# Golden replay tapes re-recorded — 2026-11-13 (#519 A1)

All seven `tests/replays/*.json` failed `frame-0 snapshot table-mismatch` on `main` since they landed
(#471, merged 11-04). This records why, per tape, and what the re-record changed.

## Method

Every point below was built from its own commit in a scratch worktree with emsdk **6.0.10** (the
`.emsdk-version` pin, emsdk repo `708dcbcc`), `CI=true npm run build:wasm`, and verified with **that
commit's own** `scripts/verify-replay.mjs`. (The 11-05 swarm ran HEAD's harness on old builds, which
is why its per-commit counts — 2/7, 1/7, 4/7 — disagreed with each other.)

| Commit | What it is | Tapes that verify |
|---|---|---|
| `2621041` | #471 branch, the commit that recorded the tapes (10-16) | 6 / 7 (`adventure-neon-helix` fails) |
| `0f03db51` | #471 branch tip before it merged `main` (10-17) | 6 / 7 (same) |
| `73e40602` | #471 branch after merging `origin/main` (10-31) | **0 / 7** |
| `908a4c56` | #471 merged into `main` (11-04) | 0 / 7 |
| `87ee2bc6`, `9e06a7bb` | `main` before / after #513 (box face normals, snapshot validation) | 0 / 7 |

So nothing merged into `main` after the tapes landed broke them: they were stale on arrival.

## Cause 1 — #492 added four sensor statics to every table (6 tapes)

The frame-0 snapshot header carries per-family static counts (`native/src/Snapshot.h`). Old tapes
vs a recording at `73e40602` (and at HEAD, identical):

| Tape | sensors before → after | every other family |
|---|---|---|
| adventure-casino-heist | 22 → 26 | unchanged |
| adventure-neon-helix | 22 → 26 | unchanged |
| adventure-storm-lattice | 24 → 28 | unchanged |
| free-cascade, magspin-capture, multiball, vanilla-rally | 21 → 25 | unchanged |

`9c9c10a4` (#492, "Drive scenario zones and exit portals from C++ sensor contacts", 10-29) authors each
`ZoneTriggerSystem` scenario zone as a C++ `SensorVolume`; `createZonesForMap` builds four
(`zoneCount = 4`). It reached the tapes' branch in the 10-31 merge. An intentional table change:
the tapes are stale (`--record`), not the build.

## Cause 2 — `adventure-neon-helix` never reproduced on the pin

It fails even at its own recording commit on 6.0.10, with only this tape's static hash differing.
The tapes were recorded on 10-16, when `scripts/build-wasm.sh` only *warned* locally on an emcc other
than the pin; the most likely cause is a recording built with another emcc. It is not attributable
to a commit. Re-recorded at HEAD it verifies on fresh pages twice with the same hash, and an
off-pin emcc now fails the build everywhere (#519 C), so this cannot recur silently.

## Also fixed before re-recording — per-step gameplay (merge regression)

On #471's branch every feeder, caught ball, stuck check and combo / tilt / power-up window ran once
per fixed step inside `stepFixed`. The 10-31 merge brought in the frame scheduler (#488 §4,
`01470f34`) and those moved into `updateSim()` — the render-frame `sim` phase, which the headless
verifier never runs. `magspin-capture` recorded at HEAD before the fix scored **0**: the ball sat in
the well and the feeder never left IDLE. Any live run with a capture would have been rejected on
verification. `stepGameplay()` restores the per-step contract (and `GameSimClock.liveMs()` puts the
nudge cooldown and tilt penalty on the running step); `tests/physics-controller-step-gameplay.test.ts`
pins it.

## The re-record

`node scripts/verify-replay.mjs --record`, then `npm run verify:replay` twice on fresh pages: 7 / 7 both
times, identical hashes. Then the replay-verifier self-test: 13 / 13 cases ok.

| Tape | score before | after | finalStateHash | staticHash |
|---|---|---|---|---|
| `adventure-casino-heist` | 0 | 0 | `0f2c1ec2557d7fd1` → `55f5bc4f5cac6df1` | `c048e30f3f11b3de` → `ecbd00b5f02460bd` |
| `adventure-neon-helix` | 2500 | 200 | `46fd1e51257b01d3` → `3c777446f2362843` | `10644124d0ae8994` → `06968b7b0c6c52c0` |
| `adventure-storm-lattice` | 0 | 0 | `5ab7afaa142b3572` → `4151243d91d8f6c4` | `7155f7dabd2093de` → `90d666a4f20b3480` |
| `free-cascade` | 870 | 870 | `fe99723b41696032` → `873602e78efdd1fb` | `3bc7f65dae203a6b` → `d39076fad3a225a2` |
| `magspin-capture` | 600 | 1620 | `811d49075d255cd5` → `7273d8f96bfb485f` | `8b10cd3bfa458bd8` → `560c11b4a8da2280` |
| `multiball` | 14668 | 7159 | `a6e4b71e7bc1fe23` → `036d73f7434e3ad3` | `8b10cd3bfa458bd8` → `b4201523553090e9` |
| `vanilla-rally` | 1670 | 500 | `f85ab5c7aae2f803` → `bed23a85be8f1dfe` | `8b10cd3bfa458bd8` → `718f0e03651a91c5` |

Scores and paths are not comparable across the re-record: once the statics differ the old tape cannot
be replayed on the new table at all. Between recording and HEAD the paths also moved with the
intentional numeric changes merged since (#513 box face normals and setRotation wake; #492's swept
sensors; the per-step gameplay above).
