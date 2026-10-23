# Babylon Frame Graph

Status: **Slice A landed** (#461): the backbox is one Frame Graph composite. **Slice B** (scene
post-processing as graph nodes) is not started; the scene still renders through its camera and
`DefaultRenderingPipeline` / `MinimalBloomPipeline` (`src/game/game-post-process.ts`).

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
  `scene.onBeforeRenderObservable`, before the scene camera samples it. Moving the scene render into a
  graph is Slice B.

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

## Slice B: scene post as nodes (not started)

| Node | Inputs → output | Replaces | Why |
|---|---|---|---|
| Main scene render | scene → HDR colour + depth | implicit camera render | The root the post chain hangs off |
| Bloom | HDR colour → colour | pipeline bloom stage | Kept on every tier except `none` |
| Image processing (tone-map, curves, vignette) | colour → colour | `DefaultRenderingPipeline` image-processing pass | A separate, **omittable** node. See the uniform-buffer note below |
| FXAA / sharpen | colour → colour | pipeline stages | Tier-gated nodes |
| SSAO / SSR / DoF / motion blur | depth (+ normals) → colour | HIGH-only pipelines | HIGH-only nodes, built only when the tier allows |

Babylon 9 has a task for each of these (`FrameGraphBloomTask`, `FrameGraphImageProcessingTask`,
`FrameGraphFXAATask`, `FrameGraphSharpenTask`, `FrameGraphSSAO2RenderingPipelineTask`,
`FrameGraphSSRRenderingPipelineTask`, `FrameGraphDepthOfFieldTask`, `FrameGraphMotionBlurTask`).
`tableRenderTarget` / `headRenderTarget` were already removed in #443.

## Limits we already degrade (must survive Slice B)

| Limit / failure | Where it is handled today | Graph-era equivalent |
|---|---|---|
| `maxUniformBuffersPerShaderStage` < 17 (12 on many Windows adapters) | `webgpu-post-process-profile.ts` picks `full` / `bloom-only` / `none`; `DefaultRenderingPipeline`'s image-processing pass binds its full layout even with toggles off, so strict adapters skip it | Leave the image-processing node **out** of the graph on those adapters, rather than toggling flags on a monolithic pipeline |
| Runtime WebGPU validation error (uniform-buffer overflow) | `isUniformBufferLimitError` → `downgradePostProcessTier` → `none` | Rebuild the graph at the lower tier. Record it through the same `recordPostProcessTierDegrade` telemetry |
| WebGPU device creation | `create-engine.ts`: `core` + max limits → `compatibility` → WebGL2 (`ENGINE_BOOTSTRAP.md`) | Unchanged. The backbox graph builds on all three (spike above) |
| Optional WebGPU features (`float32-filterable`, `timestamp-query`, …) | `requiredFeatures: []`; checked at the point of use | A node that wants a feature checks `adapter.features` when the graph is built and falls back. **Never** add it to `requiredFeatures` |
| WebGL2 uniform blocks per stage | `materials/light-budget.ts` clamps per-material lights | Unchanged (a material limit, not a pass limit) |
| DoF / SSAO failing validation | try/catch → bloom-only, `game.postProcessDegraded` | That node is simply not added |
| `?nopp=1` | skips all scene post-processing; the backbox graph is the composite only | Graph with only the scene render and the backbox composite |
| Reduced motion / photosensitive (`detectAccessibility()`) | reduced motion turns sharpen and vignette off; photosensitive damps the LCD overlay's REACH/JACKPOT pulses and leaves the backbox CRT / jackpot nodes out | Tier and accessibility pick the node set |

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

## Gates for Slice B

1. Keep `webgpu-post-process-profile.ts`'s tier decision as the single input to "which nodes exist".
2. `npx playwright test` (including the `?renderer=webgl2` runs and the screenshot specs
   `engine-bootstrap.spec.ts` / `verify_prism_core.spec.ts`), `npm run check:bundle`, and the degrade
   telemetry showing the same tiers on the same adapters as before.
