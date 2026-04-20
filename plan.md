# Project Plan — Meeting Intelligence App

> Audience: a junior engineer (or another LLM) who has never seen this project. Read top-to-bottom, do not skip sections, do not "improve" the architecture without asking. When in doubt, ask the human; do not guess.

---

## 0. What we are building (one paragraph)

A web app where users schedule meetings, optionally sync them from Google Calendar, and join them in-browser as real-time audio/video calls. While a meeting is live, an invisible Python "agent worker" joins the LiveKit room, transcribes every speaker with OpenAI's streaming Whisper (`gpt-4o-transcribe`), buffers the transcript into per-speaker paragraphs, and fans the buffered messages out to a configurable set of LangGraph-based AI agents. Each agent has its own system prompt, its own LLM (OpenAI or Anthropic, picked per-agent), and its own private rolling memory of the meeting. Agents write structured outputs to MySQL; the frontend opens a separate "live insights" dashboard that streams those outputs in real-time. After the meeting, a post-meeting summary is generated against the meeting type's fixed agenda items.

**MVP scope explicitly excludes:** voice agents speaking back into the room, recording/egress, tool-calling agents, multi-tenant orgs/billing, mobile apps. Build the foundation so these can be added later without a rewrite.

---

## 1. Architecture overview

```
                 ┌─────────────────────────────┐
                 │  Vite + React + TS frontend │   Vercel
                 │  (shadcn/ui + Tailwind)     │
                 └──────────┬──────────────────┘
                            │ REST + SSE
                            ▼
                 ┌─────────────────────────────┐
                 │  Node API (Fastify + TS)    │   Fly.io / Railway
                 │  - auth (email + Google)    │
                 │  - meetings/agents CRUD     │
                 │  - mints LiveKit tokens     │
                 │  - dispatches agent worker  │
                 │  - SSE: live insights feed  │
                 └────┬──────────────┬─────────┘
                      │              │
                      ▼              ▼
            ┌──────────────┐  ┌──────────────┐
            │   MySQL 8    │  │ LiveKit Cloud│
            │ (PlanetScale │  │   (media)    │
            │  / RDS)      │  └──────┬───────┘
            └──────▲───────┘         │
                   │                 │ joins as hidden participant
                   │                 ▼
                   │         ┌─────────────────────────────┐
                   └─────────┤  Python agent worker        │   Fly.io
                             │  - livekit-agents 1.x       │
                             │  - OpenAI Whisper STT       │
                             │  - LangGraph fan-out        │
                             │  - writes results → MySQL   │
                             └─────────────────────────────┘
```

**Three deployable processes:** `frontend`, `api`, `worker`. Plus managed MySQL, plus LiveKit Cloud. No self-hosted LiveKit for MVP.

**Why two backends (Node + Python)?** LiveKit Agents SDK is best-in-class on Python; LangGraph is Python. Auth/CRUD/serving is faster in Node and shares types with the Vite frontend. The worker only talks to MySQL + LiveKit + LLM providers; it does NOT serve HTTP to the browser.

---

## 2. Repo layout (monorepo, pnpm workspaces)

```
meeting-app/
├── apps/
│   ├── web/         # Vite + React + TS + shadcn/ui + Tailwind
│   ├── api/         # Node 22 + Fastify + TS + Drizzle ORM
│   └── worker/      # Python 3.12 + livekit-agents + langgraph (separate venv, NOT in pnpm)
├── packages/
│   └── shared/      # zod schemas + TS types shared between web and api
├── pnpm-workspace.yaml
└── plan.md
```

The Python `worker/` lives inside the same git repo for convenience but is managed by `uv` and has its own `pyproject.toml`. It is NOT part of the pnpm workspace.

---

## 3. Tech stack — locked choices

**Do not substitute these without asking the human first.**

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite + React 18 + TypeScript (strict) | |
| UI kit | shadcn/ui + Tailwind CSS | Init with `pnpm dlx shadcn@latest init` |
| Routing | TanStack Router | Type-safe, file-based |
| Data fetching | TanStack Query | |
| Forms | react-hook-form + zod | |
| LiveKit client | `livekit-client` + `@livekit/components-react` | |
| API framework | Fastify 5 + TypeScript | Not Express |
| API ORM | Drizzle ORM (mysql2 driver) | Not Prisma |
| API validation | zod (shared with frontend via `packages/shared`) | |
| Auth | Hand-rolled with `jose` (JWT) + `argon2` (password hash) + `arctic` (Google OAuth) | No Clerk/Auth0/Lucia |
| DB | MySQL 8.0.19+ | Hosted: PlanetScale or AWS RDS. Local: host MySQL instance (no docker). |
| Realtime to dashboard | Server-Sent Events from API → frontend | Not websockets, simpler. |
| Worker language | Python 3.12 | |
| Worker package mgr | `uv` | |
| LiveKit SDK | `livekit-agents ~= 1.5` with extras `[openai,silero]` | |
| STT | OpenAI `gpt-4o-transcribe` (streaming) via `livekit-plugins-openai` | NOT classic `whisper-1` (non-streaming) |
| Agent framework | `langgraph` + `langchain-core` + `langchain-openai` + `langchain-anthropic` | |
| Agent persistence | `langgraph-checkpoint-mysql` (3.x) | Real MySQL checkpointer exists, use it. |
| Hosting — frontend | Vercel | |
| Hosting — api | Fly.io (or Railway) | Long-running, persistent |
| Hosting — worker | Fly.io | NOT Vercel — worker holds persistent WebSocket to LiveKit |
| LiveKit | LiveKit Cloud Build (free) tier | ~1000 agent minutes/month |

**Default LLM:** read from env vars. Each agent row in DB has its own `provider` + `model` columns; if null, fall back to env defaults.

```env
DEFAULT_LLM_PROVIDER=openai      # or "anthropic"
DEFAULT_LLM_MODEL=gpt-4o-mini
```

---

## 4. Domain model (MySQL schema)

Drizzle schema lives in `apps/api/src/db/schema.ts`. The Python worker reads/writes the same tables via `sqlalchemy` (read-only for most tables; write to `transcript_messages`, `agent_runs`, `agent_outputs`). The LangGraph checkpointer writes to its own tables (managed by `langgraph-checkpoint-mysql`'s `.setup()`).

```
users
  id              char(26) pk            # ULID
  email           varchar(255) unique
  password_hash   varchar(255) null      # null if google-only
  google_sub      varchar(255) unique null
  display_name    varchar(255)
  created_at      datetime

sessions
  id              char(26) pk
  user_id         char(26) fk
  refresh_token_hash varchar(255)
  expires_at      datetime
  created_at      datetime

meeting_types
  id              char(26) pk
  user_id         char(26) fk            # owner; later swap for org_id (see §15)
  org_id          char(26) null          # NULLABLE NOW, populated when orgs ship
  name            varchar(255)
  description     text
  agenda_items    json                   # ["pricing", "next steps", ...]
  buffer_size     int default 10         # MOVED here from agents — controls fanout
                                         # cadence for ALL agents on this meeting type
  created_at      datetime

meeting_type_agents                      # many-to-many
  meeting_type_id char(26) fk
  agent_id        char(26) fk
  primary key (meeting_type_id, agent_id)

agents                                   # the "AI agent" definitions
  id              char(26) pk
  user_id         char(26) fk
  org_id          char(26) null          # see §15
  name            varchar(255)
  system_prompt   text
  provider        varchar(32) null       # "openai" | "anthropic" | null=default
  model           varchar(64) null
  created_at      datetime

meetings
  id              char(26) pk
  user_id         char(26) fk            # creator/owner
  org_id          char(26) null          # see §15
  meeting_type_id char(26) fk null
  title           varchar(255)
  description     text
  scheduled_at    datetime null
  google_event_id varchar(255) null
  livekit_room    varchar(255) unique    # = "meeting-{id}"
  status          enum('scheduled','live','ended','cancelled')
  worker_job_id   varchar(255) null      # active LiveKit dispatch id; used for idempotent dispatch + "has worker" check. Cleared on worker disconnect.
  started_at      datetime null
  ended_at        datetime null

meeting_invites                          # who's invited + what they can see
  id              char(26) pk
  meeting_id      char(26) fk
  invited_email   varchar(255)           # may not be a registered user yet
  invited_user_id char(26) fk null       # populated on first acceptance
  role            enum('host','participant','observer') default 'participant'
  can_view_insights boolean default false  # the toggle the host flips at invite time
  invite_token    varchar(64) unique     # opaque, used in invite link
  accepted_at     datetime null
  created_at      datetime
  index (meeting_id)
  index (invited_user_id)
  unique (meeting_id, invited_email)

transcript_messages                      # one row per "paragraph"
  id              bigint pk auto_increment
  meeting_id      char(26) fk
  speaker_identity varchar(255)          # livekit participant identity
  speaker_name    varchar(255)
  text            text
  start_ts_ms     bigint                 # ms from meeting start
  end_ts_ms       bigint
  created_at      datetime
  index (meeting_id, id)

agent_runs                               # one row per buffer-flush invocation
  id              bigint pk auto_increment
  meeting_id      char(26) fk
  agent_id        char(26) fk
  buffer_start_msg_id bigint
  buffer_end_msg_id   bigint
  status          enum('pending','running','done','error')
  error           text null
  prompt_tokens   int null               # usage tracking — see §16
  completion_tokens int null
  cost_usd        decimal(10,6) null     # computed from provider/model price table
  started_at      datetime
  finished_at     datetime null
  index (meeting_id, agent_id)

usage_counters                           # rolled-up monthly usage per user
  id              bigint pk auto_increment
  user_id         char(26) fk
  org_id          char(26) null          # see §15
  period          char(7)                # "2026-04"
  meeting_minutes int default 0
  prompt_tokens   bigint default 0
  completion_tokens bigint default 0
  cost_usd        decimal(12,6) default 0
  unique (user_id, period)

usage_limits                             # null = unlimited; controllable by superadmin
  id              bigint pk auto_increment
  user_id         char(26) fk null       # null + org_id null = global default
  org_id          char(26) null
  max_meeting_minutes_per_month int null
  max_cost_usd_per_month        decimal(12,2) null
  max_agents                    int null
  updated_at      datetime
  index (user_id)
  index (org_id)

agent_outputs                            # what an agent emitted in a run
  id              bigint pk auto_increment
  agent_run_id    bigint fk
  meeting_id      char(26) fk            # denormalized for SSE filtering
  agent_id        char(26) fk
  content         text                   # markdown
  metadata        json                   # structured fields if any
  created_at      datetime
  index (meeting_id, created_at)

meeting_summaries                        # post-meeting agenda extraction
  id              bigint pk auto_increment
  meeting_id      char(26) fk unique
  agenda_findings json                   # { "pricing": "...", "next steps": "..." }
  raw_summary     text
  generated_at    datetime
```

The LangGraph MySQL checkpointer will create its own tables (`checkpoints`, `checkpoint_writes`, etc.) on first run via `PyMySQLSaver.from_conn_string(...).setup()`. Use `thread_id = f"{meeting_id}:{agent_id}"` so each (meeting, agent) pair has isolated memory — this is how we satisfy the "agents must not see each other's outputs" requirement.

---

## 5. Auth design

We issue our own JWTs. No third-party auth provider.

**Access token:** short-lived (15 min), HS256 signed with `JWT_SECRET`, payload `{ sub: user_id, email, exp, iat }`. Sent as `Authorization: Bearer ...`.

**Refresh token:** long-lived (30 days), opaque random string, hashed and stored in `sessions` table. Sent as `httpOnly`, `secure`, `sameSite=lax` cookie. Frontend calls `POST /auth/refresh` when access token expires.

**Endpoints (Fastify):**

```
POST /auth/signup          { email, password, display_name }   → { access, user }
POST /auth/login           { email, password }                  → { access, user }
POST /auth/refresh         (cookie)                             → { access }
POST /auth/logout          (cookie)                             → 204
GET  /auth/google/start                                         → redirect to Google
GET  /auth/google/callback ?code&state                          → set cookie, redirect /
GET  /auth/me                                                   → { user }
```

**Google OAuth:** use `arctic` (small, modern OAuth lib). On callback, look up by `google_sub`; if not found, look up by email; if not found, create user with `password_hash = null`. Then issue our own JWTs — the Google token is discarded immediately. This is the "both issue JWT" requirement. The access JWT is returned to the web app via the URL **fragment** (`#access=...`), never the query string — fragments are never sent to the server, are stripped from the `Referer` header, and do not land in proxy logs. The frontend reads `window.location.hash`, stores the token in memory, and wipes the fragment via `history.replaceState` before any subsequent navigation.

**Password hashing:** `argon2id` with pinned parameters (`memoryCost=65536`, `timeCost=3`, `parallelism=4`) — not library defaults, so future upgrades cannot silently weaken the work factor. No bcrypt.

**Hardening plumbing** (all live in `apps/api/src/index.ts` + `plugins/error-handler.ts`):
- **CORS** via `@fastify/cors` with `origin: [WEB_URL]` and `credentials: true`. Same-origin is not assumed because web and api live on different ports in dev and on different hostnames in prod.
- **Rate limiting** via `@fastify/rate-limit`: global fallback of `300 / min`, with per-route caps of `10 / 15 min` on `/auth/signup` and `/auth/login` (brute-force defense) and `60 / 15 min` on `/auth/refresh` (normal usage is ~1/15min).
- **Production env guard**: on boot, the API throws if `NODE_ENV=production` and any of `WEB_URL`, `JWT_SECRET`, `LIVEKIT_URL` is missing. Silent fallbacks to localhost are a production footgun.
- **5xx sanitization**: the shared error handler echoes `err.message` verbatim for 4xx (caller fault, safe) but masks 5xx as `internal_error` in production and logs the full error server-side. SQL errors, file paths, and driver internals must not reach clients.

**LiveKit token minting** is a separate, internal step done by `POST /meetings/:id/join` (see §6). The LiveKit JWT is NOT the same as the auth JWT — it's a short-lived (1 hour) capability token signed with `LIVEKIT_API_SECRET` using `livekit-server-sdk` (Node).

---

## 6. API surface (Fastify)

All routes except `/auth/*` and `/health` require a valid access JWT. All request/response bodies validated with zod schemas in `packages/shared`.

```
GET    /health
GET    /me

# Meeting types
GET    /meeting-types
POST   /meeting-types          { name, description, agenda_items, agent_ids }
GET    /meeting-types/:id
PATCH  /meeting-types/:id
DELETE /meeting-types/:id

# Agents (the AI agents)
GET    /agents
POST   /agents                 { name, system_prompt, provider?, model?, buffer_size? }
GET    /agents/:id
PATCH  /agents/:id
DELETE /agents/:id

# Meetings
GET    /meetings               ?status=scheduled|live|ended
                                 # returns meetings owned by user AND meetings with accepted invite
POST   /meetings               { title, description, scheduled_at?, meeting_type_id?, auto_classify? }
GET    /meetings/:id
PATCH  /meetings/:id
DELETE /meetings/:id
POST   /meetings/:id/join      → { livekit_url, livekit_token }
                                 # host's first join: sets started_at (status stays 'scheduled')
                                 # dispatches worker if meeting.worker_job_id is NULL (idempotent)
                                 # status transitions to 'live' later, by the worker, when it sees the first non-agent participant
POST   /meetings/:id/leave     → 204
POST   /meetings/:id/join-guest { display_name }  → { livekit_url, livekit_token }
                                 # NO auth required; guest gets ephemeral LiveKit token
                                 # identity = "guest-{ulid}"; only works on live meetings
POST   /meetings/:id/end       → triggers post-meeting summary job

# Meeting invites
GET    /meetings/:id/invites
POST   /meetings/:id/invites              { invited_email, role?, can_view_insights }
PATCH  /meetings/:id/invites/:inviteId    { role?, can_view_insights? }
DELETE /meetings/:id/invites/:inviteId
POST   /invites/:token/accept             # called by invitee after login/signup

# Superadmin (gated by users.is_superadmin)
GET    /admin/users
GET    /admin/users/:id/usage
PATCH  /admin/users/:id/limits   { max_meeting_minutes_per_month?, max_cost_usd_per_month?, max_agents? }
GET    /admin/usage              # system-wide rollup

# Live insights (dashboard)
GET    /meetings/:id/transcript                  # full so far
GET    /meetings/:id/insights                    # all agent_outputs so far
GET    /meetings/:id/agents                      # agents attached to meeting's meeting_type (insights-gated)
POST   /meetings/:id/stream-session              # mints 60s stream_session cookie for the SSE handshake
GET    /meetings/:id/stream    (SSE)             # live transcript + insights events (cookie-auth)

# Google calendar (stub for MVP — implement after core works)
GET    /integrations/google/calendar/connect
GET    /integrations/google/calendar/events
POST   /integrations/google/calendar/import      { event_ids: [] }

# Email (SMTP / Nodemailer)
# Transactional emails — invites, welcome, summary-ready notifications
# Configured via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM env vars
# Works with any SMTP provider (Mailgun, SendGrid, etc.) — falls back to console in dev
POST   /meetings/:id/notify-summary    # internal: worker → API after summary generation (X-Internal-Key auth)

# Post-meeting
GET    /meetings/:id/summary
```

**Auto-classify** (`POST /meetings { auto_classify: true }`): if no `meeting_type_id` is given but `auto_classify=true`, the API calls an LLM with the meeting title+description and the user's available `meeting_types[*].{name,description}` and picks one. Use `gpt-4o-mini` from the env default. This runs synchronously inside the create handler — it's fast.

**Meeting lifecycle** (`POST /meetings/:id/join`): status transitions are split across API and worker, so the UI only shows "live" when a real participant is actually in the room:
- Host's first `/join`: API sets `started_at = now()` but leaves `status = 'scheduled'`. This is the "host has opened the room" signal.
- Non-host or guest `/join`: allowed if `started_at` is already set (host has opened). 409 otherwise.
- Worker, on first non-agent `participant_connected`: transitions `status: scheduled → live`.
- Worker, on last human leaving (`participant_disconnected` with 0 humans left) OR on room `disconnected`: transitions `status → 'ended'`, sets `ended_at`, clears `worker_job_id`, and disconnects itself from the room.

**Dispatching the worker** (`POST /meetings/:id/join`): idempotency lives in the DB, not in error-swallowing. Before calling the LiveKit API, the route checks `meeting.worker_job_id`; if non-NULL, a worker is already registered for this meeting and the route skips dispatch entirely. Otherwise, call `livekit-server-sdk`'s `AgentDispatchClient.createDispatch(meeting.livekit_room, 'meet-transcriber', { metadata: JSON.stringify({ meeting_id }) })` (positional args: roomName, agentName, options), take the returned `dispatch.id`, and persist it to `meetings.worker_job_id`. The worker itself writes `worker_job_id` again on entrypoint (belt-and-suspenders, using its own `ctx.job.id`) and clears it on disconnect. This means a crashed worker that rejoins the same meeting will transparently re-dispatch.

**Worker DB writes**: the Python worker owns a few targeted writes to the `meetings` row via `apps/worker/src/db.py` (pymysql, `SET time_zone = '+00:00'` on connect to match the API's `timezone: 'Z'` pool, explicit `datetime.now(timezone.utc)` parameters — never `NOW()`):
- `register_worker(meeting_id, job_id)` — called in `entrypoint` before `ctx.connect(...)`. Sets `meetings.worker_job_id`.
- `mark_meeting_live(meeting_id)` — called from `participant_connected` when the joining participant's `kind == PARTICIPANT_KIND_STANDARD`. Transitions status to `live` and sets `started_at`, guarded by `WHERE status = 'scheduled'` so it's idempotent.
- `deregister_worker(meeting_id)` — called on `participant_disconnected` (when 0 humans remain) and again on `disconnected`. Sets status to `ended`, sets `ended_at`, clears `worker_job_id`, guarded by `WHERE status IN ('live','scheduled')` so double-calls are safe.

M31 (`TranscriptMessage` model + `persist_messages`) adds to this same `db.py` file — the dispatch/lifecycle functions above are M22 + M30 scope.

**SSE stream** (`GET /meetings/:id/stream`): the API holds an open connection per dashboard tab. It polls the DB every 1s for new `transcript_messages` and `agent_outputs` for that meeting where `id > last_seen_id` and pushes them as `event: transcript` / `event: insight` SSE frames. (Polling is fine for MVP scale of 10 users. Later: replace with MySQL CDC or Redis pub/sub.)

---

## 7. The Python worker — the heart of the app

`apps/worker/` layout:

```
worker/
├── pyproject.toml          # uv-managed
├── .env.example
├── src/
│   ├── main.py             # entrypoint, WorkerOptions, dispatch handler
│   ├── transcription.py    # STT stream + paragraph buffer
│   ├── buffer.py           # MessageBuffer class
│   ├── fanout.py           # routes flushed buffers to per-agent LangGraph runners
│   ├── graph.py            # LangGraph definition (one graph, parameterized)
│   ├── db.py               # sqlalchemy session, models matching MySQL schema
│   ├── settings.py         # pydantic-settings (env vars)
│   └── summary.py          # post-meeting summarizer (called via DB flag or RPC)
└── Dockerfile
```

### 7.1 Worker entrypoint (`main.py`)

```python
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, WorkerPermissions, AutoSubscribe, cli
from livekit.plugins import openai, silero

from .transcription import attach_transcription
from .fanout import AgentFanout
from .db import session_scope
from .settings import settings

load_dotenv()

async def entrypoint(ctx: JobContext):
    meta = ctx.job.metadata or "{}"
    import json, asyncio
    meeting_id = json.loads(meta)["meeting_id"]

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # One fanout instance per meeting; loads agent definitions from MySQL once.
    fanout = AgentFanout(meeting_id=meeting_id)
    await fanout.load_agents()

    stt = openai.STT(model="gpt-4o-transcribe", language="en")
    disconnect_event = asyncio.Event()

    @ctx.room.on("track_subscribed")
    def on_track(track, pub, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            ctx.create_task(attach_transcription(
                ctx=ctx,
                participant=participant,
                track=track,
                stt=stt,
                fanout=fanout,
                meeting_id=meeting_id,
            ))

    # LiveKit event handlers are sync — they cannot `await`. On disconnect we
    # only flip a sentinel; the actual async cleanup runs at the tail of
    # `entrypoint` where it can be awaited before the job exits. Doing cleanup
    # via `ctx.create_task(...)` inside this handler is racy: the LiveKit
    # framework may tear down the event loop before the background task
    # finishes, dropping the final flush.
    @ctx.room.on("disconnected")
    def on_disconnected(reason):
        disconnect_event.set()

    try:
        await disconnect_event.wait()
    finally:
        # Order per §13.6: cancel STT streams → flush buffers → finalize meeting.
        await fanout.flush_all_and_finalize()


def prewarm(proc):
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name="meet-transcriber",   # explicit dispatch only
        permissions=WorkerPermissions(
            can_subscribe=True,
            can_publish=False,
            can_publish_data=True,
            hidden=True,
        ),
    ))
```

### 7.2 Paragraph buffer (`buffer.py`)

```python
from dataclasses import dataclass, field
from typing import Callable, Awaitable
import asyncio, time

@dataclass
class Message:
    speaker_identity: str
    speaker_name: str
    text: str
    start_ts_ms: int
    end_ts_ms: int

@dataclass
class MessageBuffer:
    on_flush: Callable[[list[Message]], Awaitable[None]]
    max_messages: int = 10
    silence_ms: int = 1500
    _buf: list[Message] = field(default_factory=list)
    _last_speaker: str | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def add(self, msg: Message):
        async with self._lock:
            self._buf.append(msg)
            if len(self._buf) >= self.max_messages:
                await self._flush_locked()

    async def maybe_flush_on_silence(self):
        # called periodically; flush if buffer non-empty and quiet long enough
        async with self._lock:
            if not self._buf:
                return
            now_ms = int(time.time() * 1000)
            if now_ms - self._buf[-1].end_ts_ms > self.silence_ms * 4:
                await self._flush_locked()

    async def _flush_locked(self):
        if not self._buf:
            return
        msgs, self._buf = self._buf, []
        await self.on_flush(msgs)
```

The buffer is **per meeting, not per agent.** A single buffer collects from all speakers; on flush it hands the same list to every agent in the fanout.

### 7.3 LangGraph definition (`graph.py`)

One graph, parameterized at runtime per (meeting_id, agent_id). Each node receives the agent's row, the rolling summary, prior outputs by THIS agent, and the new buffer.

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.mysql.aio import AIOMySQLSaver
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

class AgentState(TypedDict):
    system_prompt: str
    provider: str
    model: str
    rolling_summary: str          # what THIS agent has seen so far
    new_buffer_text: str          # the just-flushed messages, formatted
    last_output: str              # what this agent JUST produced this turn

def build_graph(checkpointer):
    g = StateGraph(AgentState)

    async def process(state: AgentState) -> AgentState:
        llm = init_chat_model(state["model"], model_provider=state["provider"])
        prompt = [
            SystemMessage(content=(
                state["system_prompt"]
                + "\n\n[Meeting context so far — your private memory]\n"
                + (state["rolling_summary"] or "(none yet)")
            )),
            HumanMessage(content=(
                "New transcript chunk from the meeting:\n\n"
                + state["new_buffer_text"]
                + "\n\nProcess this chunk according to your role. "
                  "Reply with your insight in markdown."
            )),
        ]
        resp = await llm.ainvoke(prompt)
        return {**state, "last_output": resp.content}

    async def update_summary(state: AgentState) -> AgentState:
        llm = init_chat_model(state["model"], model_provider=state["provider"])
        prompt = [
            SystemMessage(content="You maintain a concise running summary of a meeting from one observer's perspective. Keep under 1500 tokens. Preserve concrete facts, decisions, and open questions."),
            HumanMessage(content=(
                f"Previous summary:\n{state['rolling_summary'] or '(none)'}\n\n"
                f"New transcript chunk:\n{state['new_buffer_text']}\n\n"
                f"Your previous insight on this chunk:\n{state['last_output']}\n\n"
                "Return ONLY the updated summary."
            )),
        ]
        resp = await llm.ainvoke(prompt)
        return {**state, "rolling_summary": resp.content}

    g.add_node("process", process)
    g.add_node("update_summary", update_summary)
    g.add_edge(START, "process")
    g.add_edge("process", "update_summary")
    g.add_edge("update_summary", END)
    return g.compile(checkpointer=checkpointer)
```

`init_chat_model` accepts `("gpt-4o-mini", model_provider="openai")` or `("claude-sonnet-4-6", model_provider="anthropic")` — same call, swap strings. That's how we satisfy "user picks provider/model per agent."

### 7.4 Fanout (`fanout.py`)

```python
class AgentFanout:
    def __init__(self, meeting_id: str):
        self.meeting_id = meeting_id
        self.agents: list[AgentRow] = []
        self.checkpointer: AIOMySQLSaver | None = None
        self.graph = None

    async def load_agents(self):
        # SELECT a.* FROM agents a JOIN meeting_type_agents ... WHERE meeting.id = ?
        ...
        self.checkpointer = await AIOMySQLSaver.from_conn_string(settings.mysql_url).__aenter__()
        await self.checkpointer.setup()
        self.graph = build_graph(self.checkpointer)

    async def on_buffer_flush(self, msgs: list[Message]):
        # 1. Persist transcript_messages
        # 2. For each agent, kick off a graph run with thread_id = f"{meeting_id}:{agent_id}"
        formatted = "\n\n".join(
            f"[{m.speaker_name}] {m.text}" for m in msgs
        )
        for agent in self.agents:
            cfg = {"configurable": {"thread_id": f"{self.meeting_id}:{agent.id}"}}
            # Load prior state to get rolling_summary; LangGraph does this automatically
            # when you invoke with the same thread_id.
            state_in = {
                "system_prompt": agent.system_prompt,
                "provider": agent.provider or settings.default_provider,
                "model": agent.model or settings.default_model,
                "new_buffer_text": formatted,
                "rolling_summary": "",     # will be overwritten by checkpointer
                "last_output": "",
            }
            run_id = await create_agent_run(self.meeting_id, agent.id, msgs)
            try:
                result = await self.graph.ainvoke(state_in, cfg)
                await save_agent_output(run_id, result["last_output"])
            except Exception as e:
                await mark_run_error(run_id, str(e))
```

**Critical detail:** because each agent uses a unique `thread_id`, LangGraph's checkpointer keeps their `rolling_summary` strictly isolated. Agent A literally cannot read Agent B's state. This satisfies "each agent MUST ONLY see their own messages."

### 7.5 Transcription (`transcription.py`)

One STT stream per (participant, track), wrapped in `agents.stt.StreamAdapter` with Silero VAD for speech segmentation. Speaker identity is captured by closure — never mix participants into one stream. See `docs/modules/M30-stt-stream.md` for the full implementation contract.

Emission contract (per M30):
- **One `Message` per `FINAL_TRANSCRIPT` event** — the `StreamAdapter` + VAD already produce sentence-sized utterances, and the buffer layer (§7.2) handles downstream aggregation by speaker/silence.
- **Timestamps are wall-clock epoch ms** captured in the worker on `START_OF_SPEECH` / `END_OF_SPEECH` / `FINAL_TRANSCRIPT`. We do not use `alt.start_time` / `alt.end_time` from the STT SDK — those are stream-relative and unreliable across the event types we handle. Wall-clock works because a single Python process has no NTP skew, and it makes cross-stream ordering trivial.
- Empty / whitespace-only `FINAL_TRANSCRIPT`s are dropped.

```python
async def attach_transcription(*, participant, track, stt, sink):
    # IMPORTANT: speaker identity comes from `participant`, captured by closure.
    # Every LiveKit participant publishes their own mic track, so we get perfect
    # speaker labels for free — NO diarization library, NO ML guesswork. One
    # stream per (participant, track). Do not merge audio across participants.
    audio = rtc.AudioStream(track)
    stream = stt.stream()

    async def pump():
        try:
            async for ev in audio:
                stream.push_frame(ev.frame)
        finally:
            stream.end_input()
    pump_task = asyncio.create_task(pump())

    para_start_ms: int | None = None
    para_end_ms: int | None = None

    try:
        async for ev in stream:
            if ev.type == SpeechEventType.START_OF_SPEECH:
                para_start_ms = int(time.time() * 1000)
            elif ev.type == SpeechEventType.END_OF_SPEECH:
                para_end_ms = int(time.time() * 1000)
            elif ev.type == SpeechEventType.FINAL_TRANSCRIPT:
                alt = ev.alternatives[0] if ev.alternatives else None
                if alt is None or not alt.text.strip():
                    para_start_ms, para_end_ms = None, None
                    continue
                now_ms = int(time.time() * 1000)
                msg = Message(
                    speaker_identity=participant.identity,
                    speaker_name=participant.name or participant.identity,
                    text=alt.text.strip(),
                    start_ts_ms=para_start_ms or now_ms,
                    end_ts_ms=para_end_ms or now_ms,
                )
                await sink.on_paragraph(msg)
                para_start_ms, para_end_ms = None, None
    finally:
        pump_task.cancel()
        await stream.aclose()
```

The `sink` protocol is `async def on_paragraph(self, msg: Message) -> None`. M30 wires a `PrintSink`; M31 swaps it for the real `MessageBuffer`.

### 7.6 Post-meeting summary (`summary.py`)

Triggered when the room empties (or `POST /meetings/:id/end` flips a DB flag the worker polls). Loads all `transcript_messages` for the meeting + the meeting type's `agenda_items`, calls one LLM with a structured-output prompt, writes to `meeting_summaries`. Independent of agents — uses default LLM.

---

## 8. Frontend (`apps/web`)

### 8.1 Pages

```
/login                   email+password, "Sign in with Google" button
/signup                  same
/                        redirect to /dashboard
/dashboard               list of upcoming + recent meetings, CTA "New meeting"
/meetings/new            form: title, description, scheduled_at, meeting_type or auto-classify
/meetings/:id            meeting detail, "Join now" button
/meetings/:id/room       in-meeting page: LiveKit video grid + live captions
/meetings/:id/insights   live dashboard, opens in new tab while meeting is running
/meetings/:id/summary    post-meeting agenda findings + transcript
/agents                  CRUD list of AI agents
/agents/new              form: name, system_prompt, provider, model, buffer_size
/agents/:id              edit
/meeting-types           CRUD list of meeting types
/meeting-types/new       form: name, description, agenda_items[], agent_ids[]
/meeting-types/:id       edit
/settings                profile, connected accounts (Google)
/settings/integrations   Google Calendar connect
```

### 8.2 In-meeting room page

Use `@livekit/components-react`'s `LiveKitRoom` + `VideoConference` prebuilt for MVP. On mount, call `POST /meetings/:id/join` to get `{ url, token }`. Pass to `<LiveKitRoom serverUrl={url} token={token} connect>`. Add a custom `<LiveCaptions />` overlay that subscribes to `RoomEvent.DataReceived` filtered by `topic === "transcript"` (the worker publishes captions on this topic). Captions are **fire-and-forget**: the worker publishes each paragraph to the room data channel **before** it hands the message to the persistence sink, so the overlay feels instant and a failed publish never blocks the M31 DB write or M33 SSE feed. The overlay must never persist from the browser — the DB is owned by the worker.

### 8.3 Insights dashboard page

Opens in a separate tab via `window.open('/meetings/:id/insights', '_blank')`. Subscribes to `GET /meetings/:id/stream` (SSE) using native `EventSource`. Renders two columns:

- **Live transcript** (left): chronological list of `transcript_messages`.
- **Agent insights** (right): tabs per agent, each tab is a chronological feed of that agent's `agent_outputs`. Markdown rendered.

**Auth handshake.** Native `EventSource` cannot set an `Authorization` header. Before opening the stream, the dashboard calls `POST /meetings/:id/stream-session` with the normal bearer access token. The API verifies the bearer, asserts `can_view_insights`, and mints a **60-second**, meeting-scoped, `HttpOnly` `stream_session` cookie (JWT with `kind:'stream'` and `meeting_id` claim, `Path` scoped to that one stream endpoint). The dashboard then opens `new EventSource(url, { withCredentials: true })` — the browser attaches the cookie, the API validates it once in the `requireStreamAuth` preHandler, and the hijacked SSE loop runs for up to `MAX_STREAM_MS` without revalidation. A leaked cookie is usable for 60 seconds max, after which reconnects require a fresh mint via normal bearer auth. This is the ONLY place where a cookie carries authorization; all other routes remain bearer-only. **Do not** pass the access token as a URL query parameter — tokens in URLs leak into server logs, browser history, and `Referer` headers.

The right-column tab list is fetched via `GET /meetings/:id/agents`, which reuses `assertCanViewInsights` so both hosts and invited viewers can populate it — the existing `/meeting-types/:id` and `/agents/:id` endpoints are ownership-gated and would 404 for invitees.

---

## 9. Local development

```bash
# 1. Prereqs
node -v   # 22+
pnpm -v   # 10+
python --version   # 3.12+
uv --version
# Local MySQL 8.0.19+ running on :3306 with a `meeting_app` database

# 2. Clone, install JS
git clone <repo> meeting-app && cd meeting-app
pnpm install

# 3. Configure secrets
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env
# Fill in: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (from LiveKit Cloud project)
#         OPENAI_API_KEY, ANTHROPIC_API_KEY
#         GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
#         JWT_SECRET (generate: openssl rand -hex 32)
#         MYSQL_URL=mysql://root:root@localhost:3306/meeting_app

# 5. Run migrations
pnpm --filter api db:push

# 6. Install Python worker
cd apps/worker
uv sync
cd ../..

# 7. Run all three processes (in three terminals or via concurrently)
pnpm --filter api dev               # http://localhost:3001
pnpm --filter web dev               # http://localhost:5173
cd apps/worker && uv run python -m src.main dev
```

A LiveKit Cloud project is mandatory — there is no useful "fake LiveKit" mode for development. Free tier is fine. Get credentials from cloud.livekit.io.

---

## 10. Deployment

**Frontend → Vercel:** standard Vite project. Set `VITE_API_URL` to the Fly API URL.

**API → Fly.io:** `fly launch` from `apps/api/`, set secrets via `fly secrets set ...`. Persistent VM, not Machines-on-demand. Health check on `GET /health`.

**Worker → Fly.io:** separate Fly app. `Dockerfile` based on `python:3.12-slim`, install `uv`, copy `pyproject.toml`, `uv sync --frozen`, `CMD ["uv", "run", "python", "-m", "src.main", "start"]`. Set same secrets. **Do not put this on Vercel** — it holds a persistent WebSocket and spawns subprocesses per job; serverless will not work.

**MySQL → PlanetScale or AWS RDS:** point all three apps at the same connection string. Run `pnpm --filter api db:push` once after provisioning. The langgraph checkpointer tables are auto-created on worker first start.

**LiveKit → LiveKit Cloud:** create one project, copy URL/key/secret into both API and worker secrets.

---

## 11. Order of implementation (build this in this order, do not skip ahead)

1. **Repo skeleton:** monorepo, three apps, shared package, README. Local MySQL is assumed to already be running on the dev machine.
2. **DB schema + migrations** (apps/api/src/db/schema.ts) and `db:push` working against the host MySQL instance.
3. **Auth (email/password only):** signup, login, refresh, me. Argon2 + jose. Cover with a few tests.
4. **Auth (Google OAuth):** arctic, callback, account linking by email. Manual smoke test.
5. **Frontend auth shell:** Vite + Tailwind + shadcn init, login/signup pages, protected route HOC, `useMe` hook, logout.
6. **Agents CRUD** (api + web).
7. **Meeting types CRUD** including agent multi-select (api + web).
8. **Meetings CRUD** without LiveKit yet — just DB rows.
9. **LiveKit join flow:** `POST /meetings/:id/join` mints token, frontend `/meetings/:id/room` joins room. Verify two browser tabs can see each other.
9.5. **Invites + Guest Access:** invite CRUD (`POST /meetings/:id/invites`), accept flow (`POST /invites/:token/accept`), `canJoinRoom` auth helper (host OR accepted invitee), guest join endpoint (`POST /meetings/:id/join-guest` — no auth, display name only, live meetings only), public guest join page at `/join/:id`. Verify: host invites user B by email → B accepts → B joins room. Verify: guest visits `/join/:id` → enters name → joins live meeting without signup.
10. **Python worker — minimum viable:** entrypoint, explicit dispatch, joins the room, logs participants. Verify dispatch from `POST /meetings/:id/join`.
11. **STT only:** worker subscribes to audio tracks, runs Whisper, prints final transcripts to console with speaker identity.
12. **Transcript persistence:** worker writes `transcript_messages` to MySQL via paragraph buffer. Verify rows appear.
13. **Insights SSE endpoint + dashboard page:** transcript only, no agents yet. Open in second tab during a call, see live transcript.
14. **LangGraph fanout — single hard-coded agent:** wire up MySQL checkpointer, build graph, run on every buffer flush, persist `agent_runs` + `agent_outputs`. Show in dashboard.
15. **Fanout to all agents on the meeting type.** Verify isolated thread_ids by inspecting `checkpoints` table.
16. **In-meeting live captions overlay** via room data channel.
17. **Post-meeting summary** against agenda items.
18. **Auto-classify** meeting type from description.
19. **Google Calendar import** (lowest priority — implement only after everything else works).
19.5. **Email service (SMTP / Nodemailer):** `apps/api/src/services/email.ts` + templates, wire into invite creation (replace console.log), signup welcome, post-meeting summary notification. Internal `POST /meetings/:id/notify-summary` endpoint for worker→API. Works with any SMTP provider (Mailgun, SendGrid, etc.) via username/password. Verify: invite sends email, signup sends welcome, summary-ready notifies host+invitees. Falls back to console in dev.
20. **Deploy** all three to Vercel/Fly, smoke test with the human and 1 other person.

Each step ends with a manual smoke test. Do not move to the next step until the current one works end-to-end.

---

## 12. Things to NOT do (anti-requirements)

- Do not add tool-calling to agents in MVP. The graph is `process → update_summary → END`. Nothing else.
- Do not let agents see each other's outputs. Enforced by per-agent `thread_id`.
- Do not run the Python worker on Vercel or any serverless platform.
- Do not use `whisper-1` (non-streaming). Use `gpt-4o-transcribe`.
- Do not store the LiveKit API secret in the frontend or in the worker's Docker image — only in env/secrets.
- Do not implement Egress/recording in MVP.
- Do not implement orgs/teams/billing in MVP — every resource is owned by a single `user_id`. Schema leaves room to add `org_id` later without rewrites.
- Do not replace MySQL with Postgres "because the LangGraph docs use Postgres." `langgraph-checkpoint-mysql` exists and is current — use it.
- Do not "improve" the architecture by collapsing the worker into the API process. They have different lifecycles, different runtimes, and different scaling needs.
- Do not add a diarization library (pyannote, whisperx, NeMo, etc.). Speaker identity comes from `participant.identity` because every LiveKit participant publishes their own mic track. One STT stream per (participant, track). Never merge audio from multiple participants into a single stream — that's the only thing that would force diarization, and it's pure self-harm.
- Do not reload agents or meeting-type config mid-meeting. Agents are loaded once when the worker joins; edits made by users during a live meeting do not take effect until the next meeting. Leave a `# FUTURE: hot reload` hook in `fanout.py` and stop there.
- Do not commit `.env`. There's already one in the repo root from a prior project — leave it untouched and gitignored.

---

## 13. Resolved product decisions (locked)

These were open in earlier drafts; the human has answered them. Do not relitigate.

1. **Tenancy:** Single-user-owned for MVP. Every row has `user_id`. **But every user-scoped table also has a nullable `org_id` column from day one** so the org rollout (§15) is a backfill, not a migration nightmare. Do not skip the `org_id` columns "because we don't need them yet" — adding them later is the painful version.

2. **Invites & insights access:** Hosts can invite people to a meeting by email. Each invite carries a `can_view_insights` boolean the host sets at invite time (and can edit until the meeting ends). The invite link includes an opaque `invite_token`. On click:
   - If invitee is logged in and email matches, link the invite to their `user_id` and grant access.
   - If invitee is not registered, they can sign up / Google-login, then the invite auto-binds by email.
   - The invitee gets access to the meeting room regardless. Access to `/meetings/:id/insights` is gated by `can_view_insights = true` on their invite row (or being the host).
   - Endpoints: `POST /meetings/:id/invites`, `GET /meetings/:id/invites`, `PATCH /meetings/:id/invites/:inviteId`, `DELETE /meetings/:id/invites/:inviteId`, `POST /invites/:token/accept`.

3. **Google Calendar:** read-only import. We never write to Google.

4. **Meeting type deletion:** soft-detach. Set `meetings.meeting_type_id = NULL`, keep the meetings and their transcripts/insights intact.

5. **Mid-meeting agent edits:** no live reload for MVP. Agents and the meeting type's `buffer_size` are snapshotted into the worker when it joins the room. Edits made during a live meeting take effect on the *next* meeting only. Leave a clearly-marked `# FUTURE: hot reload via room data message` hook in `fanout.py` so future-us has somewhere to plug in.

6. **Buffer cadence is per-meeting-type, not per-agent.** `buffer_size` lives on `meeting_types`. One shared buffer per meeting; when it flushes, every agent on the meeting type fires in parallel against the same chunk. This is the schema in §4.

7. **PII / transcript privacy:** none for MVP.

8. **Usage & limits:** see §16. Track everything from day one, enforce nothing by default (limits are nullable = unlimited), but the enforcement code path and the superadmin dashboard hooks must exist so flipping it on later is a config change, not a refactor.

9. **Guest access:** Unauthenticated users can join a **live** meeting via a public link (`/join/:meetingId`) by providing only a display name. They get an ephemeral LiveKit token with identity `guest-{ulid}`. Guests cannot access insights, transcripts, or summaries — those require auth + invite with `can_view_insights`. Only works on `live` meetings — host must start the meeting first. The host's shareable link format is `${WEB_URL}/join/${meetingId}`.

---

## 14. Source references (docs the dev should keep open)

---

## 15. Multi-tenant gap — what to leave room for

We are NOT building orgs in MVP, but we ARE pre-paving the road. Concrete rules:

- Every user-owned table (`agents`, `meeting_types`, `meetings`) has a **nullable `org_id char(26)`** column from day one. NULL means "personal." Do not omit these columns.
- All authorization checks in the API go through a single helper `assertCanAccess(user, resource)` rather than inline `WHERE user_id = ?` clauses. The helper currently checks `resource.user_id === user.id`. When orgs ship, this becomes `user_id === user.id || (resource.org_id && user.org_ids.includes(resource.org_id))`. **One function to change**, not 50.
- Resource queries go through repository functions that already accept an optional `orgId` filter parameter (ignore it for now, but the signature exists).
- The frontend's resource lists are written against `GET /agents` etc. which already returns rows scoped by the helper above — when orgs ship, the same endpoint just starts returning org-shared rows too.
- Future tables to expect: `orgs`, `org_members(org_id, user_id, role)`, `org_invites`. Don't create them now. Just don't paint yourself into a corner.

The litmus test: when the human says "ok, ship orgs," the dev should be doing **schema additions and one helper function rewrite**, not chasing `user_id` references through 200 files.

---

## 16. Usage tracking & limits

Track from day one, enforce nothing until a superadmin flips it on.

**What gets tracked, when:**

- **Meeting minutes:** the worker writes a row to `usage_counters` (UPSERT on `(user_id, period)`) when a meeting ends, incrementing `meeting_minutes` by `(ended_at - started_at)` rounded up to whole minutes. Charged to `meetings.user_id` (the host).
- **LLM tokens & cost:** every `agent_runs` row records `prompt_tokens`, `completion_tokens`, and computed `cost_usd`. LangChain's response metadata exposes token counts on `AIMessage.usage_metadata`. A small `pricing.py` module in the worker holds a `{ (provider, model): (input_per_1k, output_per_1k) }` table. After each agent run, the worker also UPSERTs into `usage_counters` for the meeting host.
- **STT minutes:** Whisper API cost is wall-clock seconds of audio per participant. Track in `usage_counters` as `cost_usd` only (don't bother with a minutes column for STT).

**Enforcement (off by default):**

- A middleware on `POST /meetings` and `POST /meetings/:id/join` calls `assertWithinLimits(user)` which loads the user's `usage_limits` row (or the global default row, `user_id = NULL AND org_id = NULL`). If any limit is non-NULL and the current period's `usage_counters` exceeds it, return `429 { code: 'usage_limit_exceeded', limit, current }`.
- For MVP, the global default row is inserted at migration time with all limits = NULL. Result: infinite usage. The plumbing exists; flipping it on is a single SQL UPDATE.

**Superadmin dashboard (stubbed in MVP):**

- Add a `users.is_superadmin boolean default false` column.
- Add `GET /admin/users`, `GET /admin/users/:id/usage`, `PATCH /admin/users/:id/limits`, `GET /admin/usage` (system-wide rollup). All gated by `is_superadmin`.
- Frontend route `/admin` (only visible if `me.is_superadmin`). For MVP, build a single page that lists users with current-period usage and inline-editable limit fields. Skinny, ugly, functional. Set yourself as superadmin via a SQL UPDATE.

**Cost computation correctness:**

The pricing table is the source of truth and **will go stale.** Add a `# REVIEW QUARTERLY` comment in `pricing.py` and a unit test that fails if any model in the table is older than 6 months without being touched. This is the cheap version of "ops process."

---

## 17. Source references (docs the dev should keep open)

- LiveKit Agents (Python): https://docs.livekit.io/agents/
- LiveKit Agents dispatch: https://docs.livekit.io/agents/build/dispatch/
- LiveKit OpenAI STT plugin: https://docs.livekit.io/agents/models/stt/plugins/openai/
- LiveKit deployment: https://docs.livekit.io/agents/ops/deployment/
- LiveKit examples — agent-deployment: https://github.com/livekit-examples/agent-deployment
- LangGraph persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- LangGraph MySQL checkpointer: https://github.com/tjni/langgraph-checkpoint-mysql
- LangGraph memory / summarization: https://docs.langchain.com/oss/python/langgraph/add-memory
- LangMem summarization guide: https://langchain-ai.github.io/langmem/guides/summarization/
- Nodemailer: https://nodemailer.com/
- Mailgun SMTP docs: https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/#send-via-smtp
- shadcn/ui: https://ui.shadcn.com/
- Fastify: https://fastify.dev/
- Drizzle ORM (MySQL): https://orm.drizzle.team/docs/get-started-mysql
- arctic (OAuth): https://arcticjs.dev/
- LiveKit pricing/quotas: https://livekit.com/pricing
