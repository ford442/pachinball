/**
 * The durable half of the profile (#506 slice 1): IndexedDB through `idb-keyval`,
 * imported on first use so neither the library nor the database open is on the
 * boot path. The synchronous mirror (`local-store.ts`) answers boot; this holds
 * the copy that survives the mirror being cleared and the parts too big for
 * `localStorage` (editor drafts).
 *
 * One database (`pachinball`), one object store (`profile`), two keys:
 * `profile` (a `ProfileCore`) and `drafts` (an array of machine descriptors).
 * Values are plain JSON; readers validate them.
 */

export interface ProfileBackend {
  /** The stored profile core, unvalidated; undefined when there is none. */
  loadCore(): Promise<unknown>
  saveCore(core: object): Promise<void>
  /** The stored drafts, unvalidated; undefined when there are none. */
  loadDrafts(): Promise<unknown>
  saveDrafts(drafts: readonly object[]): Promise<void>
}

const DB_NAME = 'pachinball'
const STORE_NAME = 'profile'
const CORE_KEY = 'profile'
const DRAFTS_KEY = 'drafts'

/** IndexedDB through idb-keyval. Every call rejects if IndexedDB is unavailable; the store treats that as "no durable copy". */
export function createIdbBackend(): ProfileBackend {
  let opened: Promise<{ idb: typeof import('idb-keyval'); db: import('idb-keyval').UseStore }> | null = null
  const open = () => {
    opened ??= import('idb-keyval').then((idb) => ({ idb, db: idb.createStore(DB_NAME, STORE_NAME) }))
    return opened
  }
  return {
    async loadCore() {
      const { idb, db } = await open()
      return idb.get<unknown>(CORE_KEY, db)
    },
    async saveCore(core) {
      const { idb, db } = await open()
      await idb.set(CORE_KEY, core, db)
    },
    async loadDrafts() {
      const { idb, db } = await open()
      return idb.get<unknown>(DRAFTS_KEY, db)
    },
    async saveDrafts(drafts) {
      const { idb, db } = await open()
      await idb.set(DRAFTS_KEY, drafts, db)
    },
  }
}
