/**
 * @vitest-environment happy-dom
 * Unit tests for ChallengeSystem & URL share link parsing/generation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ChallengeSystem } from '../src/replay/challenge-system'
import { DEFAULT_TABLE_MAP_ID, TABLE_MAPS } from '../src/shaders/lcd-table'

describe('ChallengeSystem & Share Link Utilities', () => {
  beforeEach(() => {
    // Reset window location search mock if needed
    window.history.replaceState({}, '', '/')
  })

  it('creates shareable challenge URL string with seed and target score', () => {
    const url = ChallengeSystem.createChallengeShareUrl(12345, 500000, 'neon-helix')
    expect(url).toContain('challenge=12345:500000')
    expect(url).toContain('map=neon-helix')
  })

  it('parses challenge query parameters correctly', () => {
    window.history.replaceState({}, '', '/?challenge=999:250000&map=cyber-core')
    const system = new ChallengeSystem()
    const active = system.getActiveChallenge()

    expect(active).not.toBeNull()
    expect(active?.seed).toBe(999)
    expect(active?.targetScore).toBe(250000)
    expect(active?.mapId).toBe('cyber-core')
    system.dispose()
  })

  it('parses fallback seed and target query parameters', () => {
    window.history.replaceState({}, '', '/?seed=42&target=150000&map=quantum-grid')
    const system = new ChallengeSystem()
    const active = system.getActiveChallenge()

    expect(active).not.toBeNull()
    expect(active?.seed).toBe(42)
    expect(active?.targetScore).toBe(150000)
    expect(active?.mapId).toBe('quantum-grid')
    system.dispose()
  })

  it('defaults a map-less challenge link to a real table map', () => {
    expect(TABLE_MAPS[DEFAULT_TABLE_MAP_ID]).toBeDefined()
    const active = new ChallengeSystem().checkUrlParameters('?challenge=7:1000')
    expect(active?.mapId).toBe(DEFAULT_TABLE_MAP_ID)
    expect(ChallengeSystem.createChallengeShareUrl(7, 1000)).toContain(`map=${DEFAULT_TABLE_MAP_ID}`)
  })
})
