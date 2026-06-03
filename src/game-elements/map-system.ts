/**
 * Map System - Dynamic LCD table map loader
 *
 * Fetches map configurations and music tracks from the storage_manager backend.
 * Merges hardcoded fallback maps with dynamically uploaded shader-maps.
 */

import { API_BASE, apiFetch } from '../config'
import { TABLE_MAPS, type TableMapConfig, type TableMapType } from '../shaders/lcd-table'

export interface DynamicMapConfig extends TableMapConfig {
  id: string
  description?: string
  playfieldImage?: string
  playfieldVideo?: string
  cabinetTheme?: string
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
  private static readonly CACHE_KEY = 'pachinball.maps.cache.v2'
  private static readonly CACHE_TTL_MS = 1000 * 60 * 60

  private maps: Map<string, DynamicMapConfig> = new Map()
  private musicTracks: MusicTrack[] = []
  private loaded = false
  private loading = false
  private loadPromise: Promise<void> | null = null
  private error: string | null = null

  constructor() {
    this.resetToHardcodedMaps()
  }

  async fetchAll(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.doFetch()
    return this.loadPromise
  }

  private async doFetch(): Promise<void> {
    this.loading = true
    this.error = null

    const cachedMaps = this.readCache()
    if (cachedMaps) {
      this.mergeMaps(cachedMaps)
    } else {
      this.resetToHardcodedMaps()
    }

    try {
      const remoteMaps = await apiFetch<DynamicMapConfig[]>(`${API_BASE}/maps`)
      if (!remoteMaps || remoteMaps.length === 0) {
        this.loaded = true
        console.log(`[MapSystem] Loaded ${this.maps.size} maps (hardcoded/cache only)`)
        return
      }

      const sanitizedMaps = remoteMaps
        .map((map) => this.sanitizeRemoteMap(map))
        .filter((map): map is DynamicMapConfig => map !== null)

      this.mergeMaps(sanitizedMaps)
      this.writeCache(sanitizedMaps)
      this.loaded = true
      console.log(`[MapSystem] Loaded ${this.maps.size} maps (${sanitizedMaps.length} remote)`)
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load maps'
      this.loaded = true
      console.warn('[MapSystem] Failed to fetch remote maps, using fallback registry', error)
    } finally {
      this.loading = false
    }
  }

  async refresh(): Promise<void> {
    this.clearCache()
    this.resetToHardcodedMaps()
    this.musicTracks = []
    this.loadPromise = null
    this.loaded = false
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

  get isLoading(): boolean {
    return this.loading
  }

  get loadError(): string | null {
    return this.error
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

  private resetToHardcodedMaps(): void {
    this.maps.clear()
    const hardcoded: TableMapType[] = Object.keys(TABLE_MAPS) as TableMapType[]
    for (const id of hardcoded) {
      const config = TABLE_MAPS[id]
      this.maps.set(id, {
        ...config,
        id,
        musicTrackId: config.musicTrackId || this.inferMusicTrackId(id),
      })
    }
  }

  private mergeMaps(maps: DynamicMapConfig[]): void {
    this.resetToHardcodedMaps()
    for (const map of maps) {
      this.maps.set(map.id, {
        ...map,
        musicTrackId: map.musicTrackId || this.inferMusicTrackId(map.id),
      })
    }
  }

  private sanitizeRemoteMap(map: DynamicMapConfig | null | undefined): DynamicMapConfig | null {
    if (!map || typeof map.id !== 'string' || typeof map.name !== 'string') {
      return null
    }

    const fallback = TABLE_MAPS[map.id]
    const backgroundPattern = this.isValidBackgroundPattern(map.backgroundPattern)
      ? map.backgroundPattern
      : fallback?.backgroundPattern || 'none'

    return {
      ...fallback,
      ...map,
      id: map.id,
      name: map.name,
      baseColor: map.baseColor || fallback?.baseColor || '#00d9ff',
      accentColor: map.accentColor || fallback?.accentColor || '#ff00aa',
      scanlineIntensity: this.coerceNumber(map.scanlineIntensity, fallback?.scanlineIntensity ?? 0.2),
      pixelGridIntensity: this.coerceNumber(map.pixelGridIntensity, fallback?.pixelGridIntensity ?? 0.6),
      subpixelIntensity: this.coerceNumber(map.subpixelIntensity, fallback?.subpixelIntensity ?? 0.35),
      glowIntensity: this.coerceNumber(map.glowIntensity, fallback?.glowIntensity ?? 1.0),
      animationSpeed: this.coerceNumber(map.animationSpeed, fallback?.animationSpeed ?? 0.5),
      backgroundPattern,
      musicTrackId: map.musicTrackId || fallback?.musicTrackId || this.inferMusicTrackId(map.id),
    }
  }

  private readCache(): DynamicMapConfig[] | null {
    if (typeof localStorage === 'undefined') {
      return null
    }

    try {
      const raw = localStorage.getItem(MapSystem.CACHE_KEY)
      if (!raw) {
        return null
      }

      const parsed = JSON.parse(raw) as {
        expiresAt?: number
        maps?: DynamicMapConfig[]
      }

      if (!parsed.expiresAt || parsed.expiresAt < Date.now() || !Array.isArray(parsed.maps)) {
        localStorage.removeItem(MapSystem.CACHE_KEY)
        return null
      }

      return parsed.maps
        .map((map) => this.sanitizeRemoteMap(map))
        .filter((map): map is DynamicMapConfig => map !== null)
    } catch (error) {
      console.warn('[MapSystem] Failed to read map cache', error)
      return null
    }
  }

  private writeCache(maps: DynamicMapConfig[]): void {
    if (typeof localStorage === 'undefined') {
      return
    }

    try {
      localStorage.setItem(MapSystem.CACHE_KEY, JSON.stringify({
        expiresAt: Date.now() + MapSystem.CACHE_TTL_MS,
        maps,
      }))
    } catch (error) {
      console.warn('[MapSystem] Failed to write map cache', error)
    }
  }

  private clearCache(): void {
    if (typeof localStorage === 'undefined') {
      return
    }

    try {
      localStorage.removeItem(MapSystem.CACHE_KEY)
    } catch (error) {
      console.warn('[MapSystem] Failed to clear map cache', error)
    }
  }

  private coerceNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private isValidBackgroundPattern(
    pattern: TableMapConfig['backgroundPattern'] | string | undefined
  ): pattern is TableMapConfig['backgroundPattern'] {
    return pattern === 'hex'
      || pattern === 'grid'
      || pattern === 'circuit'
      || pattern === 'data-flow'
      || pattern === 'none'
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
