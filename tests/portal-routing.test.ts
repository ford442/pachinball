import { describe, expect, it } from 'vitest'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { getTrackStartAnchor, isAdventureTrackType } from '../src/adventure/portal-routing'
import {
  AdventureTrackProgression,
  CAMPAIGN_MAIN_PATH,
} from '../src/game-elements/adventure-track-progression'

describe('portal-routing helpers', () => {
  it('returns canonical start anchors for teleport', () => {
    const cyberCoreStart = getTrackStartAnchor(AdventureTrackType.CYBER_CORE)
    expect(cyberCoreStart.x).toBe(0)
    expect(cyberCoreStart.y).toBe(20)
    expect(cyberCoreStart.z).toBe(0)
  })

  it('validates track ids for portal open events', () => {
    expect(isAdventureTrackType('CYBER_CORE')).toBe(true)
    expect(isAdventureTrackType('UNKNOWN_TRACK')).toBe(false)
  })

  it('uses campaign progression as the next-track authority', () => {
    const progression = new AdventureTrackProgression()

    progression.completeTrack('NEON_HELIX', 60_000, 0, 60_000)
    expect(progression.getNextTrackId()).toBe('PACHINKO_HALL')

    progression.completeTrack('PACHINKO_HALL', 100_000, 0, 100_000)
    expect(progression.getNextTrackId()).toBe('CYBER_CORE')

    progression.completeTrack('CYBER_CORE', 140_000, 0, 140_000)
    expect(progression.getNextTrackId()).toBe('QUANTUM_GRID')

    progression.completeTrack('QUANTUM_GRID', 240_000, 0, 240_000)
    expect(progression.getNextTrackId()).toBe('SINGULARITY_WELL')

    progression.completeTrack('SINGULARITY_WELL', 340_000, 0, 340_000)
    expect(progression.getNextTrackId()).toBe('GLITCH_SPIRE')

    // Spine continues past GLITCH_SPIRE since #321 — it no longer falls straight
    // through to the optional PACHINKO_SPIRE branch.
    progression.completeTrack('GLITCH_SPIRE', 440_000, 0, 440_000)
    expect(progression.getNextTrackId()).toBe('RETRO_WAVE_HILLS')
  })

  it('walks the whole main spine, then offers the optional branches', () => {
    const progression = new AdventureTrackProgression()

    // Completing every spine stage in order must hand back the next spine stage
    // each time — no free-map selection or dev unlock needed anywhere along it.
    let score = 60_000
    for (let i = 0; i < CAMPAIGN_MAIN_PATH.length; i++) {
      const current = CAMPAIGN_MAIN_PATH[i]
      expect(progression.isTrackUnlocked(current), `${current} should be unlocked in sequence`).toBe(true)
      progression.completeTrack(current, score, 0, score)
      score += 20_000

      const next = CAMPAIGN_MAIN_PATH[i + 1]
      if (next) {
        expect(progression.getNextTrackId(), `after ${current}`).toBe(next)
      }
    }

    // Spine exhausted — the remaining unlocked, uncompleted tracks are branches.
    const afterSpine = progression.getNextTrackId()
    expect(afterSpine).not.toBeNull()
    expect(CAMPAIGN_MAIN_PATH as readonly string[]).not.toContain(afterSpine)
    expect(['PACHINKO_SPIRE', 'NEON_STRONGHOLD']).toContain(afterSpine)
  })
})
