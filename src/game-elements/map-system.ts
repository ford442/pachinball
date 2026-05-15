/**
 * Map System - Dynamic LCD table map loader
 *
 * Fetches map configurations and music tracks from the storage_manager backend.
 * Merges hardcoded fallback maps with dynamically uploaded shader-maps.
 */

import { TABLE_MAPS, type TableMapConfig, type TableMapType } from '../shaders/lcd-table'

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
  private maps: Map<string, DynamicMapConfig> = new Map()
  private musicTracks: MusicTrack[] = []
  private loaded = false
  private loadPromise: Promise<void> | null = null

  constructor() {
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
    // Hardcoded maps only — no backend
    this.loaded = true
    console.log(`[MapSystem] Loaded ${this.maps.size} hardcoded maps`)
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

export function getMapSystem(): MapSystem {
  if (!mapSystemInstance) {
    mapSystemInstance = new MapSystem()
  }
  return mapSystemInstance
}

export function resetMapSystem(): void {
  mapSystemInstance = null
}
