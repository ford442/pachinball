import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}))

vi.mock('../src/config', () => ({
  API_BASE: 'https://example.test/api',
  apiFetch: apiFetchMock,
}))

import { MapSystem } from '../src/game-elements/map-system'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

describe('MapSystem', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorage(),
      configurable: true,
    })
  })

  it('merges remote maps into the hardcoded registry and lets remote override local ids', async () => {
    apiFetchMock.mockResolvedValue([
      {
        id: 'neon-helix',
        name: 'Neon Helix Remix',
        baseColor: '#112233',
        accentColor: '#445566',
        scanlineIntensity: 0.4,
        pixelGridIntensity: 0.3,
        subpixelIntensity: 0.2,
        glowIntensity: 1.7,
        backgroundPattern: 'grid',
        animationSpeed: 0.9,
        description: 'override',
      },
      {
        id: 'solstice-run',
        name: 'Solstice Run',
        baseColor: '#abcdef',
        accentColor: '#fedcba',
        scanlineIntensity: 0.15,
        pixelGridIntensity: 0.55,
        subpixelIntensity: 0.25,
        glowIntensity: 1.2,
        backgroundPattern: 'hex',
        animationSpeed: 0.45,
        playfieldImage: '/maps/solstice.png',
      },
    ])

    const system = new MapSystem()
    await system.fetchAll()

    expect(apiFetchMock).toHaveBeenCalledWith('/maps')
    expect(system.isLoaded).toBe(true)
    expect(system.isLoading).toBe(false)
    expect(system.loadError).toBeNull()
    expect(system.getMap('neon-helix')?.name).toBe('Neon Helix Remix')
    expect(system.getMap('solstice-run')?.playfieldImage).toBe('/maps/solstice.png')
    expect(system.getMapIds()).toContain('solstice-run')
    expect(system.getMapIds().length).toBeGreaterThan(8)
  })

  it('falls back to cached maps when the network request fails', async () => {
    localStorage.setItem('pachinball.maps.cache.v2', JSON.stringify({
      expiresAt: Date.now() + 60_000,
      maps: [
        {
          id: 'cached-run',
          name: 'Cached Run',
          baseColor: '#101010',
          accentColor: '#202020',
          scanlineIntensity: 0.1,
          pixelGridIntensity: 0.2,
          subpixelIntensity: 0.3,
          glowIntensity: 1.1,
          backgroundPattern: 'circuit',
          animationSpeed: 0.25,
        },
      ],
    }))
    apiFetchMock.mockRejectedValue(new Error('offline'))

    const system = new MapSystem()
    await system.fetchAll()

    expect(system.isLoaded).toBe(true)
    expect(system.getMap('cached-run')?.name).toBe('Cached Run')
    expect(system.getMap('neon-helix')).toBeDefined()
    expect(system.loadError).toBe('offline')
  })

  it('clears stale cache on refresh and replaces it with fresh remote data', async () => {
    apiFetchMock
      .mockResolvedValueOnce([
        {
          id: 'spring-grid',
          name: 'Spring Grid',
          baseColor: '#303030',
          accentColor: '#404040',
          scanlineIntensity: 0.2,
          pixelGridIntensity: 0.4,
          subpixelIntensity: 0.3,
          glowIntensity: 1.0,
          backgroundPattern: 'data-flow',
          animationSpeed: 0.5,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'summer-grid',
          name: 'Summer Grid',
          baseColor: '#505050',
          accentColor: '#606060',
          scanlineIntensity: 0.25,
          pixelGridIntensity: 0.45,
          subpixelIntensity: 0.35,
          glowIntensity: 1.05,
          backgroundPattern: 'none',
          animationSpeed: 0.55,
        },
      ])

    const system = new MapSystem()
    await system.fetchAll()
    expect(system.getMap('spring-grid')).toBeDefined()

    await system.refresh()

    expect(system.getMap('spring-grid')).toBeUndefined()
    expect(system.getMap('summer-grid')).toBeDefined()
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
  })
})
