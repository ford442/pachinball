/**
 * The parts of the player `Profile` that the boot path and the `ProfileStore`
 * read (#506 slice 1): everything except the editor drafts, which pull in the
 * machine schema and live in IndexedDB only. `./profile.ts` builds the full
 * export schema from these entries.
 *
 * Boot-safe: only `./record-kit`, `./settings`, `./storage` and Valibot.
 */

import * as v from 'valibot'
import { strict } from './record-kit'
import { StoredSettingsSchema } from './settings'
import { ScoringBreakdownSchema, StoredAdventureProgressSchema, StoredCampaignSchema } from './storage'

export const PROFILE_VERSION = 2

/** Limits the profile schema enforces. */
export const PROFILE_LIMITS = {
  keysPerAction: 4,
  drafts: 32,
  achievements: 512,
} as const

const KeyCode = v.pipe(v.string('must be a KeyboardEvent.code'), v.regex(/^[A-Za-z0-9]{1,32}$/, 'must be a KeyboardEvent.code'))

/** Input action → `KeyboardEvent.code`s (slice 2's key rebinding); absent = the defaults. */
export const KeyBindingsSchema = v.record(
  v.pipe(v.string(), v.regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/, 'action names are camelCase identifiers')),
  v.pipe(v.array(KeyCode, 'must be an array'), v.maxLength(PROFILE_LIMITS.keysPerAction, `at most ${PROFILE_LIMITS.keysPerAction} keys`)),
  'must be an object',
)

/** Best score per machine id (`vanilla` for the built-in table). */
export const BestsSchema = v.record(
  v.string(),
  v.pipe(v.number('must be a score'), v.integer('must be a score'), v.minValue(0, 'must be a score')),
  'must be an object',
)

/** Unlocked achievement ids. */
export const AchievementsSchema = v.pipe(
  v.array(v.string('must be a string'), 'must be an array'),
  v.maxLength(PROFILE_LIMITS.achievements, `at most ${PROFILE_LIMITS.achievements} achievements`),
)

/** The profile's fields minus `drafts`; spread into the full schema. */
export const profileCoreEntries = {
  /** Editor completion only. */
  $schema: v.optional(v.string('must be a string')),
  /** Older files migrate in `parseProfile` before this check. */
  version: v.literal(PROFILE_VERSION, `must be ${PROFILE_VERSION}`),
  /** When the file was exported (ISO 8601); informational. */
  exportedAt: v.optional(v.string('must be a string')),
  /** Last local change, ms since the epoch; the cloud sync's tie-breaker. */
  updatedAt: v.optional(v.pipe(v.number('must be a timestamp'), v.integer('must be a timestamp'), v.minValue(0, 'must be a timestamp'))),
  settings: StoredSettingsSchema,
  keyBindings: v.optional(KeyBindingsSchema),
  campaign: v.optional(StoredCampaignSchema),
  /** Legacy free-form adventure progress. */
  adventure: v.optional(StoredAdventureProgressSchema),
  scoringBreakdown: v.optional(ScoringBreakdownSchema),
  bests: v.optional(BestsSchema),
  achievements: v.optional(AchievementsSchema),
}

/** What the store keeps in IndexedDB as `profile`: the profile without drafts. */
export const ProfileCoreSchema = strict(profileCoreEntries, 'profile must be an object')
export type ProfileCore = v.InferOutput<typeof ProfileCoreSchema>
