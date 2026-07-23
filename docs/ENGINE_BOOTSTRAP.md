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
| `setMaximumLimits` | `true` (WebGPU) | `?maxLimits=0` |
| `powerPreference` | `'high-performance'` (desktop), `'default'` (mobile UA) | `?power=high-performance\|low-power\|default` |
| `adaptToDeviceRatio` | **`false`** | Documented only — manual hardware scaling owns DPR |

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

## Playwright / CI notes

- Screenshots use `page.screenshot()` (compositor capture) — **do not** require `preserveDrawingBuffer`.
- Force WebGL2: `http://localhost:5173/?renderer=webgl2`
- Verify bootstrap options: `window.bootstrapEngineOptions` exposed after load.
