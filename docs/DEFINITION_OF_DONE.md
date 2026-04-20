# Definition of Done

A module is **done** when every box below is checked. No exceptions, no "I'll get to it later," no merging with red checks.

## Code

- [ ] Every file listed in the brief's "Files to create / modify" section exists and compiles.
- [ ] TypeScript: `pnpm --filter <pkg> typecheck` passes with zero errors. Strict mode is on; no `any` slipped in.
- [ ] Python (worker modules): `uv run mypy src/` passes (or `ruff check` if mypy is not yet wired).
- [ ] Lint: `pnpm lint` (or `uv run ruff check`) passes with zero errors and zero new warnings.
- [ ] No `console.log` / `print` debug calls left behind.
- [ ] No commented-out blocks of code.
- [ ] No `.env` or secrets committed. `.env.example` updated if new env vars were added.

## Tests

- [ ] At least one happy-path test exists for every public function/endpoint introduced.
- [ ] At least one failure-path test exists for every endpoint that can return a 4xx (auth failure, validation failure, not-found, etc.).
- [ ] Worker modules have async tests using `pytest-asyncio`.
- [ ] `pnpm --filter <pkg> test` (or `uv run pytest`) passes locally.
- [ ] CI is green on the PR.
- [ ] Per CLAUDE.md: **test everything before returning the response.** No "should work" — verify it does.

## Smoke test

- [ ] The exact "Smoke test" steps in the module brief have been executed and pass.
- [ ] For frontend modules, smoke test was run against the **Chrome** target (per CLAUDE.md `--chrome` requirement).
- [ ] Screenshots or short Loom attached to the PR for any UI module.

## Acceptance criteria

- [ ] Every checkbox in the brief's "Acceptance criteria" section is checked off in the PR description.
- [ ] Every "Do NOT" in the brief has been honored. If you bumped into one, you stopped and asked.

## Hand-off

- [ ] The brief's "Hand-off" section is accurate — downstream modules can rely on the file paths, exported symbols, and DB tables you promised.
- [ ] If anything changed from the brief (renamed export, moved file), the brief was updated in the same PR.

## Existing code

- [ ] Per CLAUDE.md: **existing code is to be taken care of always.** No drive-by deletions, no "improvements" outside the module's scope.
- [ ] Reused existing utilities/functions where possible instead of duplicating.

## Documentation

- [ ] If you added a new env var, it's in the relevant `.env.example` AND in the brief.
- [ ] If you added a new npm/pip dependency, the lockfile is committed.
- [ ] No README files created unless the brief explicitly required it.
- [ ] Inline comments only where the logic is non-obvious. No "this function adds two numbers" comments.

## PR hygiene

- [ ] PR title: `Mxx: <short title>` (e.g., `M14: meetings CRUD`).
- [ ] PR body links to `docs/modules/Mxx-*.md`.
- [ ] PR body has the acceptance-criteria checklist copy-pasted with each item checked.
- [ ] PR is rebased onto current `main`.
- [ ] Squash-merge only.

## Final gate

- [ ] You re-read plan.md §12 (anti-requirements) and confirmed your PR violates none of them.
- [ ] You self-reviewed the diff once before requesting review. (Catch your own typos before someone else has to.)
