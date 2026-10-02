# Daily Cascade

Seeded table-mode layout mutator for roguelike replayability. Adventure tracks stay authored.

## Modes

| Mode | Seed | Leaderboard `map_id` |
|------|------|----------------------|
| Vanilla | — | current table map |
| Daily Cascade | UTC `YYYY-MM-DD` (hashed) | `daily-cascade-YYYY-MM-DD` |
| Free Play | visible u32 + **Randomize** | `free-cascade-<hexSeed>` |

UI lives on the start screen (`#daily-cascade-panel`, bound by
[`src/game/daily-cascade-ui.ts`](../src/game/daily-cascade-ui.ts)).

## Machine identity

Each daily / free layout is presented as a named machine, not a seed row:
[`deriveMachineIdentity`](../src/cascade/machine-identity.ts) turns a `TableLayout`
into a title (`Violet Tempest #501` — adjective + noun from a seeded fork, series
`100 + seed % 900`), a trait line (pin density by quartile, bumper drift, active
feeders) and a backbox pick (hue → IDLE grid colour/speed, LCD theme, a light
tint on the NEXUS-7 poster via `DisplaySystem.setMachineTheme`). It is pure and
deterministic; the word lists are **append-only** (reordering renames past
machines — `tests/machine-identity.test.ts` pins golden titles). The seed is still
shown in small type.

## Share links

`?cascade=<hex seed>` opens that exact free machine; `?cascade=daily` opens today's.
**Share machine** copies `?cascade=<hex>` — a daily machine is shared by its seed,
so the link still opens the same table tomorrow (and lands on the
`free-cascade-<hex>` board, not the daily one). The param is separate from the
challenge params (`?seed=` / `?challenge=`, decimal, session RNG): a link may carry
both, the cascade picking the layout and the challenge seeding the run. There is no
backend; nothing here touches `/api/maps`.

## What mutates

- Pachinko pin density / positions (hex grid + dropout)
- Bumper positions (jittered from canonical set)
- Feeder enable flags (2–4 of 5 active)

Cabinet, walls, flippers, lane sensors, and adventure tracks are fixed.

## Pipeline

1. `SeededRng` (mulberry32) — [`src/core/seeded-rng.ts`](../src/core/seeded-rng.ts)
2. `generateTableLayout` + `validateLayout` — [`src/cascade/daily-cascade-layout.ts`](../src/cascade/daily-cascade-layout.ts) (barrel: [`src/cascade/index.ts`](../src/cascade/index.ts); the old `src/game-elements` shims are gone)
3. On `startGame()`: `rebuildMutableToys(layout)` + feeder `setGameplayEnabled` + `rebuildHandleCaches()`

Same seed always yields the same layout (see Vitest).

## Constraints

- Min pin–pin / pin–bumper spacing
- Keep-out AABBs: flipper arcs, launch lane, drain, catcher hole
- Automated disk spawn probes across 20 seeds in CI (`tests/daily-cascade-layout.test.ts`)

## Related

Epic #304 / [`docs/ASYNC_CHALLENGES_EPIC.md`](ASYNC_CHALLENGES_EPIC.md) — this module is the procedural mutator spine for async challenges.
