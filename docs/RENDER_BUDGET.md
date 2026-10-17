# Render budget

Living record of where CPU frame time goes and what each render-perf change bought. It supersedes the
stale `docs/archive/LIGHTING_SHADOW_PP_AUDIT_REPORT.md` (2026-03) for performance questions.

Every number here comes from the opt-in harness below. **Nothing in CI gates on these numbers** —
SwiftShader timings are noisy; the harness is for before/after comparisons on one machine.

## How to measure

```bash
# 1. Record a labelled run (Chromium + SwiftShader, ?renderer=webgl2&debug=1, dev server started by Playwright)
PERF_LABEL=before PERF_TIERS=low,medium,high npm run perf:baseline

# 2. ...make the change, then record again
PERF_LABEL=after  PERF_TIERS=low,medium,high npm run perf:baseline

# 3. Paste the table below
npm run perf:compare -- before after
```

| Env var | Default | Meaning |
|---|---|---|
| `PERF_BASELINE` | — | must be `1` or the spec skips (set by `npm run perf:baseline`) |
| `PERF_LABEL` | `baseline` | prefix of `test-results/perf/<label>-<tier>-<state>.json` |
| `PERF_TIERS` | `medium` | comma list of `low,medium,high` (MEDIUM is the acceptance tier) |
| `PERF_STATES` | `menu,table` | `menu` is sampled before `table` (`startGame()` leaves the menu) |
| `PERF_FRAMES` / `PERF_WARMUP` | `120` / `30` | measured / discarded frames per repeat and phase |
| `PERF_VIEWPORT` | `640x360` | browser viewport; small on purpose (see below) |
| `PERF_VERBOSE` | — | `1` logs frame progress every 10 s (spots a frame-rate collapse) |
| `PERF_REPEATS` | `3` | repeats are interleaved across tiers; the headline is the median of per-repeat medians |

What is recorded per tier × state (`tests/helpers/perf.ts`):

- `frameTimeMs` — CPU time of one `Game.renderFrame()` (includes the physics step, which runs inside `scene.render()`).
- `physicsStepMs` — time inside `physicsController.stepPhysics` for that frame.
- **`renderTimeMs` = frame − physics.** This is the number render slices (A, B) can move; the 30 % target is defined on it.
- `SceneInstrumentation` splits: `activeMeshesEvalMs`, `rttRenderMs` (shadow map / mirror / any RTT), `drawPhaseMs`.
- Counts: `drawCalls`, `activeMeshes`, `meshes`, `materials`, `lights`, `textures`, shadow casters.
- `env`: physics engine, renderer, quality tier, post-process tier, GPU string.

### Caveats

- **SwiftShader numbers are CPU-bound main-thread frame times, not fps.** Under SwiftShader the render loop runs at only
  ~0.3–1 fps (more at 640×360 than at 1280×720) because *software rasterisation* is the bottleneck. That wall-clock rate says
  nothing about how the game would run on a GPU, so never quote or compare it. The metric that matters is the ~35–55 ms
  main-thread time per `renderFrame()`, split into render vs physics, together with the mesh, draw-call and material counts.
  The small default viewport only makes a run take tens of minutes instead of hours; it does not change that metric.
- **Never compare runs with different `env.physicsEngine`.** CI/dev boxes without `public/wasm` fall back to
  main-thread Rapier, which dominates frame time and hides render changes. `perf:compare` warns on a mismatch.
- **Tier coverage.** LOW and MEDIUM are fully measurable in CI. HIGH under SwiftShader is "HIGH shadows/materials
  but no heavy post" (SSAO2/SSR/MotionBlur/DoF are forced off on software rendering). True HIGH is manual on a
  real GPU (DevTools Performance trace, plus the GPU-time HUD once `?gpuTiming=1` lands).
- A CDP `Profiler` self-time breakdown is the tie-breaker for "is this item worth shipping" (see the gate rule in the plan).
- **WebGPU in CI is feasible.** `WEBGPU_CI=1 npx playwright test tests/webgpu-probe.spec.ts --project=chromium` passed on
  2026-10-09: headless Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan --use-webgpu-adapter=swiftshader
  --use-angle=swiftshader --disable-vulkan-surface` (own browser launch, `channel: 'chromium'`) returns an adapter and device
  (`vendor: google`, `architecture: swiftshader`, `isFallbackAdapter: true`, `timestamp-query` available). The default
  Playwright project does **not** pass those flags, so WebGPU specs need a dedicated project with the full flag set
  (project-level `launchOptions.args` replace, not merge). `isFallbackAdapter: true` is also what the heavy-post
  software-rendering gate must key off on WebGPU.

## Targets

- Slices A + B together: ≥ 30 % lower median `renderTimeMs` at **MEDIUM**, menu and table scored separately.
  This is a hypothesis, not a promise — expected A+B gain is 10–25 %. Record the real number below; do not force
  items in to hit 30 %.

## Results

### PR0 baseline — MEDIUM, working tree before any render slice (2026-10-09)

Label `pr0-baseline`; Chromium + SwiftShader (CPU-bound main-thread timings, not fps), `?renderer=webgl2&debug=1`, 640×360 viewport, 3 repeats × 120 measured
frames (30 warm-up), physics engine `wasm-worker`, quality tier forced to `medium` (post-process tier `full`).
Working tree = `claude/441-residual-lifecycle-gaps` with uncommitted lifecycle work. Median of per-repeat medians (MAD).

| state | renderTimeMs | frameTimeMs | physicsStepMs | activeMeshesEvalMs | rttRenderMs | drawPhaseMs |
|---|---:|---:|---:|---:|---:|---:|
| menu | 35.06 (2.13) | 35.32 (2.45) | 0.22 | 10.87 (0.21) | 1.28 (0.19) | 21.17 (0.99) |
| table | 34.22 (0.45) | 45.09 (0.29) | 8.25 (0.43) | 9.90 (0.01) | 1.40 (0.03) | 21.02 (0.33) |

| state | drawCalls | activeMeshes / meshes | materials | lights | shadow casters |
|---|---:|---:|---:|---:|---:|
| menu | 614 | 667 / 790 | 257 | 26 | 32 |
| table | 607 | 656 / 790 | 259 | 26 | 32 |

What this says (indicative — one machine, SwiftShader; re-measure after each slice before acting on it):

- **The scene size is the solid finding:** ~790 meshes, ~610 draw calls and ~260 materials, far heavier than the issue's
  "~127 materials / ~300 pins". That is why thin-instanced pins and a static freeze are the right later slices.
- **Active-mesh evaluation is ~29–31 % of render time** (≈10 of ≈34–35 ms) in this 3-repeat run (an earlier single-repeat
  smoke showed 8.6 of 35 ms; treat that one as smoke only). It is above the plan's 20 % threshold for *considering* the opt-in
  `?freezeMeshes=1` experiment (A4), but that is a hypothesis, not a decision: re-measure after thin-instanced pins and the
  decor merge land, and decide from the profile then.
- The draw phase is ~61 % of render time, so draw-call count is the lever for slice A.
- Shadow/RTT passes are small on the CPU side (~1.3–1.4 ms), so expect little `renderTimeMs` movement from slice B's
  shadow work; its value is GPU cost and correctness.
- Run-to-run spread is small on `table` (MAD 0.45 ms) and larger on `menu` (MAD 2.13 ms; per-repeat medians 31.7 / 35.1 / 37.2),
  so treat sub-5 % differences on `menu` as noise.

### Per-slice results

_One section per change (label, date, machine, physics engine) goes here, with the `perf:compare` table._

## Bundle budget

`node scripts/check-bundle-size.mjs --print` reports `entryGzipKb` (the module script `index.html` boots) and
`initialJsGzipKb` (entry + every modulepreloaded chunk except `babylon-core`). The second number cannot be improved
by moving code into an eagerly loaded manual chunk such as `ui-overlays`.

| date | commit | entryGzipKb | initialJsGzipKb | precacheTotalKiB |
|---|---|---:|---:|---:|
| 2026-10-09 | working tree on `claude/441-residual-lifecycle-gaps` (dist built 2026-10-08) | 205.77 | 233.27 | 6239.74 |
