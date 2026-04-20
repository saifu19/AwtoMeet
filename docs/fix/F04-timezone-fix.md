# F04 — Meeting Time Shown in UTC in Emails Instead of Recipient's Local Timezone

**Date:** 2026-04-20
**Severity:** Medium (UX, cross-timezone usability)
**Discovered:** Manual testing of invite flow across US ↔ Pakistan timezones

---

## Symptom

When a host schedules a meeting and invites a participant by email, the recipient sees the scheduled time formatted as the raw UTC ISO string (e.g., `2026-04-22T14:30:00Z`) — the database representation, not a readable local time. This happens regardless of where the host and recipient are located: US→PK, US→US, and PK→US all render the same UTC string.

Symptoms:

1. Recipient must mentally convert `2026-04-22T14:30:00Z` into their local wall-clock time.
2. No timezone label means "was that 2:30 PM UTC, or the host's local 2:30 PM?"
3. No one-click "add to calendar" — recipients either set manual reminders or miss the meeting.

The web app is unaffected: the browser renders `Date` objects in the user's local timezone automatically. Emails have no such runtime.

---

## Root Cause

`apps/api/src/services/email-templates.ts` `inviteTemplate` treated `scheduledAt` as an opaque string and interpolated it verbatim:

```ts
const scheduleLine = data.scheduledAt
  ? `<p ...>Scheduled: ${esc(data.scheduledAt)}</p>`
  : '';
```

`apps/api/src/routes/invites.ts` passed `meeting.scheduled_at` directly — an ISO UTC string from the repository layer (`toMeetingResponse` calls `.toISOString()` on the `Date` coming out of the `timezone: 'Z'` MySQL pool). The template did no formatting, no timezone labelling, and no ICS attachment.

We don't store per-user timezones (no `users.timezone` column — plan.md §4 schema), so even on the server side we couldn't personalize the body. The web frontend hides the problem because `Intl.DateTimeFormat` runs in the viewer's browser; email clients have no JavaScript.

---

## Fix Applied

Two-pronged, no schema change required.

### 1. Attach RFC 5545 iCalendar (`.ics`) file to invite emails

New module `apps/api/src/services/calendar.ts` exports `buildInviteIcs(data)` which produces a standards-compliant VCALENDAR/VEVENT block:

- `DTSTART` / `DTEND` emitted in UTC with `Z` suffix (`YYYYMMDDTHHMMSSZ`)
- Duration defaults to 60 minutes (no duration field in schema yet — noted in module comment)
- Text escaping per RFC 5545 §3.3.11 (commas, semicolons, backslashes, newlines)
- Line folding at 75 octets per RFC 5545 §3.1
- CRLF line endings
- `METHOD:REQUEST` + `ORGANIZER` + `ATTENDEE;RSVP=TRUE` so mail clients recognize it as a calendar invitation

Gmail, Outlook, Apple Mail, and every major mail client automatically render the UTC `DTSTART` in the **recipient's local timezone** and offer a one-click "Add to calendar" button. This delegates timezone conversion to the endpoint that actually knows the recipient's timezone — their own device.

### 2. Render an unambiguous UTC label in the body

`inviteTemplate` now:

- Accepts `scheduledAt: Date` (was `string`) so it can format, not just interpolate
- Renders `"Wed Apr 22 2026 14:30 UTC"` via `toLocaleString('en-US', { ..., timeZone: 'UTC' })`
- Adds a note under the time: *"An invite is attached — open it to see the time in your local timezone, or click below to view in the web app."*

The CTA button still links to the web app, where browser-local rendering takes over. So recipients have three paths to the correct local time: the ICS attachment, the web link, or mental conversion from the explicit UTC label.

### 3. Wire the ICS into `sendInviteEmail` via Nodemailer's `icalEvent`

`apps/api/src/services/email.ts` now accepts optional `icalEvent: IcalEventPart` on the low-level `EmailMessage` type — not a generic attachment. Nodemailer's `icalEvent` field emits the calendar payload as a **`multipart/alternative` text/calendar MIME part** (what Gmail's smart parser requires to render the RSVP card) **and** as a `.ics` attachment (what Outlook/Apple Mail consume). Using a plain attachment instead produced Gmail's "Unable to load event" rejection.

The route (`apps/api/src/routes/invites.ts`) now passes a `Date` plus three new fields needed for the ICS: `meetingId`, `hostEmail`, and `meetingDescription`.

### 4. Gmail-compliance properties in the VEVENT

Minimal VEVENT bodies parse fine but Gmail's invite card rejects them if required metadata is missing. Added:

- `SEQUENCE:0` — version counter; required for `METHOD:REQUEST`.
- `STATUS:CONFIRMED` — otherwise the event is treated as tentative.
- `TRANSP:OPAQUE` — whether the event blocks the invitee's free/busy.
- `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:...` — without CUTYPE/ROLE/PARTSTAT, Gmail doesn't populate the Yes/No/Maybe UI.

### 5. `ORGANIZER` `SENT-BY` for cross-domain senders

When the host's email (e.g., `dev@mojosolo.com`) differs from `SMTP_FROM` (e.g., `mojomosaic@mojomosaic.com`), Gmail rejects the invite because the domain signing the email doesn't match the mailto in `ORGANIZER`. RFC 5545 §3.2.18 provides `SENT-BY` for exactly this case:

```
ORGANIZER;CN=Host Name;SENT-BY="mailto:noreply@mojomosaic.com":mailto:dev@mojosolo.com
```

`sendInviteEmail` now extracts the bare address from `SMTP_FROM` and passes it as `sentByEmail`. `buildInviteIcs` omits `SENT-BY` when the sender matches the organizer (case-insensitive), preventing a redundant self-reference.

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/services/calendar.ts` | NEW — `buildInviteIcs()` with RFC 5545 escaping, line folding, UTC formatting |
| `apps/api/src/services/email-templates.ts` | `scheduledAt` now `Date`; new `formatUtc()` helper; schedule line mentions attached invite |
| `apps/api/src/services/email.ts` | `EmailMessage.attachments` + `icalEvent` optional; `sendInviteEmail` passes ICS through Nodemailer's `icalEvent` (multipart/alternative) — NOT a generic attachment; extracts `SMTP_FROM` address for `SENT-BY`; accepts `meetingId`/`hostEmail`/`meetingDescription` |
| `apps/api/src/routes/invites.ts` | Passes `new Date(scheduled_at)`, `meetingId`, `hostEmail`, `meetingDescription` to `sendInviteEmail` |
| `apps/api/src/services/__tests__/calendar.test.ts` | NEW — 8 tests covering ICS structure, UTC format, duration default, escaping, CRLF |
| `apps/api/src/services/__tests__/email-templates.test.ts` | Updated schedule-time test; new test asserting UTC label is present and raw ISO is not |
| `apps/api/src/services/__tests__/email.test.ts` | Updated three `sendInviteEmail` call sites for the new signature; dev-mode test asserts ICS attachment is passed to nodemailer |

No schema change. No frontend change. No plan.md change.

---

## Impact Assessment

| Scenario | Before | After |
|---|---|---|
| US host → PK recipient (Gmail) | Raw `2026-04-22T14:30:00Z` in body | Body shows `14:30 UTC`; ICS attachment renders as `7:30 PM PKT` locally; one-click add-to-calendar |
| US host → US recipient (Outlook) | Raw ISO string | Body shows UTC; ICS renders in recipient's local zone (EST/PST) |
| PK host → US recipient (Apple Mail) | Raw ISO string | Same — ICS handles local render |
| Meeting with no `scheduled_at` (instant) | No scheduled line, no issues | No scheduled line, no ICS attached — null path unchanged |
| Mail client that strips attachments | Unreadable UTC | Explicit `... UTC` label + web link CTA that renders browser-local |

---

## Test Coverage

- `apps/api/src/services/__tests__/calendar.test.ts` — 8 tests:
  - VCALENDAR/VEVENT structure
  - CRLF line endings
  - `DTSTART` in UTC Z form (`20260422T143000Z`)
  - Default 60-minute duration / custom duration
  - UID, organizer, attendee correctness
  - RFC 5545 escaping of `,` `;` `\` `\n`
  - Join URL in `URL:` and `DESCRIPTION:`
- `email-templates.test.ts` — new `formats scheduled time as UTC in body (F04)` assertion + `mentions the attached invite` assertion; removed the old "includes raw ISO string" check
- `email.test.ts` — SMTP test now asserts `attachments` array contains an `invite.ics` entry with `text/calendar` content type
- Full api suite: **365/365 passing**, TypeScript clean (`npx tsc --noEmit`)

---

## Verification (manual)

1. **Cross-timezone invite:** log in as a US-based user, create a meeting at `10:00 AM EST`, invite a Pakistan-based email. Inbox in Gmail/Outlook/Apple Mail should:
   - Show the meeting body with a `UTC` label (e.g., `14:00 UTC`) — never the raw `2026-04-22T14:00:00Z`
   - Display an "Add to calendar" / "Going? Yes/No" card that shows the time as `7:00 PM PKT` (or whatever the recipient's local zone is)
   - Attach `invite.ics` with `Content-Type: text/calendar; method=REQUEST`
2. **Same-timezone invite:** US host invites US recipient — same ICS behaviour; calendar app shows local time directly.
3. **No-schedule invite:** create a meeting without `scheduled_at`, invite someone — email renders with no schedule line and no attachment.
4. **ICS file contents:** save `invite.ics` from a real email, open in a text editor, verify `DTSTART:...Z`, `METHOD:REQUEST`, `ORGANIZER:mailto:...`, `ATTENDEE;RSVP=TRUE:mailto:...`.
5. **Web app unchanged:** invite landing page `/invites/:token` continues to render the scheduled time in the browser's local timezone as before.

---

## Known Trade-offs

- **Duration hard-coded to 60 minutes.** The `meetings` schema has no `duration` column. When one is added (future plan.md §4 change), pass it through to `buildInviteIcs({ durationMinutes })`.
- **No per-user timezone stored.** We explicitly chose not to add `users.timezone` — it would require a plan.md §4 schema change + a signup-time capture via `Intl.DateTimeFormat().resolvedOptions().timeZone`. ICS + UTC label solves the bug without that complexity. If we later want `"10:00 AM PKT (14:00 UTC)"` in the body specifically for registered recipients, that enhancement goes on top of this fix.
- **No ICS line-folding past ASCII.** `foldLine()` folds on char count, which is safe for ASCII-only content. Our escapeText output is ASCII; if we ever inject raw UTF-8 into SUMMARY/DESCRIPTION without escaping we'd need byte-length folding.
- **Summary-ready email unchanged.** It contains no time, so F04 doesn't apply to it.
