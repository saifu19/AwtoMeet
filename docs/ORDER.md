# Execution Order

The team operates on a **horizontal-within-wave, vertical-between-waves** model:

- **Horizontal:** within a wave, multiple pairs work on different modules in parallel.
- **Vertical:** a later wave cannot fully ship until the previous wave's blocking modules merge.
- **Escape hatch:** a Wave N+1 module may **start coding** as soon as its specific upstream lands; it just cannot **merge** until its wave gate opens. (See `DEPENDENCIES.md` "Cross-wave early-start permissions.")

## Wave gates (hard rules)

| Wave | Cannot start until… | Cannot ship until… |
|---|---|---|
| 0 | — | — |
| 1 | M00, M01, M02 merged | All Wave 0 merged |
| 2 | M14 merged (only Wave 1 module Wave 2 strictly needs) | All Wave 1 merged |
| 3 | M20, M21, M22 merged | All Wave 2 merged |
| 4 | M31 merged | All Wave 3 merged |
| 5 | Each module declares its own minimum gate (see below) | All Wave 4 merged |
| 6 | All Waves 0–5 merged AND local end-to-end smoke test passes (plan.md §11 step 20) | — |

### Wave 5 per-module minimum gates

| Module | Minimum upstream |
|---|---|
| M50 | M40, M41 |
| M51 | M14 |
| M52 | M10, M14 |
| M53 | M40, M41 |
| M54 | M10 |
| M55 | M10, M14 |

## Recommended pair assignments

Assuming **4 pairs + 1 solo dev** (8–9 people total). Adjust to your headcount.

### Wave 0 — single-track, no parallelism

| Module | Pair | Why |
|---|---|---|
| M00 | Pair A (one strong full-stack dev) | Foundational; everyone else is blocked. Ship in 1–2 days. |
| M01 | Pair A (immediately after M00) | Same person for context continuity. |
| M02 | Pair B (in parallel with M01) | M02 only depends on M00, so it can run alongside M01. |

### Wave 1 — full horizontal parallelism (5 streams)

| Module | Pair | Notes |
|---|---|---|
| M10 + M11 | Pair A | Auth full-stack; same pair owns both api and web for coherence |
| M12 | Pair B | Agents CRUD full-stack |
| M13 | Pair C | Meeting types CRUD full-stack |
| M14 | Pair D (strongest pair — critical path) | Meetings CRUD; downstream of M13 |
| M15 | Solo dev | Cross-cutting authz helper; lands last in the wave so it can refactor across all CRUD modules |

### Wave 2 — narrow front, prioritize critical path

| Module | Pair | Notes |
|---|---|---|
| M20 | Pair D (continues from M14 — critical path) | LiveKit join + room page |
| M52 | Pair D after M20 lands | Invites + guest access (pulled forward from Wave 5 — enables multi-user meetings) |
| M21 | Pair B (Python-comfortable pair) | Worker skeleton |
| M22 | Pair D after M20+M52 land | Wires M20 ↔ M21 |

**Note:** M52 was moved from Wave 5 to Wave 2 because multi-user meeting access is required immediately after LiveKit join works. Its dependencies (M10, M14, M20) are all satisfied. Insights gating (`canViewInsights`) is created here but wired to SSE/insights endpoints when M32/M33 land.

Pairs A, C, and the solo dev can either start Wave 3 modules early (M30 needs only M21; M33 needs M11+M32) or start Wave 5 modules with low gates (M51 needs only M14).

### Wave 3 — pipeline with hand-offs

| Module | Pair | Notes |
|---|---|---|
| M30 | Pair B (continues Python work) | STT stream |
| M31 | Pair B after M30 | Buffer + persist (critical path) |
| M32 | Pair A | SSE endpoint (Node side) |
| M33 | Pair C | Insights dashboard (web) |
| M34 | Pair D | Live captions overlay |

### Wave 4 — agent intelligence

| Module | Pair | Notes |
|---|---|---|
| M40 | Pair B (Python continuity, critical path) | LangGraph graph |
| M41 | Pair B after M40 | Fanout (critical path) |
| M42 | Pair C | Insights agents tab (rebases on M33) |

### Wave 5 — broad horizontal sprint

| Module | Pair | Notes |
|---|---|---|
| M50 | Pair B (critical path) | Post-meeting summary |
| M51 | Pair A | Auto-classify |
| ~~M52~~ | ~~Pair D~~ | ~~Invites~~ — **moved to Wave 2 (after M20)** |
| M53 | Pair C | Usage tracking |
| M54 | Solo dev | Superadmin |
| M55 | Whoever is free last | Google Calendar (lowest priority — plan.md §11.19) |

### Wave 6 — single-track ship

| Module | Pair |
|---|---|
| M60 | Pair A + human together | Deploy + smoke test |

## Daily standup format

Each pair reports in **3 lines**:

```
[Pair X] Branch: feat/mXX-<slug>
         Status: in-progress | in-review | blocked
         Blocker / ETA: <one sentence>
```

Skip the rest. The standup is for unblocking, not status theater.

## Merge discipline

- **FIFO within a wave.** First PR to pass review merges first.
- **Rebase, don't merge.** Later PRs in the same wave rebase onto `main` after each merge.
- **No cross-wave merges** until the gate opens.
- **Squash merges only.** Linear history.
- See `WORKTREES.md` for file-collision rules and `DEFINITION_OF_DONE.md` for the merge checklist.

## Critical path (protect this — assign strongest pairs)

```
M00 → M01 → M14 → M20 → M22 → M31 → M41 → M50 → M60
```

Any delay on this chain delays ship date 1-for-1. Anything off this chain has slack — schedule it around critical-path needs.

## What to do when blocked

1. **Check your wave gate** — are you trying to start before your upstream merged? Use early-start rules in `DEPENDENCIES.md`.
2. **Check the file-collision rules** in `WORKTREES.md` — is another pair holding the file you need?
3. **Pull a Wave 5 module with a low gate** if you're truly idle (M51, M54, M55 are good fillers).
4. **Post in standup.** Don't sit on blockers silently.
