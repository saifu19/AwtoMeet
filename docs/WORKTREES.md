# Git Worktree Strategy

We use `git worktree` so multiple pairs can work on different modules **simultaneously without juggling branches in the same checkout.** Each module gets its own branch and its own working directory.

## Branch naming

- Format: `feat/m<XX>-<slug>` (lowercase, hyphenated).
- Examples: `feat/m00-foundation`, `feat/m10-auth-api`, `feat/m41-fanout`.
- One branch per module. Do not bundle modules into a single branch.

## Creating a worktree

```bash
# From the main repo at D:\Work\MojoMeet
git fetch origin
git worktree add ../mojomeet-m12 -b feat/m12-agents-crud origin/main

# cd into your isolated checkout
cd ../mojomeet-m12

# Work normally — commits land on feat/m12-agents-crud
# When done:
git push -u origin feat/m12-agents-crud
gh pr create --base main --title "M12: agents CRUD" --body "Implements docs/modules/M12-agents-crud.md"
```

## Removing a worktree (after PR merges)

```bash
# From the main repo
git worktree remove ../mojomeet-m12
git branch -d feat/m12-agents-crud   # local cleanup
```

## File-collision rules (READ THIS BEFORE EDITING)

The breakdown was designed so two pairs can work concurrently with **near-zero file overlap.** Stick to your lane.

### Exclusive ownership zones

| Zone | Owned by |
|---|---|
| Root configs (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`) | M00 only |
| `apps/api/src/db/schema.ts` | M01 only (after merge, treat as read-only) |
| `packages/shared/**` | M02 only (later edits require a `shared-schema` labeled PR) |
| `apps/api/src/routes/auth.ts` | M10 |
| `apps/api/src/routes/agents.ts` | M12 |
| `apps/api/src/routes/meeting-types.ts` | M13 |
| `apps/api/src/routes/meetings.ts` | M14, M20, M51 (coordinate via PR review) |
| `apps/api/src/routes/invites.ts` | M52 |
| `apps/api/src/routes/admin.ts` | M54 |
| `apps/api/src/routes/integrations.ts` | M55 |
| `apps/api/src/lib/authz.ts` | M15 |
| `apps/api/src/lib/usage.ts` | M53 |
| `apps/api/src/streams/sse.ts` | M32 |
| `apps/web/src/pages/auth/**` | M11 |
| `apps/web/src/pages/agents/**` | M12 |
| `apps/web/src/pages/meeting-types/**` | M13 |
| `apps/web/src/pages/meetings/**` (list/detail/new) | M14 |
| `apps/web/src/pages/meetings/[id]/room.tsx` | M20, M34 |
| `apps/web/src/pages/meetings/[id]/insights.tsx` | M33, M42 |
| `apps/web/src/pages/meetings/[id]/summary.tsx` | M50 |
| `apps/web/src/pages/admin/**` | M54 |
| `apps/worker/src/main.py` | M21 (later edits coordinated) |
| `apps/worker/src/transcription.py` | M30 |
| `apps/worker/src/buffer.py` | M31 |
| `apps/worker/src/db.py` | M21 (initial), M31 (writes) |
| `apps/worker/src/graph.py` | M40 |
| `apps/worker/src/fanout.py` | M41 |
| `apps/worker/src/summary.py` | M50 |
| `apps/worker/src/pricing.py` | M53 |
| Deploy configs (`fly.toml`, `Dockerfile`s, `vercel.json`) | M60 |

### Coordination rules for shared files

- **`apps/api/src/routes/meetings.ts`** is touched by M14 (CRUD), M20 (`/join`), and M51 (`auto_classify`). They must merge in this order, and each later module rebases onto the previous.
- **`apps/web/src/pages/meetings/[id]/room.tsx`** is touched by M20 (base) and M34 (captions overlay). M34 rebases onto M20.
- **`apps/web/src/pages/meetings/[id]/insights.tsx`** is touched by M33 (transcript-only) and M42 (agent tabs). M42 rebases onto M33.
- **`packages/shared`** edits after M02 require a separate, narrowly-scoped PR labeled `shared-schema` so types stay coherent across in-flight branches.

## Merge discipline

- **FIFO within a wave.** First PR to pass review merges first; later PRs in the same wave rebase onto `main` after each merge.
- **No cross-wave merges** until the wave gate opens (see `ORDER.md`).
- **Squash merges only** to keep `main` history linear and bisectable.
- **PR title must reference the module ID** (e.g., `M14: meetings CRUD`).
- **PR body must link to the module brief** (`docs/modules/M14-meetings-crud.md`) and check off each acceptance criterion.

## Conflict handling

If two branches end up touching the same file because reality diverged from the plan:

1. The later branch (per merge order) rebases.
2. If the conflict is non-trivial, post in standup and let the human arbitrate.
3. Do **not** silently rewrite the other team's code to make your rebase clean.
