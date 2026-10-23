/**
 * planBackboxGraph() decides which nodes the backbox Frame Graph has (#461 Slice A):
 * photosensitive leaves out CRT and jackpot, reduced motion swaps the jackpot pass for a still,
 * `?nopp=1` is the composite alone. Pure: no Babylon.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  BACKBOX_LAYER_ORDER,
  planBackboxGraph,
  sameBackboxGraph,
  type BackboxGraphFlags,
} from '../src/display/backbox-graph-plan'
import { QualityTier } from '../src/game-elements/visual-language'

const FLAGS: BackboxGraphFlags = { photosensitive: false, reducedMotion: false, noPostProcess: false }
const ASPECT = 20 / 12

describe('planBackboxGraph', () => {
  it('composes every layer back to front, then CRT, then the jackpot pass', () => {
    const plan = planBackboxGraph(FLAGS, QualityTier.HIGH, ASPECT)
    expect(plan.layers).toEqual(['physical', 'grid', 'reels', 'video', 'image', 'character', 'lcd'])
    expect(plan.layers).toBe(BACKBOX_LAYER_ORDER)
    expect(plan.effects).toEqual(['crt', 'jackpot'])
    expect(plan.omitted).toEqual([])
  })

  it('photosensitive mode leaves out both the CRT and the jackpot node', () => {
    const plan = planBackboxGraph({ ...FLAGS, photosensitive: true }, QualityTier.HIGH, ASPECT)
    expect(plan.effects).toEqual([])
    expect(plan.omitted).toEqual([
      { node: 'crt', reason: 'photosensitive' },
      { node: 'jackpot', reason: 'photosensitive' },
    ])
  })

  it('photosensitive wins over reduced motion: no still either', () => {
    const plan = planBackboxGraph({ ...FLAGS, photosensitive: true, reducedMotion: true }, QualityTier.MEDIUM, ASPECT)
    expect(plan.effects).toEqual([])
  })

  it('reduced motion keeps CRT and replaces the animated jackpot node with a still', () => {
    const plan = planBackboxGraph({ ...FLAGS, reducedMotion: true }, QualityTier.MEDIUM, ASPECT)
    expect(plan.effects).toEqual(['crt', 'jackpotStill'])
    expect(plan.omitted).toEqual([{ node: 'jackpot', reason: 'reduced-motion' }])
  })

  it('?nopp=1 builds the composite and nothing else', () => {
    const plan = planBackboxGraph({ ...FLAGS, noPostProcess: true }, QualityTier.HIGH, ASPECT)
    expect(plan.layers).toEqual(BACKBOX_LAYER_ORDER)
    expect(plan.effects).toEqual([])
    expect(plan.omitted.map((o) => o.reason)).toEqual(['nopp', 'nopp'])
  })

  it('sizes the composite by tier at the display aspect, rows a multiple of 8', () => {
    expect(planBackboxGraph(FLAGS, QualityTier.HIGH, ASPECT)).toMatchObject({ width: 1024, height: 616 })
    expect(planBackboxGraph(FLAGS, QualityTier.MEDIUM, ASPECT)).toMatchObject({ width: 768, height: 464 })
    expect(planBackboxGraph(FLAGS, QualityTier.LOW, ASPECT)).toMatchObject({ width: 512, height: 304 })
    for (const aspect of [ASPECT, 4 / 3, 16 / 9, 0, Number.NaN]) {
      expect(planBackboxGraph(FLAGS, QualityTier.MEDIUM, aspect).height % 8).toBe(0)
    }
  })

  it('sameBackboxGraph is true only when nodes and size match', () => {
    const a = planBackboxGraph(FLAGS, QualityTier.HIGH, ASPECT)
    expect(sameBackboxGraph(a, planBackboxGraph(FLAGS, QualityTier.HIGH, ASPECT))).toBe(true)
    expect(sameBackboxGraph(a, planBackboxGraph({ ...FLAGS, reducedMotion: true }, QualityTier.HIGH, ASPECT))).toBe(false)
    expect(sameBackboxGraph(a, planBackboxGraph(FLAGS, QualityTier.LOW, ASPECT))).toBe(false)
  })
})

describe('detectAccessibility → photosensitiveMode', () => {
  it('is set only when the player turned photosensitive mode on, not by reduced motion alone', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    try {
      const { detectAccessibility } = await import('../src/game-elements/accessibility-config')
      // Reduced motion caps flashFrequencyMax at 1 too, which is why the flag exists.
      expect(detectAccessibility({ reducedMotion: true }).flashFrequencyMax).toBe(1)
      expect(detectAccessibility({ reducedMotion: true }).photosensitiveMode).toBeFalsy()
      expect(detectAccessibility({ photosensitiveMode: true }).photosensitiveMode).toBe(true)
      expect(detectAccessibility({ reducedMotion: true, photosensitiveMode: true }).photosensitiveMode).toBe(true)
      expect(detectAccessibility({}).photosensitiveMode).toBeFalsy()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
