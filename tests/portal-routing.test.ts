import { describe, expect, it } from 'vitest'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { getNextAdventureTrack, getTrackStartAnchor, isAdventureTrackType } from '../src/adventure/portal-routing'

describe('portal-routing helpers', () => {
  it('returns next track in sequence and wraps at end', () => {
    expect(getNextAdventureTrack(AdventureTrackType.NEON_HELIX)).toBe(AdventureTrackType.CYBER_CORE)
    expect(getNextAdventureTrack(AdventureTrackType.POLYCHROME_VOID)).toBe(AdventureTrackType.NEON_HELIX)
  })

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
})
