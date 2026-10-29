# Engine Bootstrap

Reference for Babylon.js engine creation, resolution scaling, visibility lifecycle, and WASM preload strategy. Implementation lives in [`src/main.ts`](../src/main.ts) and [`src/engine/`](../src/engine/).

---

## Engine option matrix

Resolved by [`src/engine/engine-options.ts`](../src/engine/engine-options.ts) via `resolveEngineOptions()`.

| Option | Production default | Override (first match wins) |
|--------|-------------------|----------------------------|
| `antialias` | **`false`** — the scene renders into its own HDR target (4× MSAA on MEDIUM/HIGH, FXAA on LOW; see [`FRAME_GRAPH.md`](FRAME_GRAPH.md)) | `?antialias=1` |
| `preserveDrawingBuffer` | **`false`** | `?preserveBuffer=1`, `window.DEBUG_PRESERVE_DRAWING_BUFFER = true` |
| `stencil` | `true` | — |
| `setMaximumLimits` | `true` (WebGPU MRT defense) | `?maxLimits=0` — do **not** disable to "fix" Safari; see [`webgpu-post-process-profile.ts`](../src/game/webgpu-post-process-profile.ts) |
| `powerPreference` | `'high-performance'` (desktop), `'default'` (mobile UA) | `?power=high-performance\|low-power\|default` |
| `adaptToDeviceRatio` | **`false`** | Documented only — the resolution policy owns DPR (see [Resolution](#resolution--hardware-scaling-pipeline)) |
| `audioEngine` | **`false`** | — (SoundSystem + EffectsSystem own audio; avoid a third AudioContext) |
| `doNotHandleContextLost` | **`false`** | — Babylon owns the rebuild; we only log (see [Context loss](#context-loss)) |
| `failIfMajorPerformanceCaveat` | **`false`** (SwiftShader CI) | `?gpu=strict` |
| `premultipliedAlpha` | **`true`** | — (matches CSS cabinet) |
| `featureLevel` | `'core'`, then `'compatibility'` on init failure | `?gpu=compat` (skip core, also forces `setMaximumLimits: false`) |
| `enableGPUDebugMarkers` | `false` | `?gpuDebug=1` |
| `deviceDescriptor.requiredFeatures` / `enableAllFeatures` | `OPTIONAL_WEBGPU_FEATURES ∩ adapter.features` / `false` | — see [Optional WebGPU features](#optional-webgpu-features) |
| `deviceDescriptor.requiredLimits` | **never set** | — see [Why we don't probe-and-clamp](#why-we-dont-probe-and-clamp) |

`setMaximumLimits: true` is the first defense for WebGPU MRT (SSAO + DoF + bloom). Try/catch around DoF/SSAO is the second.

### Why we don't probe-and-clamp

A recurring proposal is to drop `setMaximumLimits: true`, probe `adapter.limits` via
`navigator.gpu.requestAdapter()`, and request "only what MRT needs" in
`deviceDescriptor.requiredLimits`. **Don't.** It was reviewed and rejected; this section exists so
the next reader of `setMaximumLimits: true` doesn't re-file it.

1. **`requiredLimits` are validation bounds, not allocations.** Requesting the adapter's advertised
   maximum reserves no memory and costs no performance — it raises the ceiling before a validation
   error fires. Clamping buys nothing at runtime.
2. **It targets the wrong limit.** The limit that actually breaks this project is
   `maxUniformBuffersPerShaderStage` (spec minimum 12 vs. `DefaultRenderingPipeline`'s estimated 17
   — see [`webgpu-post-process-profile.ts`](../src/game/webgpu-post-process-profile.ts)). The
   attachment/storage/texture-dimension limits usually named in the proposal are a different family
   and were never the failure mode.
3. **Clamping cannot fix that failure mode anyway.** You cannot raise an adapter's per-stage
   uniform-buffer cap by asking for less. The only fix is to not build the pass, which
   `resolveWebGPUPostProcessProfile()` / `bloomPipelineTogglesForTier()` already do, with a runtime
   downgrade via `isUniformBufferLimitError()` + `downgradePostProcessTier()`.
4. **It would make `resolveEngineOptions()` async.** That function is synchronous
   ([`engine-options.ts`](../src/engine/engine-options.ts)); awaiting `requestAdapter()` inside it
   would contaminate every caller's init chain.
5. **A hand-maintained clamp table drifts.** Add a post-process pass, forget the table, and you get
   a silent visual regression instead of the loud fallback we already handle.

`setMaximumLimits: true` stays at core level, the compatibility retry stays, and
`deviceDescriptor.requiredLimits` stays unset. The data-driven version of this work is the
telemetry below: measure how often we degrade before optimizing for it.

### WebGPU feature-level degrade

[`createWebGPUEngineWithFallback()`](../src/engine/create-engine.ts) walks the GPU paths in order,
logging each transition:

```
featureLevel: 'core'          + setMaximumLimits: true
  ↓ initAsync() rejected — dispose the half-built engine
featureLevel: 'compatibility' + setMaximumLimits: false
  ↓ initAsync() rejected — dispose
WebGL2 (new Engine(...))
```

The compatibility retry is the only place `setMaximumLimits` is forced off: asking a strict adapter
(Safari/Metal) for *less* is what lets it hand us a device at all. That is **not** a reason to lower
the `core` default — post-process degrades in
[`webgpu-post-process-profile.ts`](../src/game/webgpu-post-process-profile.ts) instead.

`?gpu=compat` skips the `core` attempt (and so also boots with `setMaximumLimits: false`), which is
the deterministic way to reproduce the degraded profile in CI.

We construct `new WebGPUEngine(...)` and `await engine.initAsync()` rather than calling
`WebGPUEngine.CreateAsync()`. In `@babylonjs/core` 7.54.3, and still in 9.30.0, `CreateAsync` builds its promise with no
reject path, so a failed init never settles — the chain above would hang, and the half-built engine
would never be disposed.

Every degraded path logs the greppable marker `[Bootstrap][gpu-degrade]` (`GPU_DEGRADE_MARKER`).
Until a real analytics sink exists, that string is how you count degrades in a console log.

### Optional WebGPU features

`deviceDescriptor.requiredFeatures` is the allow-list `OPTIONAL_WEBGPU_FEATURES`
([`gpu-capabilities.ts`](../src/engine/gpu-capabilities.ts)) **intersected with the adapter's features**
(`selectWebGPUFeatures`) — so the device gets every one of them the adapter offers, and none it does not:

`texture-compression-bc`, `texture-compression-astc`, `texture-compression-etc2`, `timestamp-query`,
`float32-filterable`, `rg11b10ufloat-renderable`, `shader-f16`.

A feature listed but not offered would fail `requestDevice()` outright, so `createWebGPUEngineWithFallback`
first asks for the adapter with the same options Babylon's `initAsync` passes to `requestAdapter` (same
adapter), reads `adapter.features`, and requests the intersection. If that probe fails it requests none.
Babylon 9.30 also intersects `requiredFeatures` itself (`webgpuEngine.pure.js` `initAsync`), which is the
backstop; the explicit intersection is there so the code says what it does.

**Rule:** consumers never read this list. They query the capability record,
`resolveGpuCapabilities(engine)`: `{ backend, compressedTextures: { bc, astc, etc2 }, gpuTimer, hdrFormat, f16,
float32Filterable, maxMsaaSamples }`, built from the engine caps Babylon derives from the enabled features
(`caps.s3tc` / `astc` / `etc2` → KTX2 transcodes to a compressed format instead of RGBA; `caps.timerQuery` →
dynamic resolution reads GPU time). The boot log prints it once: `[Bootstrap] GPU caps: …`.

(`enableAllFeatures: false` is belt-and-braces — Babylon ignores it once `requiredFeatures` is set
explicitly.)

### Context loss

`attachGpuContextLogging()` subscribes to `engine.onContextLostObservable` /
`onContextRestoredObservable` and does three things: logs, drives a toast, and records the event.

With `doNotHandleContextLost: false` Babylon rebuilds the GPU resources itself. We still do **not**
call `engine.resize()` on restore — it re-uploads nothing and would only look like recovery. We
wait for Babylon's restore observable and then say "Restored".

| | Toast (`#power-toast`) | `<body data-gpu-context>` | Telemetry |
|---|---|---|---|
| loss | `Graphics context lost — restoring…`, **stays up** — the canvas is dead until restore | `lost` | `context-lost` |
| restore | `Graphics restored`, auto-hides after 2.6 s | `ok` | `context-restored` |

`data-gpu-context` is the Playwright hook; assert on it rather than on toast copy. It is set to `ok`
at attach time, so it is present on a clean boot too.

**Reduced motion** ([`GpuContextToast`](../src/engine/gpu-context-toast.ts)) drops the toast's
opacity/transform transition and holds the restored toast for 5 s instead of 2.6 s — a flapping
context must not turn the toast into a strobe. The signal is
`window.matchMedia('(prefers-reduced-motion: reduce)')`, read directly: the in-game
`photosensitiveMode` flag lives in `src/effects/`, and `src/engine/**` must not import the game
layer to reach it.

**Driving it in a test.** WebGPU has no reliable cross-browser programmatic context loss, so
outside production builds `attachGpuContextLogging()` publishes `window.__DEBUG_LOSE_CONTEXT()` and
`window.__DEBUG_RESTORE_CONTEXT()`, which invoke the same handlers the observables do.

### Degrade telemetry

This project degrades in four distinct ways, and none of them used to be observable outside a
console nobody opens. [`src/engine/gpu-degrade-telemetry.ts`](../src/engine/gpu-degrade-telemetry.ts)
keeps every one of them in a bounded ring buffer (**16 entries**) on
`window.bootstrapGpuDegrades`, created during `createEngine()` so a clean boot reads `[]` rather
than `undefined`:

```js
window.bootstrapGpuDegrades
// [{ path: 'postprocess-tier-boot',
//    featureLevel: 'core',
//    detail: 'tier bloom-only: adapter maxUniformBuffersPerShaderStage=12 < … (17) — bloom-only graph, no image-processing node',
//    timestamp: 1757… }]
```

| `path` | Fired from | Meaning |
|--------|-----------|---------|
| `webgpu-featurelevel` | `createWebGPUEngineWithFallback()` | WebGPU booted at a lower feature level than requested |
| `webgl2-fallback` | `createEngine()` | WebGPU failed at every level; the engine is WebGL2 |
| `postprocess-tier-boot` | `PostProcessManager.setup()` | The adapter's uniform-buffer cap forced a reduced tier at startup |
| `postprocess-tier-runtime` | the `uncapturederror` guard, or `PostProcessManager.onGraphFailed()` | A WebGPU validation error forced a further downgrade mid-play, or the scene graph could not be built (tier `none`) |
| `context-lost` / `context-restored` | `attachGpuContextLogging()` | Runtime device loss and recovery |

`featureLevel` is `'core' | 'compatibility' | 'webgl2' | null`. Compatibility is not theoretical —
Chrome 146 enabled it on Android OpenGL ES 3.1 — so it is a real bucket that will collect real
entries. `createEngine()` publishes the booted level via `setActiveGpuFeatureLevel()`, which is how
the post-process layer (which can see "this is WebGPU" but not "this is the compat retry") gets it
without `src/engine/**` and `src/game/**` importing each other: both import the telemetry module,
never one another.

Bounded on purpose — a flapping context would otherwise grow an unbounded array on `window` in
exactly the situation we most want to survive. `countGpuDegrades(path)` is what an analytics sink
would drain; the console marker `[Bootstrap][gpu-degrade]` still fires alongside every entry, and
nothing about that output changed when the buffer was added.

### Render-path probe

The ring buffer answers "what went wrong". The other half of a bug report — *which* render path is
this player actually on — is `window.bootstrapGpuProbe`, a single snapshot rather than a log:

```js
window.bootstrapGpuProbe
// { backend: 'webgpu', featureLevel: 'core',
//   maxUniformBuffersPerShaderStage: 12, postProcessTier: 'bloom-only' }
```

It is filled in two steps because the two halves are known at different times by different layers:
`createEngine()` records `backend` and `featureLevel`, and `PostProcessManager.setup()` records
`postProcessTier` and the adapter cap it was derived from. Until the pipeline is built the tier is
`null`, so anything polling for it (Playwright) must wait for the field, not just the object. Unlike
the ring buffer the probe records the *undegraded* path too: `postProcessTier: 'full'` is an answer.

The debug HUD's **Display** panel reads it — `renderer`, `feature level` and `pp tier` sit next to
the physics-engine label, so the whole render path is legible without opening a console.

### Renderer backend

Separate from engine options — see [`src/renderers/renderer-selector.ts`](../src/renderers/renderer-selector.ts):

1. URL `?renderer=webgpu|webgl2`
2. `window.DEBUG_RENDERER`
3. `localStorage['pachinball-renderer']`
4. `'auto'` — WebGPU first, WebGL2 fallback on failure

Active backend is tagged on `<canvas data-renderer="webgpu|webgl2">` and `window.currentRenderer`.

### Debug URL flags (related)

| Flag | Effect |
|------|--------|
| `?nopp=1` | Skip all scene post-processing: no scene graph, the camera renders to the canvas (the backbox composite still runs) |
| `?noopt=1` | Disable `SceneOptimizer` |
| `?preserveBuffer=1` | Enable `preserveDrawingBuffer` for framebuffer readback |
| `?gpu=compat` | WebGPU `featureLevel: 'compatibility'` only (skips the `core` attempt; implies `setMaximumLimits: false`) — the deterministic way to reproduce the degraded profile in CI |
| `?gpu=strict` | `failIfMajorPerformanceCaveat: true` (not for SwiftShader CI) |
| `?gpuDebug=1` | WebGPU `enableGPUDebugMarkers` |

---

## Resolution / hardware-scaling pipeline

The game canvas is **not** full-viewport. It fills `#game-cabinet`, sized in CSS as `min(85vh, 85vw)` ([`src/style.css`](../src/style.css)).

With `adaptToDeviceRatio: false`, Babylon's `resize()` is `setSize(clientWidth / level, …)` — DPR never
enters on its own. The resolution policy ([`resolution-policy.ts`](../src/engine/resolution-policy.ts),
#488 §3) works in **render scale** (backbuffer pixels per CSS pixel) and sets `level = 1 / scale`:

```
renderScale = min(devicePixelRatio, platform cap, tier cap)        (or ?renderScale=X)
  platform cap: 1.5 mobile, 2 desktop
  tier cap:     HIGH none, MEDIUM 1.5, LOW 1
renderWidth  ≈ clientWidth  × renderScale
renderHeight ≈ clientHeight × renderScale
```

| Device | Before (fixed level) | Now (MEDIUM) |
|---|---|---|
| DPR-3 phone | level 2: ½× CSS, **1/6 of native per axis** | 1.5× CSS (½ of native per axis) |
| DPR-2 laptop | level 1: 1× CSS | 1.5× CSS (2× on HIGH) |
| DPR-1 desktop | 1× | 1× |

- **Boot** (`applyHardwareScaling`, `main.ts`): the platform cap only — the tier is not known yet.
- **`RenderResolution`** ([`render-resolution.ts`](../src/game/render-resolution.ts), a lazy chunk loaded by
  `GameRenderer.setupResolution()` after tier detection) re-applies the policy with the tier cap, on every tier
  change (settings or auto-drop), and on every DPR change. The DPR watch is a `(resolution: Xdppx)` media query
  **re-armed after each change** (a query only matches the DPR it names; the old handler compared against
  `clientWidth × DPR`, which never matches with `adaptToDeviceRatio: false`, and was never re-armed).
- **Dynamic resolution** ([`dynamic-resolution.ts`](../src/engine/dynamic-resolution.ts)): one sample per frame
  (frame-scheduler `idle` phase). With `timestamp-query` (`GpuCapabilities.gpuTimer`, WebGPU) the sample is GPU
  frame time from `EngineInstrumentation.gpuFrameTimeCounter` against a 14 ms budget; without it, the frame
  interval against 1000/55 ms. 30 consecutive frames over budget step the scale down by 0.125; 120 under
  (< 0.8 × budget, or < 0.95 × for the interval) step it up; frames in between reset both counts. A step up
  that is undone by the next step down doubles the frames the next step up needs (to 960). Range:
  `[max(0.5, max/2), max]`. `?dynres=0` or a pinned `?renderScale=` turns it off. Under automation
  (`navigator.webdriver`, i.e. Playwright) it is off unless `?dynres=1`: SwiftShader never meets the budget.
- **The scene optimizer no longer touches the hardware scaling level** (no `HardwareScalingOptimization` in
  `safe-scene-optimizer-options.ts`): it could only raise it, and fought the policy's re-application.
- The scene Frame Graph rebuilds at the new size (`RESIZE_SETTLE_FRAMES`), double-buffered, so a step never
  shows an unprocessed frame. The bloom kernel scales with the level.

(Babylon applies internal rounding; use `engine.getRenderWidth()` / `getRenderHeight()` for ground truth.)

Inspect at runtime:

```js
const e = window.game.engine
console.log(e.getRenderWidth(), e.getRenderHeight(), e.getHardwareScalingLevel())
window.game.renderer.getResolutionInfo() // { scale, maxScale, minScale, dynamic, source, devicePixelRatio, changes }
```

The debug HUD's **Frame** panel shows the same, with the frame scheduler's per-phase CPU time. Or call
`window.runVisibilityDiagnostic()` after the game loads.

---

## Post-process degradation tiers

The tier decides which nodes the scene post-process Frame Graph has (`planSceneGraph()`; see
[`FRAME_GRAPH.md`](FRAME_GRAPH.md), "Slice B"). A node that is not in the plan is never built.

1. **Full** — `scene:render → [ssao → ssr → motionBlur →] bloom → imageProcessing → sharpen → fxaa`. The bracketed
   HIGH-only nodes also need a context that can afford their geometry pass (not a software rasteriser, enough
   draw buffers); without it `game.postProcessDegraded === true` and the rest stays.
2. **Bloom-only** — `scene:render → bloom`. On WebGPU adapters capped at 12 uniform buffers per stage the game
   proactively uses this tier: the image-processing node (and FXAA, sharpen, vignette, colour curves) is **left out
   of the graph**, not toggled off on a pipeline whose pass binds its full layout regardless.
   `game.postProcessDegraded === true`; debug HUD shows `pp degraded: true`. A runtime validation error downgrades
   further to `none`, rebuilding the graph at that tier (no node: the graph is disposed).
3. **Disabled** — `?nopp=1`, or tier `none`: no graph; the camera renders straight to the canvas.

Reduced motion drops bloom, sharpen, the vignette and the HIGH-only nodes. `game.renderer.getSceneGraphInfo()` reports
the plan, every node left out and why, and the built node list.

`setMaximumLimits: true` is the first defense for WebGPU MRT. The geometry pass of the HIGH-only nodes writes four
colour attachments; contexts with fewer draw buffers build none of them.

**Mobile quality probe (#300):** `detectQualityTier()` in `material-core.ts` applies `applyMobileQualityCap()` using `isMobileUserAgent` from `engine-options.ts` — mobile caps at MEDIUM (LOW on low memory / Save-Data). SSAO/DoF are HIGH-only. Sustained frame time >22ms for 2s triggers a one-shot auto tier drop via `PerformanceMonitor`.

---

## Visibility + audio lifecycle

[`src/engine/visibility-manager.ts`](../src/engine/visibility-manager.ts) listens for `document.visibilitychange`:

| Event | Action |
|-------|--------|
| Tab hidden | `game.pauseRendering()` (stops only that Game's own loop — never bare `engine.stopRenderLoop()`), suspend `SoundSystem`, `EffectsSystem`, and Babylon `Engine.audioEngine` contexts |
| Tab visible | `engine.resize()`, `game.resumeRendering()` (a disposed Game stays stopped), resume audio **only if** game state is `PLAYING` |

Game pause (`PAUSED` state) still suspends the effects `AudioContext` via `GameLifecycle` independently.

## Frame scheduler (one render loop)

[`src/core/frame-scheduler.ts`](../src/core/frame-scheduler.ts) (#488 §4) is the only caller of
`engine.runRenderLoop`. `Game` owns one (`game.frameScheduler`, disposed with the Game's signal);
`pauseRendering()` / `resumeRendering()` are its `pause()` / `resume()`, which stop and restart that one loop
and nothing else, so the hide → show → dispose leak cannot come back (a disposed scheduler never restarts;
`tests/lifecycle-dispose.spec.ts` counts `engine.activeRenderLoops`).

Each frame runs its phases in order, every system in registration order within its phase:

| Phase | Systems (`Game.registerFrameSystems`) |
|---|---|
| `input` | latency display |
| `physics` | `physicsController.stepFixed()` — input drain, the fixed steps this frame owes, mesh interpolation |
| `sim` | `physicsController.updateSim()` (feeders, captures, stuck balls, combo / tilt / power-up), traps / launchers / moving gates, adventure mode |
| `visuals` | `physicsController.updateVisuals()` (camera, effects, trails, backbox), cabinet lighting, spinners |
| `render` | `scene.render()` |
| `hud` | countdown, perf monitor, debug HUD |
| `idle` | dynamic resolution's frame-time sample |

Cabinet lighting and spinners used to update **after** `scene.render()` (one frame late); the physics step ran
inside `scene.render()` from `onBeforeRenderObservable`. Now everything a frame shows is computed before it is
drawn. `stepPhysics()` stays as `stepFixed → updateSim → updateVisuals` for callers that drive the table directly.

A system is `{ phase, name?, update(dt), dispose? }`; `register(system, { signal })` returns its unregister
function and drops it when the signal aborts. Registration is copy-on-write, so a frame iterates a stable list
and allocates nothing. Per-phase CPU time is measured every frame and smoothed (`getTimings()`): the debug HUD's
**Frame** panel shows it. The scheduler's loop calls `game.renderFrame()` (looked up per frame), which calls
`tick()` — so the perf harness can still wrap `renderFrame`.

---

## WASM preload strategy

| Bundle | When | Where |
|--------|------|-------|
| **C++ physics** (`public/wasm/PhysicsModule.js`) — `wasm-worker` (default when cross-origin isolated: warms a Dedicated Worker) / `wasm-owner` (default otherwise: compiles on the main thread) | Parallel with engine creation | `preloadPhysicsSystem()` (`src/game-elements/physics-preload.ts`) → `preloadWasmPhysicsNow()` |
| **Rapier** (`@dimforge/rapier3d-compat`) — explicit `rapier` / `wasm-mirror` only | Parallel with engine creation | `preloadPhysicsSystem()` → `loadRapier()`; the owner modes load it lazily, and only if the C++ bundle is missing |
| **C++ physics (idle)** | Idle after bootstrap (`requestIdleCallback`, 8s timeout) | `scheduleIdleWasmPreload()` — a no-op once the parallel preload has started |
| **C++ physics (active mode)** | `physics.init()` when the preference ≠ `rapier` | Owner: reuses the preload via `getPreloadedWasmModule()`. Worker: consumes the prewarmed worker (`consumePrewarmedPhysicsWorker()`); a worker that errors or times out falls back to the owner with `[Bootstrap][physics-degrade]` |

`main.ts` never names a physics engine: `preloadPhysicsSystem()` returns the `PhysicsSystem`
that `new Game(engine, physics)` consumes (`tests/boot-graph-rapier-free.test.ts` keeps
`main.ts` / `game.ts` free of Rapier imports and types).

Idle preload no-ops gracefully when the bundle is missing (dev machines without Emscripten build).

Emscripten Release/Debug/RelWithAsserts flags, SIMD/LTO options, and the 50-sphere
microbench table live in [`docs/wasm-physics-engine.md`](wasm-physics-engine.md)
(section **Emscripten flag matrix**). Default `npm run build:wasm` remains the
production path.

Toggle C++ WASM:

```js
localStorage.setItem('pachinball:physics-engine', 'wasm-mirror') // or wasm-owner, rapier
location.reload()
```

---

## Benchmark procedure

Use for before/after comparisons (e.g. `preserveDrawingBuffer` on vs off).

### Devices

- Mid-tier laptop (integrated GPU)
- One mobile device (or Chrome DevTools device emulation as secondary)

### Steps

1. Hard-refresh the game (clear cache if comparing branches).
2. Open DevTools console; note `[Bootstrap] Total initialization` timing.
3. Click **Start Game**; play ~60 seconds.
4. Press `` ` `` to open the debug HUD (dev builds or `?debugHud=1`).
5. Record from the **Display** panel:
   - `fps`, `frame ms`, `renderer`, `pp degraded`
6. In console:

```js
const e = window.game.engine
({
  fps: e.getFps(),
  renderW: e.getRenderWidth(),
  renderH: e.getRenderHeight(),
  hwScale: e.getHardwareScalingLevel(),
  preserveBuffer: window.bootstrapEngineOptions?.preserveDrawingBuffer,
})
```

7. Optional continuous logging:

```js
localStorage.setItem('debug:perf-log', 'true')  // press T to enable perf monitor first
```

### Playwright automation

```bash
npm run dev   # separate terminal
npx playwright test tests/engine-bootstrap.spec.ts tests/verify_prism_core.spec.ts
```

Use `?renderer=webgl2` for automation-friendly WebGL2 canvas capture.

---

## Follow-ups (not in this pass)

- **Rapier** stays `@dimforge/rapier3d-compat@^0.15.0`. 0.18/0.19 add snapshot APIs that replay (#341 leftovers) will want — bump in a dedicated PR; do not mix with bootstrap hygiene.
- **#361** Worker + SharedArrayBuffer still needs COOP/COEP. Glue ENVIRONMENT is already `web,worker,node`.
- **Ship degrade telemetry to a sink.** `window.bootstrapGpuDegrades` is the buffer; nothing drains it yet. Wire it to real analytics once one exists — the ring buffer is deliberately the only consumer today. Once it has run on the live demo for a week, revisit **with data**: if the compatibility-fallback and tier-downgrade rates are negligible, close this line of work; if one adapter family (Safari/Metal is the likeliest) degrades heavily, *that* is the justification for a targeted, adapter-conditional workaround — scoped to that adapter, never the default path.
- **Babylon 9.** Done in #461: `@babylonjs/core` and `@babylonjs/loaders` are both `^9.30.0`, bumped together (see [`FRAME_GRAPH.md`](FRAME_GRAPH.md)). The engine options above are unchanged by the bump.
- **GPU-time HUD.** `timestamp-query` is now requested where the adapter has it; a GPU-time HUD reads `resolveGpuCapabilities(engine).gpuTimer` and `EngineInstrumentation.gpuFrameTimeCounter` (dynamic resolution already does). Never assume it: Safari/Metal often lacks it.

---

## Playwright / CI notes

- Screenshots use `page.screenshot()` (compositor capture) — **do not** require `preserveDrawingBuffer`.
- Force WebGL2: `http://localhost:5173/?renderer=webgl2`
- Verify bootstrap options: `window.bootstrapEngineOptions` exposed after load.
