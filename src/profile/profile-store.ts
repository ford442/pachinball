/**
 * `ProfileStore` (#506 slice 1): the one owner of the player's persistent
 * state — settings, key bindings, campaign progress, legacy adventure progress,
 * the scoring breakdown, per-machine bests and achievements (the portable
 * `Profile`, `src/schemas/profile.ts`).
 *
 * Two layers:
 *  - the **mirror** (`local-store.ts`, `localStorage`): every part, read and
 *    written synchronously, so boot never waits (`docs/SCHEMAS.md`). Each part
 *    keeps the key an earlier build used, so no data moves and an old build
 *    still reads it;
 *  - the **durable copy** (`profile-durable.ts` + `profile-backend.ts`, IndexedDB
 *    via `idb-keyval`, all lazy): every write schedules one coalesced snapshot
 *    of all parts there, and {@link ProfileStore.restore} refills a mirror the
 *    browser cleared from it. Only the mirror is on the boot path.
 *
 * The store holds no copy of any value — reads always parse the mirror — so it
 * has nothing to reset between two `Game`s and a test that swaps `localStorage`
 * sees the swap. Editor drafts are too big for the mirror and live in the
 * durable copy only (`profile-file.ts`).
 *
 * Presentation / persistence only: nothing in the sim reads it.
 */

import * as v from 'valibot'
import { parseJsonWith } from '../schemas/record-kit'
import { StoredSettingsSchema } from '../schemas/settings'
import { ScoringBreakdownSchema, StoredAdventureProgressSchema, StoredCampaignSchema } from '../schemas/storage'
import { AchievementsSchema, BestsSchema, KeyBindingsSchema } from '../schemas/profile-core'
import { createIdbBackend, type ProfileBackend } from './profile-backend'
import { readLocal, removeLocal, writeLocal } from './local-store'

/**
 * Each part's mirror key and schema. The keys are the ones earlier builds wrote
 * (settings, campaign, adventure, scoring breakdown) or new ones (the rest).
 */
const PARTS = {
  settings: { key: 'pachinball.settings', schema: StoredSettingsSchema },
  keyBindings: { key: 'pachinball.keybindings', schema: KeyBindingsSchema },
  campaign: { key: 'pachinball.campaign.rewards.v1', schema: StoredCampaignSchema },
  adventure: { key: 'pachinball_adventure_progress', schema: StoredAdventureProgressSchema },
  scoringBreakdown: { key: 'pachinball.scoring-breakdown', schema: ScoringBreakdownSchema },
  bests: { key: 'pachinball.bests', schema: BestsSchema },
  achievements: { key: 'pachinball.achievements', schema: AchievementsSchema },
} as const

export type ProfilePart = keyof typeof PARTS
export type PartValue<P extends ProfilePart> = v.InferOutput<(typeof PARTS)[P]['schema']>

/** Every part, in the order a snapshot lists them. */
export const PROFILE_PART_NAMES = Object.keys(PARTS) as ProfilePart[]

/** The mirror key of a part (the campaign save's key is also its export file's and cloud slot's identity). */
export function profileKey(part: ProfilePart): string {
  return PARTS[part].key
}

/** When the mirror was last written; absent until a build with this store has written it. */
const META_KEY = 'pachinball.profile.meta'
const MetaSchema = v.object({ updatedAt: v.pipe(v.number(), v.finite()) })

/** Before per-machine bests, the one best score was a bare number under this key. */
const LEGACY_BEST_KEY = 'pachinball.best'
/** The built-in table's id in `bests`. */
const VANILLA_MACHINE_ID = 'vanilla'

export interface ProfileStoreOptions {
  /** The durable copy; default is IndexedDB when the page has it, none otherwise. */
  backend?: ProfileBackend | null
  /** Clock for `updatedAt`; tests pass a fake one. */
  now?: () => number
}

export class ProfileStore {
  private backendOverride: ProfileBackend | null | undefined
  private resolvedBackend: ProfileBackend | null | undefined
  private readonly now: () => number
  private dirty = false
  private draining: Promise<void> | null = null
  private warned = false

  constructor(options: ProfileStoreOptions = {}) {
    this.backendOverride = options.backend
    this.now = options.now ?? Date.now
  }

  /** The durable copy, or null when the page has no IndexedDB. */
  getBackend(): ProfileBackend | null {
    if (this.backendOverride !== undefined) return this.backendOverride
    this.resolvedBackend ??= typeof indexedDB === 'undefined' ? null : createIdbBackend()
    return this.resolvedBackend
  }

  // ---------------------------------------------------------------- parts

  /** The part's stored text, as written; null when absent. */
  readText(part: ProfilePart): string | null {
    return readLocal(PARTS[part].key)
  }

  /**
   * Store the part's text (the caller serialised it). Synchronous; the durable copy follows
   * unless `persist` is false (restore: the text came from there).
   */
  writeText(part: ProfilePart, text: string, persist = true): boolean {
    if (!writeLocal(PARTS[part].key, text)) return false
    if (persist) this.touch()
    return true
  }

  /** The part, parsed with its schema; null when absent or not of that shape. */
  get<P extends ProfilePart>(part: P): PartValue<P> | null {
    return parseJsonWith(PARTS[part].schema, readLocal(PARTS[part].key))
  }

  set<P extends ProfilePart>(part: P, value: PartValue<P>): void {
    this.writeText(part, JSON.stringify(value))
  }

  remove(part: ProfilePart): void {
    removeLocal(PARTS[part].key)
    this.touch()
  }

  // ---------------------------------------------------------------- bests

  /** The best score on a machine; 0 when none. Moves the pre-profile single best into `bests` on first read. */
  getBest(machineId: string = VANILLA_MACHINE_ID): number {
    return (this.get('bests') ?? this.migrateLegacyBest())?.[machineId] ?? 0
  }

  setBest(machineId: string, score: number): void {
    const bests = this.get('bests') ?? this.migrateLegacyBest() ?? {}
    this.set('bests', { ...bests, [machineId]: Math.max(0, Math.floor(score)) })
  }

  private migrateLegacyBest(): PartValue<'bests'> | null {
    const legacy = readLocal(LEGACY_BEST_KEY)
    if (legacy === null) return null
    const score = Math.max(0, parseInt(legacy, 10) || 0)
    const bests: PartValue<'bests'> = score > 0 ? { [VANILLA_MACHINE_ID]: score } : {}
    this.set('bests', bests)
    removeLocal(LEGACY_BEST_KEY)
    return bests
  }

  // ------------------------------------------------------ durable copy

  /**
   * Boot, before the `Game` reads anything: refill parts the browser cleared from the durable copy.
   * A mirror a build with this store has written (`updatedAt` present) is current and returns here
   * without loading anything; an upgrade from an older build (parts, no stamp) seeds the durable
   * copy instead. Resolves to the parts it restored; never rejects.
   */
  async restore(): Promise<ProfilePart[]> {
    if (this.readUpdatedAt() !== null) return []
    try {
      return await (await import('./profile-durable')).restoreProfile(this)
    } catch (error) {
      this.warnOnce('could not restore the profile', error)
      return []
    }
  }

  /** Resolves when every scheduled write has reached the durable copy (tests, `pagehide`). */
  flush(): Promise<void> {
    return this.draining ?? Promise.resolve()
  }

  /** When the mirror was last written; null until a build with this store has written it. */
  readUpdatedAt(): number | null {
    return parseJsonWith(MetaSchema, readLocal(META_KEY))?.updatedAt ?? null
  }

  /** Stamp the mirror as written at `updatedAt` (default: now) without scheduling a save. */
  stamp(updatedAt: number = this.now()): void {
    writeLocal(META_KEY, JSON.stringify({ updatedAt }))
  }

  /** A part changed: stamp the mirror and schedule the durable copy. */
  touch(): void {
    this.stamp()
    this.dirty = true
    this.draining ??= this.drain()
  }

  /** One snapshot per burst of writes: waits a microtask so writes of the same tick coalesce. */
  private async drain(): Promise<void> {
    try {
      await Promise.resolve()
      const backend = this.getBackend()
      if (!backend) {
        this.dirty = false
        return
      }
      const { snapshotProfile } = await import('./profile-durable')
      while (this.dirty) {
        this.dirty = false
        try {
          await backend.saveCore(snapshotProfile(this))
        } catch (error) {
          this.warnOnce('could not save the profile to IndexedDB', error)
        }
      }
    } finally {
      // Same synchronous step as the loop's last check, so a write after it starts a new drain.
      this.draining = null
    }
  }

  /** One console warning per page for a durable-copy problem; the mirror keeps working. */
  warnOnce(message: string, detail: unknown): void {
    if (this.warned) return
    this.warned = true
    console.warn(`[ProfileStore] ${message}`, detail)
  }
}

/** The page's store. */
export const profileStore = new ProfileStore()
