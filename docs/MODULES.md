# Module Index

27 modules across 7 waves. Update the **Owner** and **Status** columns as work progresses. Status values: `open` · `claimed` · `in-progress` · `in-review` · `merged` · `blocked`.

## Wave 0 — Foundation (BLOCKER)

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M00 | Foundation / monorepo skeleton | _unassigned_ | open | — | §2, §9 | [modules/M00-foundation.md](modules/M00-foundation.md) |
| M01 | DB schema (Drizzle) | _unassigned_ | open | M00 | §4, §15, §16 | [modules/M01-db-schema.md](modules/M01-db-schema.md) |
| M02 | Shared zod contracts | _unassigned_ | open | M00 | §6 | [modules/M02-shared-contracts.md](modules/M02-shared-contracts.md) |

## Wave 1 — Parallel CRUD tracks

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M10 | Auth API (email/pw + Google) | _unassigned_ | open | M00, M01, M02 | §5 | [modules/M10-auth-api.md](modules/M10-auth-api.md) |
| M11 | Auth web shell | _unassigned_ | open | M00, M02 | §8.1 | [modules/M11-auth-web.md](modules/M11-auth-web.md) |
| M12 | Agents CRUD | _unassigned_ | open | M01, M02, M10 | §6, §8.1 | [modules/M12-agents-crud.md](modules/M12-agents-crud.md) |
| M13 | Meeting types CRUD | _unassigned_ | open | M12 | §4, §6 | [modules/M13-meeting-types-crud.md](modules/M13-meeting-types-crud.md) |
| M14 | Meetings CRUD (no LiveKit) | _unassigned_ | open | M13 | §6 | [modules/M14-meetings-crud.md](modules/M14-meetings-crud.md) |
| M15 | Authz helper + repos | _unassigned_ | open | M10–M14 | §15 | [modules/M15-authz-helper.md](modules/M15-authz-helper.md) |

## Wave 2 — Realtime spine

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M20 | LiveKit join + room page | _unassigned_ | open | M14 | §6, §8.2 | [modules/M20-livekit-join.md](modules/M20-livekit-join.md) |
| M21 | Worker skeleton | _unassigned_ | open | M00, M01 | §7.1 | [modules/M21-worker-skeleton.md](modules/M21-worker-skeleton.md) |
| M22 | Worker dispatch wiring | _unassigned_ | open | M20, M21 | §6, §7.1 | [modules/M22-worker-dispatch-wiring.md](modules/M22-worker-dispatch-wiring.md) |

## Wave 3 — Transcription + insights

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M30 | STT stream (paragraph detect) | _unassigned_ | open | M21 | §7.5 | [modules/M30-stt-stream.md](modules/M30-stt-stream.md) |
| M31 | Buffer + transcript persist | _unassigned_ | merged | M30, M01 | §7.2 | [modules/M31-buffer-persist.md](modules/M31-buffer-persist.md) |
| M32 | SSE endpoint | _unassigned_ | open | M31 | §6 | [modules/M32-sse-endpoint.md](modules/M32-sse-endpoint.md) |
| M33 | Insights dashboard | _unassigned_ | open | M32, M11 | §8.3 | [modules/M33-insights-dashboard.md](modules/M33-insights-dashboard.md) |
| M34 | In-room live captions | _unassigned_ | merged | M20, M30 | §7, §8.2 | [modules/M34-live-captions.md](modules/M34-live-captions.md) |

## Wave 4 — Agent intelligence

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M40 | LangGraph graph | _unassigned_ | open | M31, M01 | §7.3 | [modules/M40-langgraph-graph.md](modules/M40-langgraph-graph.md) |
| M41 | Fanout + per-agent threads | _unassigned_ | open | M40, M12, M13 | §7.4 | [modules/M41-fanout.md](modules/M41-fanout.md) |
| M42 | Insights agents tab | _unassigned_ | open | M41, M33 | §8.3 | [modules/M42-insights-agents-tab.md](modules/M42-insights-agents-tab.md) |

## Wave 5 — Product completeness

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M50 | Post-meeting summary | _unassigned_ | open | M41 | §7.6, §8.1 | [modules/M50-post-meeting-summary.md](modules/M50-post-meeting-summary.md) |
| M51 | Auto-classify meeting type | _unassigned_ | open | M14 | §6 | [modules/M51-auto-classify.md](modules/M51-auto-classify.md) |
| M52 | Meeting invites + insights gate | _unassigned_ | open | M14, M10 | §13.2 | [modules/M52-invites.md](modules/M52-invites.md) |
| M53 | Usage tracking + limits | _unassigned_ | open | M41, M01 | §16 | [modules/M53-usage-tracking.md](modules/M53-usage-tracking.md) |
| M54 | Superadmin | _unassigned_ | open | M10, M01 | §16 | [modules/M54-superadmin.md](modules/M54-superadmin.md) |
| M55 | Google Calendar import | _unassigned_ | open | M14, M10 | §13.3, §6 | [modules/M55-google-calendar.md](modules/M55-google-calendar.md) |

## Wave 6 — Ship

| ID | Title | Owner | Status | Depends on | plan.md refs | Brief |
|---|---|---|---|---|---|---|
| M60 | Deploy (Vercel + Fly + DB) | _unassigned_ | open | ALL prior | §10 | [modules/M60-deploy.md](modules/M60-deploy.md) |
