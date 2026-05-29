import { describe, expect, it } from 'vitest'

import { CRT_PRESETS } from '../src/display/display-types'
import { computeEffectiveScanlineIntensity } from '../src/display/display-shader'

describe('scanline configuration source of truth', () => {
  it('keeps canonical preset ordering and non-negative intensities', () => {
    expect(CRT_PRESETS.MODERN_LCD.scanlineIntensity).toBeGreaterThanOrEqual(0)
    expect(CRT_PRESETS.STORY.scanlineIntensity).toBeGreaterThanOrEqual(0)
    expect(CRT_PRESETS.RETRO.scanlineIntensity).toBeGreaterThanOrEqual(0)
    expect(CRT_PRESETS.RETRO.scanlineIntensity).toBeGreaterThanOrEqual(CRT_PRESETS.STORY.scanlineIntensity)
    expect(CRT_PRESETS.RETRO.scanlineIntensity).toBeGreaterThanOrEqual(CRT_PRESETS.MODERN_LCD.scanlineIntensity)
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

  it('returns the preset base at weight 1 and full accessibility', () => {
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.MODERN_LCD.scanlineIntensity, 1, 1))
      .toBe(CRT_PRESETS.MODERN_LCD.scanlineIntensity)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.STORY.scanlineIntensity, 1, 1))
      .toBe(CRT_PRESETS.STORY.scanlineIntensity)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.RETRO.scanlineIntensity, 1, 1))
      .toBe(CRT_PRESETS.RETRO.scanlineIntensity)
  })

  it('forces zero when accessibility factor is zero', () => {
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.RETRO.scanlineIntensity, 1, 0)).toBe(0)
    expect(computeEffectiveScanlineIntensity(CRT_PRESETS.STORY.scanlineIntensity, 0.5, 0)).toBe(0)
  })
})
