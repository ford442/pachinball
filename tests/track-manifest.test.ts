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
import {
  getDataTrackDefinition,
  getDataTrackSourcePath,
} from '../src/adventure/track-data-registry'

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

  it('declares a dataPath on every json manifest matching its loaded source file', () => {
    const jsonManifests = getAllTrackManifests().filter((m) => m.buildKind === 'json')
    for (const manifest of jsonManifests) {
      // Narrow through buildKind so the discriminated union exposes dataPath.
      if (manifest.buildKind !== 'json') continue
      expect(manifest.dataPath, `${manifest.id} must declare a dataPath`).toBeTruthy()
      expect(getDataTrackSourcePath(manifest.id)).toBe(manifest.dataPath)
    }
  })

  it('maps ts manifests to builder functions', () => {
    const tsManifests = getAllTrackManifests().filter((m) => m.buildKind === 'ts')
    expect(tsManifests.length).toBe(enumValues.length - 3)
    for (const manifest of tsManifests) {
      if (manifest.buildKind !== 'ts') continue
      expect(manifest.builder).toBeTypeOf('function')
    }
  })

  it('resolves build dispatch from the manifest alone — no parallel builder table', () => {
    // Registration is one manifest entry: every registered track carries its own
    // dispatch (TS builder or JSON dataPath), so adding a track needs no second list.
    for (const manifest of getAllTrackManifests()) {
      if (manifest.buildKind === 'ts') {
        expect(manifest.builder, `${manifest.id} builder`).toBeTypeOf('function')
      } else {
        expect(manifest.dataPath, `${manifest.id} dataPath`).toMatch(/^\.\/track-data\/.+\.json$/)
      }
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
