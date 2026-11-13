/**
 * Map System - Dynamic LCD table map loader
 *
 * Fetches map configurations and music tracks from the storage_manager backend.
 * Merges hardcoded fallback maps with dynamically uploaded shader-maps.
 */

import { API_BASE, apiFetch, isRemoteApiBase } from '../config'
import { TABLE_MAPS, type TableMapConfig } from '../config/table-maps'
import { assetUrl } from '../core/asset-urls'
import * as v from 'valibot'
import { parseJsonWith, pickDefined } from '../schemas/schema-kit'
import { MapCacheSchema, RemoteTableMapListSchema, type RemoteTableMap } from '../schemas/storage'

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
      const staticMaps = await this.fetchStaticMaps()
      if (staticMaps && staticMaps.length > 0) {
        this.overlayMaps(staticMaps)
      }

      if (!isRemoteApiBase(API_BASE)) {
        this.loaded = true
        console.log(`[MapSystem] Loaded ${this.maps.size} maps (static/hardcoded; skipped ${API_BASE || 'empty'} API)`)
        return
      }

      const remoteMaps = await apiFetch('/maps', RemoteTableMapListSchema)
      if (!remoteMaps || remoteMaps.length === 0) {
        this.loaded = true
        console.log(`[MapSystem] Loaded ${this.maps.size} maps (hardcoded/cache/static only)`)
        return
      }

      const sanitizedMaps = remoteMaps.map((map) => this.sanitizeRemoteMap(map))

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

  private staticMapsUrl(): string {
    return assetUrl('maps.json')
  }

  private async fetchStaticMaps(): Promise<DynamicMapConfig[] | null> {
    const controller = new AbortController()
    // eslint-disable-next-line no-restricted-syntax -- aborts its own fetch controller; cleared in the finally below
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(this.staticMapsUrl(), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        return null
      }
      const data: unknown = await response.json()
      const maps = v.safeParse(RemoteTableMapListSchema, data)
      return maps.success ? maps.output.map((map) => this.sanitizeRemoteMap(map)) : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  private resetToHardcodedMaps(): void {
    this.maps.clear()
    for (const [id, config] of Object.entries(TABLE_MAPS)) {
      this.maps.set(id, {
        ...config,
        id,
        musicTrackId: config.musicTrackId || this.inferMusicTrackId(id),
      })
    }
  }

  private overlayMaps(maps: DynamicMapConfig[]): void {
    for (const map of maps) {
      this.maps.set(map.id, {
        ...map,
        musicTrackId: map.musicTrackId || this.inferMusicTrackId(map.id),
      })
    }
  }

  private mergeMaps(maps: DynamicMapConfig[]): void {
    this.resetToHardcodedMaps()
    this.overlayMaps(maps)
  }

  /** A parsed remote / cached map, its missing or mistyped fields filled from the built-in map of that id (or defaults). */
  private sanitizeRemoteMap(map: RemoteTableMap): DynamicMapConfig {
    const fallback = TABLE_MAPS[map.id]
    return {
      ...fallback,
      ...pickDefined(map),
      id: map.id,
      name: map.name,
      baseColor: map.baseColor ?? fallback?.baseColor ?? '#00d9ff',
      accentColor: map.accentColor ?? fallback?.accentColor ?? '#ff00aa',
      scanlineIntensity: map.scanlineIntensity ?? fallback?.scanlineIntensity ?? 0.2,
      pixelGridIntensity: map.pixelGridIntensity ?? fallback?.pixelGridIntensity ?? 0.6,
      subpixelIntensity: map.subpixelIntensity ?? fallback?.subpixelIntensity ?? 0.35,
      glowIntensity: map.glowIntensity ?? fallback?.glowIntensity ?? 1.0,
      animationSpeed: map.animationSpeed ?? fallback?.animationSpeed ?? 0.5,
      backgroundPattern: map.backgroundPattern ?? fallback?.backgroundPattern ?? 'none',
      musicTrackId: map.musicTrackId ?? fallback?.musicTrackId ?? this.inferMusicTrackId(map.id),
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

      const parsed = parseJsonWith(MapCacheSchema, raw)
      if (!parsed || parsed.expiresAt < Date.now()) {
        localStorage.removeItem(MapSystem.CACHE_KEY)
        return null
      }

      return parsed.maps.map((map) => this.sanitizeRemoteMap(map))
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
