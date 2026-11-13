/**
 * The small records the game keeps in `localStorage` / `sessionStorage`, as
 * Valibot schemas (#505 §A): every read parses, none casts. Fields are lenient
 * (`lenient`): a field an older build wrote with another type reads as absent
 * and takes its default, so one bad field never costs the player the record.
 * These are the parts the versioned `Profile` (`./profile.ts`) is made of.
 *
 * Pure TS, boot-safe: no Babylon, no DOM, no heavy imports.
 */

import * as v from 'valibot'
import { lenient } from './schema-kit'

const finite = () => v.pipe(v.number(), v.finite())
const stringList = () => v.pipe(v.array(v.unknown()), v.transform((items) => items.filter((s): s is string => typeof s === 'string')))

// ---------------------------------------------------------------- rewards

export const REWARD_KINDS = ['ball-skin', 'cabinet-theme', 'flipper-style', 'backbox-tint'] as const
export const REWARD_RARITIES = ['common', 'rare', 'legendary'] as const

/** A campaign reward the player has not been shown yet (`unseen-rewards`, sessionStorage). */
export const UnlockedRewardSchema = v.object({
  kind: v.picklist(REWARD_KINDS),
  id: v.string(),
  label: v.string(),
  rarity: v.picklist(REWARD_RARITIES),
  scope: v.picklist(['track', 'campaign-complete']),
})
export type UnlockedReward = v.InferOutput<typeof UnlockedRewardSchema>

/** The unseen list; an entry that is not a reward is dropped, the others kept. */
export const UnseenRewardsSchema = v.pipe(
  v.array(v.unknown()),
  v.transform((items) => items.flatMap((item) => {
    const parsed = v.safeParse(UnlockedRewardSchema, item)
    return parsed.success ? [parsed.output] : []
  })),
)

// ------------------------------------------------------- scoring breakdown

/** Per-source score totals (`ScoringBreakdownTracker`); a bad or missing total reads as 0. */
export const ScoringBreakdownSchema = v.object({
  bumpers: lenient(finite()),
  specialObstacles: lenient(finite()),
  goldBalls: lenient(finite()),
  comboBonus: lenient(finite()),
  timeGoalBonus: lenient(finite()),
  premiumBonus: lenient(finite()),
  other: lenient(finite()),
})

// ------------------------------------------------------ campaign progress

/** `SerializableProgressionState` as stored; `sanitizeProgressionState` fills and checks it. */
export const StoredProgressionSchema = v.object({
  completedTracks: lenient(stringList()),
  unlockedTracks: lenient(stringList()),
  bestScores: lenient(v.record(v.string(), v.unknown())),
  currentTrack: lenient(v.string()),
  totalGoldBallsCollected: lenient(finite()),
  totalRewardsEarned: lenient(finite()),
})
export type StoredProgression = v.InferOutput<typeof StoredProgressionSchema>

/**
 * The campaign save (`pachinball.campaign.rewards.v1`, the export file and the
 * cloud slot). Version 1 kept the progression fields at the top level, so the
 * record is also read as a progression for it.
 */
export const StoredCampaignSchema = v.object({
  version: lenient(v.number()),
  progression: lenient(StoredProgressionSchema),
  unlockedRewardIds: lenient(stringList()),
  equippedRewards: lenient(
    v.pipe(
      v.record(v.string(), v.unknown()),
      v.transform((slots) => Object.fromEntries(Object.entries(slots).filter((e): e is [string, string] => typeof e[1] === 'string'))),
    ),
  ),
})

// -------------------------------------------- legacy free-form adventure

export const REWARD_TYPES = ['ball-trail', 'neon-pattern', 'skin'] as const
export type RewardType = (typeof REWARD_TYPES)[number]

export const UnlockableRewardSchema = v.object({
  id: v.string(),
  name: v.string(),
  type: v.picklist(REWARD_TYPES),
  unlockedAt: v.string(),
  equipped: v.boolean(),
})
export type UnlockableReward = v.InferOutput<typeof UnlockableRewardSchema>

/** `AdventureProgress` (legacy, `pachinball_adventure_progress`): every field optional, each checked. */
export const StoredAdventureProgressSchema = v.object({
  currentLevel: lenient(v.pipe(v.string(), v.minLength(1))),
  currentMap: lenient(v.pipe(v.string(), v.minLength(1))),
  completedLevels: lenient(v.array(v.string())),
  unlockedMaps: lenient(v.array(v.string())),
  unlockedRewards: lenient(v.array(UnlockableRewardSchema)),
  totalScore: lenient(finite()),
  bestScores: lenient(v.record(v.string(), finite())),
  lastPlayed: lenient(v.string()),
})

// --------------------------------------------------------------- map cache

export const BACKGROUND_PATTERNS = ['hex', 'grid', 'circuit', 'data-flow', 'none'] as const

/**
 * One LCD table map from `maps.json`, the `/maps` API or the cache: `id` and
 * `name` are required, everything else is checked and falls back to the
 * built-in map (or a default) when absent or mistyped (`MapSystem.sanitizeRemoteMap`).
 */
export const RemoteTableMapSchema = v.object({
  id: v.string(),
  name: v.string(),
  baseColor: lenient(v.pipe(v.string(), v.minLength(1))),
  accentColor: lenient(v.pipe(v.string(), v.minLength(1))),
  scanlineIntensity: lenient(finite()),
  pixelGridIntensity: lenient(finite()),
  subpixelIntensity: lenient(finite()),
  glowIntensity: lenient(finite()),
  backgroundPattern: lenient(v.picklist(BACKGROUND_PATTERNS)),
  animationSpeed: lenient(finite()),
  musicTrackId: lenient(v.pipe(v.string(), v.minLength(1))),
  playfieldImage: lenient(v.string()),
  playfieldVideo: lenient(v.string()),
  shaderUrl: lenient(v.string()),
  adventureGoals: lenient(v.array(v.string())),
  mode: lenient(v.picklist(['fixed', 'dynamic'])),
  worldLength: lenient(finite()),
  description: lenient(v.string()),
  cabinetTheme: lenient(v.string()),
})
export type RemoteTableMap = v.InferOutput<typeof RemoteTableMapSchema>

/** A list of maps; an entry without an `id` / `name` is dropped, the others kept. */
export const RemoteTableMapListSchema = v.pipe(
  v.array(v.unknown()),
  v.transform((items) => items.flatMap((item) => {
    const parsed = v.safeParse(RemoteTableMapSchema, item)
    return parsed.success ? [parsed.output] : []
  })),
)

/** `pachinball.maps.cache.v2`. */
export const MapCacheSchema = v.object({
  expiresAt: v.number(),
  maps: RemoteTableMapListSchema,
})
