/**
 * Map System - Dynamic LCD table map loader
 *
 * Fetches map configurations and music tracks from the storage_manager backend.
 * Merges hardcoded fallback maps with dynamically uploaded shader-maps.
 */

import { TABLE_MAPS, type TableMapConfig, type TableMapType } from '../shaders/lcd-table'
import { API_BASE } from '../config'

const DEFAULT_API_BASE = API_BASE

export interface DynamicMapConfig extends TableMapConfig {
  id: string
}

export interface MusicTrack {
  id: string
  title: string
  artist: string
  url: string
  duration: number
  map_id?: string
}

export class MapSystem {
  private apiBase: string
  private maps: Map<string, DynamicMapConfig> = new Map()
  private musicTracks: MusicTrack[] = []
  private loaded = false
  private loadPromise: Promise<void> | null = null

  constructor(apiBase?: string) {
    this.apiBase = apiBase || DEFAULT_API_BASE

    // Seed with hardcoded fallback maps
    const hardcoded: TableMapType[] = Object.keys(TABLE_MAPS) as TableMapType[]
    for (const id of hardcoded) {
      const config = TABLE_MAPS[id]
      this.maps.set(id, {
        ...config,
        id,
        musicTrackId: this.inferMusicTrackId(id),
      })
    }
  }

  async fetchAll(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.doFetch()
    return this.loadPromise
  }

  private async doFetch(): Promise<void> {
    // Fetch maps and music in parallel
    const [mapsOk, musicOk] = await Promise.all([
      this.fetchMaps(),
      this.fetchMusic(),
    ])
    this.loaded = mapsOk
    if (mapsOk) {
      console.log(`[MapSystem] Loaded ${this.maps.size} maps`)
    }
    if (musicOk) {
      console.log(`[MapSystem] Loaded ${this.musicTracks.length} music tracks`)
    }
  }

  private async fetchMaps(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/maps`)
      if (!response.ok) {
        console.warn('[MapSystem] Backend maps unavailable, using hardcoded maps')
        return false
      }

      const data = await response.json()
      const dynamicMaps: DynamicMapConfig[] = data.maps || []

      for (const map of dynamicMaps) {
        if (!map.id || !map.name) continue

        this.maps.set(map.id, {
          name: map.name,
          baseColor: map.baseColor || '#00d9ff',
          accentColor: map.accentColor || '#ffffff',
          scanlineIntensity: Number.isFinite(map.scanlineIntensity) ? map.scanlineIntensity : 0.25,
          pixelGridIntensity: Number.isFinite(map.pixelGridIntensity) ? map.pixelGridIntensity : 0.8,
          subpixelIntensity: Number.isFinite(map.subpixelIntensity) ? map.subpixelIntensity : 0.6,
          glowIntensity: Number.isFinite(map.glowIntensity) ? map.glowIntensity : 1.0,
          backgroundPattern: (map.backgroundPattern as TableMapConfig['backgroundPattern']) || 'hex',
          animationSpeed: Number.isFinite(map.animationSpeed) ? map.animationSpeed : 0.5,
          id: map.id,
          musicTrackId: map.musicTrackId || map.id,
          shaderUrl: map.shaderUrl,
          adventureGoals: Array.isArray(map.adventureGoals) ? map.adventureGoals : undefined,
        })
      }

      return true
    } catch (err) {
      console.warn('[MapSystem] Failed to fetch maps:', err)
      return false
    }
  }

  private async fetchMusic(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/music`)
      if (!response.ok) {
        console.warn('[MapSystem] Backend music unavailable')
        return false
      }
      const data = await response.json()
      this.musicTracks = data.tracks || []
      return true
    } catch (err) {
      console.warn('[MapSystem] Failed to fetch music:', err)
      return false
    }
  }

  async refresh(): Promise<void> {
    // Clear dynamic entries but keep hardcoded fallbacks
    const hardcoded = Object.keys(TABLE_MAPS)
    for (const id of this.maps.keys()) {
      if (!hardcoded.includes(id)) {
        this.maps.delete(id)
      }
    }
    this.musicTracks = []
    this.loadPromise = null
    await this.fetchAll()
  }

  getMap(id: string): DynamicMapConfig | undefined {
    return this.maps.get(id)
  }

  getMapIds(): string[] {
    return Array.from(this.maps.keys())
  }

  getAllMaps(): DynamicMapConfig[] {
    return Array.from(this.maps.values())
  }

  getMusicTracks(): MusicTrack[] {
    return [...this.musicTracks]
  }

  getMusicTrackForMap(mapId: string): MusicTrack | undefined {
    return this.musicTracks.find((t) => t.map_id === mapId)
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  inferMusicTrackId(mapId: string): string {
    const legacyMapping: Record<string, string> = {
      'neon-helix': '1',
      'cyber-core': '2',
      'quantum-grid': '3',
      'singularity-well': '4',
      'glitch-spire': '5',
      'matrix-core': '6',
      'cyan-void': '7',
      'magenta-dream': '8',
    }
    return legacyMapping[mapId] || mapId
  }
}

let mapSystemInstance: MapSystem | null = null

export function getMapSystem(apiBase?: string): MapSystem {
  if (!mapSystemInstance) {
    mapSystemInstance = new MapSystem(apiBase)
  }
  return mapSystemInstance
}

export function resetMapSystem(): void {
  mapSystemInstance = null
}
