/**
 * The only module in `src/` that touches `localStorage` (ESLint bans the global
 * everywhere else, #506 slice 1). Two kinds of keys go through it:
 *
 *  - the profile mirror: `ProfileStore`'s synchronous copy of the small,
 *    boot-critical parts of the player profile (settings, campaign, bests …),
 *    so boot reads them without waiting for IndexedDB (`docs/SCHEMAS.md`);
 *  - device-local keys that are not part of the portable profile: the renderer
 *    and physics-engine flags, caches, debug switches, the arcade session and
 *    queue, saved replays.
 *
 * `localStorage` is resolved on every call, never captured: it can be absent
 * (Node, a Worker), blocked (private windows, disabled site data) or replaced
 * by a test. Nothing in here throws.
 *
 * Boot-safe and Worker-safe: no DOM types, no imports.
 */

interface LocalStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): LocalStorageLike | null {
  try {
    return (globalThis as { localStorage?: LocalStorageLike }).localStorage ?? null
  } catch {
    return null // reading the property throws when site data is blocked
  }
}

/** The stored text for `key`; null when absent or storage is unavailable. */
export function readLocal(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Store `value`; false when storage is unavailable or full (the value then lasts for this page only). */
export function writeLocal(key: string, value: string): boolean {
  try {
    const store = storage()
    if (!store) return false
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeLocal(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/** The `Storage` subset a consumer that takes an injectable store needs, backed by this module. */
export const localStore = {
  getItem: readLocal,
  setItem: (key: string, value: string): void => {
    writeLocal(key, value)
  },
  removeItem: removeLocal,
} as const
