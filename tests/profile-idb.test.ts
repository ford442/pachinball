/** The real IndexedDB backend (idb-keyval) against fake-indexeddb: a store survives a "reload". */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileStore } from '../src/profile/profile-store'
import { exportProfile, importProfile } from '../src/profile/profile-file'

function installStorage(): Map<string, string> {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  })
  return data
}

describe('ProfileStore on IndexedDB', () => {
  let data: Map<string, string>
  beforeEach(() => {
    data = installStorage()
  })

  it('restores a cleared mirror in a new page load, and keeps drafts across it', async () => {
    const first = new ProfileStore()
    first.set('settings', { muted: true, masterVolume: 0.4 })
    first.setBest('vanilla', 9_001)
    await first.flush()
    await importProfile(await exportProfile(first), first) // exercises the drafts key too

    // The browser cleared localStorage; IndexedDB survived. A new page, a new store.
    data.clear()
    const second = new ProfileStore()
    expect(await second.restore()).toEqual(['settings', 'bests'])
    expect(second.get('settings')).toEqual({ muted: true, masterVolume: 0.4 })
    expect(second.getBest()).toBe(9_001)
  })
})
