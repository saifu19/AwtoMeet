# M51 — Auto-classify meeting type
Wave: 5    Owner: <unassigned>    Branch: feat/m51-auto-classify
Depends on: M14    plan.md refs: §6

## Goal
When a user creates a meeting with `auto_classify=true` and no explicit `meeting_type_id`, the API calls a small LLM synchronously inside the create handler to pick one of the user's existing `meeting_types` based on title+description. The LLM sees only `(id, name, description)` for each candidate and returns the chosen `id` (or null if nothing matches). Runs on `gpt-4o-mini` (from env default) and finishes in <2s so it can stay in the request path.

## Context (inlined from plan.md)
- Endpoint: `POST /meetings { title, description, scheduled_at?, meeting_type_id?, auto_classify? }`.
- From §6: "if no `meeting_type_id` is given but `auto_classify=true`, the API calls an LLM with the meeting title+description and the user's available `meeting_types[*].{name,description}` and picks one. Use `gpt-4o-mini` from the env default. This runs synchronously inside the create handler — it's fast."
- API is Node+Fastify. LLM call uses the OpenAI Node SDK (or `@langchain/openai` if already installed) — we do NOT call into the Python worker for this.
- Scope: classify ONLY among meeting types owned by the requesting user (plus `org_id`-shared in the future; use `assertCanAccess`-style repo filter).

## Files to create / modify
- **Install (api):** `openai` SDK (or `@langchain/openai` + `@langchain/core`) if not yet present.
- **Create:** `apps/api/src/services/classify.ts` — `classifyMeetingType(user, { title, description }): Promise<string | null>`.
- **Modify:** `apps/api/src/routes/meetings.ts` (create handler) — if `body.auto_classify && !body.meeting_type_id`, call the classifier and set `meeting_type_id` to the result before inserting.
- **Modify:** shared zod schema for meeting create — add `auto_classify: z.boolean().optional()`.
- **Create:** `apps/api/tests/classify.test.ts` — mock LLM, verify selection logic and fallback to null.

## Implementation notes
- Load candidate meeting types via the repository function (with the `orgId` param still accepted-but-unused per §15).
- Prompt skeleton (single message, no chat history):
  > You classify a meeting into one of the user's meeting types. Return JSON `{"meeting_type_id": "<id>" | null, "confidence": 0..1, "reason": "<short>"}`. Only pick an id from the provided list. Prefer null over a weak guess.
  >
  > Meeting: title="...", description="..."
  > Options: [{"id":"01H...","name":"Sales Discovery","description":"..."}, ...]
- Use `response_format: { type: "json_object" }`.
- Timeout: 3s hard cap. On timeout or any error, log and proceed with `meeting_type_id = null` — never fail the create request because of classification.
- Confidence threshold: if `confidence < 0.5`, treat as null.
- If the user has zero meeting types, skip the call entirely and set null.
- Keep the call cheap: `gpt-4o-mini`, `max_tokens: 150`, `temperature: 0`.

## Acceptance criteria
- [ ] `POST /meetings { auto_classify: true, title, description }` (no `meeting_type_id`) inserts a meeting with a `meeting_type_id` matching one of the user's types when the title/description clearly maps to one.
- [ ] When nothing matches, the meeting is created with `meeting_type_id = null` and no error.
- [ ] An LLM/network failure never returns a 5xx from the create endpoint; the meeting is still created with `meeting_type_id = null`.
- [ ] Users cannot be classified into meeting types they don't own.
- [ ] `auto_classify` is ignored when `meeting_type_id` is explicitly provided.
- [ ] Unit tests cover: happy path, no match, low confidence, zero-types user, LLM error.

## Smoke test
1. As a user with meeting types "Sales Discovery" and "Standup", `POST /meetings { title: "Intro call with Acme", description: "pricing discussion", auto_classify: true }`.
2. Response returns a meeting with `meeting_type_id` pointing to "Sales Discovery".
3. `POST /meetings { title: "Lunch", description: "food", auto_classify: true }` returns a meeting with `meeting_type_id = null`.

## Do NOT
- Do NOT call the Python worker for this. It is a Node-side synchronous call.
- Do NOT look at meeting types from other users.
- Do NOT let a classifier failure block meeting creation.
- Do NOT pick a type with confidence < 0.5.
- Do NOT cache results across users.
- Do NOT use an expensive model — `gpt-4o-mini` (or env default) is sufficient.

## Hand-off
Independent from other Wave 5 modules. Ships when its own tests pass.
