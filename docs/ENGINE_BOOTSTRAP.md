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
| `deviceDescriptor.requiredLimits` | probed + clamped from `adapter.limits` on the `core` attempt | dropped entirely on the `compatibility` retry; absent when `?maxLimits=0` or no `navigator.gpu` |

`setMaximumLimits: true` is the first defense for WebGPU MRT (SSAO + DoF + bloom). Try/catch around DoF/SSAO is the second.
It is now only the *fallback* first defense — see [Probed `requiredLimits`](#probed-requiredlimits).

### Probed `requiredLimits`

[`src/engine/gpu-limits.ts`](../src/engine/gpu-limits.ts) replaces the blunt "ask for every limit
at its maximum" with "ask for what the MRT chain needs, clamped to what this adapter reports":

```
navigator.gpu.requestAdapter({ powerPreference })
  → resolveRequiredLimits(adapter.limits, MRT_REQUIRED_LIMITS)
      • adapter meets the limit  → request the MRT value
      • adapter is below it      → request the adapter value, push onto `clamped`
      • adapter doesn't report it→ omit it, push onto `unsupported`
  → deviceDescriptor.requiredLimits = { … }, setMaximumLimits: false
```

Because nothing in the list can exceed `adapter.limits`, `requestDevice()` can never fail
*because of* this list — which is the difference from `setMaximumLimits`, where one limit the
driver dislikes costs a whole feature level.

Babylon applies `setMaximumLimits` only when `deviceDescriptor.requiredLimits` is unset
(`webgpuEngine.js`), so `toWebGPUEngineOptions()` sets the flag to `false` explicitly rather than
relying on that ordering.

| Situation | What we send |
|-----------|--------------|
| `core` attempt, probe succeeded | `requiredLimits` (clamped), `setMaximumLimits: false` |
| `core` attempt, no `navigator.gpu` / adapter / probe threw | no `requiredLimits`, `setMaximumLimits: true` (old behaviour) |
| `compatibility` retry | no `requiredLimits`, `setMaximumLimits: false` — WebGPU defaults, the safety net |
| `?maxLimits=0` | no probe at all, `setMaximumLimits: false` |

`MRT_REQUIRED_LIMITS` is the one place to edit when a post-process pass starts needing more. A
non-empty `clamped` list means the adapter cannot run the full profile and
[`webgpu-post-process-profile.ts`](../src/game/webgpu-post-process-profile.ts) will degrade — it is
logged with `[Bootstrap][gpu-degrade]` and recorded as a `limits-clamped` entry.

### WebGPU feature-level degrade

[`createWebGPUEngineWithFallback()`](../src/engine/create-engine.ts) walks the GPU paths in order,
logging each transition:

```
featureLevel: 'core'          + setMaximumLimits as resolved
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

| | Toast (`#power-toast`) | `<html data-gpu-context>` | Telemetry |
|---|---|---|---|
| loss | `Graphics context lost — restoring…`, stays up | `lost` | `context-lost` |
| restore | `Graphics restored`, auto-hides after 2.6 s | `ok` | `context-restored` |

`data-gpu-context` is the Playwright hook (`tests/engine-bootstrap.spec.ts` drives a real loss with
`WEBGL_lose_context`); assert on it rather than on toast copy. It is set to `ok` at attach time, so
it is present on a clean boot too.

**Photosensitive mode** ([`GpuContextToast`](../src/engine/gpu-context-toast.ts)) drops the toast's
opacity/transform transition and holds the restored toast for 5 s instead of 2.6 s — a flapping
context must not turn the toast into a strobe. The setting is read from the persisted
`pachinball.settings` blob, because engine creation runs before `Game` populates `GameConfig`.

### Degrade telemetry

[`src/engine/gpu-degrade-telemetry.ts`](../src/engine/gpu-degrade-telemetry.ts) keeps the same
events in a bounded ring buffer (32 entries) on `window.bootstrapGpuDegrades`, created during
`createEngine()` so a clean boot reads `[]` rather than `undefined`:

```js
window.bootstrapGpuDegrades
// [{ path: 'limits-clamped', featureLevel: 'core', detail: 'maxUniformBuffersPerShaderStage 16→12', timestamp: … }]
```

| `path` | Meaning |
|--------|---------|
| `limits-clamped` | The adapter could not grant an MRT limit; expect a degraded post-process profile |
| `webgpu-featurelevel` | WebGPU booted at a lower feature level than requested |
| `webgl2-fallback` | WebGPU failed at every level; the engine is WebGL2 |
| `context-lost` / `context-restored` | Runtime device loss and recovery |

Bounded on purpose — a flapping context would otherwise grow an unbounded array on `window` in
exactly the situation we most want to survive. `countGpuDegrades(path)` is what an analytics sink
would drain; the console marker `[Bootstrap][gpu-degrade]` still fires alongside it.

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
| `?gpu=compat` | WebGPU `featureLevel: 'compatibility'` only (skips the `core` attempt; implies `setMaximumLimits: false`) |
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
- **Ship degrade telemetry to a sink.** `window.bootstrapGpuDegrades` is the buffer; nothing drains it yet. Wire it to real analytics once one exists — the ring buffer is deliberately the only consumer today.
- **GPU-time HUD.** If one is added, check `adapter.features.has('timestamp-query')` in that pass only. Do **not** add it to `deviceDescriptor.requiredFeatures`; see [Optional WebGPU features](#optional-webgpu-features).

---

## Playwright / CI notes

- Screenshots use `page.screenshot()` (compositor capture) — **do not** require `preserveDrawingBuffer`.
- Force WebGL2: `http://localhost:5173/?renderer=webgl2`
- Verify bootstrap options: `window.bootstrapEngineOptions` exposed after load.
