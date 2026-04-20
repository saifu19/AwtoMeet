# M11 — Auth Web (Vite + Tailwind + shadcn + login/signup)
Wave: 1    Owner: <unassigned>    Branch: feat/m11-auth-web
Depends on: M00, M02 (may mock M10 until ready)    Blocks: every other web page (M12, M13, M14 frontends, Wave 2+)    plan.md refs: §3, §8.1

## Goal
Stand up the Vite + React + Tailwind + shadcn/ui frontend with routing (TanStack Router), a data-fetching layer (TanStack Query), `/login` and `/signup` pages, a "Sign in with Google" button, a `useMe()` hook, a protected-route higher-order component, access-token handling (stored in memory + refreshed on 401), and logout. After this module, a user can sign up, log in, and land on a protected placeholder `/dashboard` page.

## Context (inlined from plan.md)
Tech stack (locked): Vite + React 18 + TypeScript strict, shadcn/ui + Tailwind CSS (init with `pnpm dlx shadcn@latest init`), TanStack Router (type-safe, file-based), TanStack Query, react-hook-form + zod.

Pages defined for the whole app (§8.1):
```
/login                   email+password, "Sign in with Google" button
/signup                  same
/                        redirect to /dashboard
/dashboard               list of upcoming + recent meetings, CTA "New meeting"
/meetings/new, /meetings/:id, /meetings/:id/room, /meetings/:id/insights, /meetings/:id/summary
/agents, /agents/new, /agents/:id
/meeting-types, /meeting-types/new, /meeting-types/:id
/settings, /settings/integrations
```

This module implements ONLY the shell: `/login`, `/signup`, `/` redirect, a placeholder `/dashboard` behind the protected HOC, and the infrastructure (query client, router, axios/fetch wrapper, `useMe`, auth store).

Auth wire protocol (from M10): signup/login return `{ access: string; user: User }` + set a refresh cookie. Access token is held in memory only (closure or zustand). Refresh via `POST /auth/refresh` (cookie-based) on 401.

## Files to create / modify
- `apps/web/package.json` — add: `@tanstack/react-router`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `tailwindcss`, `postcss`, `autoprefixer`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, shadcn's peer deps.
- `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/src/index.css` — Tailwind init.
- `apps/web/components.json` — shadcn config (run `pnpm dlx shadcn@latest init`).
- `apps/web/src/components/ui/*` — installed shadcn primitives used by auth forms: `button`, `input`, `label`, `card`, `form`, `toast`/`sonner`.
- `apps/web/src/lib/api.ts` — fetch wrapper: attaches `Authorization: Bearer ${accessToken}`, auto-refreshes once on 401 by calling `/auth/refresh`, retries.
- `apps/web/src/lib/auth-store.ts` — in-memory access token + current user (zustand or a simple module-level store).
- `apps/web/src/hooks/useMe.ts` — TanStack Query `useQuery(['me'], () => api.get('/auth/me'))`.
- `apps/web/src/routes/__root.tsx` — root route with `<Outlet />`, `<QueryClientProvider>`.
- `apps/web/src/routes/login.tsx` — email/password form + Google button.
- `apps/web/src/routes/signup.tsx` — email/password/display_name form + Google button.
- `apps/web/src/routes/_auth.tsx` — layout route that enforces auth (the "protected HOC"). Redirects to `/login` if no session.
- `apps/web/src/routes/_auth/dashboard.tsx` — placeholder: "Welcome {display_name}" + Logout button.
- `apps/web/src/routes/index.tsx` — redirects to `/dashboard`.
- `apps/web/src/main.tsx` — create router, query client, render.
- `apps/web/.env.example` — `VITE_API_URL=http://localhost:3001`.

## Implementation notes
1. Initialize Tailwind + shadcn:
   ```bash
   cd apps/web
   pnpm dlx shadcn@latest init    # choose: default style, slate, CSS variables yes
   pnpm dlx shadcn@latest add button input label card form sonner
   ```
2. Router: use TanStack Router file-based routing. Routes that require auth live under the `_auth` pathless layout, which does the redirect check in its `beforeLoad`.
3. `lib/api.ts` minimal sketch:
   ```ts
   export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
     const doFetch = (token: string | null) =>
       fetch(`${import.meta.env.VITE_API_URL}${path}`, {
         ...init,
         credentials: 'include',
         headers: {
           'content-type': 'application/json',
           ...(token ? { authorization: `Bearer ${token}` } : {}),
           ...(init.headers ?? {}),
         },
       });
     let res = await doFetch(getAccessToken());
     if (res.status === 401) {
       const r = await fetch(`${import.meta.env.VITE_API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
       if (r.ok) {
         const { access } = await r.json();
         setAccessToken(access);
         res = await doFetch(access);
       }
     }
     if (!res.ok) throw new Error(await res.text());
     return res.json() as Promise<T>;
   }
   ```
4. Login form uses `react-hook-form` + `zodResolver(LoginReq)` imported from `@meeting-app/shared` (M02). Same for signup.
5. "Sign in with Google" is a plain anchor to `${VITE_API_URL}/auth/google/start` — no JS needed; the backend sets the cookie and redirects back.
6. `_auth.tsx` `beforeLoad`: `const me = await queryClient.ensureQueryData({ queryKey: ['me'], queryFn: () => api('/auth/me') }).catch(() => null); if (!me) throw redirect({ to: '/login' });`
7. Logout: `POST /auth/logout` → clear in-memory access token → `queryClient.clear()` → navigate to `/login`.
8. If M10 is not yet ready while this module is built, mock `/auth/*` with a tiny MSW handler or a feature flag — but prefer to sequence M10 before M11 start.

## Acceptance criteria
- [ ] `pnpm --filter web dev` starts Vite on 5173 with Tailwind + shadcn styled UI.
- [ ] `/login` and `/signup` render with shadcn forms, validate with zod, call M10 endpoints.
- [ ] Successful signup/login stores the access token in memory and navigates to `/dashboard`.
- [ ] "Sign in with Google" link launches Google OAuth via the API and lands back authenticated.
- [ ] `useMe()` returns the current user; the dashboard greets them by name.
- [ ] Visiting `/dashboard` without a session redirects to `/login`.
- [ ] Logout clears token, clears query cache, redirects to `/login`.
- [ ] On 401, the fetch wrapper calls `/auth/refresh` once and retries the original request.

## Smoke test
```bash
# With API + MySQL running
pnpm --filter web dev
# In browser:
# 1. Visit http://localhost:5173 → redirected to /login
# 2. Click "Create account" → /signup → submit → lands on /dashboard with greeting
# 3. Click Logout → back to /login
# 4. Log in again → dashboard
# 5. Click "Sign in with Google" → consent → dashboard
# 6. Wait 15+ min OR clear in-memory token via devtools → next api call triggers /auth/refresh transparently
```

## Do NOT
- Do NOT store the access token in `localStorage`. In-memory only (XSS protection).
- Do NOT put the refresh token anywhere JS can see it — it's an httpOnly cookie from M10.
- Do NOT build `/meetings/*`, `/agents/*`, `/meeting-types/*`, `/admin`, or `/settings` pages here. Those are M12/M13/M14/later.
- Do NOT skip Tailwind + shadcn init "to save time" — downstream modules depend on these primitives.
- Do NOT create a custom auth provider component tree that bypasses TanStack Query — use the query client as the source of truth for `me`.

## Hand-off
- Router is live with `_auth` protected layout. M12/M13/M14 add pages under `_auth/`.
- `lib/api.ts` is the only fetch function — every later module imports it.
- `useMe()` is available globally; downstream pages use it for authorization UI gating (e.g., admin-only links).
- `@meeting-app/shared` schemas wired into `react-hook-form` — downstream forms follow the same pattern.
- shadcn primitives installed — downstream modules `pnpm dlx shadcn@latest add <component>` as needed.
