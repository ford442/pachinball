/**
 * Campaign spine coverage (#321).
 *
 * Guards the shape of the catalogue itself — size, unlock-graph reachability,
 * and how much of it is data-driven — so a future track edit cannot quietly
 * strand a stage or break the chain that carries a player through the campaign.
 */

import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_MAIN_PATH,
  TRACK_CATALOG,
} from '../src/game-elements/adventure-track-progression'
import { getAllTrackManifests, getTrackManifest } from '../src/adventure/manifests'
import { getDataTrackDefinition } from '../src/adventure/track-data-registry'
import { buildCampaignGoalsForTrack } from '../src/game-elements/adventure-track-goals'

const catalogIds = Object.keys(TRACK_CATALOG)

describe('campaign catalogue size and composition', () => {
  it('catalogues at least 13 tracks', () => {
    expect(catalogIds.length).toBeGreaterThanOrEqual(13)
  })

  it('backs at least 5 catalogued tracks with declarative JSON', () => {
    const jsonBacked = catalogIds.filter((id) => getTrackManifest(id as never)?.buildKind === 'json')

    expect(jsonBacked.length).toBeGreaterThanOrEqual(5)
    // Each one must actually resolve to a validated definition, not just claim to.
    for (const id of jsonBacked) {
      expect(getDataTrackDefinition(id), `${id} definition`).toBeDefined()
    }
  })

  it('has a manifest for every catalogued track', () => {
    for (const id of catalogIds) {
      expect(getTrackManifest(id as never), `manifest for ${id}`).toBeDefined()
    }
  })
})

describe('unlock graph', () => {
  it('starts from exactly one root — the track the player begins on', () => {
    const roots = catalogIds.filter((id) => !TRACK_CATALOG[id].unlockedBy)
    expect(roots).toEqual(['NEON_HELIX'])
  })

  it('points every unlockedBy edge at a real catalogued track', () => {
    for (const id of catalogIds) {
      const parent = TRACK_CATALOG[id].unlockedBy
      if (parent === undefined) continue
      expect(TRACK_CATALOG[parent], `${id} is unlocked by unknown track ${parent}`).toBeDefined()
    }
  })

  it('reaches every catalogued track from the root with no cycles', () => {
    // Walk outward from NEON_HELIX; anything unreachable is content a player
    // can never legitimately arrive at.
    const children = new Map<string, string[]>()
    for (const id of catalogIds) {
      const parent = TRACK_CATALOG[id].unlockedBy
      if (parent === undefined) continue
      children.set(parent, [...(children.get(parent) ?? []), id])
    }

    const seen = new Set<string>()
    const queue = ['NEON_HELIX']
    while (queue.length > 0) {
      const id = queue.shift() as string
      expect(seen.has(id), `cycle detected at ${id}`).toBe(false)
      seen.add(id)
      queue.push(...(children.get(id) ?? []))
    }

    expect([...seen].sort()).toEqual([...catalogIds].sort())
  })
})

describe('main spine', () => {
  it('is at least 13 stages and fully catalogued', () => {
    expect(CAMPAIGN_MAIN_PATH.length).toBeGreaterThanOrEqual(13)
    for (const id of CAMPAIGN_MAIN_PATH) {
      expect(TRACK_CATALOG[id], `spine stage ${id} must be catalogued`).toBeDefined()
    }
  })

  it('lists no track twice', () => {
    expect(new Set(CAMPAIGN_MAIN_PATH).size).toBe(CAMPAIGN_MAIN_PATH.length)
  })

  it('chains each stage to the previous one so the spine unlocks in order', () => {
    for (let i = 1; i < CAMPAIGN_MAIN_PATH.length; i++) {
      const current = CAMPAIGN_MAIN_PATH[i]
      expect(TRACK_CATALOG[current].unlockedBy, `${current} must chain from the prior stage`).toBe(
        CAMPAIGN_MAIN_PATH[i - 1],
      )
    }
  })

  it('alternates EXTENDED_MAP / STATIONARY_TABLE across the extension (stages 7+)', () => {
    // Stages 1-6 predate #321 and keep their historical A/A/B/A/A/B shape.
    const extension = CAMPAIGN_MAIN_PATH.slice(6)
    expect(extension.length).toBeGreaterThanOrEqual(7)

    for (let i = 1; i < extension.length; i++) {
      const prev = TRACK_CATALOG[extension[i - 1]].modeType
      const curr = TRACK_CATALOG[extension[i]].modeType
      expect(curr, `${extension[i]} should alternate away from ${extension[i - 1]}`).not.toBe(prev)
    }
  })

  it('uses both mode types across the spine', () => {
    const modes = new Set(CAMPAIGN_MAIN_PATH.map((id) => TRACK_CATALOG[id].modeType))
    expect(modes).toEqual(new Set(['EXTENDED_MAP', 'STATIONARY_TABLE']))
  })

  it('never lowers the recommended score across the extension (stage 6 onward)', () => {
    // Scoped to stage 6+ deliberately. Stages 1-2 carry a pre-existing dip
    // (NEON_HELIX 50k -> PACHINKO_HALL 40k) from the original calibration, which
    // tests/adventure-progression-supervisor.test.ts pins to exact values; #321
    // adds stages rather than retuning that.
    const tail = CAMPAIGN_MAIN_PATH.slice(5)
    for (let i = 1; i < tail.length; i++) {
      const prev = TRACK_CATALOG[tail[i - 1]].recommendedScore
      const curr = TRACK_CATALOG[tail[i]].recommendedScore
      expect(curr, `${tail[i]} should not be easier than the stage before`).toBeGreaterThanOrEqual(prev)
    }
  })
})

describe('goals for catalogued tracks', () => {
  it('builds a goal set for every catalogued track', () => {
    for (const id of catalogIds) {
      const goals = buildCampaignGoalsForTrack(id)
      expect(goals.length, `${id} goals`).toBeGreaterThan(0)
    }
  })

  it('keeps every survival goal inside the stage time limit', () => {
    for (const id of catalogIds) {
      const limit = TRACK_CATALOG[id].timeLimitSeconds
      for (const goal of buildCampaignGoalsForTrack(id)) {
        if (goal.type !== 'survival') continue
        expect(goal.target, `${id} survival goal must fit in ${limit}s`).toBeLessThanOrEqual(limit)
      }
    }
  })
})

describe('manifest/catalog consistency', () => {
  it('gives every catalogued manifest a zone name matching its catalog name', () => {
    for (const manifest of getAllTrackManifests()) {
      if (!manifest.catalog) continue
      expect(TRACK_CATALOG[manifest.id].name).toBe(manifest.zone.name)
    }
  })
})
