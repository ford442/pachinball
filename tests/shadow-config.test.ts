import { describe, expect, it } from 'vitest'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { QualityTier } from '../src/game-elements/visual-language'
import {
  applyShadowSettings,
  resolveShadowSettings,
  type ShadowGeneratorTarget,
} from '../src/game/shadow-config'

/** Records every property write so a test can prove which filter knobs were (not) touched. */
function recordingGenerator(): { target: ShadowGeneratorTarget; writes: Record<string, unknown>; darkness: number[] } {
  const writes: Record<string, unknown> = {}
  const darkness: number[] = []
  const target = new Proxy(
    { setDarkness: (v: number) => darkness.push(v) } as unknown as ShadowGeneratorTarget,
    {
      set(obj, key, value) {
        writes[String(key)] = value
        ;(obj as unknown as Record<string, unknown>)[String(key)] = value
        return true
      },
    },
  )
  return { target, writes, darkness }
}

describe('resolveShadowSettings', () => {
  it('HIGH is PCF at QUALITY_MEDIUM on a 2048 map, with no blur kernel', () => {
    const s = resolveShadowSettings(QualityTier.HIGH)
    expect(s).toMatchObject({ technique: 'pcf', mapSize: 2048, pcfQuality: 'medium', blurKernel: null })
  })

  it.each([QualityTier.MEDIUM, QualityTier.LOW])('%s keeps the blurred ESM at 2048 with kernel 28', (tier) => {
    const s = resolveShadowSettings(tier)
    expect(s).toMatchObject({ technique: 'blur-esm', mapSize: 2048, pcfQuality: null, blurKernel: 28 })
  })

  it('keeps the darkness / bias tuning identical on every tier', () => {
    const [high, medium, low] = [QualityTier.HIGH, QualityTier.MEDIUM, QualityTier.LOW].map(resolveShadowSettings)
    for (const s of [high, medium, low]) {
      expect(s).toMatchObject({ darkness: 0.3, bias: 0.0005, normalBias: 0.02 })
    }
  })
})

describe('applyShadowSettings — exactly one technique', () => {
  it('HIGH writes only the PCF knobs', () => {
    const { target, writes, darkness } = recordingGenerator()
    applyShadowSettings(target, resolveShadowSettings(QualityTier.HIGH))
    expect(writes.usePercentageCloserFiltering).toBe(true)
    expect(writes.filteringQuality).toBe(ShadowGenerator.QUALITY_MEDIUM)
    // The pre-existing bug: these were set first and then silently overwritten.
    expect('useBlurExponentialShadowMap' in writes).toBe(false)
    expect('blurKernel' in writes).toBe(false)
    expect(darkness).toEqual([0.3])
    expect(writes.bias).toBe(0.0005)
    expect(writes.normalBias).toBe(0.02)
  })

  it.each([QualityTier.MEDIUM, QualityTier.LOW])('%s writes only the blur-ESM knobs', (tier) => {
    const { target, writes } = recordingGenerator()
    applyShadowSettings(target, resolveShadowSettings(tier))
    expect(writes.useBlurExponentialShadowMap).toBe(true)
    expect(writes.blurKernel).toBe(28)
    expect('usePercentageCloserFiltering' in writes).toBe(false)
    expect('filteringQuality' in writes).toBe(false)
  })

  it('never selects contact-hardening shadows (a third technique)', () => {
    for (const tier of [QualityTier.HIGH, QualityTier.MEDIUM, QualityTier.LOW]) {
      const { target, writes } = recordingGenerator()
      applyShadowSettings(target, resolveShadowSettings(tier))
      expect('useContactHardeningShadow' in writes).toBe(false)
    }
  })
})
