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
| Gameplay timers stepped per fixed step: swarm lifetimes (expiry removes bodies), stuck-ball detection, combo-multiplier decay, power-up timer, tilt decay | `stepFixed()` passes the sim seconds advanced (`simDt`), not render `dt` |
| Jackpot sequence (ends the display's JACKPOT state), display state machine (gates fever scoring), spinner / trap / launcher / gate timers, adventure goal and time-limit clocks | `updateGameplay()` / `Game.stepAdventureProgression`, once per fixed step at `FIXED_TIMESTEP` (#444) |

`nudgeState` and `tiltActive` are reset in `startGame()`.

Still wall-clock, cosmetic only: tilt bloom reset (`setTimeout`), the bonus
tally bloom reset, full-charge haptic pulse, spawn-effect names, mirror sync
timing for the HUD.

---

## Inputs on the tape (#441)

The replay tape (`InputFrame`, `src/replay/replay-recorder.ts`, schema
`REPLAY_SCHEMA_VERSION = 3`) carries everything that changes the ball's path:

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

### One frame per fixed step (#444)

`GamePhysicsController.stepPhysics()` runs once per render frame, but gameplay
does not: a `FixedStepPacer` (`src/core/sim-clock.ts`) turns the render delta
into 0..N whole steps (a stall catches up at most `MAX_FRAME_DT`), and each
`stepFixed()` reads one input frame — live input, or the next tape frame —
drives flippers and movers, hands the engine exactly one `FIXED_TIMESTEP`, then
runs every score / lives / ball-path update. Only presentation (mesh
interpolation by the pacer's alpha, camera, cosmetic effects) runs per render
frame. So a tape holds one frame per physics step (schema 3) and a 144 Hz
recording replays bit-for-bit at 30, 60 or 144 Hz
(`tests/replay-snapshot-wasm.test.ts`). The C++ / Rapier accumulators only ever
see whole steps; schema-2 tapes still load but were cut per render frame.

A replay also carries the cascade table it was recorded on (`cascade`:
Daily Cascade / free seed), and `startGame()` plays it on that table — not the
spectator's selection or today's daily — then gives the player theirs back.

A frame-0 snapshot whose linked bodies / hinges do not pair up with the live
world (`id-layout`: the table descriptors differ) **rejects** the replay:
`ReplayRunner.reject()` stops playback with the reason instead of letting a
ghost drift under a toast.

### Verifying tapes headless

`npm run verify:replay` (`scripts/verify-replay.mjs`) plays each
`tests/replays/*.json` tape in the real game — headless Chromium, wasm-owner,
render loop stopped, one step per frame, through `Game.playReplay` (the spectate
path) — and prints `{ finalStateHash, score, steps }` (`finalStateHash` is the
C++ `getStateHash()`). It fails on a refused snapshot or a golden mismatch.
`--update` writes this build's numbers as the goldens (an intentional numeric
change: commit them with a one-line rationale); `npm run record:replay`
re-records a tape from its scenario when the tape itself is stale (snapshot
version, table geometry) and keeps it only if a fresh page replays it.
The native build is held to the WASM one by `npm run test:wasm-parity`, which
compares the native and WASM `stateHash` at the snapshot frame.

Not yet step-exact, so not verifiable:

- **`wasm-worker` recordings.** The worker serves poses a frame late and TS
  gameplay reads them; how late depends on message timing. Verify on the
  owner path; a worker run is only reproducible if the worker lag is too.
- **A track switch mid-tape.** Starting an adventure track rebuilds the static
  world at a step the tape does not record. Tapes that run a track from frame 0
  (the corpus's scenario setup) verify; a campaign session that enters a track
  mid-game does not, until the tape records session events.
- **Physics tuning.** `getPhysicsTuningValue()` (nudge force, plunger impulse)
  is not in the world fingerprint; a run with a tuned panel replays with the
  spectator's values.
- `src/game-elements/path-mechanics/` still resets on `setTimeout`; nothing
  builds those mechanics today.

---

## Solver snapshots (#422)

`PhysicsWorld::serialize()` / `restore()` (`native/src/Snapshot.{h,cpp}`) —
versioned little-endian blob of the full C++ solver state, refused on a
differently built table. Replays carry the frame-0 snapshot plus a world
fingerprint (see `docs/ASYNC_CHALLENGES_EPIC.md` and `docs/wasm-physics-engine.md`).
The native and WASM builds produce identical bytes (`npm run test:wasm-parity`);
the hinge angle uses a libm-independent `atan2` so they can.
The `wasm-worker` client serializes and restores over an ordered
request/reply in the command batch (#441, `docs/wasm-physics-engine.md`
"Over the worker"); a real Worker still serves poses a frame late, which the
TS flipper drive reads — see the caveat in `docs/ASYNC_CHALLENGES_EPIC.md`.

## Roadmap

1. ~~Injectable RNG + physics-affecting fork streams + catalogue.~~
2. ~~#341: `ReplayRecorder` logs seed + inputs; C++ world snapshot + divergence harness.~~
3. ~~#343: URL `?seed=` share → session seed; ghost spectate; divergence toast.~~
4. #441: plunger charge on the tape; sim-clock nudge/tilt and scoring windows;
   worker snapshot round trip; restore across differing ball-id layouts.
5. ~~#444 Slice A: tape per fixed step, cascade table on the tape, `id-layout`
   rejects, headless verifier + golden tape corpus (`tests/replays/`).~~
