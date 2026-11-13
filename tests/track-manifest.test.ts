import { describe, expect, it } from 'vitest'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import {
  getAllTrackManifests,
  getTrackManifest,
  TRACK_MANIFEST_REGISTRY,
  buildTrackCatalogFromManifests,
  buildZoneRegistryFromManifests,
} from '../src/adventure/manifests'
import { MANIFEST_DATA } from '../src/adventure/manifests/track-manifest-data'
import { TRACK_CATALOG } from '../src/adventure/adventure-track-progression'
import { ZONE_REGISTRY } from '../src/adventure/zone-registry'
import { getTrackStartAnchor } from '../src/adventure/portal-routing'
import {
  getDataTrackIds,
  getDataTrackSourcePath,
  loadDataTrackDefinition,
} from '../src/adventure/track-data-registry'

describe('TrackManifest registry', () => {
  const enumValues = Object.values(AdventureTrackType)

  it('covers every AdventureTrackType enum value', () => {
    for (const id of enumValues) {
      expect(TRACK_MANIFEST_REGISTRY.has(id), `missing manifest for ${id}`).toBe(true)
    }
    expect(TRACK_MANIFEST_REGISTRY.size).toBe(enumValues.length)
  })

  it('declares manifests in AdventureTrackType order (it drives TRACK_CATALOG key order)', () => {
    expect(MANIFEST_DATA.map((manifest) => manifest.id)).toEqual(enumValues)
  })

  it('derives TRACK_CATALOG identical to manifest catalog entries', () => {
    const derived = buildTrackCatalogFromManifests()
    expect(derived).toEqual(TRACK_CATALOG)
  })

  it('derives ZONE_REGISTRY identical to manifest zone entries', () => {
    const derived = buildZoneRegistryFromManifests()
    expect(derived).toEqual(ZONE_REGISTRY)
  })

  it('every track is JSON (the TS track modules are gone, #505 §A)', () => {
    expect(getAllTrackManifests().every((m) => m.buildKind === 'json')).toBe(true)
    expect(getDataTrackIds()).toEqual([...enumValues].sort())
  })

  it('maps every manifest to a definition that loads and validates', async () => {
    for (const manifest of getAllTrackManifests()) {
      const loaded = await loadDataTrackDefinition(manifest.id)
      expect(loaded.ok ? loaded.definition.id : loaded.error, manifest.id).toBe(manifest.id)
    }
  })

  it('declares a dataPath on every manifest matching its source file', () => {
    for (const manifest of getAllTrackManifests()) {
      expect(manifest.dataPath, `${manifest.id} dataPath`).toMatch(/^\.\/track-data\/.+\.json$/)
      expect(getDataTrackSourcePath(manifest.id)).toBe(manifest.dataPath)
    }
  })

  it('a missing track file loads as an error, not a throw', async () => {
    const loaded = await loadDataTrackDefinition('NOT_A_TRACK')
    expect(loaded).toEqual({ ok: false, error: 'No track JSON for NOT_A_TRACK' })
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
