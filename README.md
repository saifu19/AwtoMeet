# AwtoMeet

**Real-time meeting intelligence, in the browser.** Schedule a meeting, join it as a live audio/video call, and let a roster of AI agents listen in — transcribing every speaker, reasoning over what's said, and streaming insights to a live dashboard.

Each agent carries its own system prompt, its own LLM (OpenAI or Anthropic, picked per-agent), and its own private rolling memory of the meeting. After the call ends, a post-meeting summary is generated against a fixed agenda.

No external SaaS on the AI path. Self-hostable end-to-end with one `docker compose up`.

---

## Table of Contents

- [Loom Demo](#loom-demo)
- [What I built](#what-i-built)
- [What makes it different](#what-makes-it-different)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repo Layout](#repo-layout)
- [Quick Start — Docker (the easy path)](#quick-start--docker-the-easy-path)
- [Quick Start — Local Development](#quick-start--local-development)
- [Environment Variables](#environment-variables)
- [Project Scripts](#project-scripts)
- [Testing](#testing)
- [Design System](#design-system)
- [Production Deployment](#production-deployment)
- [Documentation](#documentation)

---

## Loom Demo

[![Watch the demo](./demo.png)](https://www.loom.com/share/46761d8a2e75406aa52240db0d3f98f5)

---

## What I built

- Designed and implemented the end-to-end real-time meeting pipeline
- Integrated LiveKit for multi-participant audio/video with per-track speaker identity
- Built streaming transcription pipeline using Whisper (`gpt-4o-transcribe`)
- Implemented event-driven agent orchestration using LangGraph with isolated memory per agent
- Developed Fastify-based backend with SSE streaming for live dashboard updates
- Built Python worker system for agent execution and post-meeting processing
- Designed self-hostable deployment using Docker Compose

---

## What makes it different

| Typical meeting bot | AwtoMeet |
|---|---|
| One hard-coded AI summary at the end | A configurable fanout of per-user agents, each with its own prompt + model, running continuously during the meeting |
| Diarization by ML guesswork | Per-participant audio tracks via LiveKit — speaker identity is structural, not inferred |
| Cross-agent contamination | Each agent has an isolated LangGraph thread; Agent A cannot see Agent B's memory, by construction |
| Post-hoc transcripts only | Streaming Whisper (`gpt-4o-transcribe`) + paragraph buffering + SSE feed to the dashboard while the meeting is live |
| Vendor-locked | BYO LLM keys, BYO SMTP, self-hosted LiveKit, MySQL of your choice |

---

## Architecture

```
                  +-----------------------------+
                  |  Vite + React + TS (web)    |   nginx / Vercel
                  |  shadcn + Tailwind v4       |
                  +-------------+---------------+
                                | REST + SSE
                                v
                  +-----------------------------+
                  |  Node 22 + Fastify (api)    |   Fly.io / Docker
                  |  - auth (email + Google)    |
                  |  - meetings/agents CRUD     |
                  |  - mints LiveKit tokens     |
                  |  - dispatches agent worker  |
                  |  - SSE: live insights feed  |
                  +---+----------------+--------+
                      |                |
                      v                v
            +------------+     +---------------+
            |  MySQL 8   |     | LiveKit (SFU) |
            +-----^------+     +-------+-------+
                  |                    | hidden participant
                  |                    v
                  |          +----------------------------+
                  +----------+  Python 3.12 (worker)      |   Fly.io / Docker
                             |  - livekit-agents 1.x      |
                             |  - OpenAI Whisper STT      |
                             |  - LangGraph fanout        |
                             |  - MySQL checkpointer      |
                             +----------------------------+
```

**Three processes, one repo**: `web`, `api`, `worker`. Plus MySQL and a LiveKit server (self-hosted in Docker or managed via LiveKit Cloud).

**Why two backends (Node + Python)?**
- Auth, CRUD, SSE, type-sharing with the frontend → Node + Fastify + Drizzle is fastest.
- LiveKit Agents SDK and LangGraph are best-in-class on Python.
- The worker never serves HTTP to the browser — only talks to LiveKit, MySQL, and LLM providers.

**Speaker identity is free.** Every LiveKit participant publishes their own mic track, so the worker gets perfect speaker labels without a diarization library. One STT stream per `(participant, track)`.

**Agent isolation is structural.** LangGraph threads keyed on `"{meeting_id}:{agent_id}"` mean each agent's rolling summary lives in its own checkpoint row. No cross-contamination.

---

## Tech Stack

### Frontend (`apps/web`)

| Layer | Choice |
|---|---|
| Build | Vite 8 + Tailwind v4 (Vite plugin) |
| Framework | React 19 + TypeScript (strict) |
| Routing | TanStack Router (file-based, type-safe) |
| Data | TanStack Query + MSW for mocks |
| Forms | react-hook-form + Zod (`@hookform/resolvers/standard-schema`) |
| UI | shadcn (base-nova) on Base UI React |
| State | Zustand (sidebar, auth token) |
| Theming | next-themes with `attribute="class"` |
| Fonts | Geist Variable (body) + Caveat Variable (display) |
| LiveKit client | `livekit-client` + `@livekit/components-react` |
| Testing | Vitest + Testing Library + jsdom |

### API (`apps/api`)

| Layer | Choice |
|---|---|
| Runtime | Node 22 + TypeScript |
| Framework | Fastify 5 (not Express) |
| ORM | Drizzle ORM (mysql2 driver) |
| Validation | Zod schemas shared with frontend via `packages/shared` |
| Auth | Hand-rolled: `jose` (JWT), `argon2id` (password hash), `arctic` (Google OAuth) |
| Realtime | Server-Sent Events to the dashboard |
| LiveKit | `livekit-server-sdk` for token mint + agent dispatch |
| Email | Nodemailer → any SMTP provider (Mailgun, SendGrid, Postmark, SES) |
| Testing | Vitest + a real MySQL test database |

### Worker (`apps/worker`)

| Layer | Choice |
|---|---|
| Runtime | Python 3.12 |
| Package manager | `uv` (not pip, not poetry) |
| Media | `livekit-agents ~= 1.5` with `[openai,silero]` extras |
| STT | OpenAI `gpt-4o-transcribe` (streaming) via `livekit-plugins-openai` |
| Agents | `langgraph` + `langchain-core` + `langchain-openai` + `langchain-anthropic` |
| Agent persistence | `langgraph-checkpoint-mysql` (AIOMySQLSaver) |
| DB driver | `sqlalchemy` (read) + `pymysql` (targeted writes) |
| Settings | `pydantic-settings` |
| Testing | `pytest` + `pytest-asyncio` |

### Infrastructure

| Layer | Choice |
|---|---|
| Database | MySQL 8.0.19+ (PlanetScale, RDS, or self-hosted) |
| Media | LiveKit (self-hosted via Docker Compose, or LiveKit Cloud) |
| Container | Docker + Docker Compose v2 |
| Frontend host (prod) | Vercel or any static host; or the included nginx image |
| API/Worker host (prod) | Fly.io, Railway, or any VM that runs Docker |

---

## Repo Layout

```
awtomeet/
├── apps/
│   ├── web/           Vite + React + TS frontend (pnpm workspace)
│   ├── api/           Node 22 + Fastify + Drizzle (pnpm workspace)
│   └── worker/        Python 3.12 + livekit-agents + langgraph (uv, NOT in pnpm)
├── packages/
│   └── shared/        Zod schemas + TS types shared between web and api
├── docs/              Module briefs, dep graph, ui-plan, worktree rules
├── scripts/
│   └── bootstrap.sh   Generates .env + livekit.yaml with fresh secrets
├── livekit/           Generated LiveKit server config (git-ignored)
├── docker-compose.yml
├── DEPLOYMENT.md      End-to-end Docker deployment guide
├── plan.md            Authoritative product + architecture spec
├── pnpm-workspace.yaml
└── README.md          (this file)
```

The Python `worker/` lives in the same git repo for convenience but is managed by `uv` with its own `pyproject.toml`. It is **not** part of the pnpm workspace.

---

## Quick Start — Docker (the easy path)

Brings up web + api + worker + LiveKit + migrations in one command. MySQL is external — supply the URL at bootstrap time.

### Prerequisites
- Docker 24+ and Docker Compose v2
- A reachable MySQL 8.0.19+ with an empty `meeting_app` database
- Open ports: `80/tcp`, `7880/tcp`, `7881/tcp`, `50000-50099/udp`

### Bootstrap

```bash
git clone https://github.com/saifu19/AwtoMeet && cd awtomeet

./scripts/bootstrap.sh \
  "mysql://meeting_app:<password>@<db-host>:3306/meeting_app" \
  "http://<server-ip-or-hostname>"
```

`bootstrap.sh` generates fresh `.env` and `livekit/livekit.yaml` with random secrets (`JWT_SECRET`, `INTERNAL_API_KEY`, `LIVEKIT_API_KEY`/`_SECRET`). It leaves LLM, Google OAuth, and SMTP keys blank — fill those in manually in `.env`.

### Up

```bash
docker compose up -d --build
docker compose logs -f        # watch first-boot order: livekit → migrate → api → worker → web
```

### Smoke test

```bash
curl -sI http://<host>/                   # 200
curl -s  http://<host>/api/v0/health      # {"ok":true}
```

Then open `http://<host>/` in a browser → sign up → create a meeting → join → speak → transcript lines stream into the insights dashboard.

**Full deployment guide**, including the UDP port story, log triage, secret rotation, and TLS/prod cutover: [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Quick Start — Local Development

Three processes, three terminals, one local MySQL. No Docker required.

### Prerequisites

```bash
node --version       # 22+
pnpm --version       # 10+
python --version     # 3.12+
uv --version         # any recent
# MySQL 8.0.19+ on localhost:3306
```

### 1. Install everything

```bash
git clone <repo-url> awtomeet && cd awtomeet
pnpm install

cd apps/worker && uv sync && cd ../..
```

### 2. Create the database

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS meeting_app;"
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS meeting_app_test;"   # for api tests
```

### 3. Configure secrets

```bash
cp apps/api/.env.example    apps/api/.env
cp apps/web/.env.example    apps/web/.env
cp apps/worker/.env.example apps/worker/.env
```

Minimum fields to fill in:

- `apps/api/.env`: `MYSQL_URL`, `JWT_SECRET` (`openssl rand -hex 32`), `LIVEKIT_URL`/`KEY`/`SECRET`, at least one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, `INTERNAL_API_KEY` (`openssl rand -hex 32`)
- `apps/worker/.env`: same `MYSQL_URL`, LiveKit credentials, LLM key(s), matching `INTERNAL_API_KEY`
- `apps/web/.env`: usually leave empty — the Vite dev proxy forwards `/api/v0` to `http://127.0.0.1:3001`

For LiveKit, the fastest path is a free LiveKit Cloud project at [cloud.livekit.io](https://cloud.livekit.io). Drop the URL + API key + secret into both `apps/api/.env` and `apps/worker/.env`.

### 4. Sync the schema

```bash
pnpm --filter api db:push
```

The LangGraph checkpointer tables are auto-created on first worker run.

### 5. Run all three

```bash
# Terminal 1 — API
pnpm --filter api dev          # http://localhost:3001

# Terminal 2 — Web
pnpm --filter web dev          # http://localhost:5173

# Terminal 3 — Worker
cd apps/worker && uv run python -m src.main dev
```

Open `http://localhost:5173`, sign up, and you're in.

---

## Environment Variables

### Shared across api + worker
| Variable | Purpose |
|---|---|
| `MYSQL_URL` | `mysql://user:pass@host:port/meeting_app` |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit server credentials |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | LLM keys (at least one) |
| `DEFAULT_LLM_PROVIDER` / `DEFAULT_LLM_MODEL` | Fallback when agents don't specify |
| `INTERNAL_API_KEY` | HMAC-style secret for worker → API calls |

### API-only
| Variable | Purpose |
|---|---|
| `PORT` | Defaults to 3001 |
| `NODE_ENV` | `development` or `production` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `WEB_URL` | Browser-facing URL, used for CORS + OAuth redirect |
| `CROSS_SITE_COOKIES` | `"true"` only when web and api are on different registrable domains |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Transactional email |

### Worker-only
| Variable | Purpose |
|---|---|
| `API_URL` | e.g. `http://localhost:3001` for worker → API callbacks |

### Web-only
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Empty in dev (proxy); set to absolute URL in prod if web and api are on different origins |
| `VITE_ENABLE_MSW` | `"true"` to run frontend against mocked API handlers |

---

## Project Scripts

Root `package.json`:

```bash
pnpm dev                   # all workspaces in parallel (web + api + shared)
pnpm build                 # build everything
pnpm typecheck             # typecheck everything
pnpm lint                  # lint everything
```

Per-workspace:

```bash
pnpm --filter web dev              # Vite dev server on :5173
pnpm --filter web test             # Vitest (jsdom)
pnpm --filter web build            # tsc -b && vite build → apps/web/dist

pnpm --filter api dev              # tsx watch src/index.ts
pnpm --filter api db:push          # drizzle-kit push (sync schema)
pnpm --filter api db:studio        # drizzle-kit studio UI
pnpm --filter api test             # Vitest against meeting_app_test database
pnpm --filter api build            # tsc → apps/api/dist

cd apps/worker && uv run pytest    # pytest + pytest-asyncio
cd apps/worker && uv run python -m src.main dev   # worker in dev mode
```

---

## Testing

| Layer | Tooling | Scope |
|---|---|---|
| Frontend unit | Vitest + Testing Library + MSW | Hooks, components, feature logic |
| API integration | Vitest + real MySQL (`meeting_app_test`) | Routes, DB writes, auth flows |
| Worker | pytest + pytest-asyncio | Buffer logic, fanout, graph, DB ops |
| End-to-end | Playwright (setup ready, suites WIP) | Hero flows across the live stack |

Nothing snapshots `className` strings — the UI rebrand did not touch a single test.

```bash
pnpm --filter web test
pnpm --filter api test
cd apps/worker && uv run pytest
```

---

## Design System

The `apps/web` UI is built around three principles:

- **Glass surfaces** — cards, sidebar, dialogs, popovers, select menus, toasts use a frosted `backdrop-blur` over semi-transparent fills, with a subtle border.
- **Handwritten display type** — Caveat Variable for page H1s, empty-state callouts, and the brand wordmark; Geist Variable for everything else.
- **Violet + cyan neon** — violet (`--neon`) is the primary action color, cyan (`--neon-accent`) is the "live / active" signal. Neon is shadow + border only, never on text, and at most one glowing element per viewport outside hover states.

Tokens live in `apps/web/src/index.css` as OKLCH custom properties (`--primary`, `--background`, `--neon`, `--glass`, etc.). The `.glass`, `.neon-ring`, and `.neon-ring-accent` utilities are registered via Tailwind v4 `@utility` directives.

For full component patterns, allowed classes, and the add-a-CRUD-module checklist: [docs/ui-plan.md](docs/ui-plan.md).

---

## Production Deployment

Two shapes, both documented:

1. **All-in-one Docker** — web + api + worker + LiveKit on a single host. See [DEPLOYMENT.md](DEPLOYMENT.md).
2. **Split hosting** — Vercel for web, Fly.io for api + worker, managed MySQL (PlanetScale/RDS), LiveKit Cloud. See [plan.md §10](plan.md).

Production checklist before cutover:

- TLS reverse proxy (Caddy / Traefik / nginx + Let's Encrypt) in front of `:80`; `PUBLIC_URL` must be `https://...` (WebRTC requires it).
- Flip `LIVEKIT_URL_PUBLIC` to `wss://...`.
- `NODE_ENV=production` on the api service (re-enables cookie `Secure` flag + production env assertions).
- Replace `drizzle-kit push --force` in the migrate service with real, ordered migrations.
- Pin image tags (`livekit/livekit-server:v1.x.y`, `node:22.x-alpine`) instead of `latest`.
- Back up the MySQL instance on a schedule.
- Configure SMTP for transactional emails.

---

## Documentation

- [plan.md](plan.md) — authoritative product + architecture spec. Single source of truth. Do not skip.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Docker deployment end-to-end, with log triage and secret rotation.
- [docs/ui-plan.md](docs/ui-plan.md) — design system, component patterns, and rebrand reference.
- [docs/README.md](docs/README.md) — dev workflow, worktree rules, module briefs.
- [CLAUDE.md](CLAUDE.md) — AI assistant working agreements.

---

## Credits

AwtoMeet is built on open-source foundations. Key projects worth a shout:
[LiveKit](https://livekit.io) for WebRTC media,
[LangGraph](https://github.com/langchain-ai/langgraph) for agent orchestration,
[Drizzle ORM](https://orm.drizzle.team) for schema-first MySQL,
[shadcn/ui](https://ui.shadcn.com) on [Base UI](https://base-ui.com) for the component kit,
[TanStack](https://tanstack.com) Router + Query for the frontend data layer,
[Fastify](https://fastify.dev) for the HTTP server,
[uv](https://github.com/astral-sh/uv) for Python dependency management.
