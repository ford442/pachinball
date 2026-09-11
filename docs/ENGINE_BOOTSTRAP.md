# Engine Bootstrap

Reference for Babylon.js engine creation, resolution scaling, visibility lifecycle, and WASM preload strategy. Implementation lives in [`src/main.ts`](../src/main.ts) and [`src/engine/`](../src/engine/).

---

## Engine option matrix

Resolved by [`src/engine/engine-options.ts`](../src/engine/engine-options.ts) via `resolveEngineOptions()`.

| Option | Production default | Override (first match wins) |
|--------|-------------------|----------------------------|
| `antialias` | `true` | `?antialias=0` |
| `preserveDrawingBuffer` | **`false`** | `?preserveBuffer=1`, `window.DEBUG_PRESERVE_DRAWING_BUFFER = true` |
| `stencil` | `true` | — |
| `setMaximumLimits` | `true` (WebGPU MRT defense) | `?maxLimits=0` — do **not** disable to "fix" Safari; see [`webgpu-post-process-profile.ts`](../src/game/webgpu-post-process-profile.ts) |
| `powerPreference` | `'high-performance'` (desktop), `'default'` (mobile UA) | `?power=high-performance\|low-power\|default` |
| `adaptToDeviceRatio` | **`false`** | Documented only — manual hardware scaling owns DPR |
| `audioEngine` | **`false`** | — (SoundSystem + EffectsSystem own audio; avoid a third AudioContext) |
| `doNotHandleContextLost` | **`false`** | — Babylon owns the rebuild; we only log (see [Context loss](#context-loss)) |
| `failIfMajorPerformanceCaveat` | **`false`** (SwiftShader CI) | `?gpu=strict` |
| `premultipliedAlpha` | **`true`** | — (matches CSS cabinet) |
| `featureLevel` | `'core'`, then `'compatibility'` on init failure | `?gpu=compat` (skip core, also forces `setMaximumLimits: false`) |
| `enableGPUDebugMarkers` | `false` | `?gpuDebug=1` |
| `deviceDescriptor.requiredFeatures` / `enableAllFeatures` | `[]` / `false` | — see [Optional WebGPU features](#optional-webgpu-features) |
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
`deviceDescriptor` stays `{ requiredFeatures: [] }`. The data-driven version of this work is the
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
`WebGPUEngine.CreateAsync()`. In `@babylonjs/core` 7.54.3 `CreateAsync` builds its promise with no
reject path, so a failed init never settles — the chain above would hang, and the half-built engine
would never be disposed.

Every degraded path logs the greppable marker `[Bootstrap][gpu-degrade]` (`GPU_DEGRADE_MARKER`).
Until a real analytics sink exists, that string is how you count degrades in a console log.

### Optional WebGPU features

`deviceDescriptor.requiredFeatures` is deliberately `[]` — we require **no** optional WebGPU feature
at device creation. Anything listed there is a hard requirement: an adapter that lacks it fails
`requestDevice()` outright, turning a degraded-but-playable boot into no boot at all. Current
adapter support makes that a real risk (`timestamp-query` ~98% but flaky on Safari/Metal,
`float32-filterable` ~92%, `rg11b10ufloat-renderable` ~99.97%).

**Rule:** a pass that wants an optional feature checks `adapter.features.has(...)` at the point of
use and degrades there, instead of adding it to this list.

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
//    detail: 'tier bloom-only: adapter maxUniformBuffersPerShaderStage=12 < … (17) — using standalone BloomEffect',
//    timestamp: 1757… }]
```

| `path` | Fired from | Meaning |
|--------|-----------|---------|
| `webgpu-featurelevel` | `createWebGPUEngineWithFallback()` | WebGPU booted at a lower feature level than requested |
| `webgl2-fallback` | `createEngine()` | WebGPU failed at every level; the engine is WebGL2 |
| `postprocess-tier-boot` | `PostProcessManager.setup()` | The adapter's uniform-buffer cap forced a reduced tier at startup |
| `postprocess-tier-runtime` | the `uncapturederror` guard | A WebGPU validation error forced a further downgrade mid-play |
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
| `?nopp=1` | Skip all post-processing in `GameRenderer` |
| `?noopt=1` | Disable `SceneOptimizer` |
| `?preserveBuffer=1` | Enable `preserveDrawingBuffer` for framebuffer readback |
| `?gpu=compat` | WebGPU `featureLevel: 'compatibility'` only (skips the `core` attempt; implies `setMaximumLimits: false`) — the deterministic way to reproduce the degraded profile in CI |
| `?gpu=strict` | `failIfMajorPerformanceCaveat: true` (not for SwiftShader CI) |
| `?gpuDebug=1` | WebGPU `enableGPUDebugMarkers` |

---

## Resolution / hardware-scaling pipeline

The game canvas is **not** full-viewport. It fills `#game-cabinet`, sized in CSS as `min(85vh, 85vw)` ([`src/style.css`](../src/style.css)).

```
#pachinball-canvas CSS client size (100% of cabinet)
  → ResizeObserver in GameRenderer.setupResizeObserver() → engine.resize()
  → hardwareScalingLevel from resolveHardwareScalingLevel():
       mobile UA: 2 (half internal resolution)
       desktop DPR > 1: min(DPR, 2)
       else: 1
  → adaptToDeviceRatio=false (Babylon does NOT auto-multiply DPR)
  → setupDPRHandling(): re-call engine.resize() on DPR media-query change
```

**Effective render pixels** (approximate):

```
renderWidth  ≈ clientWidth  × DPR / hardwareScalingLevel
renderHeight ≈ clientHeight × DPR / hardwareScalingLevel
```

(Babylon applies internal rounding; use `engine.getRenderWidth()` / `getRenderHeight()` for ground truth.)

Inspect at runtime:

```js
const e = window.game.engine
console.log(e.getRenderWidth(), e.getRenderHeight(), e.getHardwareScalingLevel())
```

Or call `window.runVisibilityDiagnostic()` after the game loads.

---

## Post-process degradation tiers

1. **Full** — bloom, FXAA, tone-map, DoF, SSAO (+ SSR/motion blur on HIGH tier).
2. **Bloom-only** — DoF or SSAO failed validation (WebGPU strict adapters or WebGL SwiftShader). `game.postProcessDegraded === true`; debug HUD shows `pp degraded: true`.
   On WebGPU adapters capped at 12 uniform buffers per stage, the game proactively uses a **bloom-only** profile (bloom without the image-processing pass; FXAA/sharpen/vignette/color-curves disabled). Runtime validation errors downgrade further to post-process disabled (`none`).
3. **Disabled** — `?nopp=1` skips all post-processing.

`setMaximumLimits: true` is the first defense for WebGPU MRT (SSAO + DoF + bloom). Try/catch around DoF/SSAO is the second.

**Mobile quality probe (#300):** `detectQualityTier()` in `material-core.ts` applies `applyMobileQualityCap()` using `isMobileUserAgent` from `engine-options.ts` — mobile caps at MEDIUM (LOW on low memory / Save-Data). SSAO/DoF are HIGH-only. Sustained frame time >22ms for 2s triggers a one-shot auto tier drop via `PerformanceMonitor`.

---

## Visibility + audio lifecycle

[`src/engine/visibility-manager.ts`](../src/engine/visibility-manager.ts) listens for `document.visibilitychange`:

| Event | Action |
|-------|--------|
| Tab hidden | `engine.stopRenderLoop()`, suspend `SoundSystem`, `EffectsSystem`, and Babylon `Engine.audioEngine` contexts |
| Tab visible | `engine.resize()`, restart `runRenderLoop(game.renderFrame())`, resume audio **only if** game state is `PLAYING` |

Game pause (`PAUSED` state) still suspends the effects `AudioContext` via `GameLifecycle` independently.

---

## WASM preload strategy

| Bundle | When | Where |
|--------|------|-------|
| **Rapier** (`@dimforge/rapier3d-compat`) | Parallel with engine creation | `preloadPhysics()` in `main.ts` |
| **C++ physics** (`public/wasm/PhysicsModule.js`) | Idle after bootstrap (`requestIdleCallback`, 8s timeout) | `scheduleIdleWasmPreload()` |
| **C++ physics (active mode)** | `physics.init()` when `localStorage` flag ≠ `rapier` | Reuses idle cache via `getPreloadedWasmModule()` |

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
- **Babylon 8/9.** `@babylonjs/core` and `@babylonjs/loaders` are both `^7.54.3` and already in step; there is nothing to "align". A major bump is a separate migration (WGSL shader loading changes, audio-engine rewrite) and must not ride along with bootstrap hygiene.
- **GPU-time HUD.** If one is added, check `adapter.features.has('timestamp-query')` in that pass only. Do **not** add it to `deviceDescriptor.requiredFeatures`; see [Optional WebGPU features](#optional-webgpu-features).

---

## Playwright / CI notes

- Screenshots use `page.screenshot()` (compositor capture) — **do not** require `preserveDrawingBuffer`.
- Force WebGL2: `http://localhost:5173/?renderer=webgl2`
- Verify bootstrap options: `window.bootstrapEngineOptions` exposed after load.
