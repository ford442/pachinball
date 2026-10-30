/**
 * Which nodes the scene post-process Frame Graph has (#461 Slice B). Pure, so it unit-tests without
 * Babylon, like `planBackboxGraph()`.
 *
 * The tier decision in `webgpu-post-process-profile.ts` (`full` / `bloom-only` / `none`) is the one
 * input to "which nodes exist". The image-processing node is **left out** on a strict adapter
 * (`maxUniformBuffersPerShaderStage` < 17): `DefaultRenderingPipeline`'s image-processing pass binds
 * its whole uniform layout whatever its toggles say, so toggling flags on a pipeline cannot shrink
 * the bind group. A node that is not in the plan is not built, so it binds nothing.
 *
 *   [ssao] ─▶ [ssr] ─▶ [motionBlur] ─▶ [bloom] ─▶ [imageProcessing] ─▶ [sharpen] ─▶ [fxaa] ─▶ canvas
 *
 * - `?nopp=1` and tier `none` have no node at all: the scene camera renders straight to the canvas.
 * - Reduced motion drops bloom, sharpen, vignette and the HIGH-only passes.
 * - Photosensitive mode needs nothing here: it only decides the backbox's CRT / jackpot nodes
 *   (`backbox-graph-plan.ts`), as before.
 * - Anti-aliasing (#488 §3): the canvas is not multisampled. MEDIUM and HIGH render the scene
 *   colour target with 4× MSAA; FXAA is the LOW tier's anti-aliasing (and any context without MSAA).
 *
 * Nothing here reads accessibility or tier settings itself: the caller passes the flags in.
 */

import { QualityTier } from '../game-elements/visual-language'
import type { WebGPUPostProcessTier } from './webgpu-post-process-profile'

/** Execution order. The first three read the geometry pass and only exist on HIGH. */
export const SCENE_NODE_ORDER = [
  'ssao',
  'ssr',
  'motionBlur',
  'bloom',
  'imageProcessing',
  'sharpen',
  'fxaa',
] as const
export type SceneGraphNodeId = (typeof SCENE_NODE_ORDER)[number]

/** Nodes that need a geometry pass (depth / normals / reflectivity / velocity). */
export const SCENE_HEAVY_NODES: readonly SceneGraphNodeId[] = ['ssao', 'ssr', 'motionBlur']

/**
 * Colour attachments the shared geometry pass writes at most (view depth, view normal, reflectivity,
 * velocity). The old prepass needed seven, because it also carried the PBR sub-surface buffers; the
 * graph's geometry pass does not. A context with fewer draw buffers than this builds no heavy node.
 */
export const HEAVY_POST_MIN_DRAW_BUFFERS = 4

export type SceneNodeOmitReason =
  /** `?nopp=1`. */
  | 'nopp'
  /** The WebGPU tier is below what the node needs (adapter cap, or a runtime validation error). */
  | 'tier'
  | 'reduced-motion'
  /** Accessibility effect intensity is 0. */
  | 'effect-intensity'
  /** The quality tier is too low for the node. */
  | 'quality-tier'
  /** Software rasteriser, or too few draw buffers for the geometry pass. */
  | 'heavy-unavailable'
  /** FXAA is not needed: the scene colour target is multisampled. */
  | 'msaa'

export interface SceneGraphFlags {
  /** `resolveWebGPUPostProcessProfile().tier`, or the tier a runtime downgrade moved to. */
  tier: WebGPUPostProcessTier
  quality: QualityTier
  reducedMotion: boolean
  /** Accessibility effect intensity; 0 leaves bloom out. */
  effectIntensity: number
  /** `?nopp=1`. */
  noPostProcess: boolean
  /** The caller's verdict on the HIGH-only passes' prerequisites (not a software rasteriser, enough draw buffers). */
  heavyAvailable: boolean
  /** Largest MSAA sample count the context's render targets support (`GpuCapabilities.maxMsaaSamples`). */
  maxMsaaSamples: number
  /** Mobile device: the HIGH-only passes take their cheaper settings. */
  mobile: boolean
}

export interface SceneGraphPlan {
  tier: WebGPUPostProcessTier
  /** Execution order. Empty: no graph, the camera renders to the canvas. */
  nodes: readonly SceneGraphNodeId[]
  /** Every node that is not in `nodes`, and why (debug HUD, e2e assertions). */
  omitted: ReadonlyArray<{ node: SceneGraphNodeId; reason: SceneNodeOmitReason }>
  /** Vignette is a setting of the image-processing node, not a node: off under reduced motion. */
  vignette: boolean
  /** MSAA samples of the scene colour target (1 = none). */
  msaaSamples: number
  /** SSAO kernel samples (only read when the plan has `ssao`). */
  ssaoSamples: number
}

/** MSAA sample count on MEDIUM / HIGH when the context has it (WebGPU only knows 1 and 4). */
export const SCENE_MSAA_SAMPLES = 4

/** SSAO kernel per device class; it runs at half resolution (`SSAO_RATIO`) either way. */
export const SSAO_SAMPLES = { desktop: 16, mobile: 8 } as const
export const SSAO_RATIO = 0.5

/** Bloom knobs per quality tier: what `applyQualityTier` has always applied, in one place. */
export const BLOOM_QUALITY_PROFILE: Record<QualityTier, { kernel: number; scale: number; maxWeight: number }> = {
  [QualityTier.HIGH]: { kernel: 64, scale: 0.5, maxWeight: Number.POSITIVE_INFINITY },
  [QualityTier.MEDIUM]: { kernel: 32, scale: 0.35, maxWeight: 0.25 },
  [QualityTier.LOW]: { kernel: 16, scale: 0.2, maxWeight: 0.12 },
}

export function planSceneGraph(flags: SceneGraphFlags): SceneGraphPlan {
  const { tier, quality, reducedMotion } = flags
  const nodes: SceneGraphNodeId[] = []
  const omitted: Array<SceneGraphPlan['omitted'][number]> = []
  const skip = (node: SceneGraphNodeId, reason: SceneNodeOmitReason): void => {
    omitted.push({ node, reason })
  }

  const none = flags.noPostProcess ? 'nopp' : tier === 'none' ? 'tier' : null
  if (none) {
    for (const node of SCENE_NODE_ORDER) skip(node, none)
    return { tier, nodes, omitted, vignette: false, msaaSamples: 1, ssaoSamples: 0 }
  }

  // Only the full tier has the image-processing node; every other tier is bloom and nothing else.
  const full = tier === 'full'
  const msaaSamples =
    quality !== QualityTier.LOW && flags.maxMsaaSamples >= SCENE_MSAA_SAMPLES ? SCENE_MSAA_SAMPLES : 1

  for (const node of SCENE_NODE_ORDER) {
    switch (node) {
      case 'ssao':
      case 'ssr':
      case 'motionBlur':
        if (!full) skip(node, 'tier')
        else if (quality !== QualityTier.HIGH) skip(node, 'quality-tier')
        else if (reducedMotion) skip(node, 'reduced-motion')
        else if (!flags.heavyAvailable) skip(node, 'heavy-unavailable')
        else nodes.push(node)
        break
      case 'bloom':
        if (reducedMotion) skip(node, 'reduced-motion')
        else if (!(flags.effectIntensity > 0)) skip(node, 'effect-intensity')
        else nodes.push(node)
        break
      case 'imageProcessing':
        if (full) nodes.push(node)
        else skip(node, 'tier')
        break
      case 'fxaa':
        if (!full) skip(node, 'tier')
        else if (msaaSamples > 1) skip(node, 'msaa')
        else nodes.push(node)
        break
      case 'sharpen':
        if (!full) skip(node, 'tier')
        else if (reducedMotion) skip(node, 'reduced-motion')
        else if (quality === QualityTier.LOW) skip(node, 'quality-tier')
        else nodes.push(node)
        break
    }
  }

  // Nothing to multisample into without a graph: the camera renders straight to the canvas.
  return {
    tier,
    nodes,
    omitted,
    vignette: nodes.includes('imageProcessing') && !reducedMotion,
    msaaSamples: nodes.length > 0 ? msaaSamples : 1,
    ssaoSamples: nodes.includes('ssao') ? (flags.mobile ? SSAO_SAMPLES.mobile : SSAO_SAMPLES.desktop) : 0,
  }
}

/**
 * True when two plans build the same graph: no rebuild needed. The vignette is a setting of an
 * existing node, so it is not compared; the MSAA sample count is a setting of the scene colour
 * target, but a rebuild is where the target is changed, so it is.
 */
export function sameSceneGraph(a: SceneGraphPlan, b: SceneGraphPlan): boolean {
  return a.nodes.join() === b.nodes.join() && a.msaaSamples === b.msaaSamples && a.ssaoSamples === b.ssaoSamples
}
