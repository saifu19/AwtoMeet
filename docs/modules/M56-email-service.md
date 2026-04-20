# M56 — Email Service (SMTP / Nodemailer)
Wave: 5    Owner: <unassigned>    Branch: feat/m56-email-service
Depends on: M10, M50, M52    plan.md refs: §6, §11

## Goal
Add an SMTP-backed transactional email service to the API using Nodemailer. Compatible with any SMTP provider (Mailgun, SendGrid, etc.) via username/password auth. Replace the console.log invite stub with real email delivery, send welcome emails on signup, and notify participants when a post-meeting summary is ready. In dev environments without SMTP credentials, fall back to console logging (preserving current behavior).

## Context (inlined from plan.md)
- M52 invites create tokens and log invite URLs to console: `console.log('[INVITE] ${invited_email} → ${inviteUrl}')` — this module replaces that stub.
- M50 post-meeting summary generates `meeting_summaries` rows — this module adds email notification after generation.
- Auth routes handle signup (email/password + Google OAuth) — this module adds welcome emails.
- Service pattern: lazy singleton client (see `services/classify.ts`), fire-and-forget error handling.
- Worker communicates with DB directly; for summary notifications, worker calls a new internal API endpoint.

## Files to create / modify
- **Install (api):** `nodemailer` + `@types/nodemailer` (SMTP transport — works with any SMTP provider).
- **Install (worker):** `httpx` via `uv add httpx`.
- **Create:** `apps/api/src/services/email-templates.ts` — pure functions returning `{ subject, html, text }` for each email type.
- **Create:** `apps/api/src/services/email.ts` — core email service with `SmtpProvider` (Nodemailer) + `ConsoleProvider` fallback, public `sendInviteEmail`, `sendWelcomeEmail`, `sendSummaryReadyEmail` functions.
- **Create:** `apps/api/src/plugins/internal-auth.ts` — preHandler checking `X-Internal-Key` header via `crypto.timingSafeEqual`.
- **Create:** `apps/api/src/services/__tests__/email.test.ts` — unit tests for email service.
- **Create:** `apps/api/src/services/__tests__/email-templates.test.ts` — unit tests for templates.
- **Modify:** `apps/api/src/routes/invites.ts` — replace `console.log` with `sendInviteEmail` (fire-and-forget).
- **Modify:** `apps/api/src/routes/auth.ts` — add `sendWelcomeEmail` on signup and Google OAuth new-user creation.
- **Modify:** `apps/api/src/routes/meetings.ts` — add `POST /:id/notify-summary` internal endpoint.
- **Modify:** `apps/api/src/repositories/invites.ts` — add `listAcceptedInviteesWithInsights(meetingId)`.
- **Modify:** `apps/api/src/index.ts` — update `assertProductionEnv` with `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `INTERNAL_API_KEY`.
- **Modify:** `apps/api/.env.example` — add Mailgun + internal API key env vars.
- **Modify:** `apps/worker/src/fanout.py` — call `POST /meetings/:id/notify-summary` after summary generation.
- **Modify:** `apps/worker/src/settings.py` — add `api_url`, `internal_api_key` fields.
- **Modify:** `apps/worker/.env.example` — add `API_URL`, `INTERNAL_API_KEY`.

## Implementation notes
1. **Provider abstraction:** `EmailProvider` interface with `send(msg)` method. `SmtpProvider` wraps Nodemailer SMTP transport; `ConsoleProvider` logs to console. `getProvider()` returns SMTP if `SMTP_HOST` is set, otherwise Console. Lazy singleton pattern matching `classify.ts`. Works with any SMTP provider (Mailgun, SendGrid, etc.) using username/password auth — same approach as existing Laravel apps.
2. **Fire-and-forget contract:** every public function (`sendInviteEmail`, etc.) wraps in try/catch, logs `[email] ...` prefix, returns silently. Callers add `.catch(() => {})` as belt-and-suspenders. Email failure never blocks or fails the parent request.
3. **Templates:** pure functions in `email-templates.ts`. Inline CSS only (no `<style>` blocks) for email client compatibility. Shared `wrapLayout(bodyHtml)` helper for responsive 600px table layout + branding. User-provided strings (meetingTitle, displayName) must be HTML-escaped to prevent XSS.
4. **Invite email:** replace `console.log` at `invites.ts:80-83`. Use `request.user!.email` as hostName (displayName is not on the JWT payload).
5. **Welcome email:** send after user creation in signup handler (line ~119) and in Google OAuth callback new-user branch (line ~285). Only for new accounts, not re-logins.
6. **Summary notification:** new `POST /meetings/:id/notify-summary` endpoint gated by `requireInternalAuth` (not JWT). Loads meeting host + accepted invitees with `can_view_insights = true`, sends `summaryReadyEmail` to each. Worker calls this via `httpx` after `generate_for` succeeds in `fanout.py`.
7. **Internal auth:** `plugins/internal-auth.ts` checks `X-Internal-Key` header against `INTERNAL_API_KEY` env var using `crypto.timingSafeEqual` (constant-time to prevent timing attacks).
8. **Env vars:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (api); `API_URL`, `INTERNAL_API_KEY` (both api + worker).
9. **Timeout:** 10s on SMTP connection/socket to prevent hanging requests.
10. **No email log table:** provider dashboard (e.g. Mailgun) handles deliverability monitoring for MVP.
11. **No webhooks:** send-only for MVP. Future module for bounce/complaint tracking.

## Acceptance criteria
- [ ] `POST /meetings/:id/invites` sends an email to the invitee (or logs to console in dev) with the invite link and meeting title.
- [ ] `POST /auth/signup` sends a welcome email to the new user.
- [ ] Google OAuth new-user flow sends a welcome email (existing users re-logging in do NOT get a welcome email).
- [ ] After summary generation, host and qualifying invitees receive a summary-ready notification email.
- [ ] Email delivery failure never returns a 4xx/5xx from the parent endpoint (invite creation, signup, etc.).
- [ ] Without `SMTP_HOST` set, all email functions fall back to console logging with `[email] DEV:` prefix.
- [ ] `POST /meetings/:id/notify-summary` without valid `X-Internal-Key` returns 401.
- [ ] Template HTML uses only inline CSS and HTML-escapes user-provided strings.
- [ ] Unit tests pass for email service, templates, and internal auth.

## Smoke test
1. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `apps/api/.env`.
2. Sign up a new user → welcome email arrives.
3. As host, create a meeting and invite another email → invite email arrives with correct link.
4. End a meeting with agents → summary generates → host receives summary-ready email.
5. Unset `SMTP_HOST` → repeat step 3 → console shows `[email] DEV: would send to=... subject=...`, invite still created successfully.

## Do NOT
- Do NOT let email delivery failure block or fail the parent request. Always fire-and-forget.
- Do NOT use `<style>` blocks in email templates — inline CSS only for email client compatibility.
- Do NOT store SMTP credentials in the frontend or worker — only in the API's env.
- Do NOT add a database table for email logs in MVP. Use the SMTP provider's dashboard.
- Do NOT add webhook endpoints for email events in MVP.
- Do NOT use string comparison for internal API key — use `crypto.timingSafeEqual`.

## Hand-off
This module is self-contained within Wave 5. Future modules may add:
- Password reset emails (new template + auth route).
- Email preference settings (unsubscribe, frequency).
- Mailgun webhook processing for bounce/complaint tracking.
- Email log table for audit trail.
