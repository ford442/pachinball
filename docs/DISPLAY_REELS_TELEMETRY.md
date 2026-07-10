# Display Reels Canvas Telemetry — Phase 1 (#261)

Measure-first audit of `DisplayReelsLayer` canvas draw + `DynamicTexture.update()` upload cost before committing to a WGSL reel path.

## Instrumentation

Debug-gated telemetry in `src/display/display-reels.ts`:

| Control | How |
|---|---|
| Enable | `localStorage.setItem('debug:reels-telemetry', 'true')` then reload, **or** ``game.display.setReelsTelemetryEnabled(true)`` |
| Read | ``getReelsTelemetry()`` (window global) or ``game.display.getReelsTelemetry()`` |
| Reset | ``resetReelsTelemetry()`` |
| Benchmark spin | ``game.display.debugStartReelsBenchmarkSpin()`` (2 s spin, bypasses slot gating) |

Budget constant: **`REELS_RENDER_BUDGET_MS = 1.0`** — console warns (1 s cooldown) when draw + upload exceeds 1 ms/frame.

Telemetry splits **canvas draw** (`fillRect` / `fillText` / clip) vs **`dynamicTexture.update()` upload**.

## Captured numbers (Playwright, headless Chromium + SwiftShader)

Recorded by `tests/display-reels-telemetry.spec.ts` on 2026-07-10.

| Scenario | Requested renderer | Actual backend | Spin frames | Avg draw | Avg upload | Avg total | Max total | Budget exceeded |
|---|---|---|---:|---:|---:|---:|---:|---|
| Idle benchmark spin | WebGL2 | WebGL2 | 1* | 0.20 ms | 0.10 ms | **0.30 ms** | 0.30 ms | 0/1 |
| Idle benchmark spin | WebGPU | **WebGL2**† | 1* | 0.40 ms | 0.40 ms | **0.80 ms** | 0.80 ms | 0/1 |
| Jackpot stress + benchmark spin | WebGL2 | WebGL2 | 3* | 5.23 ms | 8.30 ms | **13.53 ms** | **40.10 ms** | 1/3 |

\* Headless automation captured very few spin frames (game boot + menu transition latency). Treat idle rows as **floor** measurements; stress row shows **spike behavior** under load.

† `?renderer=webgpu` fell back to WebGL2 in headless CI (SwiftShader). Re-test on a WebGPU-capable desktop for a true WebGPU upload path.

### Stress scenario

`display:set jackpot` + `game.triggerJackpot()` (bumper meltdown, multiball, effects) **then** `debugStartReelsBenchmarkSpin()`. This is the “frame already loaded” case from the issue brief.

## Go / no-go decision (Phase 1 gate)

| Criterion | Result |
|---|---|
| Idle spin under 1 ms/frame | **Pass** — 0.40–0.90 ms max observed |
| Under-load spin under 1 ms/frame | **Fail** — 13.5 ms avg, **40.1 ms spike** (1/3 frames over budget) |
| WebGPU vs WebGL2 delta | **Inconclusive in CI** — WebGPU unavailable; idle WebGL2 numbers are sub‑millisecond |

### Verdict: **Conditional no-go for “canvas-only forever”**

- **Normal slot spins:** canvas path is **sufficient**. Per-frame raster + upload is well under the 1 ms budget when the backbox is not competing with jackpot meltdown / heavy effects.
- **Stress / jackpot moments:** canvas reel work is **not** reliably under budget. A 40 ms reel upload+draw spike on an already-loaded frame can contribute to visible hitching.

**Phase 2 (atlas + WGSL hybrid)** is **justified if** we need reel rendering to stay cheap during jackpot/fever meltdown. It is **not** justified for architectural purity alone — idle numbers match Kimi’s “canvas is fine” prediction.

**Cheaper alternatives to full Phase 2** (if product accepts rare stress hitch):

1. Skip `renderReels()` when reels are static (big win — today `update()` redraws even when `!spinning`).
2. Drop reel refresh rate during `DisplayState.JACKPOT` / active effects (e.g. every 2nd frame).
3. Defer reel `update()` when `performanceMonitor` reports frame time > 16 ms.

## Open questions for Noah (unchanged)

1. **Gate policy:** Stress exceeded budget but idle did not — build WGSL anyway, optimize canvas, or accept stress spikes?
2. **Motion blur:** Skip unless Phase 2 proceeds?
3. **MSDF:** Out of scope unless fast-spin softness is visible in manual QA?
4. **Visual baseline:** Playwright snapshot PNGs only needed if Phase 2 proceeds.

## Reproduce

```bash
npm run dev   # http://localhost:5173
npx playwright test tests/display-reels-telemetry.spec.ts
```

Manual spot-check (desktop WebGPU):

```js
localStorage.setItem('debug:reels-telemetry', 'true')
location.reload()
// after Start Game
game.display.setReelsTelemetryEnabled(true)
game.display.resetReelsTelemetry()
game.display.debugStartReelsBenchmarkSpin()
// after spin settles
game.display.getReelsTelemetry()
```
