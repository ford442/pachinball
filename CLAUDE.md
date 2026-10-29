# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # TypeScript check + Vite production build + optional WASM
npm run lint       # ESLint on all .ts/.tsx files (type-aware for src/, incl. no-floating-promises and import-x/no-cycle)
npm run check:index-strict  # noUncheckedIndexedAccess ratchet: src/core, src/wasm, src/game/physics must stay clean
npm run preview    # Preview production build locally
npm run machine:validate  # Weekly machine: golden descriptor, next 53 ISO weeks + free seeds, fixtures (like tracks:validate)
npm test           # Run Vitest unit tests
npx playwright test  # Run E2E / visual regression tests
npm run compile-db        # Configure-only: writes native/build-native/compile_commands.json for clangd (see root .clangd). Re-run after adding any .cpp. Offline: npm run compile-db -- -DPACHINBALL_BUILD_TESTS=OFF
npm run check:compile-db  # Fail if that database misses a native TU, mixes -O levels, or contains em++ commands
npm run test:native       # compile-db + C++ Catch2 tests (incl. golden traces: any numeric drift fails)
npm run test:native:release  # same suite at -O3 (native/build-release); golden traces must match Debug
npm run test:native:san   # Catch2 under ASan + UBSan (native/build-san); any report fails
npm run check:wasm-docs   # Fail if docs/wasm-physics-engine.md drifts from CMake / config / sources
npm run build:wasm        # Emscripten Release → public/wasm/
npm run test:wasm-parity  # WASM bundle vs native C++ reference
npm run bench:wasm-flags  # Microbench WASM flag matrix (SIMD/LTO)
```

To run a single Vitest test file:
```bash
npx vitest run tests/ball-manager.test.ts
```

## Architecture

**Pachinball** is a 3D WebGPU-first pachinko/pinball hybrid built with Babylon.js 9. Physics runs on an in-house C++ engine compiled to WASM (`native/` + `src/wasm/`) by default — in a Dedicated Worker (`wasm-worker`) when the page is cross-origin isolated, else in-process (`wasm-owner`); Rapier 3D WASM is the lazily loaded dev/degrade path. Runtime mode is selected via `src/config.ts` (`rapier` / `wasm-mirror` / `wasm-owner` / `wasm-worker`). Builders author physics through `PhysicsApi` / `PhysicsWorldSink` / `PhysicsBody` (`src/core/physics-api.ts`), never Rapier values — see `docs/wasm-physics-engine.md`.

### Startup flow

`src/main.ts` bootstraps the Babylon engine (WebGPU → WebGL fallback) and preloads the C++ physics WASM bundle in parallel (Rapier only for the explicit `rapier` / `wasm-mirror` modes), then hands off to `new Game()`. The `window.game` global is set for Playwright tests to hook into.

### Core modules

| Path | Role |
|------|------|
| `src/game.ts` | Central orchestrator (~19 KB / ~450 lines — slimmed from its former ~140 KB monolith; the sub-systems now live under `src/game/`, `src/game-elements/`, `src/display/`, `src/effects/`, `src/objects/`). Owns scene, cameras, lights, materials, post-processing, game-state machine (MENU / PLAYING / PAUSED / GAME_OVER), and wires all sub-systems together. |
| `src/core/frame-scheduler.ts` | `FrameScheduler`: the one owner of `engine.runRenderLoop`. Phases `input → physics → sim → visuals → render → hud → idle`; systems register `{ phase, update(dt) }` with `{ signal }`. New per-frame work registers here — never a second `runRenderLoop`, never an update after `scene.render()`. See `docs/ENGINE_BOOTSTRAP.md` "Frame scheduler". |
| `src/engine/gpu-capabilities.ts`, `src/engine/resolution-policy.ts` | `resolveGpuCapabilities(engine)` — query `{ compressedTextures, gpuTimer, hdrFormat, f16, maxMsaaSamples }` instead of guessing from the quality tier. Render scale = `min(DPR, 1.5 mobile / 2 desktop, tier cap)` with dynamic resolution (`src/game/render-resolution.ts`); the scene optimizer never touches the hardware scaling level. |
| `src/core/static-scene-gate.ts` | `StaticSceneGate`: one invalidation point for everything frozen while the scene is static (materials, the active-mesh list, the shadow map). Mutate something frozen → call `game.staticSceneGate?.invalidate(...)`. See `docs/STATIC_SCENE.md`. |
| `src/game-elements/` | Discrete sub-systems: `physics.ts` (physics world: the C++ owner's `WasmTableWorld`, or Rapier), `ball-manager.ts` (spawn/collect/drain), `input.ts` (keyboard/touch/gamepad), `camera-controller.ts`, `sound-system.ts`, `zone-trigger-system.ts`, `leaderboard-system.ts`, `adventure-mode.ts`, `debug-hud.ts`, etc. |
| `native/` | C++ physics core — rigid bodies, broadphase, contact listener. Catch2-tested via `npm run test:native`. |
| `src/wasm/` | Emscripten loader (`PhysicsModule.ts`), contact/transform buffer codecs, WASM types. |
| `src/game/physics/` | Runtime physics engine selection and collision dispatch (`rapier`, `wasm-mirror`, `wasm-owner`). |
| `src/objects/` | Playfield geometry: bumpers, flippers (joint-based rotation), walls, rails, pachinko pins, decoration. All live under `object-core.ts` as the top-level orchestrator. |
| `src/cabinet/` | Four cabinet presets (classic, neo, vertical, wide) built by `cabinet-builder.ts`. Each defines its own dimensions and styling. |
| `src/display/` | Multi-layer backbox display, composited by one Frame Graph (`backbox-frame-graph.ts`, nodes chosen by `backbox-graph-plan.ts`) onto one plane; CRT and jackpot are passes on that composite, never on the camera. `display-core.ts` drives state transitions (IDLE → REACH → FEVER). See `docs/FRAME_GRAPH.md`. |
| `src/game/scene-*.ts`, `game-post-process.ts` | Scene post-processing as a second Frame Graph (bloom → image processing → sharpen, plus HIGH-only SSAO / SSR / motion blur; the scene target is 4× MSAA on MEDIUM/HIGH and FXAA is the LOW tier’s AA). `scene-graph-plan.ts` (pure) picks the nodes from the `webgpu-post-process-profile.ts` tier; `scene-frame-graph.ts` builds and runs them; `ScenePostController` is the knob surface effects write to. The camera still renders the scene (into one HDR target), not `scene.frameGraph`. New visual passes land as nodes here, not as camera `PostProcess`es. Both graphs load through `src/frame-graph-runtime.ts` (one lazy chunk). See `docs/FRAME_GRAPH.md`. |
| `src/shaders/` | Standalone effect shaders (CRT scanlines + curvature, jackpot overlay, cyber grid, LCD table, scanline): GLSL for WebGL2, WGSL twins in `src/shaders/wgsl/` for WebGPU. |
| `src/materials/` | PBR material library split by domain (ball, metallic, interactive, structural). `material-core.ts` is the entry point. |
| `src/audio/` | Single `AudioEngine` (one AudioContext) + pachinko worklet + sample bank. EventBus remains the trigger API. |
| `src/config/` | Ball-type definitions (STANDARD / GOLD_PLATED / SOLID_GOLD), spawn weight distribution (75 / 20 / 5 %), point values, fever-mode multipliers, API config. |

### Ball lifecycle

Balls are spawned by `BallManager` according to the weighted distribution in `config.ts`. Collection triggers point callbacks and increments the gold-ball counter. `zone-trigger-system.ts` detects spatial events (bumper hits, drain, special zones) and notifies the game loop.

### Lifecycle conventions

A `Game` must tear down completely (`Game.dispose()` → `disposeGame()` in `src/game/game-disposer.ts`), so a second `Game` in the same page starts clean:

- Listeners on `window` / `document` / canvas — and on static `index.html` nodes such as `#start-btn` — take `{ signal: game.signal }` (one `AbortController` per `Game`); hosts that need it declare `signal: AbortSignal`. Never assign `el.onclick = …` on a node that outlives the Game.
- Timers and animation frames go through a `TimerScope` (`src/core/timers.ts`); the owner's `dispose()` calls `scope.dispose()`. Game-level glue uses `game.timers`. ESLint (`no-restricted-syntax`) bans bare `setTimeout` / `setInterval` / `requestAnimationFrame` in `src/game`, `game-elements`, `effects`, `objects`, `display`, `audio` and `adventure`; a bare call that is provably safe takes `// eslint-disable-next-line no-restricted-syntax -- <why>`.
- Any `await` (including a lazy `import()`) in a long-lived owner is followed by `if (this.signal.aborted) return` before it touches state or creates a singleton: `dispose()` can land while it is pending.
- Module singletons need a `reset*` that `disposeGame` calls (lazily loaded ones register theirs in `lazySingletonResets`; `tests/game-disposer-resets.test.ts` pins the list). Do not reset `AdventureState`: it wipes campaign progress.
- Dev-only tooling stays out of the entry chunk: `DebugHUD` / `GameDebug` (`?debug=1` or DEV), `PhysicsTuningPanel` and `FreeMapTestMode` are dynamically imported, so `game.debugHUD`, `game.physicsTuningPanel` and `game.freeMapTestMode` can be `null` until used and `toggleFreeMapTestMode()` / `ensurePhysicsTuningPanel()` are async. `isDebugHUDAvailable()` and the `isPhysicsTuning*` predicates stay synchronous and dependency-free.
- Pass `this` to host consumers; `Game implements` every `*Host` interface, so no `as unknown as XHost` casts.
- `tests/lifecycle-dispose.spec.ts` counts listeners over CDP and fails if a Game leaks any.

### Testing approach

Unit tests (`tests/`) run in a Node environment via Vitest. Babylon.js and Rapier are fully mocked — do not import real engine code inside test files. Playwright E2E tests launch the full Vite dev server and access `window.game` for assertions; see `tests/verify_prism_core.spec.ts` for the pattern.

### Campaign progression docs

Use `docs/ADVENTURE_CAMPAIGN.md` for the current A/B alternating campaign model and portal lifecycle. `AdventureTrackProgression` + `AdventureProgressionSupervisor` are the campaign source of truth; `AdventureState` remains legacy/free-form progression.

### WebGPU / shader authoring

Our custom shaders are **dual GLSL / WGSL** (#488): each GLSL source in `src/shaders/` (CRT, jackpot overlay, cyber grid, LCD table, scanline) has a WGSL twin in `src/shaders/wgsl/` with the same uniforms, samplers and math. `display-shader.ts` registers the GLSL in `Effect.ShadersStore` and picks the language from `engine.isWebGPU` (`displayShaderSource()`): on WebGPU the grid `ShaderMaterial` and the backbox Frame Graph passes are created with `shaderLanguage: ShaderLanguage.WGSL`, and their `extraInitializationsAsync` lazily imports `src/display/backbox-shaders-wgsl.ts`, which registers the WGSL under the same keys in `ShaderStore.ShadersStoreWGSL` (so the WGSL stays out of the entry chunk). Babylon fetches its GLSL → WGSL translator (glslang + twgsl, ~2.7 MB from `cdn.babylonjs.com`) the first time any GLSL effect compiles on WebGPU, so **a WebGPU boot must compile no GLSL**: a new shader needs a WGSL twin (`textureSample` only in uniform control flow, sampler `<texture>Sampler`, `uniforms.x`, `fragmentInputs.vUV`, `fragmentOutputs.color`), and a new `BackboxEffectPass` must carry the right `shaderLanguage`. `tests/webgpu-shader-language.test.ts` checks every `ShadersStore` key has a WGSL twin with the same interface; `tests/webgpu-no-glslang.spec.ts` boots WebGPU and fails on any glslang / twgsl / `cdn.babylonjs.com` request. `src/effects/fresnel-rim-plugin.ts` injects GLSL or WGSL by the language Babylon asks for. Check for `engine.isWebGPU` before using WebGPU-only features.
