# M10 — Auth API (email/password + Google OAuth)
Wave: 1    Owner: <unassigned>    Branch: feat/m10-auth-api
Depends on: M00, M01, M02    Blocks: M11 integration, M52, M54, M55, every protected api route    plan.md refs: §5

## Goal
Implement the full auth surface on the Fastify API: email/password signup/login with argon2 hashes, refresh tokens in httpOnly cookies, access-token JWTs via `jose`, Google OAuth via `arctic` with account-linking by email, and `GET /auth/me`. All endpoints validate bodies with `@meeting-app/shared` schemas from M02. After this module, a user can sign up, log in, refresh, log out, and authenticate via Google — and any future route can check `request.user`.

## Context (inlined from plan.md)
We issue our own JWTs. No third-party auth provider.

- **Access token:** 15 min, HS256 signed with `JWT_SECRET`, payload `{ sub: user_id, email, exp, iat }`. Sent as `Authorization: Bearer ...`.
- **Refresh token:** 30 days, opaque random string, hashed with argon2 and stored in `sessions.refresh_token_hash`. Sent as `httpOnly`, `secure`, `sameSite=lax` cookie. Frontend calls `POST /auth/refresh` when access token expires.
- **Password hashing:** `argon2id`, **parameters pinned** in `apps/api/src/auth/password.ts` (`memoryCost=65536`, `timeCost=3`, `parallelism=4`). We do not rely on library defaults because a future `argon2` upgrade could silently weaken them. No bcrypt.
- **Google OAuth:** use `arctic`. On callback, look up by `google_sub`; if not found, look up by `email`; if not found, create user with `password_hash = null`. Then issue our own JWTs — Google's token is discarded immediately. Crucially, the access JWT is handed to the web app through the **URL fragment** (`#access=...`), never the query string, so it is not sent to the server, not logged by reverse proxies, and not leaked via the `Referer` header. The frontend reads `window.location.hash`, stores the token in memory, and immediately wipes the hash with `history.replaceState`.

Endpoints:
```
POST /auth/signup          { email, password, display_name }   → { access, user }
POST /auth/login           { email, password }                  → { access, user }
POST /auth/refresh         (cookie)                             → { access }
POST /auth/logout          (cookie)                             → 204
GET  /auth/google/start                                         → redirect to Google
GET  /auth/google/callback ?code&state                          → set cookie, redirect /
GET  /auth/me                                                   → { user }
```

LiveKit token minting is separate and belongs to M14 / Wave 2 — not this module.

## Files to create / modify
- `apps/api/src/plugins/auth.ts` — Fastify plugin that decorates `request.user` by verifying `Authorization: Bearer` JWT. Exports `requireAuth` preHandler.
- `apps/api/src/routes/auth.ts` — all `/auth/*` routes.
- `apps/api/src/auth/jwt.ts` — `signAccess(userId, email)`, `verifyAccess(token)` using `jose` HS256.
- `apps/api/src/auth/password.ts` — `hashPassword`, `verifyPassword` with `argon2`.
- `apps/api/src/auth/sessions.ts` — `createSession(userId)` returns a plaintext refresh token and stores its argon2 hash in `sessions`; `rotateSession(token)`, `revokeSession(token)`.
- `apps/api/src/auth/google.ts` — arctic Google provider (client id/secret + redirect URL from env), `getAuthorizationUrl(state)`, `validateAuthorizationCode(code)`, `fetchUserinfo(accessToken)`.
- `apps/api/src/routes/me.ts` — `GET /me` (also `GET /auth/me`, alias) returns `{ user }`.
- `apps/api/src/index.ts` — register cookie plugin (`@fastify/cookie`), register auth plugin, mount auth routes.
- `apps/api/.env.example` — ensure `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WEB_URL`.
- `apps/api/package.json` — add deps: `jose`, `argon2`, `arctic`, `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit`, `ulid`.

## Implementation notes
1. **Signup flow:**
   - Validate body with `SignupReq` from `@meeting-app/shared`.
   - Reject if email already exists.
   - `password_hash = argon2.hash(password)`.
   - Insert user with `ulid()` id, `is_superadmin=false`.
   - `createSession(userId)` → plaintext refresh token; set cookie.
   - Return `{ access: signAccess(userId, email), user }`.
2. **Login flow:** look up by email, `argon2.verify(hash, password)`, rotate a new session, return access + user.
3. **Refresh flow:** read cookie; hash its value; `SELECT * FROM sessions WHERE refresh_token_hash = ? AND expires_at > NOW()`. If valid, issue a new access token. (Rotation is optional for MVP; recommend rotating and updating the cookie for security, but single-use is acceptable.)
4. **Logout:** hash the cookie value, delete the session row, clear the cookie.
5. **Refresh cookie options:** `httpOnly: true`, `secure: true` (in prod), `sameSite: 'lax'`, `path: '/auth'`, `maxAge: 30 * 24 * 3600`.
6. **JWT:**
   ```ts
   import { SignJWT, jwtVerify } from 'jose';
   const secret = new TextEncoder().encode(process.env.JWT_SECRET);
   export async function signAccess(sub: string, email: string) {
     return new SignJWT({ email })
       .setProtectedHeader({ alg: 'HS256' })
       .setSubject(sub)
       .setIssuedAt()
       .setExpirationTime('15m')
       .sign(secret);
   }
   ```
7. **Google OAuth with arctic:**
   ```ts
   import { Google, generateState, generateCodeVerifier } from 'arctic';
   export const google = new Google(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
   ```
   In `/auth/google/start`: generate state + code verifier, store in short-lived cookies (`google_oauth_state`, `google_code_verifier`), redirect to `google.createAuthorizationURL(state, codeVerifier, ['openid','profile','email'])`.
   In `/auth/google/callback`: validate state matches cookie, exchange code, fetch userinfo (`https://openidconnect.googleapis.com/v1/userinfo`), then:
   ```ts
   let user = await db.query.users.findFirst({ where: eq(users.google_sub, info.sub) });
   if (!user) user = await db.query.users.findFirst({ where: eq(users.email, info.email) });
   if (!user) user = await insertUser({ email: info.email, display_name: info.name, google_sub: info.sub, password_hash: null });
   else if (!user.google_sub) await db.update(users).set({ google_sub: info.sub }).where(eq(users.id, user.id));
   ```
   Issue our own JWT, set refresh cookie, redirect to `${WEB_URL}/`.
8. **`requireAuth` preHandler:** read `Authorization: Bearer`, `verifyAccess`, attach `request.user = { id, email }`. On failure, `reply.code(401).send({ error: 'unauthorized' })`.
9. **`GET /me` / `GET /auth/me`:** protected; reload user from DB (fresh `is_superadmin` for admin routes later).
10. **CORS** (`apps/api/src/index.ts`): register `@fastify/cors` with `origin: [WEB_URL]`, `credentials: true`, and the standard verb/header allowlist. Credentials must be true so the browser sends the httpOnly refresh cookie on `/auth/refresh`.
11. **Rate limiting** (`apps/api/src/index.ts` + `routes/auth.ts`): register `@fastify/rate-limit` globally with a generous fallback (`max: 300 / 1 min`, `/api/v0/health` allow-listed). Apply tighter per-route caps via `config.rateLimit`: `/auth/signup` and `/auth/login` get `10 / 15 min` (bruteforce defense); `/auth/refresh` gets `60 / 15 min` (normal usage ≈ 1 refresh per 15 min). Per-route caps are pass-through config, so they are harmless no-ops in the test harness where the plugin is not registered.
12. **Production env guard** (`apps/api/src/index.ts`): before starting Fastify, call `assertProductionEnv()` which throws if any of `WEB_URL`, `JWT_SECRET`, or `LIVEKIT_URL` is missing when `NODE_ENV=production`. Fail fast — a silent fallback to `localhost:5173` would point real users at a dev box.
13. **Error sanitization**: the shared `errorHandler` returns `err.message` verbatim for 4xx (caller fault, safe to echo) but masks 5xx as `internal_error` in production (server fault — the underlying message may contain SQL, stack traces, or internal paths). The full error is logged server-side via `request.log.error`. All plugin-level error handlers (including the one inside `routes/auth.ts`) delegate to this shared handler so there is no bypass.

## Acceptance criteria
- [ ] `POST /auth/signup` creates a user, hashes password with pinned argon2id params, returns `{ access, user }`, sets refresh cookie.
- [ ] `POST /auth/login` verifies password and returns access + user.
- [ ] `POST /auth/refresh` returns a fresh access token when cookie is valid; 401 otherwise.
- [ ] `POST /auth/logout` deletes the session row and clears the cookie.
- [ ] `GET /auth/google/start` redirects to Google with state+PKCE cookies set.
- [ ] `GET /auth/google/callback` links by `google_sub` → email → create-new in that order, then issues our JWTs, and redirects to `${WEB_URL}/auth/callback#access=<jwt>` (fragment, not query).
- [ ] `GET /auth/me` returns the current user when given a valid Bearer token.
- [ ] `requireAuth` preHandler is exported and usable by downstream route modules.
- [ ] All request bodies validated with schemas from `@meeting-app/shared`.
- [ ] CORS is configured with an explicit origin allowlist tied to `WEB_URL` and `credentials: true`.
- [ ] `/auth/signup`, `/auth/login`, and `/auth/refresh` are rate-limited per-IP.
- [ ] API process refuses to start in production if `WEB_URL`, `JWT_SECRET`, or `LIVEKIT_URL` is unset.
- [ ] In production, 5xx responses return a generic `internal_error` body and log the real error server-side.

## Smoke test
```bash
pnpm --filter api dev
# Signup
curl -i -X POST http://localhost:3001/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"hunter2hunter2","display_name":"A"}'
# Copy access token from response; copy refresh cookie from Set-Cookie header.
curl -s http://localhost:3001/auth/me -H "Authorization: Bearer <access>"
# Refresh
curl -i -X POST http://localhost:3001/auth/refresh --cookie "refresh_token=<value>"
# Google: open http://localhost:3001/auth/google/start in a browser; complete consent; land back at WEB_URL with cookie set.
```

## Do NOT
- Do NOT use bcrypt. argon2id only, with pinned parameters.
- Do NOT use a third-party auth provider (Clerk, Auth0, Lucia) — hand-rolled as spec'd.
- Do NOT store plaintext refresh tokens in the DB; only argon2 hashes.
- Do NOT reuse Google's access token as our JWT. Discard it immediately.
- Do NOT issue access tokens longer than 15 minutes.
- Do NOT commit `JWT_SECRET` or Google client secrets.
- Do NOT pass the access JWT back to the web app as a **query string** parameter. Query strings end up in browser history, reverse-proxy access logs, and the HTTP `Referer` header — that is CWE-598. Use the URL fragment (`#access=...`) or an ephemeral httpOnly cookie.
- Do NOT echo `err.message` to clients for 5xx errors in production.

## Hand-off
- `requireAuth` preHandler exported from `apps/api/src/plugins/auth.ts` — every protected route in M12/M13/M14/M15 uses it.
- `request.user = { id, email }` is populated on authenticated requests — downstream handlers read this for ownership checks.
- Users table is populated, sessions table is populated — M15's `assertCanAccess` will rely on `users.id`.
- `@meeting-app/shared` auth schemas are in use — M11 will re-use them for forms.
