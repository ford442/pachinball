# Daily Cascade

Seeded table-mode layout mutator for roguelike replayability. Adventure tracks stay authored.

## Modes

| Mode | Seed | Leaderboard `map_id` |
|------|------|----------------------|
| Vanilla | — | current table map |
| Daily Cascade | UTC `YYYY-MM-DD` (hashed) | `daily-cascade-YYYY-MM-DD` |
| Free Play | visible u32 + **Randomize** | `free-cascade-<hexSeed>` |

UI lives on the start screen (`#daily-cascade-panel`).

## What mutates

- Pachinko pin density / positions (hex grid + dropout)
- Bumper positions (jittered from canonical set)
- Feeder enable flags (2–4 of 5 active)

Cabinet, walls, flippers, lane sensors, and adventure tracks are fixed.

## Pipeline

1. `SeededRng` (mulberry32) — [`src/game-elements/seeded-rng.ts`](../src/game-elements/seeded-rng.ts)
2. `generateTableLayout` + `validateLayout` — [`src/game-elements/daily-cascade-layout.ts`](../src/game-elements/daily-cascade-layout.ts)
3. On `startGame()`: `rebuildMutableToys(layout)` + feeder `setGameplayEnabled` + `rebuildHandleCaches()`

Same seed always yields the same layout (see Vitest).

## Constraints

- Min pin–pin / pin–bumper spacing
- Keep-out AABBs: flipper arcs, launch lane, drain, catcher hole
- Automated disk spawn probes across 20 seeds in CI (`tests/daily-cascade-layout.test.ts`)

## Related

Epic #304 / [`docs/ASYNC_CHALLENGES_EPIC.md`](ASYNC_CHALLENGES_EPIC.md) — this module is the procedural mutator spine for async challenges.
