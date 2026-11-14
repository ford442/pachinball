# Headless replay — a tape in Node, without Babylon (#528)

A replay step is a function: one input row, one wasm `step`, one TypeScript tick, one hash.
Babylon is not an input to it. `src/sim/node-replay.ts` runs that function in Node: it builds the
C++ owner world from the build's own `PhysicsModule.wasm`, authors the table, restores the tape's
frame-0 snapshot, applies the tape rows and runs the same tick the game runs, then reads
`getStateHash()` and the score.

```
tape row ──▶ SimPhysicsController.stepFixed ──▶ wasm step ──▶ contact dispatch / ScoringBridge / StepGameplay
                       ▲                                                   │
            HeadlessHost (src/sim)                                        ▼
   BallManager · ZoneTriggerSystem · GameStateManager · SimDisplayState   score, lives, balls
   GameInputActions · HeadlessTable (src/table authoring) · run-start.ts   getStateHash()
```

| Command | What |
|---------|------|
| `npm run verify:replay:node` | Every golden tape (`tests/replays/*.json`) in Node: must land on its golden hash, score and step count. ~2 s. Needs `npm run build:wasm`. `-- --dist dist` runs a build's own `dist/sim/node-replay.mjs` and `dist/wasm`; `-- --strict` fails on skipped tapes too. |
| `npm run verify:replay` | The same tapes in headless Chromium: the rendering smoke, and the only way to `--record` / `--update` goldens. |
| `npm run test:verifier:node` | The replay verifier's self-test on the Node runner (Chromium is never launched). |
| `VERIFIER_RUNNER=node` | The verifier service replays with the build's Node runner first (`services/replay-verifier/README.md`). |

`vite build` writes `dist/sim/node-replay.mjs` (the `simBundle()` plugin, `scripts/lib/sim-bundle.mjs`),
so every archived build carries the TypeScript tick it shipped next to its wasm. It is not in the
service-worker precache; players never download it.

## The split

The game's tick used to live in classes that also drew: the physics controller interpolated meshes,
`BallManager` built meshes and trails, scoring read the backbox, builders authored colliders between
mesh calls. Each of those now has a sim half with no Babylon import, which the game composes with its
presentation half:

| Sim half (Node and game) | Presentation half (game only) |
|--------------------------|-------------------------------|
| `SimPhysicsController` — fixed step, accumulator, tick, wiring | `GamePhysicsController` — mesh interpolation, `sim` / `visuals` phases, ghost (three protected hooks) |
| `BallManager` — bodies, ball data, multiball, gold / swarm, captures, stuck detection | `BallPresentation` (`BallView`) — meshes, bindings, trails, light, particles, skins |
| `src/table/table-colliders.ts` — every in-scope collider the vanilla table authors | the builders in `src/objects/`, which call it and build meshes around the bodies |
| `TargetBank` — targets up / respawn timers | `GameObjects` shows, hides and pulses the target meshes |
| `SimDisplayState` — the backbox state gameplay gates on (last `display:set`) | `DisplaySystem` follows the same events |
| `feeder-triggers.ts` — each polling feeder's idle capture test | the feeders, which run it and animate |
| `run-start.ts` — machine, seed, table rebuild, run reset, ball reset | `GameLifecycle` adds UI, audio, recording |

`PhysicsHost` names what the tick needs as sim interfaces (`PhysicsSim`, `TableObjectsSim`, the toy
`*Sim` / `*SimState` types, `Pick<…>` of sound and engine), which the game's classes satisfy as they
are and `HeadlessHost` satisfies with no presentation at all.

### Reaches that were bugs

The issue's rule: a scoring path that reaches into a mesh or a material is the bug. Fixed here:

- **Bumper spin transfer** took its impact normal from `vis.mesh.position`; it now uses the bumper's body.
- **Hologram catch** pulled the ball to `hologram.getAbsolutePosition()`; the anchor is now data on the
  bumper (`BumperRef.hologramAnchor`).
- **Backbox state** (hologram catch and fever only from IDLE, fever gold multiplier, fever end on a
  drain) was read from `DisplaySystem.getDisplayState()`; it is `SimDisplayState` now. A direct
  `display.setDisplayState(REACH)` (MagSpin catch) sets both.
- **Ball positions to effects** were Babylon `Vector3`s built in scoring code; scoring passes plain
  `{x, y, z}` and the effects facades convert (`effects/as-vector3.ts`).
- **The plunger rod's glow** was written from `GameInputActions` through `visual-language`; the game
  injects it with the scene.
- **Collision groups and gravity** were only exported by `game-elements/physics.ts`, which loads Rapier;
  they live in `core/collision-groups.ts`.

Everything above is checked by the golden tapes in both runners: the game's numbers did not move.

## What the Node runner does not replay (yet)

It fails closed: a tape that reaches gameplay still owned by a presentation class stops with
`{ ok: false, code: 'unsupported', reason }` (`HeadlessGuard`), never a guessed number. The verifier
sends those tapes to Chromium; `verify:replay:node` reports them as skipped.

| Reach | Why it is not in Node | Follow-up |
|-------|-----------------------|-----------|
| Adventure tracks | `AdventureMode` and the track builders author through meshes | extract track authoring like `src/table/` |
| A toy that engages (trap catch, launcher, gate, spinner) | their state machines live in the mesh builders | a `*Sim` per toy, as `TargetBank` |
| A feeder that captures; the nano loom or prism core in play at all | same; only the idle capture tests are extracted | a sim state machine per feeder |
| The backbox leaving IDLE | the slot machine (RNG, `slot:win` points) runs inside `DisplaySystem` | move `SlotMachine`'s spin plan out of the display |
| A jackpot | the phase clock is owned by `EffectsSystem` | own the `JackpotPhaseClock` in the sim |

The golden tapes today: vanilla-rally, free-cascade and multiball replay in Node; the three adventure
tapes and magspin-capture are Chromium-only. #521's `rulesHash` plugs into `replayTapeInNode`.

## Keeping it Babylon-free

- `scripts/lib/sim-bundle.mjs` fails the bundle (and so `vite build`, `verify:replay:node` and
  `tests/headless-replay.test.ts`) when any input is an `@babylonjs/*` module. The error names one.
- ESLint forbids `@babylonjs/*` imports, types included, in `src/sim/` and `src/table/`.
- `src/sim/` and `src/table/` are in the `noUncheckedIndexedAccess` and `as unknown as` ratchets.

New gameplay that runs per step belongs in a sim class the tick reaches through `PhysicsHost`; its
meshes go in the presentation class around it. A new in-scope collider is authored in
`src/table/table-colliders.ts` and called from both the builder and `buildHeadlessTable` (in the
game's creation order: the owner exports statics in world creation order, and the frame-0 snapshot
refuses a different static table).

## Loading the shipped wasm in Node

The release `PhysicsModule.js` is built for the web (`-sENVIRONMENT=web,worker`) and reads no
`Module` overrides (`-sINCOMING_MODULE_JS_API=[]`), so the runner does not rebuild it: it serves the
build's `.wasm` bytes to the glue through a `fetch` that answers only for `PhysicsModule.wasm`, for
the duration of the instantiation (`wasmModuleFactory`), after checking their SHA-256 against
`build-info.json`.
