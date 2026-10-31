# Daily Cascade

Seeded table-mode layout mutator for roguelike replayability. Adventure tracks stay authored.

## Modes

| Mode | Seed | Leaderboard `map_id` |
|------|------|----------------------|
| Vanilla | — | current table map |
| Daily Cascade | UTC `YYYY-MM-DD` (hashed) | `daily-cascade-YYYY-MM-DD` |
| Free Play | visible u32 + **Randomize** | `free-cascade-<hexSeed>` |
| Weekly Machine | UTC ISO week `YYYY-Www` (hashed), or the seed of a `?seed=` / `?challenge=` link | `weekly-machine-<hexSeed>` |

UI lives on the start screen (`#daily-cascade-panel`).

## What mutates

- Pachinko pin density / positions (hex grid + dropout)
- Bumper positions (jittered from canonical set)
- Feeder enable flags (2–4 of 5 active)

Cabinet, walls, flippers, lane sensors, and adventure tracks are fixed.

## Pipeline

1. `SeededRng` (mulberry32) — [`src/core/seeded-rng.ts`](../src/core/seeded-rng.ts)
2. `generateTableLayout` + `validateLayout` — [`src/cascade/daily-cascade-layout.ts`](../src/cascade/daily-cascade-layout.ts) (barrel: [`src/cascade/index.ts`](../src/cascade/index.ts))
3. On `startGame()`: `rebuildMutableToys(layout)` + feeder `setGameplayEnabled` + `rebuildHandleCaches()`

Same seed always yields the same layout (see Vitest).

## Constraints

- Min pin–pin / pin–bumper spacing
- Keep-out AABBs: flipper arcs, launch lane, drain, catcher hole
- Automated disk spawn probes across 20 seeds in CI (`tests/daily-cascade-layout.test.ts`)

## Weekly machine

One seeded **machine**, not only a reshuffled pin lattice
([`src/cascade/weekly-machine.ts`](../src/cascade/weekly-machine.ts)). A seed picks,
through `getLayoutRng('weekly:' + seed)`:

| What | Envelope (`WEEKLY_ENVELOPE`) |
|------|------------------------------|
| Pin-field density | lattice 8–12 rows × 11–15 cols, seeded dropout 12.5 %–37.5 % |
| Pin keep-outs | up to 3 extra rectangles (1–3 wide, 3–10 tall) inside the field, plus the table's own and one around each bumper |
| Bumper offsets | each of the 12 canonical bumpers moves ≤ 1 unit per axis, off the flipper arcs, ≥ 0.5 between rims |
| Armed feeders | 2–4 of the 5 existing feeders |

The result is a plain-JSON `WeeklyMachineDescriptor`, validated like a track
definition (`validateWeeklyMachine`: shape, envelope, then the Daily Cascade
constraints, a pin-count floor and the spawn probes). **An out-of-envelope value
is an error, never clamped**; the generator draws only values that pass and falls
back to `plainWeeklyMachine(seed)` if 48 draws all fail. Numbers live on a 1/64
grid so a descriptor survives JSON exactly. `npm run machine:validate` sweeps the
next 53 ISO weeks and 100 free seeds, validates the fixtures in
`tests/fixtures/weekly-machines/`, and pins `2026-W44` as a golden — the
generator is part of the replay contract, so changing what a seed draws moves
every weekly table (bump `WEEKLY_MACHINE_VERSION` if you mean to).

**Build.** `TableLayout.pinField` carries the field as authored (rows, cols,
`dropout`, `dropoutSeed`, `keepOuts`); `pachinkoPinFieldSpec` turns it into one
`PinFieldSpec` with **no occupancy mask** and the C++ owner takes it as one
`addPinField`. Bumpers and feeders go through the calls they always did. No new
collider type, no new library. `layout.pins` is the same spec resolved in
float32 (`resolvePinField`), which is what the constraint checks and the lattice
mesh see. The generator and validator (`weekly-machine.ts`) are a lazy chunk,
loaded by `DailyCascadeState.loadWeekly()` when a game starts on a weekly
machine — the entry chunk is close to its gzip budget.

**Which table a game starts on** (`resolveStartMachine`, called from `startGame`
before the session RNG is seeded):

| Start | Table |
|-------|-------|
| Weekly Machine start mode | this ISO week's machine |
| `?seed=N` / `?challenge=N:target` on a Vanilla start | the weekly machine for `N` |
| Daily Cascade / Free Play | their pin-lattice layouts, unchanged |
| Campaign | vanilla table (a share link does not mutate it) |
| Replay with `machine: 'weekly'` in the payload | the weekly machine for the payload's `seed`, whatever the spectator selected |
| Any other replay | vanilla (or the spectator's Daily / Free layout, as before) |

`startGame` seeds the session RNG with the machine's seed, **then** builds the
table (`getLayoutRng` is keyed by the session seed as well, so `weeklyMachineRng`
throws if they differ), all before the first recorded step. The frame-0
fingerprint therefore includes the descriptor: two clients with the same seed
export the same statics and get the same `staticContentHash()`. Three layers
check it: `tests/weekly-machine-owner.test.ts` compares the engine calls and the
pin-occupancy hash of two builds (fake engine); `native/tests/pin_field_test.cpp`
pins C++'s resolution of the golden 2026-W44 field to the pins TypeScript
resolves; `tests/weekly-machine-static-hash.spec.ts` compares
`getStaticContentHash()` across two page loads on the compiled bundle (CI, like
the other `wasm-owner` specs). The replay payload gains `machine?: 'weekly'`.

## Related

Epic #304 / [`docs/ASYNC_CHALLENGES_EPIC.md`](ASYNC_CHALLENGES_EPIC.md) — this module is the procedural mutator spine for async challenges.
