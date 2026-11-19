/**
 * Profile export / import (#506 slice 1) and the editor drafts that only the
 * durable copy holds. Loaded lazily — it needs the full `Profile` schema, which
 * includes the machine schema — by the Settings buttons and (slice 6) the editor.
 *
 * Export writes a `Profile` (v2) as JSON; import accepts any version this build
 * can migrate, replaces the player's profile with it and reports field-level
 * errors for a file it refuses, never half-applying one.
 */

import * as v from 'valibot'
import { MachineDescriptorSchema } from '../schemas/machine'
import { PROFILE_LIMITS } from '../schemas/profile-core'
import { parseProfile, type Profile } from '../schemas/profile'
import { parseWith, type ParseResult, type SchemaIssue } from '../schemas/schema-kit'
import { replaceProfile, snapshotProfile } from './profile-durable'
import { profileStore, type ProfileStore } from './profile-store'

const DraftsSchema = v.pipe(v.array(MachineDescriptorSchema), v.maxLength(PROFILE_LIMITS.drafts))

/** The editor drafts in the durable copy; empty when there is none or it is unreadable. */
async function loadDrafts(store: ProfileStore): Promise<NonNullable<Profile['drafts']>> {
  const backend = store.getBackend()
  if (!backend) return []
  try {
    const raw = await backend.loadDrafts()
    const parsed = raw === undefined ? null : parseWith(DraftsSchema, raw)
    return parsed?.ok ? parsed.value : []
  } catch {
    return []
  }
}

/** The whole profile as the JSON text of a `Profile` (v2). */
export async function exportProfile(store: ProfileStore = profileStore): Promise<string> {
  const profile: Profile = { ...snapshotProfile(store), exportedAt: new Date().toISOString() }
  const drafts = await loadDrafts(store)
  if (drafts.length > 0) profile.drafts = drafts
  return `${JSON.stringify(profile, null, 2)}\n`
}

export type ImportProfileResult =
  | { ok: true; settings: Profile['settings']; draftsKept: boolean }
  | { ok: false; errors: readonly SchemaIssue[] }

/**
 * Replace the player's profile with the file's. Parts the file omits are removed, so an export
 * imported on a fresh device gives that device the same profile. `draftsKept` is false when the
 * file had drafts the page could not store (no IndexedDB).
 */
export async function importProfile(text: string, store: ProfileStore = profileStore): Promise<ImportProfileResult> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: [{ path: '', message: 'not valid JSON' }] }
  }
  const parsed: ParseResult<Profile> = parseProfile(raw)
  if (!parsed.ok) return { ok: false, errors: parsed.errors }

  const { drafts, ...core } = parsed.value
  replaceProfile(store, core)
  let draftsKept = true
  const backend = store.getBackend()
  if (backend) {
    try {
      await backend.saveDrafts(drafts ?? [])
    } catch {
      draftsKept = false
    }
  } else {
    draftsKept = (drafts?.length ?? 0) === 0
  }
  await store.flush()
  return { ok: true, settings: core.settings, draftsKept }
}
