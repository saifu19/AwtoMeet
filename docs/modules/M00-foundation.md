# M00 — Foundation (monorepo skeleton)
Wave: 0    Owner: <unassigned>    Branch: feat/m00-foundation
Depends on: (none)    Blocks: M01, M02, M10, M11, M12, M13, M14, M15, all later modules    plan.md refs: §2, §3, §9

## Goal
Stand up the pnpm monorepo skeleton with `apps/{web,api,worker}` and `packages/shared`, root tooling (TypeScript, ESLint, Prettier, tsconfig base), and `.env.example` files for every app. After this module, `pnpm install` succeeds and each app has a placeholder entrypoint that runs. **MySQL is assumed to already be running on the dev's host machine** — no docker-compose, no containerized DB.

## Context (inlined from plan.md)
We are building a meeting intelligence web app with three deployable processes — `frontend`, `api`, `worker` — plus managed MySQL and LiveKit Cloud. Repo layout (pnpm workspaces):

```
meeting-app/
├── apps/
│   ├── web/         # Vite + React + TS + shadcn/ui + Tailwind
│   ├── api/         # Node 22 + Fastify + TS + Drizzle ORM
│   └── worker/      # Python 3.12 + livekit-agents + langgraph (uv, NOT in pnpm)
├── packages/
│   └── shared/      # zod schemas + TS types shared between web and api
├── pnpm-workspace.yaml
└── plan.md
```

The Python `worker/` lives in the same git repo but is managed by `uv` and has its own `pyproject.toml`. It is NOT part of the pnpm workspace.

Locked tech choices (do not substitute): Node 22, pnpm 10+, Vite + React + TS strict, Fastify 5, Drizzle (mysql2), zod, MySQL 8.0.19+, Python 3.12 (uv). Hosting: Vercel (web), Fly.io (api, worker). **Production Docker images for api/worker still happen in M21/M60** — only the local MySQL container is dropped.

Local dev prereqs: `node 22+`, `pnpm 10+`, `python 3.12+`, `uv`, **a running local MySQL 8.0.19+ instance with a `meeting_app` database**. Env files live at `apps/api/.env`, `apps/worker/.env`, `apps/web/.env` — copied from `.env.example`. Required keys include `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET` (`openssl rand -hex 32`), `MYSQL_URL` (point at the host MySQL — credentials and db name are dev-machine specific), `DEFAULT_LLM_PROVIDER=openai`, `DEFAULT_LLM_MODEL=gpt-4o-mini`.

## Files to create / modify
- `pnpm-workspace.yaml` — workspace globs: `apps/web`, `apps/api`, `packages/*`. Do NOT include `apps/worker`.
- `package.json` (root) — private, scripts: `dev`, `build`, `lint`, `typecheck`. Add devDeps via `pnpm add -w -D <pkg>` (NEVER hand-write versions).
- `tsconfig.base.json` — strict: true, target ES2022, moduleResolution bundler, paths for `@shared/*` → `packages/shared/src/*` (no `baseUrl` — deprecated in TS 7).
- `.gitignore` — `node_modules`, `dist`, `.env`, `.env.*`, `!.env.example`, `.venv`, `__pycache__`, `.turbo`, `.DS_Store`.
- `.prettierrc`, `.eslintrc.cjs` — baseline configs.
- `apps/api/package.json` — scripts: `dev` (tsx watch), `build`, `start`, `db:push`, `typecheck`. Deps installed via `pnpm add --filter api fastify drizzle-orm mysql2 zod jose argon2 arctic` and `pnpm add --filter api --workspace @meeting-app/shared`.
- `apps/api/tsconfig.json` — extends base.
- `apps/api/src/index.ts` — placeholder Fastify instance listening on 3001 with `GET /health`.
- `apps/api/.env.example` — all API env keys (see plan.md §9). `MYSQL_URL` defaults to `mysql://root:root@localhost:3306/meeting_app` but the dev edits to match their local instance.
- `apps/web/package.json` — scripts: `dev`, `build`, `preview`, `typecheck`. Deps via `pnpm add --filter web react react-dom` and `pnpm add --filter web -D vite @vitejs/plugin-react @types/react @types/react-dom typescript`.
- `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx` — Vite skeleton.
- `apps/web/.env.example` — `VITE_API_URL=http://localhost:3001`.
- `apps/web/tsconfig.json`, `apps/web/tsconfig.node.json` — extends base, JSX. `tsconfig.node.json` must use `outDir: dist-node` (not `noEmit: true`) to satisfy TS6310.
- `apps/worker/pyproject.toml` — uv project. Deps added via `uv add livekit-agents[openai,silero] langgraph langchain-core langchain-openai langchain-anthropic langgraph-checkpoint-mysql sqlalchemy pymysql pydantic-settings python-dotenv`.
- `apps/worker/src/__init__.py`, `apps/worker/src/main.py` — placeholder `print("worker stub")`.
- `apps/worker/.env.example` — worker env keys (MYSQL_URL, LIVEKIT_*, OPENAI_*, ANTHROPIC_*, DEFAULT_LLM_*).
- `packages/shared/package.json` — name `@meeting-app/shared`, exports `./src/index.ts`. `pnpm add --filter @meeting-app/shared zod`.
- `packages/shared/src/index.ts` — `export {};` placeholder.
- `packages/shared/tsconfig.json` — extends base.
- `README.md` — brief local-dev quickstart.

## Implementation notes
1. Use pnpm 10+. **NEVER hand-write dependency versions** — use `pnpm add <pkg>` / `uv add <pkg>` so the latest stable is fetched and pinned automatically.
2. `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - 'apps/web'
     - 'apps/api'
     - 'packages/*'
   ```
3. **Local MySQL:** the dev is responsible for having a MySQL 8.0.19+ instance running on `localhost:3306` with a `meeting_app` database created. They can use a system install (`brew install mysql`, `apt install mysql-server`, the official Windows installer, etc.). M00 does NOT manage the DB lifecycle — that's a host concern. For DB inspection, use any GUI you like (MySQL Workbench, DBeaver, TablePlus) or the `mysql` CLI.
4. API placeholder `src/index.ts`:
   ```ts
   import Fastify from 'fastify';
   const app = Fastify({ logger: true });
   app.get('/health', async () => ({ ok: true }));
   app.listen({ port: 3001, host: '0.0.0.0' });
   ```
5. Worker stays outside pnpm; `uv sync` is run from `apps/worker/`. Do NOT add worker to `pnpm-workspace.yaml`.
6. Use `@shared/*` path alias in `tsconfig.base.json`. Both `apps/api` and `apps/web` reference `packages/shared` as a workspace dep (`"@meeting-app/shared": "workspace:*"` — pnpm writes this when you run `pnpm add --filter <app> --workspace @meeting-app/shared`).
7. **argon2 native build:** pnpm 10 sandboxes build scripts by default. After install you'll see `Ignored build scripts: argon2`. M10 will run `pnpm approve-builds` when it actually imports argon2; M00 doesn't need to.

## Acceptance criteria
- [ ] `pnpm install` succeeds from repo root with zero errors.
- [ ] A local MySQL instance is reachable on `mysql://...@localhost:3306/meeting_app` (dev-supplied — verify with `mysql -h 127.0.0.1 -P 3306 -u <user> -p` or any GUI).
- [ ] `pnpm --filter api dev` starts Fastify on 3001 and `curl http://localhost:3001/health` returns `{"ok":true}`.
- [ ] `pnpm --filter web dev` starts Vite on 5173.
- [ ] `cd apps/worker && uv sync` completes without error; `uv run python -m src.main` prints `worker stub`.
- [ ] `.env` files are ignored by git; `.env.example` files are tracked.
- [ ] `pnpm -r typecheck` passes across all workspaces.
- [ ] No `docker-compose.yml` exists in the repo root.

## Smoke test
```bash
pnpm install
# Ensure local MySQL is running and `meeting_app` db exists:
#   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS meeting_app;"
cp apps/api/.env.example apps/api/.env       # then edit MYSQL_URL to match host instance
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env
pnpm --filter api dev &    # background
curl -s http://localhost:3001/health    # → {"ok":true}
pnpm --filter web dev &
# Visit http://localhost:5173 → MojoMeet placeholder page
cd apps/worker && uv sync && uv run python -m src.main    # prints "worker stub"
```

## Do NOT
- Do NOT commit `.env` files. There's an existing `.env` at the repo root from a prior project — leave it untouched and gitignored (§12).
- Do NOT add `apps/worker` to the pnpm workspace. It is uv-managed Python.
- Do NOT "improve" the architecture by collapsing worker into api.
- Do NOT substitute Postgres for MySQL. Do NOT substitute Prisma for Drizzle. Do NOT substitute Express for Fastify.
- Do NOT install shadcn yet — that's M11.
- Do NOT create a `docker-compose.yml` for local MySQL. The MVP decision is host MySQL only; cloud MySQL in production. Production Dockerfiles for api/worker still happen in M21/M60 — those are unrelated.
- Do NOT hand-write dependency version numbers in any `package.json` or `pyproject.toml`. Always use `pnpm add` / `uv add` without a version.

## Hand-off
- Working pnpm workspace rooted at repo root.
- Local MySQL running on the dev's host (configured via `MYSQL_URL` in `apps/api/.env`) — consumed by M01 (`db:push`) and every later DB module.
- `packages/shared/src/index.ts` exists as an empty entry point — M02 fills it in.
- Env plumbing ready for M10 (JWT_SECRET, GOOGLE_*), M14 (LIVEKIT_*), worker modules.
- `apps/api/src/index.ts` is the Fastify bootstrap file every later api module will mount routes against.
