/**
 * `MachineDescriptor` (#506 Slice A): a machine as one piece of plain JSON —
 * cabinet preset + track(s) + backbox character + music stems + rules + seed
 * policy. Shipped machines live in `public/machines/*.json`; `?machine=<id>`
 * boots one (`src/machine/machine-loader.ts`), and a share link carries one
 * compressed in the URL hash (`src/machine/machine-share.ts`).
 *
 * One Valibot schema (`MachineDescriptorSchema`, #505 §A) is the type and the
 * validator: structured `{ path, message }` errors, unknown fields rejected,
 * nothing clamped. Inline tracks parse with the track schema and a weekly
 * table with the weekly schema, so their errors keep their own paths under
 * `tracks[i].inline` / `rules.cascade.weekly`. `public/schemas/machine.json`
 * is generated from it. The `WeeklyMachineDescriptor` is a derived view: a weekly machine
 * is a vanilla machine whose `rules.cascade.weekly` holds the seeded table
 * (`machineFromWeekly` / `weeklyView`).
 *
 * Media references are relative paths under `public/backbox/` and
 * `public/audio/` only (no scheme, no `..`): a descriptor opened from a share
 * link must not be able to point the page at an arbitrary host.
 *
 * Pure TS — no Babylon, no DOM — so it runs in Vitest and in the CLI.
 */

import * as v from 'valibot'
import { AdventureTrackType } from '../adventure/adventure-types'
import { BALL_SPAWN_CONFIG, BallType } from '../config/balls'
import { GAME_TUNING } from '../config/gameplay'
import { TrackDefinitionSchema } from './track'
import { WeeklyMachineSchema, type WeeklyMachineDescriptor } from './weekly'
import { validateWeeklyMachine } from '../cascade/weekly-machine'
import {
  canonicalJson,
  formatSchemaIssues,
  intInRange,
  inRange,
  isRecord,
  parseWith,
  safePath,
  strict,
  withCrossCheck,
  type SchemaIssue,
} from './schema-kit'

export const MACHINE_SCHEMA_VERSION = 1

export const MACHINE_CABINETS = ['classic', 'neo', 'vertical', 'wide'] as const
export type MachineCabinet = (typeof MACHINE_CABINETS)[number]

export const MACHINE_SEED_POLICIES = ['vanilla', 'daily', 'weekly', 'free'] as const
/** How the table's seed is chosen; mirrors `DailyCascadeMode`. */
export type MachineSeedPolicy = (typeof MACHINE_SEED_POLICIES)[number]

export const STEM_ROLES = ['drums', 'bass', 'lead', 'fever'] as const
export type StemRole = (typeof STEM_ROLES)[number]

export const BALL_TYPE_KEYS = [BallType.STANDARD, BallType.GOLD_PLATED, BallType.SOLID_GOLD] as const

/** Limits the validator enforces; the editor's form renderer reads them too. */
export const MACHINE_LIMITS = {
  idPattern: /^[a-z0-9][a-z0-9-]{0,47}$/,
  nameMaxLength: 64,
  tracks: { min: 1, max: 8 },
  stems: { max: 8 },
  bpm: { min: 40, max: 240 },
  shaderParams: { maxCount: 16, keyPattern: /^[a-zA-Z][a-zA-Z0-9]{0,31}$/, min: -1000, max: 1000 },
  points: { max: 1_000_000 },
  feverMultiplier: { min: 1, max: 100 },
  feverThreshold: { min: 1, max: 100 },
} as const

/** A path under `public/backbox/`: lower-case segments, no scheme, no `..`. */
const BACKBOX_VIDEO = /^(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9][a-z0-9._-]*\.(?:mp4|webm)$/
const BACKBOX_POSTER = /^(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9][a-z0-9._-]*\.(?:png|webp|jpg)$/
/** A path under `public/audio/`. */
const AUDIO_STEM = /^(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9][a-z0-9._-]*\.(?:opus|ogg|webm)$/
const HEX_COLOR = /^#[0-9a-f]{6}$/

const TRACK_IDS = Object.values(AdventureTrackType)

const enumOf = <const T extends readonly string[]>(values: T) => v.picklist(values, `must be one of ${values.join(' | ')}`)

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** A backbox clip, relative to `public/backbox/`; `poster` is the still shown while it loads or if it fails. */
const VideoRefSchema = strict({
  video: safePath(BACKBOX_VIDEO, 'must be a .mp4/.webm path under public/backbox/'),
  poster: v.optional(safePath(BACKBOX_POSTER, 'must be a .png/.webp/.jpg path under public/backbox/')),
})

const { shaderParams: shaderLimits } = MACHINE_LIMITS

const BackboxSchema = strict({
  idle: VideoRefSchema,
  reach: VideoRefSchema,
  fever: VideoRefSchema,
  /** Screen-border / LED accent colour, `#rrggbb`. */
  border: safePath(HEX_COLOR, 'must be a lower-case #rrggbb colour'),
  /** Named numeric knobs for the backbox shader passes (CRT, grid). */
  shaderParams: v.pipe(
    v.record(
      v.pipe(v.string(), v.regex(shaderLimits.keyPattern, 'parameter names are camelCase identifiers')),
      inRange(shaderLimits),
      'must be an object',
    ),
    v.maxEntries(shaderLimits.maxCount, `at most ${shaderLimits.maxCount} parameters`),
  ),
})

/** One looped stem, relative to `public/audio/`. */
const StemSchema = strict({
  role: enumOf(STEM_ROLES),
  src: safePath(AUDIO_STEM, 'must be an .opus/.ogg/.webm path under public/audio/'),
})

const AudioSchema = strict({
  stems: withCrossCheck(
    v.pipe(
      v.array(StemSchema, 'must be an array'),
      v.maxLength(MACHINE_LIMITS.stems.max, `at most ${MACHINE_LIMITS.stems.max} stems`),
    ),
    (stems, issue) => {
      if (!Array.isArray(stems)) return
      const roles = new Set<unknown>()
      stems.forEach((stem: unknown, i) => {
        if (!isRecord(stem) || typeof stem.role !== 'string') return
        if (roles.has(stem.role)) issue([i, 'role'], `duplicate stem role ${stem.role}`)
        roles.add(stem.role)
      })
    },
  ),
  bpm: inRange(MACHINE_LIMITS.bpm),
})

/** A shipped track by id, or a whole track definition inline (editor drafts, share links). */
const TrackIdRef = strict({ id: v.picklist(TRACK_IDS, 'unknown track id') })
const TrackInlineRef = strict({ inline: TrackDefinitionSchema })
const TrackRefSchema = v.lazy((input) => {
  if (isRecord(input) && 'id' in input) return TrackIdRef
  if (isRecord(input) && 'inline' in input) return TrackInlineRef
  return v.union([TrackIdRef, TrackInlineRef], (issue) => (isRecord(issue.input) ? 'needs `id` or `inline`' : 'must be an object'))
})

const TracksSchema = v.pipe(
  v.array(TrackRefSchema, 'must be an array'),
  v.check(
    (tracks) => tracks.length >= MACHINE_LIMITS.tracks.min && tracks.length <= MACHINE_LIMITS.tracks.max,
    (issue) =>
      `needs ${MACHINE_LIMITS.tracks.min}–${MACHINE_LIMITS.tracks.max} tracks, got ${Array.isArray(issue.input) ? issue.input.length : 0}`,
  ),
)

function ballTable<S extends v.GenericSchema<unknown, number>>(value: () => S) {
  return strict({
    [BallType.STANDARD]: value(),
    [BallType.GOLD_PLATED]: value(),
    [BallType.SOLID_GOLD]: value(),
  })
}

const RulesSchema = strict({
  balls: strict({
    /** Spawn weights; must sum to 1. */
    weights: withCrossCheck(ballTable(() => inRange({ min: 0, max: 1 })), (weights, issue) => {
      if (!isRecord(weights)) return
      const sum = BALL_TYPE_KEYS.reduce((acc, key) => {
        const w = weights[key]
        return acc + (typeof w === 'number' && Number.isFinite(w) ? w : 0)
      }, 0)
      if (Math.abs(sum - 1) > 1e-9) issue([], `weights sum to ${sum}; must sum to 1`)
    }),
    points: ballTable(() => intInRange({ min: 0, max: MACHINE_LIMITS.points.max })),
    feverMultipliers: ballTable(() => inRange(MACHINE_LIMITS.feverMultiplier)),
  }),
  fever: strict({
    /** Combo count that enters FEVER from IDLE. */
    threshold: intInRange(MACHINE_LIMITS.feverThreshold),
  }),
  /** Daily Cascade constraints; `weekly` is the seeded table of a weekly machine. */
  cascade: strict({
    weekly: v.optional(WeeklyMachineSchema),
  }),
})

/**
 * The machine's shape. `validateMachine` adds what a schema cannot say: the
 * table a weekly descriptor resolves to must pass the Daily Cascade layout
 * checks and spawn probes (`validateWeeklyMachine`).
 */
export const MachineDescriptorSchema = withCrossCheck(
  strict(
    {
      schemaVersion: v.literal(MACHINE_SCHEMA_VERSION, `must be ${MACHINE_SCHEMA_VERSION}`),
      id: safePath(MACHINE_LIMITS.idPattern, 'must be lower-case letters, digits and dashes (≤ 48)'),
      name: v.pipe(
        v.string(`must be a non-empty string of at most ${MACHINE_LIMITS.nameMaxLength} characters`),
        v.check(
          (name) => name.trim() !== '' && name.length <= MACHINE_LIMITS.nameMaxLength,
          `must be a non-empty string of at most ${MACHINE_LIMITS.nameMaxLength} characters`,
        ),
      ),
      cabinet: enumOf(MACHINE_CABINETS),
      tracks: TracksSchema,
      backbox: BackboxSchema,
      audio: AudioSchema,
      rules: RulesSchema,
      seedPolicy: enumOf(MACHINE_SEED_POLICIES),
    },
    'machine must be an object',
  ),
  (machine, issue, clean) => {
    if (!clean || !isRecord(machine) || machine.seedPolicy !== 'weekly') return
    const rules = machine.rules
    if (!(isRecord(rules) && isRecord(rules.cascade) && rules.cascade.weekly !== undefined)) {
      issue(['rules', 'cascade', 'weekly'], 'a weekly machine carries its seeded table')
    }
  },
)

export type MachineDescriptor = v.InferOutput<typeof MachineDescriptorSchema>
export type MachineBackbox = MachineDescriptor['backbox']
export type VideoRef = MachineBackbox['idle']
export type MachineAudio = MachineDescriptor['audio']
export type StemRef = MachineAudio['stems'][number]
export type TrackRef = MachineDescriptor['tracks'][number]
export type MachineRules = MachineDescriptor['rules']
export type BallTable = Record<BallType, number>

export type MachineIssue = SchemaIssue

export type MachineValidation =
  | { ok: true; descriptor: MachineDescriptor }
  | { ok: false; errors: MachineIssue[] }

/**
 * Validate a raw JSON value as a `MachineDescriptor`. Does not throw. The
 * schema checks the shape (inline tracks with the track schema, a weekly table
 * with the weekly schema); a weekly table then also has to resolve to a table
 * that passes the Daily Cascade constraints and spawn probes.
 */
export function validateMachine(raw: unknown): MachineValidation {
  const result = parseWith(MachineDescriptorSchema, raw)
  if (!result.ok) return result
  const weekly = result.value.rules.cascade.weekly
  if (weekly !== undefined) {
    const table = validateWeeklyMachine(weekly)
    if (!table.ok) {
      return {
        ok: false,
        errors: table.errors.map((e) => ({ path: e.path ? `rules.cascade.weekly.${e.path}` : 'rules.cascade.weekly', message: e.message })),
      }
    }
  }
  return { ok: true, descriptor: result.value }
}

export function formatMachineErrors(errors: readonly MachineIssue[]): string {
  return formatSchemaIssues(errors)
}

export type { WeeklyMachineDescriptor }

// ---------------------------------------------------------------------------
// Defaults and derived views
// ---------------------------------------------------------------------------

/** The rules the game plays today (`BALL_SPAWN_CONFIG`, `GAME_TUNING.combo`), as machine rules. */
export function defaultMachineRules(): MachineRules {
  return {
    balls: {
      weights: { ...BALL_SPAWN_CONFIG.weights },
      points: { ...BALL_SPAWN_CONFIG.points },
      feverMultipliers: { ...BALL_SPAWN_CONFIG.feverMultipliers },
    },
    fever: { threshold: GAME_TUNING.combo.feverThreshold },
    cascade: {},
  }
}

/** The backbox the game shows without a machine (`GameConfig.backbox` clips). */
export function defaultMachineBackbox(): MachineBackbox {
  return {
    idle: { video: 'attract.mp4', poster: 'attract.png' },
    reach: { video: 'reach.mp4', poster: 'reach.png' },
    fever: { video: 'fever.mp4', poster: 'fever.png' },
    border: '#00ffff',
    shaderParams: {},
  }
}

/** True when `rules` are the ones the game plays without a machine (the only rules the runtime applies yet). */
export function rulesAreDefault(rules: MachineRules): boolean {
  const { cascade: _cascade, ...rest } = rules
  const { cascade: _defaultCascade, ...defaults } = defaultMachineRules()
  return canonicalJson(rest) === canonicalJson(defaults)
}

/** The weekly machine for a seeded table: the classic machine, its seed policy `weekly`. */
export function machineFromWeekly(weekly: WeeklyMachineDescriptor): MachineDescriptor {
  return {
    schemaVersion: MACHINE_SCHEMA_VERSION,
    id: `weekly-${weekly.seed.toString(16).padStart(8, '0')}`,
    name: 'Weekly Machine',
    cabinet: 'classic',
    tracks: [{ id: AdventureTrackType.NEON_HELIX }],
    backbox: defaultMachineBackbox(),
    audio: { stems: [], bpm: 120 },
    rules: { ...defaultMachineRules(), cascade: { weekly } },
    seedPolicy: 'weekly',
  }
}

/** The `WeeklyMachineDescriptor` view of a machine, if it is a weekly one. */
export function weeklyView(machine: MachineDescriptor): WeeklyMachineDescriptor | null {
  return machine.rules.cascade.weekly ?? null
}
