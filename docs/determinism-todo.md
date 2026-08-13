# Determinism migration — `Math.random()` catalogue

Tracked for **#341** (replay spine) and **#343** (Async Challenges).

**Session RNG:** `initSessionRng(seed)` in `game-lifecycle.ts` on every `startGame()`. Physics-affecting draws use `getSessionRngFork(label)` so sub-streams stay independent and reproducible.

**Fork labels** (`src/core/seeded-rng.ts` → `RNG_FORK`):

| Label | Consumers |
|-------|-----------|
| `spawn` | Weighted ball-type roll, extra-ball x jitter, imposter catch impulse |
| `gold-swarm` | Small-gold swarm angle/speed/position |
| `multiball` | Chain-multiball spawn offsets |
| `trap` | Ball-trap release boost vector |
| `spinner` | Spinner bumper spin direction |
| `feeder` | Mag-spin / quantum-tunnel / nano-loom / spinner-launcher variances |
| `slot` | Slot-machine activation + reel shuffles |

---

## Physics-trajectory-affecting — **seeded** (this slice)

| File | Line(s) | Usage | Fork |
|------|---------|-------|------|
| `src/game-elements/ball-manager-spawn.ts` | ~549 | Weighted ball-type roll | `spawn` |
| `src/game-elements/ball-manager-spawn.ts` | ~145 | Extra-ball spawn x jitter | `spawn` |
| `src/game-elements/ball-manager-gold.ts` | ~205–215 | Gold-swarm angle/speed/position | `gold-swarm` |
| `src/game-elements/ball-manager-multiball.ts` | ~41–43 | Multiball spawn offsets | `multiball` |
| `src/objects/object-ball-traps.ts` | ~298–300 | Trap release boost vector | `trap` |
| `src/objects/object-spinner-bumpers.ts` | ~247 | Spinner spin direction | `spinner` |
| `src/game-elements/ball-manager.ts` | ~277 | Imposter catch release impulse | `spawn` |
| `src/game-elements/mag-spin-feeder.ts` | ~405 | Release angle variance | `feeder` |
| `src/game-elements/quantum-tunnel-feeder.ts` | ~271 | Eject impulse z variance | `feeder` |
| `src/game-elements/nano-loom-feeder.ts` | ~352 | Weave nudge impulse | `feeder` |
| `src/game-elements/path-mechanics/spinner-launcher.ts` | ~152 | Launch angle | `feeder` |
| `src/display/slot-machine.ts` | ~145, ~170 | Activation + spin plan | `slot` |
| `src/display/display-reels.ts` | ~251, ~390, ~401, ~421 | Reel shuffles / stops | `slot` |

---

## Physics-trajectory-affecting — **deferred** (migrate in #341)

| File | Line(s) | Usage | Notes |
|------|---------|-------|-------|
| `src/game-elements/path-mechanics/reactive-peg-cluster.ts` | 62 | Peg cluster radius variance | Adventure path layout |
| `src/game-elements/challenge-system.ts` | 44 | Default challenge seed | Use `randomU32Seed()` or session seed |
| `src/game/game-scenario.ts` | 303, 306 | Dynamic scenario obstacle type/position | Table scenario spawning |

---

## Cosmetic / exempt — **stay on `Math.random()`**

| File | Line(s) | Usage |
|------|---------|-------|
| `src/effects/effects-camera.ts` | 41–43 | Camera shake offsets |
| `src/effects/effects-screen.ts` | 296–298 | Screen shake offsets |
| `src/effects/effects-shards.ts` | 28–30 | Particle shard velocity/rotation/scale |
| `src/effects/effects-audio.ts` | 141, 242 | Synth frequency + noise buffer |
| `src/effects/effects-jackpot.ts` | 32 | Injectable callback default (`Math.random`) |
| `src/display/display-lcd-overlay.ts` | 168, 177–178 | Walk-by emoji timer/speed/pick |
| `src/game-elements/sound-system-synth.ts` | 54, 70, 315, 346, 411, 528 | Noise buffers, pan, frequency jitter |
| `src/game-elements/sound-system-samples.ts` | 194 | Random sample pick |
| `src/game-elements/ball-stack-visual.ts` | 77–79 | Reserve-ball visual rotation |
| `src/game-elements/mag-spin-feeder.ts` | 206–207 | Release shake (visual only) |
| `src/game-elements/gauss-cannon-feeder.ts` | 267–268 | Barrel vibration (visual only) |
| `src/game/physics/collision-handlers.ts` | 95, 151 | Bumper beep pitch variance |
| `src/game/game-renderer.ts` | 288–289 | Render jitter offsets |
| `src/materials/material-cabinet.ts` | 149–160 | Wood grain procedural texture |
| `src/materials/material-core.ts` | 232 | Texture noise |
| `src/objects/object-bumpers.ts` | 149 | Hologram sweep phase (visual only) |
| `src/objects/decoration/decoration-motifs.ts` | 48, 359–360 | Trace IDs, LED jitter |
| `src/objects/decoration/decoration-factory.ts` | 76–78, 100 | Trim scale/rotation |
| `src/objects/decoration/decoration-builder.ts` | 57 | Dummy ball diameter |
| `src/adventure/tracks/tesla-tower.ts` | 123–124, 150, 153 | Prop placement / animation |
| `src/adventure/tracks/prism-pathway.ts` | 48–49, 56 | Prop placement |
| `src/adventure/tracks/polychrome-void.ts` | 72, 114 | Prop placement |
| `src/adventure/tracks/orbital-junkyard.ts` | 44–49, 64–66 | Debris placement |
| `src/adventure/tracks/neural-network.ts` | 157–158 | Forest prop placement |
| `src/adventure/tracks/neon-skyline.ts` | 76–77 | Sky prop placement |
| `src/adventure/tracks/casino-heist.ts` | 50–51, 54, 61, 141–142 | Maze chips / animation |

---

## Intentional entropy source

| File | Line(s) | Usage |
|------|---------|-------|
| `src/core/seeded-rng.ts` | 110 | `randomU32Seed()` fallback when `crypto.getRandomValues` unavailable |

---

## Open questions (from #341 scoping)

1. **Seed source:** `randomU32Seed()` per session today; add URL `?seed=` + localStorage for #343.
2. **Module home:** `src/core/seeded-rng.ts` (kernel alongside EventBus); reserve `src/determinism/` for recorder/runner.
3. **PRNG width:** Mulberry32 (32-bit) sufficient for MVP; revisit if long replays desync.
4. **Rapier upgrade:** `^0.15` → ~0.19 is a separate decision before snapshot parity work.

## Roadmap

1. **This slice:** injectable RNG + physics-affecting fork streams + catalogue (done).
2. **#341:** stable RNG consumption order; `world.createSnapshot()` divergence harness; ReplayRecorder logs seed + inputs.
3. **#343:** URL `?seed=` share + ghost spectate; graceful divergence degrade.
