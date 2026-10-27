/**
 * Key-light shadow settings per quality tier — exactly ONE filter technique per tier.
 *
 * Babylon's filter setters (`useBlurExponentialShadowMap`, `usePercentageCloserFiltering`,
 * `useContactHardeningShadow`, …) all write the same `filter` field, so stacking them is
 * last-write-wins: the earlier setter, and any tuning attached to it (the blur kernel), is
 * silently dead. Before this module HIGH set blur-ESM and then PCF, so it ran PCF and the
 * `blurKernel = 28` line did nothing. Each tier now names the one technique it runs.
 *
 * `resolveShadowSettings` is pure; `applyShadowSettings` is the only place that writes a filter
 * technique onto a generator, so "one technique per tier" is checkable in one spot.
 */

import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { QualityTier } from '../game-elements/visual-language'

export type ShadowTechnique =
  /** Percentage-closer filtering with a hardware comparison sampler. HIGH only. */
  | 'pcf'
  /** Blurred exponential shadow map. The pre-existing MEDIUM / LOW behaviour, kept as is. */
  | 'blur-esm'

export interface ShadowSettings {
  technique: ShadowTechnique
  /** Square shadow-map edge in texels. */
  mapSize: number
  /** PCF kernel quality (`ShadowGenerator.QUALITY_MEDIUM`). Only meaningful for `pcf`. */
  pcfQuality: 'medium' | null
  /** Gaussian blur kernel of the ESM map. Only meaningful for `blur-esm`. */
  blurKernel: number | null
  /** `ShadowGenerator.setDarkness` — 0 is black shadow, 1 is no shadow. */
  darkness: number
  bias: number
  normalBias: number
}

/** Shared by every tier; the technique-specific knobs differ below. */
const COMMON = {
  mapSize: 2048,
  darkness: 0.3,
  bias: 0.0005,
  normalBias: 0.02,
} as const

/**
 * HIGH: PCF at QUALITY_MEDIUM, 2048². It used to be PCF at QUALITY_HIGH on a 4096² map (4x the
 * texels) that was re-rendered every frame. Whether 2048² is visually acceptable on HIGH is an
 * open question on the render-hygiene issue; this one constant (`COMMON.mapSize`) is the knob.
 *
 * MEDIUM / LOW: blurred ESM, 2048², kernel 28 — unchanged from before.
 */
export function resolveShadowSettings(tier: QualityTier): ShadowSettings {
  if (tier === QualityTier.HIGH) {
    return { ...COMMON, technique: 'pcf', pcfQuality: 'medium', blurKernel: null }
  }
  return { ...COMMON, technique: 'blur-esm', pcfQuality: null, blurKernel: 28 }
}

/** The generator members `applyShadowSettings` writes, so tests can pass a recording fake. */
export type ShadowGeneratorTarget = Pick<
  ShadowGenerator,
  | 'usePercentageCloserFiltering'
  | 'filteringQuality'
  | 'useBlurExponentialShadowMap'
  | 'blurKernel'
  | 'setDarkness'
  | 'bias'
  | 'normalBias'
>

/**
 * Put `generator` on exactly the technique in `settings`. Setting a technique replaces whichever
 * one was active (they share the generator's `filter` field), so no other filter flag is written
 * and the knobs of the technique that is NOT selected are never touched.
 */
export function applyShadowSettings(generator: ShadowGeneratorTarget, settings: ShadowSettings): void {
  if (settings.technique === 'pcf') {
    generator.usePercentageCloserFiltering = true
    generator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
  } else {
    generator.useBlurExponentialShadowMap = true
    if (settings.blurKernel !== null) generator.blurKernel = settings.blurKernel
  }
  generator.setDarkness(settings.darkness)
  generator.bias = settings.bias
  generator.normalBias = settings.normalBias
}
