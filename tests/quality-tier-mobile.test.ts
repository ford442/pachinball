import { describe, it, expect } from 'vitest'
import { QualityTier } from '../src/game-elements/visual-language'
import {
  applyMobileQualityCap,
  detectQualityTier,
} from '../src/materials/material-core'
import {
  isMobileUserAgent,
  shouldForceLowQualityMobile,
} from '../src/engine/engine-options'

function stubEngine(caps: { textureFloat: boolean; textureLOD: boolean }) {
  return {
    getCaps: () => caps,
  } as never
}

describe('isMobileUserAgent / shouldForceLowQualityMobile', () => {
  it('detects Android / Mobi UAs', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14; Mobile)')).toBe(true)
    expect(
      isMobileUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      ),
    ).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false)
  })

  it('forces LOW on low deviceMemory or saveData when mobile', () => {
    expect(
      shouldForceLowQualityMobile({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 4,
      }),
    ).toBe(true)
    expect(
      shouldForceLowQualityMobile({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        saveData: true,
      }),
    ).toBe(true)
    expect(
      shouldForceLowQualityMobile({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 8,
        saveData: false,
      }),
    ).toBe(false)
    expect(
      shouldForceLowQualityMobile({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        deviceMemory: 2,
      }),
    ).toBe(false)
  })
})

describe('applyMobileQualityCap', () => {
  it('leaves desktop tiers unchanged', () => {
    expect(
      applyMobileQualityCap(QualityTier.HIGH, { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }),
    ).toBe(QualityTier.HIGH)
  })

  it('caps mobile HIGH to MEDIUM', () => {
    expect(
      applyMobileQualityCap(QualityTier.HIGH, {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 8,
      }),
    ).toBe(QualityTier.MEDIUM)
  })

  it('forces LOW on constrained mobile', () => {
    expect(
      applyMobileQualityCap(QualityTier.HIGH, {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 3,
      }),
    ).toBe(QualityTier.LOW)
  })
})

describe('detectQualityTier', () => {
  it('maps GPU caps then applies mobile cap', () => {
    const highCaps = stubEngine({ textureFloat: true, textureLOD: true })
    expect(
      detectQualityTier(highCaps, { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }),
    ).toBe(QualityTier.HIGH)
    expect(
      detectQualityTier(highCaps, {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 8,
      }),
    ).toBe(QualityTier.MEDIUM)
    expect(
      detectQualityTier(stubEngine({ textureFloat: false, textureLOD: true }), {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      }),
    ).toBe(QualityTier.LOW)
  })
})
