import { describe, expect, it } from 'vitest'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import {
  getAllTrackManifests,
  getTrackManifest,
  TRACK_MANIFEST_REGISTRY,
  buildTrackCatalogFromManifests,
  buildZoneRegistryFromManifests,
} from '../src/adventure/manifests'
import { TRACK_CATALOG } from '../src/game-elements/adventure-track-progression'
import { ZONE_REGISTRY } from '../src/game-elements/zone-registry'
import { getTrackStartAnchor } from '../src/adventure/portal-routing'
import { getDataTrackDefinition } from '../src/adventure/track-data-registry'

describe('TrackManifest registry', () => {
  const enumValues = Object.values(AdventureTrackType)

  it('covers every AdventureTrackType enum value', () => {
    for (const id of enumValues) {
      expect(TRACK_MANIFEST_REGISTRY.has(id), `missing manifest for ${id}`).toBe(true)
    }
    expect(TRACK_MANIFEST_REGISTRY.size).toBe(enumValues.length)
  })

  it('derives TRACK_CATALOG identical to manifest catalog entries', () => {
    const derived = buildTrackCatalogFromManifests()
    expect(derived).toEqual(TRACK_CATALOG)
  })

  it('derives ZONE_REGISTRY identical to manifest zone entries', () => {
    const derived = buildZoneRegistryFromManifests()
    expect(derived).toEqual(ZONE_REGISTRY)
  })

  it('maps json manifests to validated data definitions', () => {
    const jsonManifests = getAllTrackManifests().filter((m) => m.buildKind === 'json')
    expect(jsonManifests.length).toBe(3)
    for (const manifest of jsonManifests) {
      expect(getDataTrackDefinition(manifest.id)).toBeDefined()
    }
  })

  it('maps ts manifests to builder functions', () => {
    const tsManifests = getAllTrackManifests().filter((m) => m.buildKind === 'ts')
    expect(tsManifests.length).toBe(enumValues.length - 3)
    for (const manifest of tsManifests) {
      expect(manifest.builder).toBeTypeOf('function')
    }
  })

  it('start anchors match portal-routing helpers', () => {
    for (const id of enumValues) {
      const manifest = getTrackManifest(id)!
      const anchor = getTrackStartAnchor(id)
      expect(anchor.x).toBe(manifest.startAnchor.x)
      expect(anchor.y).toBe(manifest.startAnchor.y)
      expect(anchor.z).toBe(manifest.startAnchor.z)
    }
  })
})
