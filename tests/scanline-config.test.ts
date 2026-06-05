import { describe, expect, it } from 'vitest'

import { CRT_PRESETS } from '../src/display/display-types'
import { computeEffectiveScanlineIntensity } from '../src/shaders/scanline'

describe('scanline configuration source of truth', () => {
  it('keeps canonical preset ordering and non-negative intensities', () => {
    expect(CRT_PRESETS.MODERN_LCD.scanlineIntensity).toBeGreaterThanOrEqual(0)
    expect(CRT_PRESETS.STORY.scanlineIntensity).toBeGreaterThanOrEqual(0)
    expect(CRT_PRESETS.RETRO.scanlineIntensity).toBeGreaterThanOrEqual(0)
    expect(CRT_PRESETS.RETRO.scanlineIntensity).toBeGreaterThanOrEqual(CRT_PRESETS.STORY.scanlineIntensity)
    expect(CRT_PRESETS.RETRO.scanlineIntensity).toBeGreaterThanOrEqual(CRT_PRESETS.MODERN_LCD.scanlineIntensity)
    // SUBTLE sits between MODERN_LCD and STORY
    expect(CRT_PRESETS.SUBTLE.scanlineIntensity).toBeGreaterThanOrEqual(CRT_PRESETS.MODERN_LCD.scanlineIntensity)
    expect(CRT_PRESETS.STORY.scanlineIntensity).toBeGreaterThanOrEqual(CRT_PRESETS.SUBTLE.scanlineIntensity)
  })

  it('includes an OFF preset with no CRT contribution', () => {
    expect(CRT_PRESETS.OFF).toEqual({
      scanlineIntensity: 0,
      curvature: 0,
      vignette: 0,
      chromaticAberration: 0,
      glow: 0,
      noise: 0,
      flicker: 0,
    })
  })

  it('does not export a competing CRT_PRESETS map from crt-effect shader module', async () => {
    const crtEffectModule = await import('../src/shaders/crt-effect')
    expect('CRT_PRESETS' in crtEffectModule).toBe(false)
  })
})

describe('scanline dimmer math', () => {
  it('returns zero at weight 0 for every preset', () => {
    for (const preset of Object.values(CRT_PRESETS)) {
      expect(computeEffectiveScanlineIntensity(preset.scanlineIntensity, 0, 1)).toBe(0)
    }
  })

  it('returns the preset base at weight 1 and full accessibility ceiling', () => {
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.MODERN_LCD.scanlineIntensity, 1, 1))
      .toBe(CRT_PRESETS.MODERN_LCD.scanlineIntensity)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.STORY.scanlineIntensity, 1, 1))
      .toBe(CRT_PRESETS.STORY.scanlineIntensity)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.RETRO.scanlineIntensity, 1, 1))
      .toBe(CRT_PRESETS.RETRO.scanlineIntensity)
  })

  it('forces zero when accessibility ceiling is zero', () => {
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.RETRO.scanlineIntensity, 1, 0)).toBe(0)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.STORY.scanlineIntensity, 0.5, 0)).toBe(0)
  })

  it('accessibility ceiling caps heavy presets without crushing gentle ones', () => {
    const ceiling = 0.25
    // RETRO (0.90) is capped at the ceiling
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.RETRO.scanlineIntensity, 1, ceiling))
      .toBe(ceiling)
    // MODERN_LCD (0.15) is below the ceiling — passes through unchanged
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.MODERN_LCD.scanlineIntensity, 1, ceiling))
      .toBe(CRT_PRESETS.MODERN_LCD.scanlineIntensity)
    // SUBTLE (0.30) is just above the ceiling — gets capped
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.SUBTLE.scanlineIntensity, 1, ceiling))
      .toBe(ceiling)
  })

  it('user multiplier scales proportionally across presets', () => {
    const multiplier = 0.5
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.RETRO.scanlineIntensity, multiplier, 1))
      .toBeCloseTo(CRT_PRESETS.RETRO.scanlineIntensity * multiplier, 10)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.MODERN_LCD.scanlineIntensity, multiplier, 1))
      .toBeCloseTo(CRT_PRESETS.MODERN_LCD.scanlineIntensity * multiplier, 10)
  })

  it('clamps result to [0, 1] for out-of-range inputs', () => {
    expect(computeEffectiveScanlineIntensity(2.0, 2.0, 1)).toBe(1)
    expect(computeEffectiveScanlineIntensity(-1.0, 1, 1)).toBe(0)
  })
})
