import { describe, expect, it } from 'vitest'
import {
  getTrackThemeProfile,
  getTrackMaterialColor,
  TRACK_THEME_PROFILES,
} from '../src/adventure/track-theme-profiles'
import { TRACK_CATALOG } from '../src/adventure/adventure-track-progression'

describe('track-theme-profiles', () => {
  it('defines CYBER_CORE Cyber-Shock premium profile', () => {
    const profile = getTrackThemeProfile('CYBER_CORE')
    expect(profile).toBeDefined()
    expect(profile?.label).toBe('Cyber Shock')
    expect(profile?.palette.accent).toBe('CYAN')
    expect(profile?.particles.ambient).toBe('electric-arc')
    expect(profile?.usePBRStructure).toBe(true)
  })

  it('resolves material slots per track', () => {
    expect(getTrackMaterialColor('CYBER_CORE', 'energy')).toBe('#ff7700')
    expect(getTrackMaterialColor('CYBER_CORE', 'accent')).toBe('#00e8ff')
    expect(getTrackMaterialColor('UNKNOWN', 'structure')).toBeNull()
  })

  it('includes premium profiles for the other catalogued tracks', () => {
    expect(TRACK_THEME_PROFILES.TIDAL_NEXUS.particles.ambient).toBe('underwater-caustic')
    expect(TRACK_THEME_PROFILES.GLITCH_SPIRE.particles.ambient).toBe('ghost-mist')
    expect(TRACK_THEME_PROFILES.QUANTUM_GRID.particles.ambient).toBe('pixel-scan')
  })

  it('keys every profile by a catalogued track id', () => {
    for (const [key, profile] of Object.entries(TRACK_THEME_PROFILES)) {
      expect(profile.trackId).toBe(key)
      expect(TRACK_CATALOG[key], `${key} is not a catalogued track`).toBeDefined()
    }
  })
})
