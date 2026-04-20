# M60 — Deploy to production
Wave: 6    Owner: <unassigned>    Branch: feat/m60-deploy
Depends on: EVERYTHING (M01 through M55)    plan.md refs: §10, §12

## Goal
Ship the three processes — web, api, worker — plus managed MySQL and LiveKit Cloud wiring to production. Frontend on Vercel, API on Fly.io, worker on Fly.io (SEPARATE app), MySQL on PlanetScale or AWS RDS, LiveKit Cloud for media. End state: human and one other person can sign up, create agents/meeting-types, schedule a meeting, invite each other, join from two browsers, see live transcription + per-agent insights, and read the post-meeting summary.

## Context (inlined from plan.md §10)
**Frontend → Vercel:** standard Vite project. Set `VITE_API_URL` to the Fly API URL.

**API → Fly.io:** `fly launch` from `apps/api/`. Persistent VM (NOT Machines-on-demand). Set secrets via `fly secrets set`. Health check on `GET /health`.

**Worker → Fly.io:** SEPARATE Fly app from the API. `Dockerfile` based on `python:3.12-slim`, installs `uv`, copies `pyproject.toml`, `uv sync --frozen`, `CMD ["uv", "run", "python", "-m", "src.main", "start"]`. Same secrets as API + LiveKit + LLM keys. **Do NOT put this on Vercel** — the worker holds a persistent WebSocket to LiveKit and spawns subprocesses per job. Serverless will not work.

**MySQL → PlanetScale or AWS RDS:** all three apps use the same connection string. Run `pnpm --filter api db:push` once after provisioning. The LangGraph checkpointer tables are auto-created on worker first start via `AIOMySQLSaver.setup()`.

**LiveKit → LiveKit Cloud:** one project, URL/key/secret into API and worker secrets. Free tier (~1000 agent-min/month) is enough for MVP.

## Files to create / modify
- **Create:** `apps/api/fly.toml` — app name `mojomeet-api`, internal port 3001, http service, health check `/health`.
- **Create:** `apps/api/Dockerfile` — `node:22-slim`, pnpm install, build TS, `CMD ["node", "dist/index.js"]`.
- **Create:** `apps/worker/fly.toml` — app name `mojomeet-worker`, NO http service (it's an outbound-only WebSocket worker), single process group.
- **Create:** `apps/worker/Dockerfile` — `python:3.12-slim`, install `uv`, copy pyproject + src, `uv sync --frozen`, `CMD ["uv","run","python","-m","src.main","start"]`.
- **Create:** `apps/web/vercel.json` (if needed) — SPA rewrites for client-side routing.
- **Create:** `.dockerignore` files per app.
- **Create:** `docs/deploy.md` (OR expand this module's Smoke test section) — one-page runbook.
- **Modify:** `apps/api/src/index.ts` — bind `0.0.0.0`, read `PORT` env.
- **Modify:** CORS config on API — allow the Vercel frontend origin.

## Implementation notes
- **Provision order:** MySQL first → LiveKit Cloud project → deploy API → deploy worker → deploy frontend. Frontend needs API URL; worker needs LiveKit + MySQL; API needs MySQL + LiveKit.
- **MySQL:** PlanetScale is easiest (free hobby tier gone, check current pricing; RDS t4g.micro as fallback). Create DB `mojomeet_prod`. Run `pnpm --filter api db:push` once locally with `MYSQL_URL` pointing at prod.
- **LiveKit Cloud:** sign up at cloud.livekit.io, create project, grab `LIVEKIT_URL` (wss://...), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **API secrets:** `fly secrets set JWT_SECRET=... MYSQL_URL=... LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... DEFAULT_LLM_PROVIDER=openai DEFAULT_LLM_MODEL=gpt-4o-mini WEB_URL=https://mojomeet.vercel.app -a mojomeet-api`.
- **Worker secrets:** same MYSQL_URL, LIVEKIT_*, OPENAI_API_KEY, ANTHROPIC_API_KEY, DEFAULT_LLM_*. No JWT/Google/WEB_URL needed.
- **Worker Fly app:** scale to 1 machine minimum, `auto_stop_machines = false`, `min_machines_running = 1`. The worker must always be alive to accept LiveKit dispatches.
- **API Fly app:** `min_machines_running = 1` as well — we use SSE, which needs a live process. Fly scale-to-zero would break SSE.
- **Frontend:** `vercel link`, set env var `VITE_API_URL=https://mojomeet-api.fly.dev`, deploy.
- **Google OAuth redirect:** after deploying, add the production callback URL(s) to the Google Cloud Console: `https://mojomeet-api.fly.dev/auth/google/callback` and `https://mojomeet-api.fly.dev/integrations/google/calendar/callback`.
- **LiveKit dispatch:** explicit dispatch by agent name (`meet-transcriber`) means no dispatch rules needed in LiveKit Cloud — the API triggers via `AgentDispatchClient`.
- **Health checks:** API `/health`. Worker has none; rely on Fly process-alive check.
- **Logs:** `fly logs -a mojomeet-api`, `fly logs -a mojomeet-worker`. Keep both terminals open during smoke test.

## Acceptance criteria
- [ ] Three Fly/Vercel apps deploy cleanly from main branch.
- [ ] `curl https://mojomeet-api.fly.dev/health` returns 200.
- [ ] Signup/login work on the Vercel frontend against the Fly API.
- [ ] Creating a meeting + joining from two browsers produces live transcription in the insights dashboard tab.
- [ ] Agent outputs appear in per-agent tabs during the meeting.
- [ ] Post-meeting summary generates and is visible at `/meetings/:id/summary`.
- [ ] Meeting invites via email link work end-to-end across accounts.
- [ ] `usage_counters` rows are populated after a real meeting.
- [ ] Worker process stays up (doesn't crash-loop) for ≥24h under idle.
- [ ] No secrets committed to git.

## Smoke test (the full runbook)
1. Provision MySQL, copy connection string.
2. Create LiveKit Cloud project, copy credentials.
3. `cd apps/api && fly launch --no-deploy` → edit fly.toml → `fly secrets set ...` → `fly deploy`.
4. `cd apps/worker && fly launch --no-deploy` → edit fly.toml (no http service, `min_machines_running=1`) → `fly secrets set ...` → `fly deploy`.
5. `cd apps/web && vercel --prod` with `VITE_API_URL` env set.
6. Add production Google OAuth callback URLs to Google Cloud Console.
7. `pnpm --filter api db:push` with `MYSQL_URL` pointed at prod — runs migrations.
8. Sign up as yourself on the Vercel URL. Manually set `is_superadmin=true` via `fly ssh console -a mojomeet-api` or direct DB client.
9. Create an AI agent, a meeting type, a meeting. Invite a second human.
10. Both humans join the room. Speak for a minute. Verify `/insights` shows live transcript + per-agent outputs.
11. Leave the meeting. Wait ~10s. Visit `/meetings/:id/summary` — agenda findings render.
12. Check `fly logs -a mojomeet-worker` for clean shutdown of the meeting.

## Do NOT
- Do NOT deploy the worker to Vercel or any serverless platform. (§12, §10) It holds a persistent WebSocket.
- Do NOT merge worker and API into one process to "save money." They have different lifecycles. (§12)
- Do NOT use Postgres instead of MySQL because the LangGraph docs showed it. (§12) The MySQL checkpointer exists and is required.
- Do NOT set `min_machines_running = 0` on either API or worker — SSE and agent dispatch both break.
- Do NOT commit `.env` files or bake secrets into Docker images. (§12)
- Do NOT enable Egress/recording in LiveKit Cloud.
- Do NOT forget to add production OAuth callback URLs — auth will fail silently otherwise.
- Do NOT skip the `db:push` step against prod MySQL.
- Do NOT point the worker and API at different MySQLs. Same connection string.

## Hand-off
This is the terminal module. After M60 ships and the smoke test passes with two humans, MVP is DONE. Future work (orgs, recording, mobile, voice-back, tool-calling agents) goes in a new plan — do NOT bolt it onto this one.
