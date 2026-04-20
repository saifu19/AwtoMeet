# M53 — Usage tracking & limits (off by default)
Wave: 5    Owner: <unassigned>    Branch: feat/m53-usage-tracking
Depends on: M41, M01    plan.md refs: §16, §4

## Goal
Track meeting minutes, LLM tokens, and LLM cost from day one. Enforce nothing by default — `usage_limits` rows are all NULL, meaning unlimited. Wire the enforcement middleware into `POST /meetings` and `POST /meetings/:id/join` so flipping enforcement on later is a SQL UPDATE, not a refactor.

## Context (inlined from plan.md §16)
**What gets tracked, when:**
- **Meeting minutes:** worker UPSERTs `usage_counters` on `(user_id, period)` at meeting end, incrementing `meeting_minutes` by `ceil((ended_at - started_at) / 60s)`. Charged to `meetings.user_id` (host).
- **LLM tokens & cost:** every `agent_runs` row records `prompt_tokens`, `completion_tokens`, `cost_usd`. Token counts come from `AIMessage.usage_metadata` (langchain exposes it). A `pricing.py` module holds `{(provider, model): (input_per_1k, output_per_1k)}`. After each run, worker UPSERTs `usage_counters` with deltas for the meeting host.
- **STT minutes:** Whisper cost = wall-clock seconds of audio per participant. Track only as `cost_usd` delta — don't add a minutes column.

**Enforcement (off by default):**
- Middleware on `POST /meetings` and `POST /meetings/:id/join` calls `assertWithinLimits(user)`. Loads `usage_limits` row for the user (or global default `user_id IS NULL AND org_id IS NULL`). If any limit is non-NULL and current-period `usage_counters` exceeds it, return `429 { code: 'usage_limit_exceeded', limit, current }`.
- Migration inserts a global default row with all limits = NULL. Result: infinite usage. Flipping on is one `UPDATE`.

**Pricing staleness:** add `# REVIEW QUARTERLY` to `pricing.py`; unit test fails if any model's `updated_at` is >6 months old.

## Files to create / modify
- **Create (worker):** `apps/worker/src/pricing.py` — a `PRICING` dict keyed by `(provider, model)` returning `(input_per_1k_usd, output_per_1k_usd, updated_at: date)`. Function `compute_cost(provider, model, prompt_tokens, completion_tokens) -> Decimal`.
- **Create (worker):** `apps/worker/tests/test_pricing.py` — asserts every model's `updated_at` is within 6 months of today; add `# REVIEW QUARTERLY` comment atop.
- **Modify (worker):** `fanout.py` `_run_agent` — after successful run, extract `usage_metadata` from the LLM response, compute cost via `pricing.compute_cost`, update `agent_runs.prompt_tokens/completion_tokens/cost_usd`, and UPSERT `usage_counters` for the host (`meetings.user_id`) with prompt/completion/cost deltas for the current period (`YYYY-MM`).
- **Modify (worker):** `fanout.py` `flush_all_and_finalize` — at meeting end, compute minutes = `ceil((ended_at - started_at) / 60)` and UPSERT `usage_counters.meeting_minutes`.
- **Modify (worker):** transcription pipeline — track audio-seconds per participant; add its Whisper cost to `usage_counters.cost_usd`. Simplest: on STT stream close, compute `total_seconds * whisper_per_second` and add.
- **Create (api):** `apps/api/src/middleware/assertWithinLimits.ts` — loads `usage_limits` row (user-specific OR global default), compares against current-period `usage_counters`, returns 429 or passes.
- **Modify (api):** `POST /meetings` and `POST /meetings/:id/join` handlers — call `assertWithinLimits(user)` first.
- **Migration:** ensure `usage_counters`, `usage_limits` tables exist; INSERT a single global default row `(user_id=NULL, org_id=NULL, max_*=NULL)`.

## Implementation notes
- Period format: `strftime("%Y-%m")` — e.g. `"2026-04"`.
- UPSERT SQL:
  ```sql
  INSERT INTO usage_counters (user_id, org_id, period, prompt_tokens, completion_tokens, cost_usd)
  VALUES (?, NULL, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    prompt_tokens = prompt_tokens + VALUES(prompt_tokens),
    completion_tokens = completion_tokens + VALUES(completion_tokens),
    cost_usd = cost_usd + VALUES(cost_usd);
  ```
- `assertWithinLimits` fetch order: user-specific row first; fallback to global default. Only check limits that are non-NULL.
- 429 body: `{ code: 'usage_limit_exceeded', limit: { meeting_minutes, cost_usd, agents }, current: {...} }`.
- `max_agents` check: only makes sense on `POST /agents`, not meeting creation. But the plan says to wire into meeting create/join — check only `meeting_minutes` and `cost_usd` there.
- Cost decimals: use `Decimal` end-to-end in Python; store `decimal(12,6)` in MySQL.
- Do NOT enforce limits on the worker side. Only the API enforces. Worker's job is pure tracking.
- Do not crash the worker if pricing table lacks an entry for a model — log a warning, store `cost_usd = NULL`, keep going.

## Acceptance criteria
- [ ] After a live meeting with N agent runs, `agent_runs` rows all have non-NULL `prompt_tokens`, `completion_tokens`, `cost_usd` (where pricing is known).
- [ ] `usage_counters` for the host's current period reflects the sum of the run-level tokens/cost plus meeting minutes plus STT cost.
- [ ] `assertWithinLimits` middleware is wired into `POST /meetings` and `POST /meetings/:id/join`. With the global default row all-NULL, it always passes.
- [ ] Setting `max_meeting_minutes_per_month = 0` for a user immediately causes 429 on create/join.
- [ ] `test_pricing.py` fails when any model entry is older than 6 months.
- [ ] No runtime error when an unknown model is used — `cost_usd` just stays NULL.

## Smoke test
1. Run a meeting with 2 agents and ~5 flushes. Check `agent_runs` — all rows have token counts and non-NULL cost.
2. Check `usage_counters` for the host/current-period — see aggregate tokens/cost plus meeting_minutes.
3. Manually `UPDATE usage_limits SET max_cost_usd_per_month = 0.0001 WHERE user_id IS NULL AND org_id IS NULL;` — attempt to `POST /meetings/:id/join` — 429 returned.
4. Reset to NULL — join succeeds again.

## Do NOT
- Do NOT enforce limits unless a non-NULL value says to. Default is infinite.
- Do NOT put enforcement logic in the worker. Tracking only.
- Do NOT double-count when agent runs error — errored runs get NULL cost and contribute nothing to `usage_counters`.
- Do NOT commit stale pricing — the quarterly test is the tripwire.
- Do NOT couple this to the superadmin UI; M54 reads these tables separately.

## Hand-off
M54 (superadmin dashboard) reads `usage_counters` + writes `usage_limits`. Both modules share this schema.
