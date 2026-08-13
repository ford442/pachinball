# Determinism migration — remaining `Math.random()` call sites

Tracked for #341 (SeededRng + replay spine) and #343 (Async Challenges).

**Migrated in this slice:** ball-type weighted spawn (`selectWeightedBallType` in `ball-manager-spawn.ts`) via `getSessionRng()`.

**Already on SeededRng (prior work):** slot machine spins, reel shuffles, multiball offsets, gold-ball swarm, feeder release angles (mag-spin, quantum-tunnel), spinner launcher, spinner bumper spin direction, ball-trap boost variance, imposter catch impulses, daily cascade layout.

---

## Gameplay-affecting — migrate next

| File | Usage | Notes |
|------|-------|-------|
| `src/objects/object-bumpers.ts` | `sweep: Math.random()` | Bumper hologram sweep phase — may affect visual timing |
| `src/game-elements/path-mechanics/reactive-peg-cluster.ts` | Peg cluster radius variance | Adventure path mechanic layout |
| `src/game-elements/challenge-system.ts` | Default challenge seed when URL param absent | Should use `randomU32Seed()` or explicit session seed |
| `src/game/game-scenario.ts` | Scenario obstacle type/position | Dynamic scenario spawning |
| `src/game/physics/collision-handlers.ts` | Beep pitch variance on bumper hits | Audio feedback; low replay priority |

## Cosmetic / exempt (may stay on `Math.random()`)

| File | Usage |
|------|-------|
| `src/effects/effects-camera.ts` | Camera shake offsets |
| `src/effects/effects-screen.ts` | Screen shake offsets |
| `src/effects/effects-shards.ts` | Particle shard velocity, rotation, scale |
| `src/effects/effects-audio.ts` | Synth frequency + noise buffer |
| `src/display/display-lcd-overlay.ts` | Walk-by emoji timer, speed, pick |
| `src/game-elements/sound-system-synth.ts` | Noise buffers, pan, frequency jitter |
| `src/game-elements/sound-system-samples.ts` | Random sample pick |
| `src/game-elements/ball-stack-visual.ts` | Reserve-ball visual rotation |
| `src/game-elements/mag-spin-feeder.ts` | Release shake (visual only) |
| `src/game-elements/gauss-cannon-feeder.ts` | Barrel vibration (visual only) |
| `src/game/game-renderer.ts` | Render jitter offsets |
| `src/materials/material-cabinet.ts` | Wood grain procedural texture |
| `src/materials/material-core.ts` | Texture noise |
| `src/objects/decoration/decoration-*.ts` | LED placement, dummy balls, trace IDs |
| `src/adventure/tracks/*.ts` | Procedural decoration placement (build-time layout) |

## Intentional entropy source

| File | Usage |
|------|-------|
| `src/core/seeded-rng.ts` | `randomU32Seed()` fallback when `crypto.getRandomValues` unavailable |

---

## Open questions (from #341 scoping)

1. **Seed source:** fixed dev seed, per-session `randomU32Seed()`, or URL/localStorage override for shareable challenges (#343)?
2. **Module home:** `src/core/seeded-rng.ts` (chosen — kernel alongside EventBus).
3. **PRNG width:** Mulberry32 (32-bit state) is sufficient for MVP; revisit if replay desync appears at scale.
