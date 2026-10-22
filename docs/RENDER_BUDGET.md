# Render budget

Living record of where CPU frame time goes and what each render-perf change bought. It supersedes the
stale `docs/archive/LIGHTING_SHADOW_PP_AUDIT_REPORT.md` (2026-03) for performance questions.

Every number here comes from the opt-in harness below. **Nothing in CI gates on these numbers** —
SwiftShader timings are noisy; the harness is for before/after comparisons on one machine.

## How to measure

```bash
# 1. Record a labelled run (Chromium + SwiftShader, ?renderer=webgl2&debug=1&noopt=1, dev server started by Playwright)
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
| `PERF_STATES` | `menu,table,table3` | sampled in this order: `menu` first (`startGame()` leaves the menu for good), then `table` (one ball), then `table3` (two extra balls spawned on the same table) |
| `PERF_FRAMES` / `PERF_WARMUP` | `120` / `30` | measured / discarded frames per repeat and phase |
| `PERF_VIEWPORT` | `640x360` | browser viewport; small on purpose (see below) |
| `PERF_VERBOSE` | — | `1` logs frame progress every 10 s (spots a frame-rate collapse) |
| `PERF_REPEATS` | `3` | repeats are interleaved across tiers; the headline is the median of per-repeat medians |

What is recorded per tier × state (`tests/helpers/perf.ts`):

- `frameTimeMs` — CPU time of one `Game.renderFrame()` (includes the physics step, which runs inside `scene.render()`).
- `physicsStepMs` — time inside `physicsController.stepPhysics` for that frame.
- **`renderTimeMs` = frame − physics.** This is the number render slices (A, B) can move; the 30 % target is defined on it.
- `SceneInstrumentation` splits: `activeMeshesEvalMs`, `rttRenderMs` (shadow map / mirror / any RTT), `drawPhaseMs`.
- Counts: `drawCalls`, `activeMeshes`, `meshes`, `materials`, `lights`, `textures`, shadow casters, and (#443)
  `materialsFrozen` (materials whose `isFrozen` is true, of `materials`), `shadowRendersPerFrame` / `mirrorRendersPerFrame`
  (how often the key-light shadow map / the mirror texture rendered during the measured frames — multiply by the frame rate for
  renders per second; under SwiftShader the wall-clock frame rate is meaningless, so the per-frame figure is the one to quote)
  and `refreezeCount` (`StaticSceneGate.refreezeCount`; `n/a` on commits before the gate exists).
- `env`: physics engine, renderer, quality tier, post-process tier, GPU string.

### Caveats

- **SwiftShader numbers are CPU-bound main-thread frame times, not fps.** Under SwiftShader the render loop runs at only
  ~0.3–1 fps (more at 640×360 than at 1280×720) because *software rasterisation* is the bottleneck. That wall-clock rate says
  nothing about how the game would run on a GPU, so never quote or compare it. The metric that matters is the ~35–55 ms
  main-thread time per `renderFrame()`, split into render vs physics, together with the mesh, draw-call and material counts.
  The small default viewport only makes a run take tens of minutes instead of hours; it does not change that metric.
- **The harness boots with `?noopt=1` and silences the sustained-jank handler; do the same for any ad-hoc measurement.**
  The game runs a Babylon `SceneOptimizer` (target 55 fps, `GameRenderer.setupSceneOptimizer`). Software GL runs at 1–3 fps, so
  within seconds the optimizer has switched shadows, post-processes, particles and render targets off, halved the resolution and
  shrunk textures: every run would be measuring a degraded scene with **no shadow pass** (0 shadow renders per frame) and the
  shadow / mirror / prepass work could not show up at all. The jank handler would likewise drop the quality tier mid-run.
- **Table states are sampled after the `StaticSceneGate` settles** (`waitForStaticScene`, ~60 rendered frames after Start while the
  fog eases to its in-play values). Sampling earlier measures a thawed scene, not the steady state a player sits in; the JSON
  records `gateState`, `activeListFrozen` and `settleFrames` so a run that never settled is visible.
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

### #443 slices A + B — MEDIUM, WebGL2 (2026-10-22)

Chromium + SwiftShader on a 4-core container, `?renderer=webgl2&debug=1&noopt=1`, 640×360, quality tier forced to `medium`,
3 repeats × 60 measured frames (20 warm-up) per commit, physics engine `rapier` (this container has no `public/wasm`, so physics
is main-thread Rapier — **not comparable with the `wasm-worker` PR0 baseline above**, nor across machines). One checkout per
commit, run one after the other; the values are the median of the per-repeat medians, with the MAD in brackets. Scene counts
(draws 613, active 666 / 790, 257 materials) match PR0 at the base commit, so the scene is the same. Differences under ~1.5 ms on
the menu are inside the run-to-run spread.

**Menu**

| commit | change | renderTimeMs (MAD) | Δ vs base | active-mesh eval ms | draw calls | active / total meshes | frozen / total materials | shadow renders per frame | refreezes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `e8023f9` | base (before #443) | 15.7 (0.4) | — | 4.7 | 613 | 666 / 790 | 0 / 257 | 1.00 | n/a |
| `757d440` | B1+B5 one shadow technique per tier, dead RTTs gone | 15.7 (0.3) | 0% | 4.1 | 612 | 666 / 790 | 0 / 257 | 1.00 | n/a |
| `124f0ee` | B4 shared prepass (HIGH only; inert here) | 16.8 (0.9) | 7% | 4.8 | 612 | 666 / 790 | 0 / 257 | 1.00 | n/a |
| `8ce3b02` | B3 mirror list hygiene, refresh 2 | 17.5 (1.5) | 12% | 5.0 | 614 | 668 / 790 | 0 / 257 | 1.00 | n/a |
| `876aeb0` | A3 StaticSceneGate (hooks only, freezes nothing) | 16.7 (1.0) | 6% | 4.8 | 614 | 668 / 790 | 0 / 257 | 1.00 | 3 |
| `742680f` | A1 freeze unlit decor materials | 16.9 (1.4) | 8% | 5.1 | 612 | 666 / 790 | 22 / 257 | 1.00 | 3 |
| `acb6dea` | A2 decor merge + frozen active list + autoClear | 11.8 (0.4) | -25% | 0.0 | 651 | 716 / 773 | 12 / 247 | 1.00 | 1 |
| `8206c23` | A4a table pins as one thin-instance lattice | 12.4 (0.0) | -21% | 0.0 | 652 | 626 / 680 | 12 / 247 | 1.00 | 1 |
| `6391cfb` | A4b adventure pins as thin-instance lattices | 11.5 (0.5) | -27% | 0.0 | 652 | 626 / 680 | 12 / 247 | 1.00 | 1 |
| `7f7e7b3` | static-scene stack in its own chunk | 12.3 (0.3) | -22% | 0.0 | 652 | 626 / 680 | 12 / 247 | 1.00 | 1 |

**Table, idle (1 ball)**

| commit | change | renderTimeMs (MAD) | Δ vs base | active-mesh eval ms | draw calls | active / total meshes | frozen / total materials | shadow renders per frame | refreezes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `e8023f9` | base (before #443) | 21.7 (0.3) | — | 5.5 | 607 | 656 / 790 | 0 / 259 | 1.00 | n/a |
| `757d440` | B1+B5 one shadow technique per tier, dead RTTs gone | 21.5 (0.7) | -1% | 5.4 | 607 | 657 / 790 | 0 / 259 | 1.00 | n/a |
| `124f0ee` | B4 shared prepass (HIGH only; inert here) | 21.8 (0.7) | 1% | 5.8 | 604 | 654 / 790 | 0 / 259 | 1.00 | n/a |
| `8ce3b02` | B3 mirror list hygiene, refresh 2 | 22.4 (0.4) | 4% | 6.4 | 603 | 653 / 790 | 0 / 259 | 1.00 | n/a |
| `876aeb0` | A3 StaticSceneGate (hooks only, freezes nothing) | 21.1 (1.3) | -3% | 4.6 | 604 | 654 / 790 | 0 / 259 | 1.00 | 4 |
| `742680f` | A1 freeze unlit decor materials | 21.2 (0.4) | -2% | 5.1 | 608 | 658 / 790 | 22 / 259 | 1.00 | 14 |
| `acb6dea` | A2 decor merge + frozen active list + autoClear | 15.9 (1.6) | -27% | 0.0 | 651 | 716 / 773 | 12 / 249 | 1.00 | 12 |
| `8206c23` | A4a table pins as one thin-instance lattice | 15.6 (0.4) | -28% | 0.0 | 652 | 626 / 680 | 12 / 249 | 1.00 | 12 |
| `6391cfb` | A4b adventure pins as thin-instance lattices | 16.3 (1.3) | -25% | 0.0 | 652 | 626 / 680 | 12 / 249 | 1.00 | 12 |
| `7f7e7b3` | static-scene stack in its own chunk | 15.9 (0.3) | -26% | 0.0 | 652 | 626 / 680 | 12 / 249 | 1.00 | 13 |

**Table, 3 balls**

| commit | change | renderTimeMs (MAD) | Δ vs base | active-mesh eval ms | draw calls | active / total meshes | frozen / total materials | shadow renders per frame | refreezes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `e8023f9` | base (before #443) | 21.7 (2.9) | — | 5.3 | 607 | 656 / 790 | 0 / 262 | 1.00 | n/a |
| `757d440` | B1+B5 one shadow technique per tier, dead RTTs gone | 19.9 (1.5) | -8% | 5.3 | 607 | 657 / 790 | 0 / 262 | 1.00 | n/a |
| `124f0ee` | B4 shared prepass (HIGH only; inert here) | 21.0 (0.3) | -3% | 5.4 | 601 | 651 / 790 | 0 / 262 | 1.00 | n/a |
| `8ce3b02` | B3 mirror list hygiene, refresh 2 | 23.3 (3.0) | 7% | 5.7 | 603 | 653 / 790 | 0 / 262 | 1.00 | n/a |
| `876aeb0` | A3 StaticSceneGate (hooks only, freezes nothing) | 20.8 (0.5) | -4% | 5.4 | 603 | 653 / 790 | 0 / 262 | 1.00 | 7 |
| `742680f` | A1 freeze unlit decor materials | 22.9 (0.6) | 6% | 5.8 | 606 | 656 / 790 | 22 / 262 | 1.00 | 17 |
| `acb6dea` | A2 decor merge + frozen active list + autoClear | 13.8 (1.4) | -37% | 0.0 | 651 | 716 / 773 | 12 / 252 | 1.00 | 15 |
| `8206c23` | A4a table pins as one thin-instance lattice | 15.9 (0.5) | -27% | 0.0 | 652 | 626 / 680 | 12 / 252 | 1.00 | 15 |
| `6391cfb` | A4b adventure pins as thin-instance lattices | 14.7 (0.1) | -32% | 0.0 | 652 | 626 / 680 | 12 / 252 | 1.00 | 15 |
| `7f7e7b3` | static-scene stack in its own chunk | 16.1 (1.0) | -26% | 0.0 | 652 | 626 / 680 | 12 / 252 | 1.00 | 16 |

Replicate of the two ends (HEAD and base run again, same settings; pooled medians of all six repeat-medians):

| state | base `e8023f9` | `7f7e7b3` | Δ |
|---|---:|---:|---:|
| menu | 16.1 ms | 12.1 ms | **−25 %** |
| table, idle | 21.3 ms | 16.1 ms | **−25 %** |
| table, 3 balls | 21.0 ms | 16.2 ms | **−23 %** |

What this says:

- **A2's frozen active-mesh list is the entire CPU gain.** Active-mesh evaluation goes from 4.7–5.5 ms to 0 and render time drops
  by about the same amount (`acb6dea`). Nothing before it (B1, B3, B4, A3, A1) moves `renderTimeMs` outside the noise at MEDIUM,
  which is what those items are for: B1 and B4 act on HIGH (and heavy post is skipped on software GL), B3's mirror is never drawn
  (next point), A3 freezes nothing, and A1 freezes 12 of 247 materials (22 before the decor merge), too few to register here.
- **The mirror texture renders 0 times per frame at every commit, base included.** Babylon only renders a `MirrorTexture` that some
  active mesh's material references, and nothing here does. B3 keeps its render list from growing (asserted over 50 spawn/collect
  cycles and 3 cabinet swaps) and sets its refresh rate, but there is no mirror cost to save until a material uses it. Deleting the
  unused texture is the cleaner fix and is left as a decision.
- **Shadow renders stay at 1.00 per frame**: B2 (static + dynamic generators) is not implemented in this PR. The shadow pass costs
  ~0.8 ms of CPU per frame at MEDIUM here (`rttRenderMs`), so on this metric B2 can buy at most ~5 %; its case is GPU time.
- **Draw calls go up, 613 → 652 (+6 %).** A frozen list cannot depend on where the camera is aiming, so it is captured with frustum
  clipping off: off-screen meshes are submitted and clipped by the GPU. The freeze is declined when it would add more than 30 %
  (`MAX_OFFSCREEN_RATIO`); here it is 7 %. The draw phase grows by 0.2–0.8 ms against 5 ms of evaluation saved.
- **Thin-instanced pins do not reduce draw calls.** The per-pin `InstancedMesh`es were already one hardware-instanced draw per
  source mesh. What the lattice removes is ~93 scene nodes (773 → 680 meshes; the decor merge took 790 → 773) and everything
  per-node.
- `refreezes`: 1 on the menu; 11–16 over a table run (each ball spawn or collect and each fog settle thaws and refreezes once).
  The gate settles about 60 frames after Start and 1–2 frames on the menu.

### Answers to the issue's open questions

1. **PCF `QUALITY_MEDIUM` at 2048² on HIGH.** One constant (`COMMON.mapSize` in `src/game/shadow-config.ts`). A 1280×720 table
   screenshot at HIGH, base-equivalent (PCF `QUALITY_HIGH` on 4096²) against this branch (PCF `QUALITY_MEDIUM` on 2048²): mean
   absolute difference 1.4 / 255; the differing pixels sit on geometry edges (the camera re-aims between captures) and the debug
   HUD text, with no shadow-shaped difference. That is software-rendered at one size, not a substitute for a look on a real HIGH
   display; if a reviewer sees shimmer there, `mapSize: 4096` for the HIGH branch alone is a one-line change.
2. **≥ 30 % on SwiftShader.** Not reached: −25 / −25 / −23 % (menu / table / 3 balls) at MEDIUM with A + B as built, and the
   remaining 12–16 ms is the draw phase (~650 draws), which this PR does not reduce. These timings are main-thread JS plus GL command
   encoding, a fair CPU measure but not a GPU one, so the figure should be re-measured on real hardware rather than targeted.
   **WebGPU HIGH could not be recorded:** `?renderer=webgpu` on the SwiftShader adapter fails the `scene_critical` stage with
   `TypeError: engine.createDynamicTexture is not a function` (`StructuralMaterials.createLCDGridTexture`) — identically at the base
   commit, so it is not something this branch introduced. WebGL2 and WebGPU therefore need separate rows from a GPU machine.

## Bundle budget

`node scripts/check-bundle-size.mjs --print` reports `entryGzipKb` (the module script `index.html` boots) and
`initialJsGzipKb` (entry + every modulepreloaded chunk except `babylon-core`). The second number cannot be improved
by moving code into an eagerly loaded manual chunk such as `ui-overlays`.

| date | commit | entryGzipKb | initialJsGzipKb | precacheTotalKiB |
|---|---|---:|---:|---:|
| 2026-10-09 | working tree on `claude/441-residual-lifecycle-gaps` (dist built 2026-10-08) | 205.77 | 233.27 | 6239.74 |

#443 slices A + B, `entryGzipKb` per commit (the issue asks for no more than +1 KB over the base):

| commit | change | entryGzipKb | Δ vs base |
|---|---|---:|---:|
| `e8023f9` | base | 205.01 | — |
| `757d440` | B1+B5 | 205.12 | +0.11 |
| `124f0ee` | B4 | 205.21 | +0.20 |
| `8ce3b02` | B3 | 205.35 | +0.34 |
| `876aeb0` | A3 gate | 206.76 | +1.75 |
| `742680f` | A1 | 207.38 | +2.37 |
| `acb6dea` | A2 | 208.67 | +3.66 |
| `8206c23` | A4a | 209.33 | +4.32 |
| `6391cfb` | A4b | 209.30 | +4.29 |
| `7f7e7b3` | static-scene stack as its own chunk (`static-scene-install`, loaded during init) | 206.39 | **+1.38** |

The gate, the frozen-material set, the frozen active-mesh list and the skybox clear skip are now one dynamic chunk, so the entry
keeps only the call sites; what is left over the +1 KB is boot-time code (shadow / mirror tier resolution, the decor merge and the
allowlist registration, the pin-lattice builder, the HIGH prepass glue). `initialJsGzipKb` is 233.88 at `7f7e7b3`.
