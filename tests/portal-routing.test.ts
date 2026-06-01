import { describe, expect, it } from 'vitest'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { getTrackStartAnchor, isAdventureTrackType } from '../src/adventure/portal-routing'
import { AdventureTrackProgression } from '../src/game-elements/adventure-track-progression'

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
    expect(progression.getNextTrackId()).toBe('CYBER_CORE')

    progression.completeTrack('CYBER_CORE', 140_000, 0, 140_000)
    expect(progression.getNextTrackId()).toBe('QUANTUM_GRID')

    progression.completeTrack('QUANTUM_GRID', 240_000, 0, 240_000)
    expect(progression.getNextTrackId()).toBe('PACHINKO_SPIRE')
  })
})
