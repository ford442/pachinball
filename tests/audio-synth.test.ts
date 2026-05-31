import { describe, expect, it } from 'vitest'
import {
  createImpactVoiceProfile,
  normalizeImpactVelocity,
  getPortalMotifFrequencies,
} from '../src/game-elements/audio-synth'

describe('audio-synth helpers', () => {
  it('normalizes velocity into 0..1 range', () => {
    expect(normalizeImpactVelocity(-1)).toBe(0)
    expect(normalizeImpactVelocity(0)).toBe(0)
    expect(normalizeImpactVelocity(12, 24)).toBe(0.5)
    expect(normalizeImpactVelocity(100, 24)).toBe(1)
  })

  it('scales bumper voice loudness with impact velocity', () => {
    const low = createImpactVoiceProfile('bumper', 2)
    const high = createImpactVoiceProfile('bumper', 18)
    expect(high.gain).toBeGreaterThan(low.gain)
    expect(high.filterStart).toBeGreaterThan(low.filterStart)
  })

  it('reduces noisy layers in reduced-audio mode', () => {
    const regular = createImpactVoiceProfile('flipper', 12, {}, false)
    const reduced = createImpactVoiceProfile('flipper', 12, {}, true)
    expect(reduced.noiseAmount).toBeLessThan(regular.noiseAmount)
    expect(reduced.gain).toBeLessThan(regular.gain)
  })

  it('returns richer premium portal motif', () => {
    expect(getPortalMotifFrequencies(false).length).toBe(3)
    expect(getPortalMotifFrequencies(true).length).toBe(4)
  })
})

