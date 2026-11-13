/**
 * The player profile (#506 slice 5) as one versioned Valibot schema (#505 §A):
 * settings, key bindings, campaign progress, per-machine bests, achievements
 * and machine drafts in a single record, so it can be exported to a file,
 * imported on another device and migrated by `version`. Its parts are the
 * storage schemas the game already reads (`./settings`, `./storage`);
 * `public/schemas/profile.json` is generated from it.
 *
 * Not on the boot path: it pulls in the machine schema for drafts.
 */

import * as v from 'valibot'
import { MachineDescriptorSchema } from './machine'
import { parseWith, strict, type ParseResult } from './schema-kit'
import { StoredSettingsSchema } from './settings'
import { ScoringBreakdownSchema, StoredAdventureProgressSchema, StoredCampaignSchema } from './storage'

export const PROFILE_VERSION = 1

/** Limits the profile schema enforces. */
export const PROFILE_LIMITS = {
  keysPerAction: 4,
  drafts: 32,
  achievements: 512,
} as const

const KeyCode = v.pipe(v.string('must be a KeyboardEvent.code'), v.regex(/^[A-Za-z0-9]{1,32}$/, 'must be a KeyboardEvent.code'))

export const ProfileSchema = strict(
  {
    /** Editor completion only. */
    $schema: v.optional(v.string('must be a string')),
    version: v.literal(PROFILE_VERSION, `must be ${PROFILE_VERSION}`),
    /** When the file was exported (ISO 8601); informational. */
    exportedAt: v.optional(v.string('must be a string')),
    settings: StoredSettingsSchema,
    /** Input action → `KeyboardEvent.code`s (slice 5's key rebinding); absent = the defaults. */
    keyBindings: v.optional(
      v.record(
        v.pipe(v.string(), v.regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/, 'action names are camelCase identifiers')),
        v.pipe(v.array(KeyCode, 'must be an array'), v.maxLength(PROFILE_LIMITS.keysPerAction, `at most ${PROFILE_LIMITS.keysPerAction} keys`)),
        'must be an object',
      ),
    ),
    campaign: v.optional(StoredCampaignSchema),
    /** Legacy free-form adventure progress. */
    adventure: v.optional(StoredAdventureProgressSchema),
    scoringBreakdown: v.optional(ScoringBreakdownSchema),
    /** Best score per machine id. */
    bests: v.optional(
      v.record(v.string(), v.pipe(v.number('must be a score'), v.integer('must be a score'), v.minValue(0, 'must be a score')), 'must be an object'),
    ),
    /** Unlocked achievement ids. */
    achievements: v.optional(
      v.pipe(v.array(v.string('must be a string'), 'must be an array'), v.maxLength(PROFILE_LIMITS.achievements, `at most ${PROFILE_LIMITS.achievements} achievements`)),
    ),
    /** Machine editor drafts. */
    drafts: v.optional(
      v.pipe(v.array(MachineDescriptorSchema, 'must be an array'), v.maxLength(PROFILE_LIMITS.drafts, `at most ${PROFILE_LIMITS.drafts} drafts`)),
    ),
  },
  'profile must be an object',
)

export type Profile = v.InferOutput<typeof ProfileSchema>

/**
 * Read an exported profile. Migrations run by `version` before the parse
 * (there is one version yet); an unknown version is refused, never guessed.
 */
export function parseProfile(raw: unknown): ParseResult<Profile> {
  const version = typeof raw === 'object' && raw !== null && 'version' in raw ? raw.version : undefined
  if (typeof version === 'number' && version > PROFILE_VERSION) {
    return { ok: false, errors: [{ path: 'version', message: `profile version ${version} is newer than this build (${PROFILE_VERSION})` }] }
  }
  return parseWith(ProfileSchema, raw)
}
