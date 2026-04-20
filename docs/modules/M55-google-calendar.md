# M55 — Google Calendar read-only import
Wave: 5    Owner: <unassigned>    Branch: feat/m55-google-calendar
Depends on: M14, M10    plan.md refs: §13.3, §6

## Goal
Lowest-priority feature. Let a user connect their Google Calendar (read-only scope) and import upcoming events as MojoMeet meetings. We never write to Google. On import, each selected event becomes a `meetings` row with `google_event_id` set (for idempotency) and `scheduled_at` populated from the event start.

## Context (inlined from plan.md)
- §13.3: "Google Calendar: read-only import. We never write to Google."
- §6 endpoints:
  ```
  GET  /integrations/google/calendar/connect
  GET  /integrations/google/calendar/events
  POST /integrations/google/calendar/import    { event_ids: [] }
  ```
- `meetings.google_event_id` column already exists (§4) — NULLABLE, unique per `(user_id, google_event_id)` effectively (enforce in app; or add a composite unique index during M01).
- Auth already supports Google OAuth (via `arctic`) for login. That flow grants only `openid email profile`. Calendar access needs a SECOND OAuth consent with `https://www.googleapis.com/auth/calendar.readonly`. Do NOT reuse the login scopes.
- Implementation order: dead last. Implement only after everything else works (§11 step 19).

## Files to create / modify
- **Migration:** create `google_calendar_tokens` table — `user_id`, `access_token`, `refresh_token`, `expires_at`, `scope`, `updated_at`. One row per user.
- **Create (api):** `apps/api/src/routes/integrations/google.ts` — the three endpoints.
- **Create (api):** `apps/api/src/services/googleCalendar.ts` — arctic client instance with calendar scope, `listUpcomingEvents(user)`, `importEvents(user, eventIds)`.
- **Modify (api):** shared zod schemas — add `ImportEventsBody = z.object({ event_ids: z.array(z.string()).min(1) })`.
- **Create (web):** `apps/web/src/pages/settings/integrations.tsx` — "Connect Google Calendar" button, list of upcoming events with checkboxes, "Import selected" button.
- **Modify (web):** `/settings` page — add link to `/settings/integrations`.

## Implementation notes
- Use `arctic`'s Google provider again, but a separate instance with `scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email']` and `accessType: 'offline'` so we get a refresh token.
- Store refresh token encrypted at rest if you have time. MVP: plaintext in DB is acceptable — don't commit anything to do with it.
- `GET /integrations/google/calendar/connect`: redirect to Google consent URL with a state param; callback lands at `GET /integrations/google/calendar/callback` (add this endpoint), exchanges code for tokens, upserts `google_calendar_tokens`, redirects to `/settings/integrations`.
- `GET /integrations/google/calendar/events`: refresh access token if expired, call `GET https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=NOW&maxResults=50&singleEvents=true&orderBy=startTime`, return `[{id, summary, description, start, end, attendees}]`.
- `POST /integrations/google/calendar/import`: for each `event_id` in body, fetch event, upsert `meetings` row with `user_id=me`, `title=summary`, `description=description`, `scheduled_at=start`, `google_event_id=event.id`, `status='scheduled'`, `livekit_room='meeting-'+newId`. Idempotent on `(user_id, google_event_id)` — skip if already imported.
- Do NOT auto-import; require explicit user selection.
- Do NOT subscribe to push notifications / webhooks. Pull-only.
- If the user revokes access mid-session, calls return 401 from Google; catch and delete the row; return a clear error to the frontend ("reconnect required").

## Acceptance criteria
- [ ] User can connect Google Calendar via consent flow; tokens are stored.
- [ ] `GET /integrations/google/calendar/events` returns the next 50 upcoming primary-calendar events.
- [ ] Selecting events and clicking "Import" creates matching `meetings` rows with populated `google_event_id` and `scheduled_at`.
- [ ] Re-importing the same events does NOT create duplicates.
- [ ] Disconnecting (deleting the token row) works and prevents further calls.
- [ ] No code path ever writes to Google.

## Smoke test
1. From `/settings/integrations`, connect Google.
2. See a list of upcoming events from your primary calendar.
3. Check 2 events, click "Import."
4. Visit `/dashboard` — see the 2 imported meetings.
5. Re-import the same 2 — no duplicates created.

## Do NOT
- Do NOT request any write scopes. Read-only, ever. (§13.3)
- Do NOT block shipping of earlier modules on this. It is explicitly last. (§11 step 19)
- Do NOT sync bidirectionally.
- Do NOT subscribe to Google push notifications.
- Do NOT auto-import events without user consent per-event.
- Do NOT reuse the login OAuth client — calendar uses a different scope set and a distinct consent.

## Hand-off
Terminal feature. After M55, the app feature-set is complete; only M60 (deploy) remains.
