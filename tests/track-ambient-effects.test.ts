import { describe, expect, it } from 'vitest'
import type { Scene } from '@babylonjs/core'
import { TrackAmbientEffects } from '../src/effects/track-ambient-effects'
import { getTrackThemeProfile } from '../src/game-elements/track-theme-profiles'

describe('TrackAmbientEffects accessibility', () => {
  const scene = { uniqueId: 1 } as unknown as Scene
  const cyberCore = getTrackThemeProfile('CYBER_CORE')

  it('suppresses ambient particles and flicker when photosensitive mode is enabled', () => {
    const effects = new TrackAmbientEffects(scene)
    effects.setAccessibilityFlags({ photosensitiveMode: true, reducedMotion: false })
    effects.applyProfile(cyberCore ?? null)

    expect(effects.update(0.016)).toBe(1)
    expect(effects.update(0.5)).toBe(1)
  })

  it('suppresses ambient particles and flicker when reduced motion is enabled', () => {
    const effects = new TrackAmbientEffects(scene)
    effects.setAccessibilityFlags({ photosensitiveMode: false, reducedMotion: true })
    effects.applyProfile(cyberCore ?? null)

    expect(effects.update(0.016)).toBe(1)
  })

  it('clears active ambient effects when accessibility flags tighten mid-session', () => {
    const effects = new TrackAmbientEffects(scene)
    effects.setAccessibilityFlags({ photosensitiveMode: false, reducedMotion: false })
    effects.setAccessibilityFlags({ photosensitiveMode: true, reducedMotion: false })

    expect(effects.update(0.25)).toBe(1)
  })
})
