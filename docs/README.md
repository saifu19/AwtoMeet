# MojoMeet — Developer Docs

This directory turns `../plan.md` into actionable, parallelizable work for the team. **`plan.md` remains the single source of truth.** Everything here references it.

## How to read these docs

1. **New to the project?** Read `../plan.md` end-to-end first. No skipping. Then come back here.
2. **Picking up work?** Read `ORDER.md` to find which wave is open, then `MODULES.md` to claim an unowned module, then open your module's brief in `modules/Mxx-*.md`.
3. **Setting up your worktree?** Read `WORKTREES.md`.
4. **Closing out a module?** Read `DEFINITION_OF_DONE.md` before opening the PR.

## Files in this directory

| File | Purpose |
|---|---|
| `README.md` | This file. |
| `MODULES.md` | Index of all 27 modules: id, title, wave, owner, status, deps, plan.md refs. |
| `DEPENDENCIES.md` | ASCII dependency graph + critical-path notes. |
| `ORDER.md` | Execution order, wave gates, pair assignments, merge discipline. |
| `WORKTREES.md` | Branch naming, `git worktree` commands, file-collision rules. |
| `DEFINITION_OF_DONE.md` | Per-module DoD checklist (tests, smoke, lint, types, docs). |
| `modules/Mxx-*.md` | One self-contained brief per module. |

## Mental model

- **Waves** are a vertical staircase: a later wave cannot fully ship until the previous wave's blocking modules are merged. Within a wave, pairs work horizontally in parallel.
- **Modules** are sized so one pair can finish in a few days on a dedicated branch with minimal cross-team file collisions.
- **Branches** follow `feat/mXX-<slug>`; **worktrees** follow `../mojomeet-mXX`.

## Anti-requirements (from plan.md §12 — read before coding)

- No tool-calling agents in MVP. Graph is `process → update_summary → END`.
- No agent cross-talk. Per-agent `thread_id` isolation is sacred.
- No worker on Vercel. Worker is Fly.io only — it holds a persistent WebSocket.
- No `whisper-1`. Use `gpt-4o-transcribe` (streaming).
- No Postgres swap. `langgraph-checkpoint-mysql` exists; use it.
- No diarization libraries. One STT stream per (participant, track).
- No mid-meeting agent hot-reload in MVP.
- No `.env` commits.

If you find yourself wanting to violate one of these, **stop and ask the human first.**
