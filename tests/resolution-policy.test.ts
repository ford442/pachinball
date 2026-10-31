/**
 * Resolution policy (#488 §3): DPR-aware render scale with platform and tier caps, and the
 * dynamic-resolution hysteresis controller.
 */

import { describe, it, expect } from 'vitest'
import { DynamicResolutionController } from '../src/engine/dynamic-resolution'
import {
  MIN_RENDER_SCALE,
  hardwareScalingLevelFor,
  isDynamicResolutionEnabled,
  parseRenderScaleOverride,
  resolveRenderScale,
} from '../src/engine/resolution-policy'

describe('resolveRenderScale', () => {
  it('a DPR-3 phone on MEDIUM renders at ≥ 1.5x CSS pixels (the #488 acceptance)', () => {
    expect(resolveRenderScale({ devicePixelRatio: 3, mobile: true, quality: 'medium' })).toBeGreaterThanOrEqual(1.5)
  })

  it('caps at 1.5 on mobile and 2 on desktop', () => {
    expect(resolveRenderScale({ devicePixelRatio: 3, mobile: true, quality: 'high' })).toBe(1.5)
    expect(resolveRenderScale({ devicePixelRatio: 3, mobile: false, quality: 'high' })).toBe(2)
    expect(resolveRenderScale({ devicePixelRatio: 1.25, mobile: false, quality: 'high' })).toBe(1.25)
  })

  it('applies the quality-tier cap', () => {
    expect(resolveRenderScale({ devicePixelRatio: 2, mobile: false, quality: 'medium' })).toBe(1.5)
    expect(resolveRenderScale({ devicePixelRatio: 3, mobile: true, quality: 'low' })).toBe(1)
    expect(resolveRenderScale({ devicePixelRatio: 2, mobile: false, quality: null })).toBe(2)
  })

  it('never goes below the minimum, and survives a junk DPR', () => {
    expect(resolveRenderScale({ devicePixelRatio: 0.25, mobile: false, quality: 'high' })).toBe(MIN_RENDER_SCALE)
    expect(resolveRenderScale({ devicePixelRatio: Number.NaN, mobile: false, quality: 'high' })).toBe(1)
  })

  it('?renderScale= pins the scale and turns dynamic resolution off', () => {
    expect(resolveRenderScale({ devicePixelRatio: 3, mobile: true, quality: 'low', search: '?renderScale=1.25' })).toBe(1.25)
    expect(parseRenderScaleOverride('?renderScale=0.1')).toBe(MIN_RENDER_SCALE)
    expect(parseRenderScaleOverride('?renderScale=abc')).toBeNull()
    expect(isDynamicResolutionEnabled('')).toBe(true)
    expect(isDynamicResolutionEnabled('?dynres=0')).toBe(false)
    expect(isDynamicResolutionEnabled('?renderScale=1')).toBe(false)
    // Automation: off unless asked for.
    expect(isDynamicResolutionEnabled('', true)).toBe(false)
    expect(isDynamicResolutionEnabled('?dynres=1', true)).toBe(true)
    expect(isDynamicResolutionEnabled('?dynres=1&renderScale=1', true)).toBe(false)
  })

  it('converts to a hardware scaling level', () => {
    expect(hardwareScalingLevelFor(2)).toBe(0.5)
    expect(hardwareScalingLevelFor(1)).toBe(1)
  })
})

describe('DynamicResolutionController', () => {
  const run = (c: DynamicResolutionController, ms: number, frames: number): Array<number> => {
    const changes: number[] = []
    for (let i = 0; i < frames; i++) {
      const next = c.sample(ms)
      if (next !== null) changes.push(next)
    }
    return changes
  }

  it('steps down after 30 consecutive frames over budget', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    expect(run(c, 20, 29)).toEqual([])
    expect(run(c, 20, 1)).toEqual([1.875])
    expect(c.currentScale).toBe(1.875)
  })

  it('an on-budget frame breaks the run (hysteresis)', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    run(c, 20, 29)
    c.sample(12) // dead band (between 0.8 × budget and budget)
    expect(run(c, 20, 29)).toEqual([])
  })

  it('steps up only after 120 frames under budget, never above the max', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    run(c, 20, 30)
    expect(run(c, 5, 119)).toEqual([])
    expect(run(c, 5, 1)).toEqual([2])
    expect(run(c, 5, 500)).toEqual([])
  })

  it('stops at the minimum (half the max by default)', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    run(c, 30, 30 * 20)
    expect(c.currentScale).toBe(1)
    expect(c.range).toEqual({ min: 1, max: 2 })
  })

  it('backs off after a step up that did not hold', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    run(c, 20, 30) // down
    run(c, 5, 120) // up
    run(c, 20, 30) // down again: the probe failed
    expect(run(c, 5, 120)).toEqual([])
    expect(run(c, 5, 120)).toEqual([2])
  })

  it('ignores junk samples (GPU timer not resolved yet)', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    expect(run(c, 0, 1000)).toEqual([])
    expect(run(c, Number.NaN, 1000)).toEqual([])
  })

  it('a lower ceiling clamps the current scale; resetToMax jumps to it', () => {
    const c = new DynamicResolutionController({ budgetMs: 14, maxScale: 2 })
    expect(c.setMaxScale(1.5)).toBe(1.5)
    run(c, 30, 30)
    expect(c.currentScale).toBe(1.375)
    expect(c.setMaxScale(2)).toBe(1.375)
    expect(c.setMaxScale(2, true)).toBe(2)
  })
})
