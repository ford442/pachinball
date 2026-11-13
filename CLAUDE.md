# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # typecheck → build:wasm (skips without Emscripten) → Vite build; writes dist/build-info.json
npm run lint       # ESLint on all .ts/.tsx files (type-aware for src/, incl. no-floating-promises and import-x/no-cycle)
npm run typecheck  # `tsc -b` on TypeScript 7 (the native compiler, `typescript7` alias, ~5 s): app, node, worker, worklet and test projects. `typecheck:ts6` runs TS 6, `typecheck:compare` both and diffs their diagnostics (CI). Never run a bare `tsc` / `npx tsc`: both packages declare a `tsc` bin and which one `node_modules/.bin/tsc` is is not guaranteed
npm run check:unknown-casts # `as unknown as` ratchet: all of src/ holds zero (track modules build through TrackBuilderApi; elsewhere a `Window` global in src/vite-env.d.ts, a `Pick<Host, …>`, or one downcast to `T & Extra`)
npm run check:knip  # dead code (knip.jsonc): unused files / exports / types / dependencies, zero findings. A barrel (`src/*/index.ts`) is a directory's public surface. An export that only a test or a Playwright page reaches in a way knip cannot follow (a dynamic-import namespace, `import('/src/…')`) gets a `/** @public <why> */` tag; the Playwright-imported modules are `entry` in knip.jsonc
npm run preview    # Preview production build locally
npm run print:wasm-flags  # The effective CMake WASM flags (SIMD / LTO / ENV / memory); CI prints them in the native-physics job
npm run models:cabinet-placeholders  # Regenerate the dimension-matched placeholder cabinet GLBs in public/models/cabinet (docs/CABINET_GLTF.md)
npm run models:insert-placeholders   # Same for the playfield-insert GLBs (docs/ASSETS_GUIDE.md)
npm run machine:validate  # Weekly machine golden + next 53 ISO weeks + free seeds; MachineDescriptor: public/machines/*.json, 2027 weekly round-trip, share-link ≤ 8 KB
npm run schemas:json      # Rewrite public/schemas/*.json (JSON Schema) from the Valibot schemas in src/schemas/; tests/json-schemas.test.ts fails on drift
npm test           # Run Vitest unit tests
npx playwright test  # Run E2E / visual regression tests (every dev-server spec; the nightly workflow runs this, ci.yml the blocking subset + preview/degrade configs)
npm run compile-db        # Configure-only: writes native/build-native/compile_commands.json for clangd (see root .clangd). Re-run after adding any .cpp. Offline: npm run compile-db -- -DPACHINBALL_BUILD_TESTS=OFF
npm run check:compile-db  # Fail if that database misses a native TU, mixes -O levels, or contains em++ commands
npm run test:native       # compile-db + C++ Catch2 tests (incl. golden traces: any numeric drift fails)
npm run test:native:release  # same suite at -O3 (native/build-release); golden traces must match Debug
npm run test:native:san   # Catch2 under ASan + UBSan at -O1 (native/build-san); any report fails
npm run lint:native       # clang-tidy (native/.clang-tidy) over native/src + native/fuzz; any diagnostic fails (after compile-db)
npm run fuzz              # libFuzzer: fuzz_snapshot_restore (corpus: golden tapes' frame-0 snapshots) + fuzz_command_stream, 60 s each, ASan + UBSan (clang + compiler-rt)
npm run check:wasm-docs   # Fail if docs/wasm-physics-engine.md drifts from CMake / config / sources
npm run build:wasm        # Emscripten Release → public/wasm/. Fails on any emcc but .emsdk-version (emsdk repo commit: .emsdk-commit); PACHINBALL_ALLOW_EMSDK_MISMATCH=1 for experiments, never for shipped builds or tapes
npm run test:wasm-parity  # WASM bundle vs native C++ reference
npm run bench:wasm-flags  # Microbench WASM flag matrix (SIMD/LTO)
npm run build:worklet     # esbuild src/audio/pachinko-voice-processor.ts → public/audio/pachinko-voice-processor.js (IIFE, generated; `build` runs it)
npm run check:worklet     # Fail if the committed worklet script drifts from its TypeScript (CI check job)
npm run check:dist-wasm   # After `npm run build`: dist/wasm must be byte-identical to public/wasm
npm run check:bundle      # Bundle-size gate (bundle-budget.json); fails if Rapier is precached/preloaded
npm run verify:replay     # Golden replay tapes (tests/replays/*.json) in headless Chromium; needs build:wasm. `-- --update` rewrites goldens
npm run verify:replay:node  # The same goldens in Node, no Babylon / browser (src/sim, #528); ~2 s, needs build:wasm. Unsupported tapes are reported skipped. `-- --dist dist` runs the build's dist/sim/node-replay.mjs
npm run record:replay     # Re-record stale tapes from their scenarios
npm run test:verifier     # services/replay-verifier self-test (after `npm run build`)
npm run test:verifier:node  # the same self-test on the headless Node runner (VERIFIER_RUNNER=node); Chromium is never launched
npm run release:archive -- --to <dir>  # archive dist/ as a released build for the verifier, with its golden tapes (#490 B)
node scripts/verify-live.mjs   # after a deploy: live build-info.json = dist/build-info.json, COOP/COEP on index.html + wasm, sw.js and boot assets 200 (.github/workflows/deploy.yml runs it)
supabase db start && supabase test db  # Arcade DB migrations + pgTAP RLS tests (supabase/)
```

To run a single Vitest test file:
```bash
npx vitest run tests/ball-manager.test.ts
```

## Architecture

**Pachinball** is a 3D WebGPU-first pachinko/pinball hybrid built with Babylon.js 9. Physics runs on an in-house C++ engine compiled to WASM (`native/` + `src/wasm/`) by default — in-process (`wasm-owner`), the only mode whose runs replay step-exactly and can be verified for the leaderboard; a Dedicated Worker (`wasm-worker`) is opt-in (`?physics=wasm-worker`); Rapier 3D WASM is the lazily loaded dev/degrade path. Runtime mode is selected via `src/config/physics.ts` (`WASM_PHYSICS.defaultEngine`; `rapier` / `wasm-mirror` / `wasm-owner` / `wasm-worker`). Builders author physics through `PhysicsApi` / `PhysicsWorldSink` / `PhysicsBody` (`src/core/physics-api.ts`), never Rapier values — see `docs/wasm-physics-engine.md`.

### Type checking

`noUncheckedIndexedAccess` is on for all of `src/` (`tsconfig.app.json`, and `tsconfig.worker.json`): an indexed read is `T | undefined`. Use `x[i]!` where a loop bound or a length guard proves it in range (as `src/core` does) and a real fallback where it does not. `npm run typecheck` runs `tsc -b` on TypeScript 7's native compiler (the `typescript7` alias); `typescript` itself stays `~6.0` because `typescript-eslint` peers `<6.1`, and CI runs `typecheck:compare` (both, diagnostics diffed). Never call a bare `tsc` / `npx tsc`: both packages declare a `tsc` bin, so `node_modules/.bin/tsc` is whichever npm linked last. The Emscripten `--emit-tsd` shim (`scripts/emcc-tsc/tsc`) names TypeScript 6 by path so the committed `src/wasm/generated/PhysicsModule.d.ts` cannot change by accident. Switch `typescript` to 7 and delete the alias, `--ts6` and `--compare` when `typescript-eslint` supports TS 7 (the dependabot `ignore` in `.github/dependabot.yml` says when).

### Startup flow

`src/main.ts` bootstraps the Babylon engine (WebGPU → WebGL fallback) and preloads the C++ physics WASM bundle in parallel (Rapier only for the explicit `rapier` / `wasm-mirror` modes), then hands off to `new Game()`. The `window.game` global is set for Playwright tests to hook into.

### Core modules

| Path | Role |
|------|------|
| `src/game.ts` | Central orchestrator. Owns scene, cameras, lights, materials, post-processing, game-state machine (MENU / PLAYING / PAUSED / GAME_OVER), and wires all sub-systems together. Boot-time wiring runs as `registerX(game)` stages under `src/game/init/`, ordered by `game-systems-init.ts`. The frame scheduler (`registerFrameSystems`) owns the render loop. |
| `src/core/frame-scheduler.ts` | `FrameScheduler`: the one owner of `engine.runRenderLoop`. Phases `input → physics → sim → visuals → render → hud → idle`; systems register `{ phase, update(dt) }` with `{ signal }`. New per-frame work registers here — never a second `runRenderLoop`, never an update after `scene.render()`. See `docs/ENGINE_BOOTSTRAP.md` "Frame scheduler". |
| `src/engine/gpu-capabilities.ts`, `src/engine/resolution-policy.ts` | `resolveGpuCapabilities(engine)` — query `{ compressedTextures, gpuTimer, hdrFormat, f16, maxMsaaSamples }` instead of guessing from the quality tier. Render scale = `min(DPR, 1.5 mobile / 2 desktop, tier cap)` with dynamic resolution (`src/game/render-resolution.ts`); the scene optimizer never touches the hardware scaling level. |
| `src/core/static-scene-gate.ts` | `StaticSceneGate`: one invalidation point for everything frozen while the scene is static (materials, the active-mesh list, the shadow map). Mutate something frozen → call `game.staticSceneGate?.invalidate(...)`. See `docs/STATIC_SCENE.md`. |
| `src/game-elements/` | Discrete sub-systems: `physics.ts` (physics world: the C++ owner's `WasmTableWorld`, or Rapier), `ball-manager.ts` (spawn/collect/drain), `input.ts` (keyboard/touch/gamepad), `camera-controller.ts`, `zone-trigger-system.ts`, `leaderboard-system.ts`, `debug-hud.ts`, etc. |
| `src/adventure/` | Adventure mode (`adventure-mode.ts`), campaign progression/state, zone registry, and the tracks: declarative JSON in `track-data/` (lazy, one chunk per track), compiled by `track-compiler.ts` / `track-elements.ts` (`docs/TRACK_SCHEMA.md`). |
| `native/` | C++ physics core — rigid bodies, broadphase, contact listener. Catch2-tested via `npm run test:native`. |
| `src/wasm/` | Emscripten loader (`PhysicsModule.ts`), contact/transform buffer codecs, WASM types. |
| `src/game/physics/` | Runtime physics engine selection and collision dispatch (`rapier`, `wasm-mirror`, `wasm-owner`). `physics-controller.ts` keeps construction, `stepFixed` and the pacer; the other scheduler phases and concerns are their own files (`sim-phase`, `visual-phase`, `step-gameplay`, `nudge-tilt`, `wasm-bridges`, `replay-snapshot-sync`). |
| `src/objects/` | Playfield geometry: bumpers, flippers (joint-based rotation), walls, rails, pachinko pins, decoration. All live under `object-core.ts` as the top-level orchestrator. |
| `src/cabinet/` | Four cabinet presets (classic, neo, vertical, wide) built by `cabinet-builder.ts`. Each defines its own dimensions and styling. |
| `src/display/` | Multi-layer backbox display, composited by one Frame Graph (`backbox-frame-graph.ts`, nodes chosen by `backbox-graph-plan.ts`) onto one plane; CRT and jackpot are passes on that composite, never on the camera. `display-core.ts` drives state transitions (IDLE → REACH → FEVER). See `docs/FRAME_GRAPH.md`. |
| `src/game/scene-*.ts`, `game-post-process.ts` | Scene post-processing as a second Frame Graph (bloom → image processing → sharpen, plus HIGH-only SSAO / SSR / motion blur; the scene target is 4× MSAA on MEDIUM/HIGH and FXAA is the LOW tier’s AA). `scene-graph-plan.ts` (pure) picks the nodes from the `webgpu-post-process-profile.ts` tier; `scene-frame-graph.ts` builds and runs them; `ScenePostController` is the knob surface effects write to. The camera still renders the scene (into one HDR target), not `scene.frameGraph`. New visual passes land as nodes here, not as camera `PostProcess`es. Both graphs load through `src/frame-graph-runtime.ts` (one lazy chunk). See `docs/FRAME_GRAPH.md`. |
| `src/shaders/` | Standalone effect shaders (CRT scanlines + curvature, jackpot overlay, cyber grid, LCD table, scanline): GLSL for WebGL2, WGSL twins in `src/shaders/wgsl/` for WebGPU. |
| `src/materials/` | PBR material library split by domain (ball, metallic, interactive, structural). `material-core.ts` is the entry point. It is also the only place (with `src/cabinet/`) that may `new StandardMaterial` — ESLint bans it elsewhere (#524): boot-time one-offs use `material-basic.ts` (`createStandardMaterial` / `createUnlitMaterial` / `getSharedUnlitMaterial`); things that spawn during play never build a material per spawn — shard / ripple / impact-ring / fever-trail instances share `material-transient.ts`'s one unlit material and are drawn by `src/effects/transient-field.ts` as thin instances (per-instance RGBA = tint + fade), per-ball ribbon trails recycle through `TrailMaterialPool` (`material-trail.ts`). |
| `src/audio/` | Single `AudioEngine` (one AudioContext) + pachinko worklet + sample bank. EventBus remains the trigger API. The voice worklet is TypeScript (`pachinko-voice-processor.ts` → `VoicePool`, a fixed 24-voice struct-of-arrays pool that steals the quietest and allocates nothing in `process()`; message = `VoiceHit` in `voice-hit.ts`); `public/audio/pachinko-voice-processor.js` is **generated** (`npm run build:worklet`), never edited. Typed by `tsconfig.worklet.json` + `worklet-globals.d.ts`, excluded from the DOM-lib app project. Pan = contact-point x / half the active cabinet preset's `playfieldWidth` (`setPlayfieldPanWidth`, called by `CabinetBuilder.loadCabinetPreset`). |
| `src/sim/`, `src/table/` | The headless replay runner (#528, `docs/HEADLESS_REPLAY.md`): `node-replay.ts` replays a tape in Node on `HeadlessHost` — `SimPhysicsController`, `BallManager`, `ZoneTriggerSystem`, `SimDisplayState`, `run-start.ts` — and the build's own wasm; `vite build` emits it as `dist/sim/node-replay.mjs`. `src/table/table-colliders.ts` is the vanilla table's collider authoring, called by the builders and by `buildHeadlessTable`. No `@babylonjs/*` import in either (ESLint; the bundle check fails the build). Gameplay still owned by a presentation class (adventure, an engaged toy / feeder, backbox off IDLE, jackpot) makes the runner return `unsupported` (`HeadlessGuard`), never a guessed number. |
| `src/replay/` | Replay recorder/runner (one tape frame per physics step, frame-0 C++ snapshot), challenges (`challenge-v2.ts`), ghost race. |
| `src/rules/` + `src/schemas/rules-program.ts` | Rules as data (#556, `docs/RULES.md`): `RulesEngine` runs a machine's rules v2 program (events → conditions → actions, state in sim ticks) — no Babylon. `ScoringBridge` raises events into it (`dispatchRules`) where scoring used to be hard-coded; actions come back through its sink, presentation as `rules:cue`. The vanilla program (`vanilla.ts`) is today's scoring and replays the golden tapes bit-identically. `rulesHash` (SHA-256 of the canonical run rules) is in every schema 4 tape, submission and board key (`(map_id, rules_hash)`); `resolveRunRules` (`src/game/run-start.ts`) refuses a tape whose rules do not hash to it. Scoring changes go in the program, not in collision handlers. |
| `src/arcade/` + `supabase/` | Live arcade client (`arcade-api.ts`, endpoint in `src/config/arcade.ts`) on Supabase: migrations, RLS pgTAP tests, Edge Functions. Contract: `docs/API_CONTRACT.md` + `docs/api/arcade.openapi.yaml` (checked by `tests/arcade-contract.test.ts`). Dev/Playwright stay offline unless `VITE_ARCADE_URL` is set. |
| `services/replay-verifier/` | Storage-host anti-cheat service: replays submitted tapes on the build shipping the tape's own `PhysicsModule.wasm` (SHA-256 stamped in every tape) and marks scores verified/rejected; weekly tournaments freeze from verified runs only (`docs/API_CONTRACT.md`). |
| `src/profile/` | The player's persistent state (#506): `ProfileStore` reads / writes the profile's parts (settings, bindings, campaign, bests, achievements) synchronously through a `localStorage` mirror and snapshots them into IndexedDB (`idb-keyval`, lazy) for restore, export / import and drafts. `local-store.ts` is the **only** module that may touch `localStorage` (ESLint-enforced): player data goes through `ProfileStore`, device-local keys (flags, caches, debug switches) through `readLocal` / `writeLocal`. New player state is a new `PARTS` entry, not a new key. `docs/SCHEMAS.md` "The player profile". |
| `src/schemas/` | One Valibot schema layer (#505 §A) for everything read from outside the code: tracks, machines, weekly descriptor, rules, profile, arcade responses, settings and stored records, replay tapes. Types are `v.InferOutput`; parse with `parseWith` / `parseJsonWith` (`schema-kit.ts`), never `JSON.parse(…) as T`; `apiFetch(url, schema)`. Errors are `{ path, message }`. Only `settings.ts` / `storage.ts` sit on the boot path. See `docs/SCHEMAS.md`. |
| `src/schemas/machine.ts`, `src/machine/` | `MachineDescriptor` (cabinet + tracks + backbox clips + stems + rules + seed policy) and its loader: `?machine=<id>` (`public/machines/*.json`) or a `#machine=v1.…` share link; cabinet and backbox clips are applied, rules not yet. See `docs/MACHINES.md`. |
| `src/config/` | Ball-type definitions (STANDARD / GOLD_PLATED / SOLID_GOLD), spawn weight distribution (75 / 20 / 5 %), point values, fever-mode multipliers, API config. |

### Ball lifecycle

Balls are spawned by `BallManager` according to the weighted distribution in `src/config/`. Collection triggers point callbacks and increments the gold-ball counter. `zone-trigger-system.ts` detects spatial events (bumper hits, drain, special zones) and notifies the game loop.

### Lifecycle conventions

A `Game` must tear down completely (`Game.dispose()` → `disposeGame()` in `src/game/game-disposer.ts`), so a second `Game` in the same page starts clean:

- Listeners on `window` / `document` / canvas — and on static `index.html` nodes such as `#start-btn` — take `{ signal: game.signal }` (one `AbortController` per `Game`); hosts that need it declare `signal: AbortSignal`. Never assign `el.onclick = …` on a node that outlives the Game.
- Timers and animation frames go through a `TimerScope` (`src/core/timers.ts`); the owner's `dispose()` calls `scope.dispose()`. Game-level glue uses `game.timers`. ESLint (`no-restricted-syntax`) bans bare `setTimeout` / `setInterval` / `requestAnimationFrame` in `src/game`, `game-elements`, `effects`, `objects`, `display`, `audio` and `adventure`; a bare call that is provably safe takes `// eslint-disable-next-line no-restricted-syntax -- <why>`.
- Any `await` (including a lazy `import()`) in a long-lived owner is followed by `if (this.signal.aborted) return` before it touches state or creates a singleton: `dispose()` can land while it is pending.
- Module singletons need a `reset*` that `disposeGame` calls (lazily loaded ones register theirs in `lazySingletonResets`; `tests/game-disposer-resets.test.ts` pins the list). Do not reset `AdventureState`: it wipes campaign progress.
- Dev-only tooling stays out of the entry chunk: `DebugHUD` / `GameDebug` (`?debug=1` or DEV), `PhysicsTuningPanel` and `FreeMapTestMode` are dynamically imported, so `game.debugHUD`, `game.physicsTuningPanel` and `game.freeMapTestMode` can be `null` until used and `toggleFreeMapTestMode()` / `ensurePhysicsTuningPanel()` are async. `isDebugHUDAvailable()` and the `isPhysicsTuning*` predicates stay synchronous and dependency-free.
- Pass `this` to host consumers; `Game implements` every `*Host` interface, so no `as unknown as XHost` casts. That list is closed (12): a new feature does not add a `*Host` to `Game`. It takes a small context / service object that a `register*` stage builds and the consumer receives instead of `Game` — `game.overlays` (`ArcadeOverlays`: leaderboard + name entry, lazily loaded) and `game.screens` (`GameScreens`: the index.html screens) are the first two; a host asks for `Pick<ArcadeOverlays, 'ensure' | 'leaderboard'>`, not for `Game`. `tests/game-surface-budget.test.ts` ratchets Game's public mutable fields (started at 118, goal 59) and its `*Host` count; lower the budget in the change that moves fields off. Next slices, by how few references they have: the dev tooling (`debugHUD`, `debugHelper`, `physicsTuningPanel`, `freeMapTestMode`, `showDebugUI`, …, but `window.game.debugHUD` is read by Playwright specs, so it needs the test handle), the adventure systems, the feeders and table toys, the lights and cameras.
- `tests/lifecycle-dispose.spec.ts` counts listeners over CDP and fails if a Game leaks any.

### Sim / presentation split (#528)

The tick runs without Babylon: `SimPhysicsController` (fixed step, tick, scoring wiring) is extended by `GamePhysicsController` (mesh interpolation, `sim` / `visuals` phases, ghost); `BallManager` is the ball sim and `BallPresentation` (`BallView`) draws it; `PhysicsHost` types its members as sim interfaces (`PhysicsSim`, `TableObjectsSim`, the toy `*Sim` types). Gameplay never reads a mesh, a material or `DisplaySystem` state: positions are bodies' or plain `{x, y, z}` (effects facades take `Vec3Like`), the backbox state is `host.displayState` (`SimDisplayState`), bumper hologram anchors are data. A new collider the C++ owner exports is authored in `src/table/` and called from the builder and `buildHeadlessTable` in the game's creation order. `npm run verify:replay:node` and `tests/headless-replay.test.ts` hold it.

### Determinism

Gameplay runs in whole fixed steps (`FixedStepPacer` / `FIXED_TIMESTEP` in `src/core/sim-clock.ts`). Anything that affects score, lives or the ball's path reads the sim clock, never `performance.now()` — otherwise replays and verification break (`docs/determinism-todo.md`). Intentional numeric changes update the golden tapes (`npm run verify:replay -- --update`) in the same PR.

Production builds drop `console.log` / `info` / `debug` / `time*` (esbuild `pure`, keyed on Vite's `mode`) but keep `console.warn` / `console.error`; use `bootWarn` / `bootError` (`src/boot-log.ts`) for boot-critical diagnostics — they also feed the 50-line ring `src/engine/error-reporter.ts` attaches to uncaught errors / unhandled rejections (`window.pachinballErrors`). Source maps are built `hidden` and moved to `dist-sourcemaps/` (never deployed).

### Fault isolation (#503)

One throw must never stop the game. `FrameScheduler` runs each system in a try/catch: a presentation-phase system (`input` / `visuals` / `render` / `hud` / `idle`) that throws on 3 of the last 8 frames is quarantined; `physics` / `sim` systems are never removed: their faults — and a contact handler that throws inside the step (`PhysicsHost.onSimFault`) — go to `SimFaultPolicy` (`src/game/sim-fault-policy.ts`), which rejects a **strict** playback with `sim-fault` (the verifier sets `ReplayRunner.setStrict(true)`; spectate / ghosts play on), marks a live run unranked (`ranked: false` on submit, off every board) and ends it on 3 faulting frames of 8. `EventBus.emit` isolates each handler the same way (3 throws in 8 emits → unsubscribed + `'handler:quarantined'`), and contact dispatch isolates each contact. In `wasm-worker` mode the client supervises the worker (`fatal` message, `error` / `messageerror`, 30 unanswered steps) and rebuilds its world in-process from `PhysicsCommandLog` (structure + a checkpoint every 600 steps + the commands since), after which `getWasmMode()` reads `wasm-owner` and `'physics:engine-switched'` fires. `apiFetch` retries only idempotent methods; a finished arcade run is stored exactly once (one submission id per run, `Idempotency-Key` on `submit-replay` / `submit-score`, `public.submission_keys`; `docs/API_CONTRACT.md`).

### Testing approach

Unit tests (`tests/`) run in a Node environment via Vitest. Babylon.js and Rapier are fully mocked — do not import real engine code inside test files. Playwright E2E tests auto-start the Vite dev server on 5173 (`webServer` in `playwright.config.ts`; projects `chromium` + `mobile-chrome`) and access `window.game` for assertions; see `tests/verify_prism_core.spec.ts` for the pattern.

### Campaign progression docs

Use `docs/ADVENTURE_CAMPAIGN.md` for the current A/B alternating campaign model and portal lifecycle. `AdventureTrackProgression` + `AdventureProgressionSupervisor` are the campaign source of truth; `AdventureState` remains legacy/free-form progression.

### WebGPU / shader authoring

Our custom shaders are **dual GLSL / WGSL** (#488): each GLSL source in `src/shaders/` (CRT, jackpot overlay, cyber grid, LCD table, scanline) has a WGSL twin in `src/shaders/wgsl/` with the same uniforms, samplers and math. `display-shader.ts` picks the language from `engine.isWebGPU` (`displayShaderSource()`): on WebGPU the grid `ShaderMaterial` and the backbox Frame Graph passes are created with `shaderLanguage: ShaderLanguage.WGSL`, on WebGL2 with GLSL, and either way their `extraInitializationsAsync` lazily imports that backend's source chunk — `src/display/backbox-shaders-wgsl.ts` (`ShaderStore.ShadersStoreWGSL`) or `src/display/backbox-shaders-glsl.ts` (`Effect.ShadersStore`), same keys — so no shader source sits in the entry chunk. Babylon fetches its GLSL → WGSL translator (glslang + twgsl, ~2.7 MB from `cdn.babylonjs.com`) the first time any GLSL effect compiles on WebGPU, so **a WebGPU boot must compile no GLSL**: a new shader needs a WGSL twin (`textureSample` only in uniform control flow, sampler `<texture>Sampler`, `uniforms.x`, `fragmentInputs.vUV`, `fragmentOutputs.color`), and a new `BackboxEffectPass` must carry the right `shaderLanguage`. `tests/webgpu-shader-language.test.ts` checks every `ShadersStore` key has a WGSL twin with the same interface; `tests/webgpu-no-glslang.spec.ts` boots WebGPU and fails on any glslang / twgsl / `cdn.babylonjs.com` request. `src/effects/fresnel-rim-plugin.ts` injects GLSL or WGSL by the language Babylon asks for. Check for `engine.isWebGPU` before using WebGPU-only features.
