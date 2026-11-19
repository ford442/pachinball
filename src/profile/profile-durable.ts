/**
 * The durable-copy half of `ProfileStore` (#506 slice 1), imported on the first
 * write or restore so it stays off the boot path: the snapshot the store saves
 * to IndexedDB, the import that replaces the mirror, and the restore that
 * refills a cleared mirror from it.
 */

import { parseWith } from '../schemas/schema-kit'
import { PROFILE_VERSION, ProfileCoreSchema, type ProfileCore } from '../schemas/profile-core'
import { PROFILE_PART_NAMES, type PartValue, type ProfilePart, type ProfileStore } from './profile-store'

/** The profile as the durable copy stores it (everything but drafts), parsed from the mirror. */
export function snapshotProfile(store: ProfileStore): ProfileCore {
  const core: ProfileCore = { version: PROFILE_VERSION, settings: store.get('settings') ?? {} }
  const updatedAt = store.readUpdatedAt()
  if (updatedAt !== null) core.updatedAt = updatedAt
  const keyBindings = store.get('keyBindings')
  if (keyBindings) core.keyBindings = keyBindings
  const campaign = store.get('campaign')
  if (campaign) core.campaign = campaign
  const adventure = store.get('adventure')
  if (adventure) core.adventure = adventure
  const scoringBreakdown = store.get('scoringBreakdown')
  if (scoringBreakdown) core.scoringBreakdown = scoringBreakdown
  const bests = store.get('bests')
  if (bests) core.bests = bests
  const achievements = store.get('achievements')
  if (achievements) core.achievements = achievements
  return core
}

function replacePart<P extends ProfilePart>(store: ProfileStore, part: P, value: PartValue<P> | undefined): void {
  if (value === undefined) store.remove(part)
  else store.set(part, value)
}

/** Make the mirror exactly `core`: parts it names are written, parts it omits are removed (an import). */
export function replaceProfile(store: ProfileStore, core: ProfileCore): void {
  store.set('settings', core.settings)
  replacePart(store, 'keyBindings', core.keyBindings)
  replacePart(store, 'campaign', core.campaign)
  replacePart(store, 'adventure', core.adventure)
  replacePart(store, 'scoringBreakdown', core.scoringBreakdown)
  replacePart(store, 'bests', core.bests)
  replacePart(store, 'achievements', core.achievements)
}

/**
 * Refill the parts the mirror lacks from the durable copy, and stamp it. With nothing to restore
 * but parts an older build wrote (no stamp yet), stamp them and copy them to the durable store.
 * Never rejects.
 */
export async function restoreProfile(store: ProfileStore): Promise<ProfilePart[]> {
  const restored: ProfilePart[] = []
  const backend = store.getBackend()
  if (backend) {
    try {
      const raw = await backend.loadCore()
      const parsed = raw === undefined ? null : parseWith(ProfileCoreSchema, raw)
      if (parsed && !parsed.ok) store.warnOnce('stored profile is unreadable, ignoring it', parsed.errors)
      if (parsed?.ok) {
        for (const part of PROFILE_PART_NAMES) {
          const value = parsed.value[part]
          if (value === undefined || store.readText(part) !== null) continue
          if (store.writeText(part, JSON.stringify(value), false)) restored.push(part)
        }
        if (restored.length > 0) store.stamp(parsed.value.updatedAt)
      }
    } catch (error) {
      store.warnOnce('could not read the stored profile', error)
    }
  }
  if (store.readUpdatedAt() === null && PROFILE_PART_NAMES.some((part) => store.readText(part) !== null)) store.touch()
  return restored
}
