/** ProfileStore (#506 slice 1): the localStorage mirror, the durable copy, restore, export / import. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProfileStore, profileKey } from '../src/profile/profile-store'
import { exportProfile, importProfile } from '../src/profile/profile-file'
import { snapshotProfile } from '../src/profile/profile-durable'
import { readLocal, removeLocal, writeLocal } from '../src/profile/local-store'
import type { ProfileBackend } from '../src/profile/profile-backend'
import { PROFILE_VERSION } from '../src/schemas/profile-core'

const classic: object = JSON.parse(readFileSync(join(__dirname, '../public/machines/classic.json'), 'utf8')) as object

function installStorage(): Map<string, string> {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  })
  return data
}

/** An in-memory durable copy that counts its writes. */
function memoryBackend(initial: { core?: unknown; drafts?: unknown } = {}) {
  const state = { core: initial.core, drafts: initial.drafts, coreSaves: 0 }
  const backend: ProfileBackend = {
    loadCore: () => Promise.resolve(state.core),
    saveCore: (core) => {
      state.core = JSON.parse(JSON.stringify(core))
      state.coreSaves++
      return Promise.resolve()
    },
    loadDrafts: () => Promise.resolve(state.drafts),
    saveDrafts: (drafts) => {
      state.drafts = JSON.parse(JSON.stringify(drafts))
      return Promise.resolve()
    },
  }
  return { state, backend }
}

let data: Map<string, string>
let clock = 1_000
const now = () => clock++

beforeEach(() => {
  data = installStorage()
  clock = 1_000
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('local-store', () => {
  it('never throws when storage is missing or blocked', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readLocal('a')).toBeNull()
    expect(writeLocal('a', '1')).toBe(false)
    expect(() => removeLocal('a')).not.toThrow()

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readLocal('a')).toBeNull()
    expect(writeLocal('a', '1')).toBe(false)
    expect(() => removeLocal('a')).not.toThrow()
  })
})

describe('parts and the mirror', () => {
  it('keeps the keys earlier builds wrote, so no data has to move', () => {
    expect(profileKey('settings')).toBe('pachinball.settings')
    expect(profileKey('campaign')).toBe('pachinball.campaign.rewards.v1')
    expect(profileKey('adventure')).toBe('pachinball_adventure_progress')
    expect(profileKey('scoringBreakdown')).toBe('pachinball.scoring-breakdown')
  })

  it('reads a record an older build stored, and drops a field of the wrong type', () => {
    data.set('pachinball.settings', JSON.stringify({ muted: true, masterVolume: 'loud' }))
    const store = new ProfileStore({ backend: null })
    expect(store.get('settings')).toEqual({ muted: true })
  })

  it('round-trips a part through the mirror and returns null for an absent or unreadable one', () => {
    const store = new ProfileStore({ backend: null })
    expect(store.get('bests')).toBeNull()
    store.set('bests', { vanilla: 500 })
    expect(JSON.parse(data.get('pachinball.bests') ?? 'null')).toEqual({ vanilla: 500 })
    expect(store.get('bests')).toEqual({ vanilla: 500 })
    data.set('pachinball.bests', '{nope')
    expect(store.get('bests')).toBeNull()
    store.remove('bests')
    expect(data.has('pachinball.bests')).toBe(false)
  })

  it('moves the single pre-profile best into bests on first read', () => {
    data.set('pachinball.best', '4200')
    const store = new ProfileStore({ backend: null })
    expect(store.getBest()).toBe(4200)
    expect(data.has('pachinball.best')).toBe(false)
    expect(store.get('bests')).toEqual({ vanilla: 4200 })
    store.setBest('classic', 99.9)
    expect(store.getBest('classic')).toBe(99)
    expect(store.getBest()).toBe(4200)
    expect(store.getBest('never-played')).toBe(0)
  })

  it('treats a garbage legacy best as no best', () => {
    data.set('pachinball.best', 'abc')
    expect(new ProfileStore({ backend: null }).getBest()).toBe(0)
  })
})

describe('durable copy', () => {
  it('coalesces the writes of one tick into one snapshot of the latest state', async () => {
    const { state, backend } = memoryBackend()
    const store = new ProfileStore({ backend, now })
    store.set('settings', { muted: true })
    store.set('settings', { muted: false, masterVolume: 0.3 })
    store.setBest('vanilla', 10)
    expect(state.coreSaves).toBe(0)
    await store.flush()
    expect(state.coreSaves).toBe(1)
    expect(state.core).toMatchObject({
      version: PROFILE_VERSION,
      settings: { muted: false, masterVolume: 0.3 },
      bests: { vanilla: 10 },
    })
    store.setBest('vanilla', 20)
    await store.flush()
    expect(state.coreSaves).toBe(2)
  })

  it('a write that lands while a save is in flight is saved too', async () => {
    const saves: unknown[] = []
    let release: () => void = () => undefined
    const backend: ProfileBackend = {
      loadCore: () => Promise.resolve(undefined),
      saveCore: async (core) => {
        saves.push(JSON.parse(JSON.stringify(core)))
        if (saves.length === 1) await new Promise<void>((resolve) => { release = resolve })
      },
      loadDrafts: () => Promise.resolve(undefined),
      saveDrafts: () => Promise.resolve(),
    }
    const store = new ProfileStore({ backend, now })
    store.setBest('vanilla', 1)
    await vi.waitFor(() => expect(saves).toHaveLength(1)) // the first save is now in flight
    store.setBest('vanilla', 2)
    release()
    await store.flush()
    expect(saves).toHaveLength(2)
    expect(saves[1]).toMatchObject({ bests: { vanilla: 2 } })
  })

  it('a backend that fails costs the durable copy, never the mirror, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const backend: ProfileBackend = {
      loadCore: () => Promise.reject(new Error('no idb')),
      saveCore: () => Promise.reject(new Error('no idb')),
      loadDrafts: () => Promise.reject(new Error('no idb')),
      saveDrafts: () => Promise.reject(new Error('no idb')),
    }
    const store = new ProfileStore({ backend, now })
    store.setBest('vanilla', 5)
    await store.flush()
    store.setBest('vanilla', 6)
    await store.flush()
    expect(store.getBest()).toBe(6)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('restore', () => {
  const core = {
    version: PROFILE_VERSION,
    updatedAt: 5_000,
    settings: { muted: true },
    bests: { vanilla: 7000 },
    achievements: ['first-fever'],
  }

  it('refills a mirror the browser cleared from the durable copy', async () => {
    const { backend } = memoryBackend({ core })
    const store = new ProfileStore({ backend, now })
    expect(await store.restore()).toEqual(['settings', 'bests', 'achievements'])
    expect(store.get('settings')).toEqual({ muted: true })
    expect(store.getBest()).toBe(7000)
    expect(snapshotProfile(store).updatedAt).toBe(5_000)
  })

  it('keeps a part the mirror still has', async () => {
    data.set('pachinball.settings', JSON.stringify({ muted: false }))
    const { backend } = memoryBackend({ core })
    const store = new ProfileStore({ backend, now })
    expect(await store.restore()).toEqual(['bests', 'achievements'])
    expect(store.get('settings')).toEqual({ muted: false })
  })

  it('leaves a stamped mirror alone and does not open the durable copy', async () => {
    const { backend } = memoryBackend({ core })
    const loadCore = vi.spyOn(backend, 'loadCore')
    const store = new ProfileStore({ backend, now })
    store.setBest('vanilla', 1)
    await store.flush()
    expect(await store.restore()).toEqual([])
    expect(loadCore).not.toHaveBeenCalled()
    expect(store.getBest()).toBe(1)
  })

  it('on an upgrade (parts, no stamp) seeds the durable copy', async () => {
    data.set('pachinball.settings', JSON.stringify({ muted: true }))
    const { state, backend } = memoryBackend()
    const store = new ProfileStore({ backend, now })
    expect(await store.restore()).toEqual([])
    await store.flush()
    expect(state.core).toMatchObject({ settings: { muted: true } })
    expect(data.has('pachinball.profile.meta')).toBe(true)
  })

  it('a fresh install writes nothing', async () => {
    const { state, backend } = memoryBackend()
    const store = new ProfileStore({ backend, now })
    expect(await store.restore()).toEqual([])
    await store.flush()
    expect(state.coreSaves).toBe(0)
    expect(data.size).toBe(0)
  })

  it('ignores an unreadable stored profile and a failing backend', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await new ProfileStore({ backend: memoryBackend({ core: { version: 99 } }).backend }).restore()).toEqual([])
    const failing: ProfileBackend = { ...memoryBackend().backend, loadCore: () => Promise.reject(new Error('blocked')) }
    expect(await new ProfileStore({ backend: failing }).restore()).toEqual([])
    expect(data.size).toBe(0)
    warn.mockRestore()
  })

  it('works with no IndexedDB at all', async () => {
    expect(await new ProfileStore({ backend: null }).restore()).toEqual([])
  })
})

describe('export / import', () => {
  function populated() {
    const mem = memoryBackend({ drafts: [classic] })
    const store = new ProfileStore({ backend: mem.backend, now })
    store.set('settings', { muted: true, masterVolume: 0.25, reducedMotion: true })
    store.set('keyBindings', { flipperLeft: ['KeyZ', 'ShiftLeft'] })
    store.writeText('campaign', JSON.stringify({ version: 2, progression: { unlockedTracks: ['NEON_HELIX'], currentTrack: 'NEON_HELIX' }, unlockedRewardIds: ['r1'], equippedRewards: {} }))
    store.setBest('vanilla', 12_000)
    store.set('achievements', ['first-fever', 'ghost-win'])
    return { store, mem }
  }

  it('round-trips: export, import on a fresh store, export again', async () => {
    const { store } = populated()
    const first = await exportProfile(store)

    data.clear()
    const fresh = memoryBackend()
    const other = new ProfileStore({ backend: fresh.backend, now })
    const result = await importProfile(first, other)
    expect(result).toMatchObject({ ok: true, draftsKept: true })

    const strip = (text: string): unknown => {
      const { exportedAt: _exportedAt, updatedAt: _updatedAt, ...rest } = JSON.parse(text) as Record<string, unknown>
      return rest
    }
    expect(strip(await exportProfile(other))).toEqual(strip(first))
    expect(fresh.state.drafts).toHaveLength(1)
    expect(other.getBest()).toBe(12_000)
    // The import reached the durable copy, not only the mirror.
    expect(fresh.state.core).toMatchObject({ bests: { vanilla: 12_000 }, achievements: ['first-fever', 'ghost-win'] })
  })

  it('exports a v2 profile with its drafts', async () => {
    const { store } = populated()
    const parsed = JSON.parse(await exportProfile(store)) as Record<string, unknown>
    expect(parsed.version).toBe(PROFILE_VERSION)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(Array.isArray(parsed.drafts)).toBe(true)
  })

  it('replaces the profile: parts the file omits are removed', async () => {
    const { store } = populated()
    const result = await importProfile(JSON.stringify({ version: PROFILE_VERSION, settings: { muted: false } }), store)
    expect(result.ok).toBe(true)
    expect(store.get('settings')).toEqual({ muted: false })
    expect(store.get('achievements')).toBeNull()
    expect(store.get('keyBindings')).toBeNull()
    expect(store.getBest()).toBe(0)
  })

  it('migrates a v1 file', async () => {
    const store = new ProfileStore({ backend: null, now })
    const result = await importProfile(JSON.stringify({ version: 1, settings: { muted: true }, bests: { vanilla: 3 } }), store)
    expect(result.ok).toBe(true)
    expect(store.getBest()).toBe(3)
    expect(snapshotProfile(store).version).toBe(PROFILE_VERSION)
  })

  it('refuses a bad file without touching the profile', async () => {
    const { store } = populated()
    const before = JSON.stringify(snapshotProfile(store))
    for (const text of ['{nope', JSON.stringify({ version: PROFILE_VERSION + 1, settings: {} }), JSON.stringify({ version: PROFILE_VERSION, settings: {}, bests: { a: -1 } }), '[]']) {
      const result = await importProfile(text, store)
      expect(result.ok).toBe(false)
    }
    expect(JSON.stringify(snapshotProfile(store))).toBe(before)
  })

  it('reports drafts it cannot keep when the page has no IndexedDB', async () => {
    const store = new ProfileStore({ backend: null, now })
    const withDrafts = await importProfile(JSON.stringify({ version: PROFILE_VERSION, settings: {}, drafts: [classic] }), store)
    expect(withDrafts).toMatchObject({ ok: true, draftsKept: false })
    const without = await importProfile(JSON.stringify({ version: PROFILE_VERSION, settings: {} }), store)
    expect(without).toMatchObject({ ok: true, draftsKept: true })
  })
})
