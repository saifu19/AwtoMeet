# Dependency Graph

```
                              ┌─────┐
                              │ M00 │  monorepo skeleton
                              └──┬──┘
                       ┌─────────┴─────────┐
                       ▼                   ▼
                    ┌─────┐             ┌─────┐
                    │ M01 │             │ M02 │
                    │ DB  │             │zod  │
                    └──┬──┘             └──┬──┘
                       │  ┌────────────────┤
                       ▼  ▼                ▼
                     ┌─────┐            ┌─────┐
                     │ M10 │            │ M11 │
                     │ auth│            │ web │
                     │ api │            │shell│
                     └──┬──┘            └──┬──┘
                        ▼                  │
                     ┌─────┐               │
                     │ M12 │               │
                     │agnts│               │
                     └──┬──┘               │
                        ▼                  │
                     ┌─────┐               │
                     │ M13 │               │
                     │mtypes               │
                     └──┬──┘               │
                        ▼                  │
                     ┌─────┐               │
                     │ M14 │ ◄─────────────┤
                     │mtgs │               │
                     └──┬──┘               │
                  ┌─────┴────┐             │
                  ▼          ▼             │
               ┌─────┐    ┌─────┐          │
               │ M15 │    │ M20 │          │   (M15 = cross-cutting authz)
               │authz│    │ join│          │
               └─────┘    └──┬──┘          │
                             ▼             │
                          ┌─────┐          │
                          │ M52 │          │   (M52 = invites + guest access, moved from Wave 5)
                          │invts│          │
                          └──┬──┘          │
                             │   ┌─────┐   │
                             │   │ M21 │   │
                             │   │worker   │
                             │   └──┬──┘   │
                             └────┬─┘      │
                                  ▼        │
                               ┌─────┐     │
                               │ M22 │     │
                               │dispch     │
                               └──┬──┘     │
                                  ▼        │
                               ┌─────┐     │
                               │ M30 │     │
                               │ STT │     │
                               └──┬──┘     │
                                  ▼        │
                               ┌─────┐     │
                               │ M31 │     │
                               │buffer     │
                               └──┬──┘     │
                          ┌───────┼─────┐  │
                          ▼       ▼     ▼  │
                       ┌─────┐ ┌─────┐ ┌─────┐
                       │ M32 │ │ M40 │ │ M34 │
                       │ SSE │ │graph│ │capt │
                       └──┬──┘ └──┬──┘ └─────┘
                          ▼       ▼
                       ┌─────┐ ┌─────┐
                       │ M33 │ │ M41 │
                       │dash │ │fanout
                       └──┬──┘ └──┬──┘
                          └───┬───┘
                              ▼
                           ┌─────┐
                           │ M42 │
                           │tabs │
                           └──┬──┘
              ┌────────┬──────┼────────┬────────┬────────┐
              ▼        ▼      ▼        ▼        ▼        ▼
           ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  ┌─────┐
           │ M50 │ │ M51 │ │ M52 │ │ M53 │ │ M54 │  │ M55 │
           │summ │ │class│ │invts│ │usage│ │admin│  │gcal │
           └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘  └──┬──┘
              └────────┴───────┴────────┴───────┴──────┘
                                    │
                                    ▼
                                 ┌─────┐
                                 │ M60 │
                                 │ship │
                                 └─────┘
```

## Critical path (longest chain — protect this)

```
M00 → M01 → M14 → M20 → M22 → M31 → M41 → M50 → M60
  ↑    ↑     ↑     ↑     ↑     ↑     ↑     ↑
  │    │     │     │     │     │     │     │
  └ Wave 0   Wave 1   Wave 2   Wave 3   Wave 4   Wave 5   Wave 6
```

**Anything not on this chain has slack.** Assign your strongest pairs to critical-path modules.

## Slack analysis

- **High slack:** M11, M15, M34, M51, M55 (M55 is explicitly the lowest priority — only do it after everything else works, per plan.md §11.19).
- **Medium slack:** M12, M13, M32, M33, M42, M53, M54. (M52 moved to Wave 2, now complete.)
- **Zero slack:** every module on the critical path.

## Cross-wave early-start permissions

A module may **start coding** before its wave gate opens, as long as its specific upstream is merged. It just cannot **merge to main** until its wave gate opens. Examples:

- M20 may start once M14 is merged, even if M10/M11/M12/M13/M15 are still in flight.
- M21 may start once M00+M01 are merged — it doesn't need any of Wave 1.
- M30 may start once M21 is merged.
- M40 may start once M31 is merged.

This is the "horizontal agile within wave + vertical staircase between waves" model, with an explicit early-start escape hatch on the critical path.
