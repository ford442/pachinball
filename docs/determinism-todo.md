# Determinism — `Math.random()` catalogue and replay spine

Tracked for **#341** (replay spine), **#343** (Async Challenges) and **#422**
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
game. Two clocks replace it (`src/core/sim-clock.ts`):

- **Engine step counter** — `simNowMs(physics)`: fixed steps the active engine
  has taken × 1/60 s. The C++ counter whenever a WASM engine is active (owner,
  worker *and* mirror — the mirror's Rapier world never steps, so reading
  Rapier's counter there froze the clock), Rapier's otherwise. Used by the
  collision pair debounce (`CollisionDispatcher`), which already tolerates the
  counter going backwards.
- **Gameplay clock** — `GameSimClock`, owned by `GamePhysicsController.simClock`
  and installed for the whole game (`installSimClock`, read via
  `simClockMs()` / `simClockSeconds()` / `simClockSteps()`). It accumulates the
  steps the engine took each frame and never jumps: after a snapshot restore
  moves the engine counter to the recorder's value it re-anchors (`resync`)
  instead of counting the jump, so an interval that started before the restore
  (ball-save from `startGame()`) measures the same on recorder and spectator.

On the gameplay clock (#441):

| What | Where |
|------|-------|
| Nudge cooldown, tilt warnings, warning decay | `physics-controller.ts` `applyNudge` / `tickTilt` |
| Tilt penalty (no `setTimeout`; released in `tickTilt` each frame) | `physics-controller.ts` `triggerTilt` |
| Ball-save grace | `ball-manager-context.ts` `nowMs()`, `scoring-bridge.ts` |
| Combo chain / bumper combo / gold-streak windows | `scoring-bridge.ts` `nowSeconds()` |
| Gold swarm quick-collect bonus | `ball-manager-gold.ts` `collectBall` |
| Plunger charge (steps held) | `input-plunger.ts` |
| Flipper hold-time stiffness ramp (Rapier path) | `game-input-actions.ts` |
| Gameplay timers stepped per frame: swarm lifetimes (expiry removes bodies), stuck-ball detection, combo-multiplier decay, power-up timer, tilt decay | `stepPhysics()` passes the sim seconds advanced (`simDt`), not render `dt` |

`nudgeState` and `tiltActive` are reset in `startGame()`.

Still wall-clock, cosmetic only: tilt bloom reset (`setTimeout`), the bonus
tally bloom reset, full-charge haptic pulse, spawn-effect names, mirror sync
timing for the HUD.

---

## Inputs on the tape (#441)

The replay tape (`InputFrame`, `src/replay/replay-recorder.ts`, schema
`REPLAY_SCHEMA_VERSION = 2`) carries everything that changes the ball's path:

- **Plunger charge.** `plungerCharge` (0–1 at fire, `null` otherwise) is the
  value the launch impulse is scaled by. Live and replay both fire through
  `GameInputActions.handlePlunger(frame.plungerCharge)`; the spectator's own
  `plungerChargeLevel` is never read. Charge is measured in **fixed steps
  held** (`input-plunger.ts`, `simStepCount()`), not wall time, so two 60 fps
  recordings of the same hold agree. RLE rows gain a 7th field (`String(n)`,
  exact; `-` for none). Schema-1 tapes (fired bit only) replay at charge 0.
  `InputFrame.plunger` remains as a deprecated alias for one release.
- **Nudges** are quantised to the tape's 0.01 grid in `processBufferedInputs()`,
  so the live impulse is exactly the one replay re-applies.

### Next blocker: the tape is per render frame

One `InputFrame` is recorded per `stepPhysics()` call, i.e. per **render**
frame, and playback steps the world with the viewer's own
`engine.getDeltaTime()`. A 144 Hz spectator therefore runs a different number of
fixed steps between taped inputs than the 60 Hz recorder did. Every determinism
test pins delta to 1/60 s to sidestep this. Fix: record the fixed-step count per
frame (or one frame per fixed step) and have playback advance exactly that many
steps regardless of viewer dt.

---

## Solver snapshots (#422)

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
4. #441: plunger charge on the tape; sim-clock nudge/tilt and scoring windows;
   worker snapshot round trip; restore across differing ball-id layouts.
5. Next: tape per fixed step instead of per render frame (see "Next blocker").
