/** The versioned player profile (#505 §A / #506 slice 5). */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseProfile, PROFILE_VERSION } from '../src/schemas/profile'

const classic: unknown = JSON.parse(readFileSync(join(__dirname, '../public/machines/classic.json'), 'utf8'))

describe('parseProfile', () => {
  it('reads a full profile', () => {
    const result = parseProfile({
      version: PROFILE_VERSION,
      settings: { muted: true, masterVolume: 0.5 },
      keyBindings: { flipperLeft: ['KeyZ', 'ShiftLeft'] },
      campaign: { version: 2, progression: { unlockedTracks: ['NEON_HELIX'] } },
      bests: { classic: 12000 },
      achievements: ['first-jackpot'],
      drafts: [classic],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.settings.muted).toBe(true)
      expect(result.value.drafts?.[0]?.id).toBe('classic')
    }
  })

  it('reports errors with their paths', () => {
    const result = parseProfile({ version: 1, settings: {}, keyBindings: { flipperLeft: ['Key Z'] }, bests: { classic: -1 }, drafts: [{ id: 'x' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path)
      expect(paths).toContain('keyBindings.flipperLeft[0]')
      expect(paths).toContain('bests.classic')
      expect(paths.some((p) => p.startsWith('drafts[0]'))).toBe(true)
    }
  })

  it('refuses a newer version instead of guessing', () => {
    expect(parseProfile({ version: PROFILE_VERSION + 1, settings: {} })).toEqual({
      ok: false,
      errors: [{ path: 'version', message: `profile version ${PROFILE_VERSION + 1} is newer than this build (${PROFILE_VERSION})` }],
    })
  })
})
