/**
 * The player profile (#506) as one versioned Valibot schema (#505 §A):
 * settings, key bindings, campaign progress, per-machine bests, achievements
 * and machine drafts in a single record, so it can be exported to a file,
 * imported on another device and migrated by `version`. Its parts are the
 * storage schemas the game already reads (`./settings`, `./storage`), gathered
 * in `./profile-core`; `ProfileStore` (src/profile/) reads and writes them and
 * `public/schemas/profile.json` is generated from this file.
 *
 * Version 2 is the store's own record: it adds `updatedAt`. Version 1 was
 * never written by a build, so its migration only restamps the version.
 *
 * Not on the boot path: it pulls in the machine schema for drafts.
 */

import * as v from 'valibot'
import { MachineDescriptorSchema } from './machine'
import { PROFILE_LIMITS, PROFILE_VERSION, profileCoreEntries } from './profile-core'
import { parseWith, strict, type ParseResult } from './schema-kit'

export { PROFILE_VERSION }

export const ProfileSchema = strict(
  {
    ...profileCoreEntries,
    /** Machine editor drafts. */
    drafts: v.optional(
      v.pipe(v.array(MachineDescriptorSchema, 'must be an array'), v.maxLength(PROFILE_LIMITS.drafts, `at most ${PROFILE_LIMITS.drafts} drafts`)),
    ),
  },
  'profile must be an object',
)

export type Profile = v.InferOutput<typeof ProfileSchema>

/** Bring an older file up to {@link PROFILE_VERSION}; anything else passes through for the parse to judge. */
function migrateProfile(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'version' in raw && raw.version === 1) {
    return { ...raw, version: PROFILE_VERSION }
  }
  return raw
}

/**
 * Read an exported profile. Migrations run by `version` before the parse; a
 * version newer than this build is refused, never guessed.
 */
export function parseProfile(raw: unknown): ParseResult<Profile> {
  const version = typeof raw === 'object' && raw !== null && 'version' in raw ? raw.version : undefined
  if (typeof version === 'number' && version > PROFILE_VERSION) {
    return { ok: false, errors: [{ path: 'version', message: `profile version ${version} is newer than this build (${PROFILE_VERSION})` }] }
  }
  return parseWith(ProfileSchema, migrateProfile(raw))
}
