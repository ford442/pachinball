/**
 * Map System - Dynamic LCD table map loader
 *
 * Fetches map configurations from the storage_manager backend.
 * Merges hardcoded fallback maps with dynamically uploaded shader-maps.
 */

import { TABLE_MAPS, type TableMapConfig, type TableMapType } from '../shaders/lcd-table'

const STORAGE_API_BASE = 'http://localhost:8000/api'

export interface DynamicMapConfig extends TableMapConfig {
  id: string
  musicTrackId?: string
  shaderUrl?: string
}

export class MapSystem {
  private maps: Map<string, DynamicMapConfig> = new Map()
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

  /**
   * Fetch dynamic maps from the backend.
   * Falls back to hardcoded maps if the backend is unreachable.
   */
  async fetchMaps(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.doFetch()
    return this.loadPromise
  }

  private async doFetch(): Promise<void> {
    try {
      const response = await fetch(`${STORAGE_API_BASE}/maps`)
      if (!response.ok) {
        console.warn('[MapSystem] Backend unavailable, using hardcoded maps')
        return
      }

      const data = await response.json()
      const dynamicMaps: DynamicMapConfig[] = data.maps || []

      for (const map of dynamicMaps) {
        // Validate required fields
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
        })
      }

      this.loaded = true
      console.log(`[MapSystem] Loaded ${dynamicMaps.length} dynamic maps`)
    } catch (err) {
      console.warn('[MapSystem] Failed to fetch maps:', err)
    }
  }

  /**
   * Re-fetch maps from the backend and update the registry.
   */
  async refresh(): Promise<void> {
    this.loadPromise = null
    await this.fetchMaps()
  }

  /**
   * Get a map configuration by ID.
   */
  getMap(id: string): DynamicMapConfig | undefined {
    return this.maps.get(id)
  }

  /**
   * Get all available map IDs.
   */
  getMapIds(): string[] {
    return Array.from(this.maps.keys())
  }

  /**
   * Get all map configurations.
   */
  getAllMaps(): DynamicMapConfig[] {
    return Array.from(this.maps.values())
  }

  /**
   * Check if maps have been fetched from the backend.
   */
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
