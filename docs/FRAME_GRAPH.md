# Babylon Frame Graph

Status: **Slice A landed** (#461): the backbox is one Frame Graph composite. **Slice B landed**: scene
post-processing is a second Frame Graph (`src/game/scene-frame-graph.ts`), chosen node by node from
the tier decision in `webgpu-post-process-profile.ts`. `DefaultRenderingPipeline`,
`MinimalBloomPipeline`, and the separate SSAO2 / SSR / motion-blur pipelines are gone.

Version: `@babylonjs/core` and `@babylonjs/loaders` **`^9.30.0`** (locked at 9.30.0), bumped together
from `^7.54.3`. Babylon 9's typings rely on TypeScript 6's DOM lib for WebGPU types, so
`typescript` moved to `~6.0.3` (and `typescript-eslint` to a release that supports it) in the same
change. No runtime library was added.

## Spike: does a graph build on every backend?

Throwaway page, headless Chromium (SwiftShader), Babylon 9.30.0. Graph: clear → one
`FrameGraphObjectRendererTask` → one `FrameGraphCustomPostProcessTask` → an imported texture that a
scene plane samples; pixels read back and checked.

| Backend | Builds | Renders correct pixels | Notes |
|---|---|---|---|
| WebGPU `core` | yes | yes (GLSL and WGSL pass) | adapter reported `maxUniformBuffersPerShaderStage = 12` |
| WebGPU `compatibility` | yes | yes (GLSL and WGSL pass) | device without `core-features-and-limits`, `setMaximumLimits: false` |
| WebGL2 | yes | yes | |

So the graph **replaces** the old backbox path; it is not an opt-in beside it. The same three runs
are kept as `tests/backbox-frame-graph.spec.ts` (WebGL2 always; WebGPU `core` / `compatibility`
with `WEBGPU_CI=1`, because they need a WebGPU adapter in headless Chromium).

Headless SwiftShader note: WebGPU on SwiftShader loses its device as soon as a canvas presents
unless Chromium also gets `--use-vulkan=swiftshader`.

## Slice A: the backbox graph

`src/display/backbox-graph-plan.ts` decides which nodes exist (pure, unit-tested).
`src/display/backbox-frame-graph.ts` builds and runs them (lazily imported by `DisplaySystem`, so
the Frame Graph code stays out of the entry chunk).

```
backbox:clear → physical → grid → reels → video → image → character → lcd → [crt] → [jackpot | jackpotStill] → plane
```

| Node | Babylon class | Input → output |
|---|---|---|
| `backbox:clear` | `FrameGraphClearTextureTask` | → composite (opaque black) + depth |
| `backbox:<layer>` ×7 | `FrameGraphObjectRendererTask` | the layer's meshes, drawn over the composite through an orthographic backbox camera |
| `backbox:crt` | `FrameGraphCustomPostProcessTask` (`crtEffect`) | composite → composite |
| `backbox:jackpot` / `backbox:jackpotStill` | `FrameGraphCustomPostProcessTask` (`jackpotOverlay`) | composite → output |
| `backbox:output` | `FrameGraphCopyToTextureTask` | only when no effect pass exists |

- **Explicit order.** Every layer task draws into the same texture, in `BACKBOX_LAYER_ORDER`.
  Nothing depends on local-Z offsets or alpha sorting between layers any more. Only the physical
  layer (rotating drums) tests and writes depth; the flat layers draw over what is there.
- **Off the scene camera.** Layer meshes move to `BACKBOX_LAYER_MASK` (`0x10000000`), which the
  scene camera's default mask does not include. A mesh created later (the lazily loaded character
  take) is adopted on the next frame, and the static-scene gate is invalidated so a frozen
  active-mesh list cannot keep drawing it. If the graph fails to build, it hands every mesh back.
- **One plane.** The scene sees one `backboxComposite` plane (unlit, emissive = the composite) at
  `DISPLAY_LAYER_Z.COMPOSITE`. Layer colours go into the composite without image processing
  (`disableImageProcessing`), so the scene pipeline grades the plane once.
- **CPU work stays CPU work.** Canvas `DynamicTexture` uploads (LCD, reels, jackpot text) and video
  decode happen in each layer as before; a task only samples the result.
- **Execution.** The graph is not `scene.frameGraph`: it runs once per frame from
  `scene.onBeforeRenderObservable`, before the scene camera samples it. The scene post chain (Slice B)
  is a second graph of its own, run after the camera render; neither is `scene.frameGraph` (see below).

### CRT and jackpot are scoped to the glass

They used to be camera `PostProcess`es (`display-shader.ts`), so they scanned and flashed the
playfield too. They are now passes on the composite; the scene camera carries neither (the e2e
spec asserts this). `DisplayShaderLayer.getEffectPasses()` supplies their shaders, uniforms and
"active this frame" checks. A built pass that is not active this frame (`task.disabled`) copies its
input through unchanged, so toggling CRT or entering JACKPOT never rebuilds the graph.

### Which nodes exist

`planBackboxGraph(flags, tier, aspect)`:

| Condition | Effect nodes |
|---|---|
| default | `crt`, `jackpot` |
| reduced motion | `crt`, `jackpotStill` (frozen uniforms, one static text frame per phase) |
| photosensitive mode | none: CRT and jackpot are **left out**, not dimmed |
| `?nopp=1` | none: the composite and nothing else |

The flags come from `AccessibilityConfig` (`photosensitiveMode`, `reducedMotion`), passed in by
`DisplaySystem`; the graph module reads no settings itself. Reduced motion alone also caps
`flashFrequencyMax` at 1, which is why `photosensitiveMode` is now its own field. Changing either
in settings rebuilds the graph only if the node set changed. Composite size is per tier
(HIGH 1024, MEDIUM 768, LOW 512 wide, at the display's aspect).

On a software rasteriser (WebGL on SwiftShader: Chrome without GPU acceleration, and every CI
runner; `src/engine/software-rasterizer.ts`, the same check that keeps HIGH-only scene post off
there) the composite uses the LOW size whatever the tier and re-renders every
`SOFTWARE_FRAME_INTERVAL` (3) frames; the plane shows the last composite in between. The node set
is unchanged. Layer meshes are still adopted every frame, so the scene camera never draws one.

`DisplaySystem.getBackboxGraphInfo()` reports the plan, the built node list, which effect passes ran
on the last frame, and the omitted nodes with their reasons (debug HUD / e2e).

### Things this fixed on the way

- From the playfield camera (z = -21, looking +Z) the layer planes, all rotated π to face +Z, were
  back-face culled, and the opaque physical backdrop was the stack's *nearest* plane. Only the
  physical drums were visible. The composite plane faces the player.
- The LCD overlay uploaded its canvas with `update(false)`, unlike every other layer, so it was
  upside down relative to them. It now uses the default upload.
- The jackpot canvas was cleared and re-uploaded every frame outside JACKPOT; it is now cleared once
  on the way out.
- The unassigned `display` plane (default material) under the backbox root is gone.

### Not a layer: the border glow

`BackboxBorderGlow` lights the cabinet's `cabinetBackbox` frame mesh (emissive + fresnel rim during
FEVER). That mesh surrounds the glass in the scene; it is not something drawn on the glass, so it
stays a scene material.

## Slice B: the scene post chain as nodes

```
camera render ─▶ scene:render (HDR) ─▶ [ssao] ─▶ [ssr] ─▶ [motionBlur] ─▶ [bloom] ─▶ [imageProcessing] ─▶ [sharpen] ─▶ [fxaa] ─▶ canvas
                                          ▲ geometry pass (view depth, normal, reflectivity, velocity) feeds the first three
```

`src/game/scene-graph-plan.ts` decides which nodes exist (pure, unit-tested: `tests/scene-graph-plan.test.ts`).
`src/game/scene-frame-graph.ts` builds and runs them; `src/game/scene-heavy-nodes.ts` holds the HIGH-only ones.
`PostProcessManager` (`game-post-process.ts`) owns the plan: it re-plans on quality tier, accessibility
and runtime degrade, and keeps the graph in step. `ScenePostController` (`scene-post-controller.ts`) is the
knob surface `EffectsSystem` and the tiers write to (`BloomPipelineController`), kept as plain state so it
exists before the graph chunk loads.

| Node | Babylon task | Exists when (`planSceneGraph`) |
|---|---|---|
| `scene:render` | not a task: the scene camera's own render into an HDR `RenderTargetTexture`, imported | whenever a graph exists |
| `ssao` | `FrameGraphSSAO2RenderingPipelineTask` | tier `full`, HIGH, no reduced motion, `heavyAvailable` |
| `ssr` | `FrameGraphSSRRenderingPipelineTask` | same |
| `motionBlur` | `FrameGraphMotionBlurTask` | same |
| `bloom` | `FrameGraphBloomTask` | any tier but `none`; not reduced motion; effect intensity > 0 |
| `imageProcessing` | `FrameGraphImageProcessingTask` | tier `full` only. **Left out, not toggled off**, on a strict adapter |
| `sharpen` | `FrameGraphSharpenTask` | tier `full`, not reduced motion, not LOW |
| `fxaa` | `FrameGraphFXAATask` | tier `full`, and the scene target is **not** multisampled (LOW, or no MSAA) |

`?nopp=1` and tier `none` have no node at all: no graph exists and the camera renders straight to the canvas.
The vignette is a setting of the image-processing node (off under reduced motion, flashes included), not a node.
Photosensitive mode needs nothing here; it still only decides the backbox's CRT / jackpot nodes.
`heavyAvailable` is: not a software rasteriser (the same check as before), at least `HEAVY_POST_MIN_DRAW_BUFFERS`
(4, the geometry pass's attachments) draw buffers, and float render targets.

### Scene colour target: format, MSAA, SSAO cost (#488 §2–3)

- **Format.** `GpuCapabilities.hdrFormat` (`src/engine/gpu-capabilities.ts`): `rg11b10ufloat` where it is
  colour-renderable (WebGPU `rg11b10ufloat-renderable`, WebGL2 `EXT_color_buffer_float`) — 32 bits per pixel,
  half the bandwidth of RGBA16F — else `rgba16f`, `rgba32f`, `rgba8`. The packed format has no alpha; nothing
  reads the scene colour's alpha (the last pass writes an opaque canvas). The HIGH-only nodes keep their own
  targets at half float. `?hdr=rgba16f` pins a lower format for A/B comparisons. `getSceneGraphInfo().graph.format`.
- **Anti-aliasing.** The canvas is not multisampled any more (`antialias: false`, `?antialias=1` restores it):
  the camera never renders to it while a graph exists. MEDIUM and HIGH render the scene target with
  `SCENE_MSAA_SAMPLES` (4) and have **no** FXAA node; LOW (and a context without MSAA) has FXAA and 1 sample.
  The sample count is a setting of the one scene target (`plan.msaaSamples`), changed in place at the swap, so
  the render-pass id survives a tier change. Babylon's post-process tasks force their own outputs to 1 sample,
  so MSAA stops at the scene target. TAA is a later option once motion vectors exist.
- **SSAO.** Half resolution (`SSAO_RATIO` 0.5, blurred at full size) and `SSAO_SAMPLES` 16 on desktop / 8 on
  mobile (was 32 at full resolution).

### Why the scene render is not `scene.frameGraph`

The brief for this slice named "main scene render" as a node. Setting `scene.frameGraph` was read against
Babylon 9.30's source and rejected:

- `_renderWithFrameGraph` skips `_gatherRenderTargetsStage` and `_materialsRenderTargets`, so the key
  light's shadow map and the cabinet mirror (both gathered there) would stop being rendered.
- It sets `scene.activeCamera = null` every frame. `scene.pick`, `RenderStateWatcher`, adventure mode's
  camera swap, skybox auto-clear and `game-slot-adventure.ts` all read it.
- Its object renderer has its own active-mesh evaluation, so the frozen active-mesh list
  (`frozen-active-meshes.ts`, which drives `_activeMeshes` directly) would no longer apply.

So, like the backbox graph, this one is a graph of its own: the camera renders into a target
(`camera.outputRenderTarget`, the standard Babylon way to render a camera offscreen), and the graph imports
that target as `scene:render`, runs from `scene.onAfterRenderObservable`, and writes the canvas. Only
`game.tableCam` is post-processed, as before; any other active camera (adventure's follow camera) renders
straight to the canvas.

### Generations, and the one render target

A rebuild (a new node set, a new bloom scale, a new canvas size) compiles a **new generation** beside the
running one and swaps in one step, so a resize or a tier change never shows an unprocessed frame. Until the
first generation is ready, and while the scene optimizer has post-processing off, the camera renders to
the canvas. A canvas size must hold for `RESIZE_SETTLE_FRAMES` frames before a rebuild starts.

**The scene colour target is created once and lives as long as the graph.** A camera that renders into a
target renders with that target's render-pass id, and a material compiles one variant per pass id. The
first version made a target per generation: every rebuild then gave the camera a pass its materials had
never compiled for, the frozen active-mesh list never asked for them, and the scene went black and stayed
black (the node list, the frame counter and the logs all looked healthy). Now a resize builds the next
generation against a same-size staging texture and resizes the one target at the swap, re-pointing the
graph's imported handle; and the first frame with a render pass id the camera has not used yet thaws
`StaticSceneGate` (`onRenderPassChanged`). `tests/scene-frame-graph.spec.ts` asserts the render-pass id is
unchanged across rebuilds **and reads pixels**: a graph that builds and reports the right nodes proves nothing
about the frame it presents.

### HIGH-only nodes

One `FrameGraphGeometryRendererTask` (four colour attachments: view depth, view normal, reflectivity,
velocity) feeds SSAO, SSR and motion blur. The old chain shared the engine's prepass, which needed seven
attachments because it also carried the PBR sub-surface buffers; the graph's geometry pass does not, so no
prepass or legacy G-buffer is ever enabled (`render-hygiene.spec.ts` asserts that). The nodes run on linear HDR
colour before bloom and image processing (they used to run after tone mapping). Tuning is the old values;
SSR's automatic thickness needs a second, reverse-culled geometry pass, so SSR uses its fixed `thickness`.
The geometry pass compiles a variant of every material, so a HIGH generation can take minutes on a software
rasteriser (`HEAVY_READY_TIMEOUT_MS`); the running generation draws meanwhile.

**There is no depth-of-field node.** The old `DefaultRenderingPipeline` was built once at boot with automatic
rebuilds off, so the `depthOfFieldEnabled = true` that `applyQualityTier(HIGH)` set later never added the effect;
the built effect list (`bloom`, image processing, sharpen, FXAA) never contained it. Adding it now would be a
new look rather than a port (and at `focusDistance = 2500` on a camera about 30 units from the table it blurs the
whole playfield). `FrameGraphDepthOfFieldTask` is the node to add once someone tunes it.

### The cabinet grade the old pipeline never applied

`PostProcessManager.setup()` configured ACES tone mapping, contrast 1.1, a 0.4 vignette and colour curves
(hue 5, saturation 15) inside `if (fullBloom.imageProcessingEnabled && fullBloom.imageProcessing)`. The
pipeline was constructed with `automaticBuild = false`, so `imageProcessing` did not exist yet and the whole
block was skipped; it never ran. The shipped look is therefore no tone mapping, contrast 1, and a vignette
that only appears after a screen flash or a quality change. The image-processing node keeps those defaults
(`ScenePostImageProcessing`), so this change is not a visual one: a same-frame A/B on one live scene (the old
pipeline rebuilt beside the graph, the same knobs) differs by less than the graph differs from itself
between two renders (mean abs 0.10 against a 0.10 noise floor, in the default state; and 0.05 against 0.07
with strong bloom, a vignette and the ACES grade applied to both). If the grade is wanted, it is these
assignments on `controller.imageProcessingState` in `setup()`, and the graph already matches the old
pipeline when it is on:

```ts
ip.toneMappingEnabled = true; ip.toneMappingType = 1 /* ACES */; ip.contrast = 1.1
ip.vignetteWeight = 0.4; ip.colorCurvesEnabled = true  // plus colorCurves hue 5 / saturation 15 on the node
```

Expect the cabinet to look darker and more contrasty: the emissive palette was tuned by eye against the ungraded look.

### Debugging

`game.renderer.getSceneGraphInfo()` returns the plan (nodes, and every node left out with its reason), whether a
build is pending, the built node list (`scene:render` first), the generation counter, size and executed frame
count. `window.bootstrapGpuProbe.postProcessTier` is unchanged.

## Limits we degrade, and how the graph does it

| Limit / failure | Handled by | In the graph |
|---|---|---|
| `maxUniformBuffersPerShaderStage` < 17 (12 on many Windows adapters) | `webgpu-post-process-profile.ts` picks `full` / `bloom-only` / `none` (unchanged cut-off, so the same adapters get the same tier) | `planSceneGraph` leaves the image-processing node (and FXAA, sharpen, the HIGH-only nodes) **out** below `full`; the `bloom-only` graph is `scene:render → scene:bloom`. Nothing toggles flags on a monolithic pipeline |
| Runtime WebGPU validation error (uniform-buffer overflow) | `isUniformBufferLimitError` → `downgradePostProcessTier` → `none` | The manager re-plans at the lower tier (`none` has no node: the graph is disposed and the camera renders to the canvas). Recorded by the same `recordPostProcessTierDegrade('postprocess-tier-runtime', …)`, with the same `[Bootstrap][gpu-degrade]` marker |
| The graph fails to build (chunk fetch, shader, device) | `PostProcessManager.onGraphFailed` | Treated as tier `none`, recorded as `postprocess-tier-runtime` with the error as the reason, `game.postProcessDegraded = true`. A *rebuild* that fails keeps the running generation |
| WebGPU device creation | `create-engine.ts`: `core` + max limits → `compatibility` → WebGL2 (`ENGINE_BOOTSTRAP.md`) | Unchanged. Both graphs build on all three (spike above; `WEBGPU_CI=1` runs the scene graph spec on `core` and `compatibility`) |
| Optional WebGPU features (`float32-filterable`, `timestamp-query`, …) | `requiredFeatures: []`; checked at the point of use | A node that wants one checks `adapter.features` when the graph is built and falls back. **Never** add it to `requiredFeatures` (no node needs one today) |
| WebGL2 uniform blocks per stage | `materials/light-budget.ts` clamps per-material lights | Unchanged (a material limit, not a pass limit) |
| Too few draw buffers / no float render targets / software rasteriser | `heavyAvailable` | The HIGH-only nodes are left out (`heavy-unavailable`), `postProcessDegraded` is set, bloom and the grade stay |
| `?nopp=1` | `PostProcessManager.setup()` returns before any state exists | No graph, no controller; the backbox graph is the composite only |
| Reduced motion / photosensitive (`detectAccessibility()`) | `syncAccessibility()` re-plans (settings screen) and `applyQualityTier` re-plans (pause menu) | Reduced motion drops bloom, sharpen, the vignette and the HIGH-only nodes; photosensitive leaves the backbox CRT / jackpot nodes out, as in Slice A |
| `scene.postProcessesEnabled = false` (SceneOptimizer under load) | `Scene.postProcessesEnabled` | The camera renders to the canvas that frame and the graph does not run, as the camera post-processes did |

We do **not** probe and clamp limits (see `ENGINE_BOOTSTRAP.md`, "Why we don't probe-and-clamp"),
and the graph must not reintroduce that.

## Bundle

The 9.x bump alone took the `babylon-core` chunk from 665 to 937 KB gzip, almost all of it code
Babylon 9 loads lazily (`import()`): glTF extensions and their dependencies (Gaussian splatting,
OpenPBR, KHR_interactivity's FlowGraph, audio emitters) and per-shader chunks. Two changes put it
back under the 680 KB budget without raising it (570.9 KB at the time of the bump):

- `vite.config.ts` only pins **statically reachable** `@babylonjs/core` modules into `babylon-core`;
  lazily reached ones get their own chunks. Chunks reachable only through `@babylonjs/loaders`
  (itself not precached), or only through an `import()` made by Babylon's own audio engines (never
  run: `audioEngine: false`), are named `babylon-lazy-*` and kept out of the service-worker precache.
- `babylon-loaders` holds only the loader modules the app imports and their static imports (the
  glTF 2.0 loader and its extension registry, ~160 KB raw). The extensions it `import()`s on demand
  get chunks of their own, so the first cabinet load no longer downloads all of them (~670 KB).
- The cabinet loader imports the glTF 2.0 loader alone and registers the built-in extensions as
  lazy factories (`registerBuiltInGLTFExtensions()`), instead of the `@babylonjs/loaders/glTF`
  barrel that imports all of them. None of the cabinet / insert GLBs list an extension today.

### Slice B and the bundle

Both graphs are loaded through **one** lazy entry, `src/frame-graph-runtime.ts`. `DisplaySystem` and
`PostProcessManager` both `import()` it, so Rollup puts everything only the graphs reach (Babylon's
FrameGraph core, the tasks, the geometry renderer, both builders) into one `frame-graph-runtime` chunk
(163 KB raw, 35 KB gzip; it replaces `backbox-frame-graph`, 79 / 19 KB) instead of leaving a third, shared
chunk behind. The plan modules and the controller are in the entry chunk and import no Babylon runtime code
but `Color4`.

Dropping the static `DefaultRenderingPipeline` / SSAO2 / SSR / motion-blur / prepass imports made
`babylon-core` smaller (574 to 534 KB gzip). It also meant three small Babylon modules the frame-graph chunk
and the glTF loader share (`renderTargetTexture`, `multiRenderTarget.pure`, `meshBlendingTag`) were no longer
boot-reachable, so each became a shared chunk of its own and a new precache entry. `game-post-process.ts`
imports them statically to keep them in `babylon-core`, as the old prepass imports did.

Measured against the commit before Slice B: `entryGzipKb` 205.44 (205.43), `initialJsGzipKb` 234.25 (234.24),
`babylonCoreGzipKb` 533.7 (574.0), `precacheTotalKiB` 5534 (5758), 222 precache entries (248). The only
precached chunk name that is new is `frame-graph-runtime`. Shader chunks for features that no longer exist
(grain, chromatic aberration, circle of confusion, sub-surface scattering, the legacy prepass) dropped out.

## Gates for Slice B

1. `webgpu-post-process-profile.ts`'s tier decision is the single input to "which nodes exist"
   (`planSceneGraph`); no adapter limit is probed, `requiredLimits` is never set, `requiredFeatures` stays `[]`,
   `WebGPUEngine.CreateAsync` is not called, and `resolveEngineOptions()` is untouched.
2. `npx playwright test` (including the `?renderer=webgl2` runs and the screenshot specs
   `engine-bootstrap.spec.ts` / `verify_prism_core.spec.ts`), `npm run check:bundle`, and the degrade
   telemetry showing the same tiers on the same adapters as before.
3. `tests/scene-frame-graph.spec.ts` (WebGL2, and `WEBGPU_CI=1` for `core` / `compatibility`) asserts the nodes
   **and** that the presented frame is not black.

On a SwiftShader WebGPU adapter (`maxUniformBuffersPerShaderStage = 12`), both `core` and `compatibility` boot at
tier `bloom-only` with the graph `scene:render → scene:bloom`, exactly the tier the old pipeline picked there.

Known and not ours: on WebGPU `compatibility`, Babylon 9.30 never sets `textureBindingViewDimension`, so
every cube texture (the IBL environment) fails validation in `CreateBindGroup` (20 console warnings, then
Babylon stops logging). It is identical on the commit before Slice B.
