# Babylon Frame Graph — scoping (no upgrade)

Status: **scoping only** (#424 Slice D). `@babylonjs/core` stays at `^7.54.3`.
Frame Graph arrives with the v8/v9 line, so adopting it means a major
dependency bump. That bump is **not** part of #424. It needs its own issue,
filed after the P0 physics work, with the checklist at the end of this page as
its acceptance criteria.

This page records what would become a graph node, and which WebGPU/WebGL2
limits we already degrade around, so that issue starts from facts rather than
a rewrite. Check Babylon API names against the version actually chosen at bump
time. Nothing below depends on a specific class name.

## What we compose by hand today

The backbox is a stack of world-space planes under one `TransformNode`,
separated by small local-Z offsets (`src/display/display-layer-depth.ts`).
Each plane is its own mesh, material and blend:

| Layer (back → front) | Z | Source | Producer |
|---|---|---|---|
| Physical drums / static art | -0.65 | meshes | `display-physical.ts` |
| Cyber-grid background | -0.50 | `ShaderMaterial` plane | `display-shader.ts` |
| Reels | -0.32 | WGSL shader on WebGPU, canvas `DynamicTexture` fallback | `display-reels.ts` |
| Main video | +0.08 | `VideoTexture` | `display-video.ts` |
| Main image | +0.12 | `Texture` | `display-image.ts` |
| LCD overlay (REACH text, walk-bys, fever sparks) | +0.38 | canvas `DynamicTexture` | `display-lcd-overlay.ts` |
| Border glow | — | mesh | `display-border-glow.ts` |

On top of that:

- **CRT** and **jackpot** effects are camera `PostProcess`es
  (`display-shader.ts`, attached and detached on state change). They run
  full-screen, so they hit the playfield as well as the backbox.
- **Scene post-processing** (`src/game/game-post-process.ts`):
  `DefaultRenderingPipeline` (bloom, FXAA, tone-map, image processing) or
  `MinimalBloomPipeline`, plus HIGH-tier SSAO2, SSR, depth of field and motion blur.
- **Render targets**: `tableRenderTarget` / `headRenderTarget`
  (`game-renderer.ts`), a `MirrorTexture`, and the shadow generator.

Four to five alpha-blended planes plus two full-screen passes is the "compose
four planes by hand" the #424 vision wants to retire.

## Candidate graph nodes

| Node | Inputs → output | Replaces | Why |
|---|---|---|---|
| Backbox layer tasks (physical, grid, reels, video/image, LCD, *character*) | per-layer sources → one texture each | the Z-offset plane stack | Explicit ordering instead of depth offsets and blend order, and one place to drop a layer on a low tier |
| Backbox composite | layer textures → one backbox texture | 4–5 blended planes | One textured plane in the 3D scene; overdraw and sorting problems go away |
| CRT pass | backbox texture → backbox texture | full-screen camera `PostProcess` | Scopes CRT to the backbox, which is what it was meant to hit |
| Jackpot pass | backbox texture → backbox texture | full-screen camera `PostProcess` | Same. Also a clean place to honour the photosensitive flag, which this pass ignores today |
| Main scene render | scene → HDR colour + depth | implicit camera render | The root the post chain hangs off |
| Table / head RTTs | scene subsets → textures | `tableRenderTarget` / `headRenderTarget` | Declared dependencies instead of render-order conventions |
| Bloom | HDR colour → colour | pipeline bloom stage | Kept on every tier except `none` |
| Image processing (tone-map, curves, vignette) | colour → colour | `DefaultRenderingPipeline` image-processing pass | Becomes a separate, **omittable** node. See the uniform-buffer note below |
| FXAA / sharpen | colour → colour | pipeline stages | Tier-gated nodes |
| SSAO / SSR / DoF / motion blur | depth (+ normals) → colour | HIGH-only pipelines | HIGH-only nodes, built only when the tier allows |

Slice B's character layer (REACH/FEVER sprites) should land as a normal
display layer now, and becomes one more backbox layer task under the graph.

**Stays outside the graph:** canvas drawing for the LCD and reels
(`DynamicTexture` uploads are CPU work, and a node only samples the result),
video decode, physics, input and audio.

## Limits we already degrade (must survive the migration)

| Limit / failure | Where it is handled today | Graph-era equivalent |
|---|---|---|
| `maxUniformBuffersPerShaderStage` < 17 (12 on many Windows adapters) | `webgpu-post-process-profile.ts` picks `full` / `bloom-only` / `none`; `DefaultRenderingPipeline`'s image-processing pass binds its full layout even with toggles off, so strict adapters skip it | Leave the image-processing node **out** of the graph on those adapters, rather than toggling flags on a monolithic pipeline |
| Runtime WebGPU validation error (uniform-buffer overflow) | `isUniformBufferLimitError` → `downgradePostProcessTier` → `none` | Rebuild the graph at the lower tier. Record it through the same `recordPostProcessTierDegrade` telemetry |
| WebGPU device creation | `create-engine.ts`: `core` + max limits → `compatibility` → WebGL2 (`ENGINE_BOOTSTRAP.md`) | Unchanged. The graph has to build on all three |
| Optional WebGPU features (`float32-filterable`, `timestamp-query`, …) | `requiredFeatures: []`; checked at the point of use | A node that wants a feature checks `adapter.features` when the graph is built and falls back. **Never** add it to `requiredFeatures` |
| WebGL2 uniform blocks per stage | `materials/light-budget.ts` clamps per-material lights | Unchanged (a material limit, not a pass limit), but re-verify after the glTF loader in the new version |
| DoF / SSAO failing validation | try/catch → bloom-only, `game.postProcessDegraded` | That node is simply not added |
| `?nopp=1` | skips all post-processing | Graph with only the scene render and the backbox composite |
| Reduced motion / photosensitive (`detectAccessibility()`) | reduced motion turns sharpen and vignette off; photosensitive damps the LCD overlay's REACH/JACKPOT pulses (`display-lcd-overlay.ts`). The CRT and jackpot post-processes are **not** gated today | Tier and accessibility pick the node set, which also closes the gap: the jackpot and CRT flicker nodes are left out for photosensitive players |

We do **not** probe and clamp limits (see `ENGINE_BOOTSTRAP.md`, "Why we don't
probe-and-clamp"), and the graph must not reintroduce that.

## Before anyone bumps the dependency

1. File a separate issue. It is gated on the P0s, as #424 is.
2. Confirm Frame Graph builds on WebGPU `core`, WebGPU `compatibility` **and**
   WebGL2 in the chosen version. Otherwise it can only be an opt-in path next
   to the current one.
3. Keep the existing `webgpu-post-process-profile.ts` tier decision as the
   single input to "which nodes exist".
4. Migrate the backbox first (self-contained, visible win), then scene post.
5. Gates: `npx playwright test` (including the `?renderer=webgl2` runs and
   the screenshot specs `engine-bootstrap.spec.ts` / `verify_prism_core.spec.ts`),
   `npm run check:bundle`, and the degrade telemetry showing the same tiers on
   the same adapters as before.
