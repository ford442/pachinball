/**
 * Which nodes the backbox Frame Graph has (#461 Slice A). Pure, so it unit-tests without Babylon.
 *
 * The backbox is one composite: one render task per layer, drawn back → front into one texture in
 * this explicit order, then the effect passes, then one textured plane in the scene. The order is
 * the contract that replaces the old local-Z offsets and alpha sorting (display-layer-depth.ts).
 *
 * The effect passes are chosen here, not toggled later:
 *   - `?nopp=1` builds the composite and nothing else (no CRT, no jackpot pass);
 *   - photosensitive mode leaves out both the CRT and the jackpot pass;
 *   - reduced motion replaces the animated jackpot pass with a still one.
 * Whether a built pass runs on a given frame (CRT switched off by the player, no jackpot in progress)
 * is a per-frame toggle in backbox-frame-graph.ts, which passes its input through unchanged.
 */

import { QualityTier } from '../game-elements/visual-language'

/** Back → front. A task per id, drawn in exactly this order. */
export const BACKBOX_LAYER_ORDER = ['physical', 'grid', 'reels', 'video', 'image', 'character', 'lcd'] as const
export type BackboxLayerId = (typeof BACKBOX_LAYER_ORDER)[number]

/** Effect passes on the composite, in execution order. */
export type BackboxEffectNode = 'crt' | 'jackpot' | 'jackpotStill'

export interface BackboxGraphFlags {
  /** The player turned photosensitive mode on: no CRT flicker, no jackpot flash. */
  photosensitive: boolean
  /** Reduced motion: the jackpot pass is a still. */
  reducedMotion: boolean
  /** `?nopp=1`: composite only. */
  noPostProcess: boolean
}

export interface BackboxGraphPlan {
  layers: readonly BackboxLayerId[]
  effects: readonly BackboxEffectNode[]
  /** Nodes deliberately left out and why (debug HUD, e2e assertions). */
  omitted: ReadonlyArray<{ node: BackboxEffectNode; reason: 'nopp' | 'photosensitive' | 'reduced-motion' }>
  /** Composite texture size in pixels. */
  width: number
  height: number
}

/**
 * Composite width per tier. Height follows the display's aspect ratio. The backbox covers well
 * under half the screen width from the cabinet camera, and every layer pass loads and stores the
 * whole composite, which is real work on a software rasteriser (SwiftShader, the WebGL2 fallback).
 */
const COMPOSITE_WIDTH: Record<QualityTier, number> = {
  [QualityTier.HIGH]: 1024,
  [QualityTier.MEDIUM]: 768,
  [QualityTier.LOW]: 512,
}

export function planBackboxGraph(
  flags: BackboxGraphFlags,
  tier: QualityTier,
  displayAspect: number,
): BackboxGraphPlan {
  const effects: BackboxEffectNode[] = []
  const omitted: Array<BackboxGraphPlan['omitted'][number]> = []
  const skipAll = flags.noPostProcess ? 'nopp' : flags.photosensitive ? 'photosensitive' : null

  if (skipAll) {
    omitted.push({ node: 'crt', reason: skipAll }, { node: 'jackpot', reason: skipAll })
  } else {
    effects.push('crt')
    if (flags.reducedMotion) {
      effects.push('jackpotStill')
      omitted.push({ node: 'jackpot', reason: 'reduced-motion' })
    } else {
      effects.push('jackpot')
    }
  }

  const width = COMPOSITE_WIDTH[tier]
  const aspect = displayAspect > 0 && Number.isFinite(displayAspect) ? displayAspect : 5 / 3
  // Multiple of 8 keeps row pitch aligned on every backend.
  const height = Math.max(8, Math.round(width / aspect / 8) * 8)

  return { layers: BACKBOX_LAYER_ORDER, effects, omitted, width, height }
}

/** True when two plans build the same graph (same nodes, same size): no rebuild needed. */
export function sameBackboxGraph(a: BackboxGraphPlan, b: BackboxGraphPlan): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.layers.join() === b.layers.join() &&
    a.effects.join() === b.effects.join()
  )
}
