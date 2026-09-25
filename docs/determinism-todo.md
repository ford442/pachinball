# Determinism — `Math.random()` catalogue and replay spine

Tracked for **#341** (replay spine), **#343** (Async Challenges) and **#431**
(solver snapshots + the last physics-affecting `Math.random`).

**Session RNG:** `initSessionRng(seed)` in `game-lifecycle.ts` on every `startGame()`. The seed is the replay's seed when spectating, the Daily Cascade layout seed in daily mode, the `?seed=` / `?challenge=seed:target` share-link seed when one is active (`getChallengeSystem()`), and `randomU32Seed()` otherwise. Physics-affecting draws use `getSessionRngFork(label)` so sub-streams stay independent and reproducible; runtime-built collider layouts use `getLayoutRng(key)`.

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
| `layout` | Prefix of every `getLayoutRng(key)` stream (below) |

**Layout streams** — `getLayoutRng(key)` is `createSeededRng(hash(sessionSeed : layout : key))`,
a fresh stream per key rather than a cached advancing fork. Tracks and zones
are built lazily, in an order the player decides; keyed streams give the same
colliders for the same seed whatever was built first, and a rebuild of the same
track reproduces it.

---

## Physics-trajectory-affecting — **seeded**

| File | Usage | Stream |
|------|-------|--------|
| `src/game-elements/ball-manager-spawn.ts` | Weighted ball-type roll, extra-ball spawn x jitter | fork `spawn` |
| `src/game-elements/ball-manager-gold.ts` | Gold-swarm angle/speed/position | fork `gold-swarm` |
| `src/game-elements/ball-manager-multiball.ts` | Multiball spawn offsets | fork `multiball` |
| `src/objects/object-ball-traps.ts` | Trap release boost vector | fork `trap` |
| `src/objects/object-spinner-bumpers.ts` | Spinner spin direction | fork `spinner` |
| `src/game-elements/ball-manager.ts` | Imposter catch release impulse | fork `spawn` |
| `src/objects/feeders/mag-spin-feeder.ts` | Release angle variance | fork `feeder` |
| `src/objects/feeders/quantum-tunnel-feeder.ts` | Eject impulse z variance | fork `feeder` |
| `src/objects/feeders/nano-loom-feeder.ts` | Weave nudge impulse | fork `feeder` |
| `src/game-elements/path-mechanics/spinner-launcher.ts` | Launch angle | fork `feeder` |
| `src/display/slot-machine.ts` | Activation + spin plan | fork `slot` |
| `src/display/display-reels.ts` | Reel shuffles / stops | fork `slot` |
| `src/game-elements/path-mechanics/reactive-peg-cluster.ts` | Peg cluster radius variance | `peg-cluster:<x>,<y>,<z>` |
| `src/game/game-scenario.ts` | Dynamic scenario obstacle type/position | `scenario-zone:<index>` |
| `src/adventure/tracks/prism-pathway.ts` | Prism collider placement + rotation | `track:prism-pathway` |
| `src/adventure/tracks/casino-heist.ts` | Chip-stack collider placement + height; slot-gate mover phase/frequency | `track:casino-heist:chips`, `…:gates` |
| `src/adventure/tracks/orbital-junkyard.ts` | Debris collider placement, size, shape, orientation | `track:orbital-junkyard:debris` |
| `src/adventure/tracks/neural-network.ts` | Cilia collider placement | `track:neural-network:cilia` |
| `src/adventure/tracks/neon-skyline.ts` | AC-unit collider placement | `track:neon-skyline:ac-units` |
| `src/adventure/tracks/polychrome-void.ts` | Ghost collider offsets; which isle is green (collision group) | `track:polychrome-void:ghosts`, `…:isles` |
| `src/adventure/tracks/tesla-tower.ts` | Ball-lightning collider placement + oscillator frequency/phase | `track:tesla-tower:lightning` |
| `src/replay/challenge-system.ts` | Default challenge seed when `?seed=` is absent | `randomU32Seed()` (entropy, not gameplay) |

Nothing is deferred: `grep -rn "Math.random" src` lists only the cosmetic
entries below plus `randomU32Seed`'s fallback.

---

## Cosmetic / exempt — **stay on `Math.random()`**

| File | Usage |
|------|-------|
| `src/effects/effects-camera.ts` | Camera shake offsets |
| `src/effects/effects-screen.ts` | Screen shake offsets |
| `src/effects/effects-shards.ts` | Particle shard velocity/rotation/scale |
| `src/effects/effects-audio.ts` | Synth frequency + noise buffer |
| `src/effects/effects-jackpot.ts` | Injectable callback default (`Math.random`) |
| `src/game/game-post-process.ts` | Table-camera shake offsets |
| `src/display/display-lcd-overlay.ts` | Walk-by emoji timer/speed/pick |
| `src/audio/sound-system-synth.ts` | Noise buffers, pan, frequency jitter |
| `src/audio/sound-system-samples.ts` | Random sample pick |
| `src/game-elements/ball-stack-visual.ts` | Reserve-ball visual rotation |
| `src/objects/feeders/mag-spin-feeder.ts` | Release shake of the ring meshes (visual only) |
| `src/objects/feeders/gauss-cannon-feeder.ts` | Barrel vibration (visual only) |
| `src/game/physics/collision-handlers.ts` | Bumper / flipper beep pitch variance |
| `src/materials/material-cabinet.ts` | Wood grain procedural texture |
| `src/materials/material-core.ts` | Texture noise |
| `src/objects/object-bumpers.ts` | Hologram sweep phase (visual only) |
| `src/objects/decoration/decoration-motifs.ts` | Trace IDs, LED jitter |
| `src/objects/decoration/decoration-factory.ts` | Trim scale/rotation |
| `src/objects/decoration/decoration-builder.ts` | Dummy ball diameter |
| `src/adventure/tracks/casino-heist.ts` | Poker-chip material pick (commented in place) |

---

## Intentional entropy source

| File | Usage |
|------|-------|
| `src/core/seeded-rng.ts` | `randomU32Seed()` fallback when `crypto.getRandomValues` unavailable |

---

## Wall-clock time on the scoring path

Seeded RNG is not enough if gameplay reads `performance.now()`: a replay stepped
headless (or restored mid-run) runs at a different wall-clock rate than the live
game. The collision pair debounce (`CollisionDispatcher`) now runs on the
simulation clock — fixed steps taken × 1/60 s, from the C++ step counter on the
owner path and Rapier's otherwise.

Still wall-clock (not physics-trajectory-affecting unless the tape nudges):

| File | Usage | Notes |
|------|-------|-------|
| `src/game/physics/physics-controller.ts` | Nudge cooldown / tilt warnings / tilt decay; tilt penalty via `setTimeout` | A tape whose nudges land inside the cooldown in one run and outside in another can TILT differently. Move to the sim clock before nudge-heavy replays are verified. |

---

## Solver snapshots (#431)

`PhysicsWorld::serialize()` / `restore()` (`native/src/Snapshot.{h,cpp}`) —
versioned little-endian blob of the full C++ solver state, refused on a
differently built table. Replays carry the frame-0 snapshot plus a world
fingerprint (see `docs/ASYNC_CHALLENGES_EPIC.md` and `docs/wasm-physics-engine.md`).
The native and WASM builds produce identical bytes (`npm run test:wasm-parity`);
the hinge angle uses a libm-independent `atan2` so they can.

## Roadmap

1. ~~Injectable RNG + physics-affecting fork streams + catalogue.~~
2. ~~#341: `ReplayRecorder` logs seed + inputs; C++ world snapshot + divergence harness.~~
3. ~~#343: URL `?seed=` share → session seed; ghost spectate; divergence toast.~~
4. Next: sim-clock nudge/tilt; restore across differing ball-id layouts (remap
   TS links onto the snapshot's ids instead of reporting `id-layout`); worker
   snapshot round trip.
