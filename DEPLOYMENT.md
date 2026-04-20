# MojoMeet — Docker Deployment (dev/test)

One `docker compose up` brings up the whole stack on a single Linux host:

| Service   | Image                       | What it does                                    | Ports                     |
|-----------|-----------------------------|-------------------------------------------------|---------------------------|
| `web`     | nginx + Vite SPA build      | Serves the SPA + reverse-proxies `/api/v0` → api| `80`                      |
| `api`     | Node 22 + Fastify           | REST API, SSE, LiveKit token mint               | `3001` (internal)         |
| `worker`  | Python 3.12 + livekit-agents| Transcription + insights                        | none (outbound only)      |
| `livekit` | livekit/livekit-server      | Self-hosted SFU                                 | `7880` ws, `7881` tcp, `50000-50099/udp` |
| `migrate` | api build image (one-shot)  | Applies schema + seeds defaults, then exits     | none                      |

MySQL is **external** — the URL is supplied at bootstrap time.

The browser talks to a single origin (`http://<host>`), so **there is no CORS boundary**. Cookies are first-party; `SameSite=Lax` is fine. LiveKit media goes direct from the browser to `<host>:7880` / UDP.

---

## 0. Prerequisites

On the target Linux host:
- Docker 24+ and Docker Compose v2 (`docker compose`, not `docker-compose`).
- `openssl` (already installed on every modern Linux).
- A reachable MySQL 8.0.19+ with an empty `meeting_app` database and a user that has `ALL PRIVILEGES` on it.
- Open firewall ports: `80/tcp`, `7880/tcp`, `7881/tcp`, `50000-50099/udp`.

That's it. No Node, no Python, no pnpm on the host — everything builds inside containers.

---

## 1. Clone + bootstrap

```bash
git clone <repo-url> mojomeet
cd mojomeet

# Generates .env + livekit/livekit.yaml with fresh secrets.
# Arg 1: MySQL connection URL (required)
# Arg 2: Public URL the browser will use (default: http://localhost)
./scripts/bootstrap.sh \
  "mysql://meeting_app:<password>@<db-host>:3306/meeting_app" \
  "http://<server-ip-or-hostname>"
```

What bootstrap generates for you (fresh random secrets every run):
- `JWT_SECRET` — 32 bytes hex
- `INTERNAL_API_KEY` — 32 bytes hex, shared between api + worker
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — baked into `livekit/livekit.yaml` and mirrored into `.env`
- `LIVEKIT_URL_PUBLIC` — the ws URL handed to browsers (points at `<host>:7880`)

What bootstrap leaves blank for you to fill in (optional — features degrade gracefully):
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — at least one is needed for the worker to produce insights/summaries
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth sign-in
- `SMTP_*` — transactional emails (welcome, invites, summaries)

Open `.env`, fill in whatever you want, save.

---

## 2. Bring it up

```bash
docker compose up -d --build
```

First run takes a few minutes (pulls base images + builds api/web/worker). Subsequent runs are seconds.

Watch it boot:

```bash
docker compose logs -f
```

You should see, in order:
1. `mojomeet-livekit` — "starting LiveKit server"
2. `mojomeet-migrate` — "drizzle-kit push" completes, seed runs, container exits 0
3. `mojomeet-api` — "Server listening at http://0.0.0.0:3001"
4. `mojomeet-worker` — "registered worker meet-transcriber"
5. `mojomeet-web` — nginx ready

---

## 3. Smoke test

From your laptop:

```bash
# 1. Web reachable
curl -sI http://<host>/ | head -1        # HTTP/1.1 200 OK

# 2. API reachable via the reverse proxy (no CORS, same origin)
curl -s http://<host>/api/v0/health      # {"ok":true}

# 3. LiveKit reachable
curl -sI http://<host>:7880/             # HTTP/1.1 404 or 200 — either means it's listening
```

Then in a browser at `http://<host>/`:
1. Sign up → reload the page → still logged in (refresh cookie round-trip working).
2. Create a meeting → join → speak.
3. Transcript lines appear within ~2s (SSE + worker + LiveKit).

---

## 4. Common breakage

| Symptom | Cause | Fix |
|---------|-------|-----|
| `migrate` exits non-zero with "unknown database" | DB doesn't exist | Create it: `mysql -h <host> -u root -p -e "CREATE DATABASE meeting_app;"` |
| `migrate` "Access denied" | DB user missing grants | `GRANT ALL ON meeting_app.* TO '<user>'@'%'; FLUSH PRIVILEGES;` |
| Browser loads but API calls 502 | api container not up yet | `docker compose logs api` — usually a bad env var |
| `worker` logs "401 Unauthorized" calling API | `INTERNAL_API_KEY` mismatch | Shouldn't happen (both read the same `.env`). If it does, delete `.env` + `livekit/livekit.yaml` and re-bootstrap |
| Browser connects to meeting, but no audio | UDP `50000-50099` blocked by firewall | Open the UDP range; WebRTC falls back to TCP 7881, which is slower but works |
| SSE transcript never appears | nginx buffering (shouldn't — already configured) OR worker crashed | `docker compose logs worker` |
| `livekit` logs "external IP could not be determined" | Server has no public IP / is behind NAT with no STUN reachability | Add `external_ip: <public-ip>` to `livekit/livekit.yaml` under `rtc:` |

---

## 5. Day-two operations

```bash
# Tail everything
docker compose logs -f

# Tail one service
docker compose logs -f api

# Restart after changing .env (env changes aren't live-reloaded)
docker compose up -d

# Rebuild + restart after pulling new code
git pull && docker compose up -d --build

# Nuke and reset (keeps .env, resets containers)
docker compose down && docker compose up -d --build

# Full reset including secrets (re-runs bootstrap)
docker compose down -v
rm .env livekit/livekit.yaml
./scripts/bootstrap.sh <mysql-url> <public-url>
docker compose up -d --build
```

---

## 6. Rotating secrets

```bash
docker compose down
rm .env livekit/livekit.yaml
./scripts/bootstrap.sh <mysql-url> <public-url>
docker compose up -d
```

All existing user sessions are invalidated (JWT_SECRET rotation), and every LiveKit token you've handed out becomes invalid. Fine for dev/test — don't do this thoughtlessly in prod.

---

## 7. Going to prod later

Before flipping this to a real production deployment:

- Put a TLS reverse proxy (Caddy / Traefik / nginx with Let's Encrypt) in front of `:80` — update `PUBLIC_URL` to `https://...`. Browsers require HTTPS for WebRTC from non-localhost origins anyway.
- Flip `LIVEKIT_URL_PUBLIC` to `wss://...` and terminate TLS for the LiveKit WS too (Caddy handles this cleanly with `reverse_proxy livekit:7880`).
- Set `NODE_ENV=production` on the api service — re-enables cookie `Secure` flag and `assertProductionEnv`. You'll need SMTP configured at that point.
- Replace the `drizzle-kit push --force` call in the `migrate` service with real migrations.
- Pin image tags (`livekit/livekit-server:v1.x.y`, `node:22.x-alpine`, etc.) instead of floating `latest`.
- Back up the MySQL instance.
