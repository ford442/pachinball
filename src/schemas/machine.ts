/**
 * `MachineDescriptor` (#506 Slice A): a machine as one piece of plain JSON —
 * cabinet preset + track(s) + backbox character + music stems + rules + seed
 * policy. Shipped machines live in `public/machines/*.json`; `?machine=<id>`
 * boots one (`src/machine/machine-loader.ts`), and a share link carries one
 * compressed in the URL hash (`src/machine/machine-share.ts`).
 *
 * Validated the way tracks and the weekly machine are (`validateTrackDefinition`,
 * `validateWeeklyMachine`): structured `{ path, message }` errors, unknown fields
 * rejected, nothing clamped. Hand-written for now; it moves to the Valibot
 * schema set together with the track schema (#505 §A) without changing its
 * contract. The `WeeklyMachineDescriptor` is a derived view: a weekly machine
 * is a vanilla machine whose `rules.cascade.weekly` holds the seeded table
 * (`machineFromWeekly` / `weeklyView`).
 *
 * Media references are relative paths under `public/backbox/` and
 * `public/audio/` only (no scheme, no `..`): a descriptor opened from a share
 * link must not be able to point the page at an arbitrary host.
 *
 * Pure TS — no Babylon, no DOM — so it runs in Vitest and in the CLI.
 */

import { AdventureTrackType } from '../adventure/adventure-types'
import type { TrackDefinition } from '../adventure/track-schema-types'
import { validateTrackDefinition } from '../adventure/track-schema'
import { BALL_SPAWN_CONFIG, BallType } from '../config/balls'
import { GAME_TUNING } from '../config/gameplay'
import {
  validateWeeklyMachine,
  type WeeklyMachineDescriptor,
} from '../cascade/weekly-machine'

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

/** A backbox clip, relative to `public/backbox/`; `poster` is the still shown while it loads or if it fails. */
export interface VideoRef {
  video: string
  poster?: string
}

export interface MachineBackbox {
  idle: VideoRef
  reach: VideoRef
  fever: VideoRef
  /** Screen-border / LED accent colour, `#rrggbb`. */
  border: string
  /** Named numeric knobs for the backbox shader passes (CRT, grid). */
  shaderParams: Record<string, number>
}

/** One looped stem, relative to `public/audio/`. */
export interface StemRef {
  role: StemRole
  src: string
}

export interface MachineAudio {
  stems: StemRef[]
  bpm: number
}

/** A shipped track by id, or a whole track definition inline (editor drafts, share links). */
export type TrackRef = { id: AdventureTrackType } | { inline: TrackDefinition }

export type BallTable = Record<BallType, number>

export interface MachineRules {
  balls: {
    /** Spawn weights; must sum to 1. */
    weights: BallTable
    points: BallTable
    feverMultipliers: BallTable
  }
  fever: {
    /** Combo count that enters FEVER from IDLE. */
    threshold: number
  }
  /** Daily Cascade constraints; `weekly` is the seeded table of a weekly machine. */
  cascade: {
    weekly?: WeeklyMachineDescriptor
  }
}

export interface MachineDescriptor {
  schemaVersion: typeof MACHINE_SCHEMA_VERSION
  id: string
  name: string
  cabinet: MachineCabinet
  tracks: TrackRef[]
  backbox: MachineBackbox
  audio: MachineAudio
  rules: MachineRules
  seedPolicy: MachineSeedPolicy
}

export interface MachineIssue {
  path: string
  message: string
}

export type MachineValidation =
  | { ok: true; descriptor: MachineDescriptor }
  | { ok: false; errors: MachineIssue[] }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TRACK_IDS: ReadonlySet<string> = new Set(Object.values(AdventureTrackType))

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, errors: MachineIssue[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push({ path: join(path, key), message: 'unknown field' })
  }
}

function requireObject(value: unknown, path: string, errors: MachineIssue[]): Record<string, unknown> | null {
  if (isPlainObject(value)) return value
  errors.push({ path, message: 'must be an object' })
  return null
}

function checkEnum<T extends string>(value: unknown, allowed: readonly T[], path: string, errors: MachineIssue[]): void {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    errors.push({ path, message: `must be one of ${allowed.join(' | ')}` })
  }
}

function checkPattern(value: unknown, pattern: RegExp, path: string, what: string, errors: MachineIssue[]): void {
  if (typeof value !== 'string' || !pattern.test(value) || value.includes('..')) {
    errors.push({ path, message: `must be ${what}` })
  }
}

function checkRange(
  value: unknown,
  range: { min: number; max: number },
  path: string,
  errors: MachineIssue[],
  integer = false,
): void {
  const ok = integer ? Number.isInteger(value) : isFiniteNumber(value)
  if (!ok || (value as number) < range.min || (value as number) > range.max) {
    errors.push({ path, message: `must be ${integer ? 'an integer' : 'a number'} in [${range.min}, ${range.max}]` })
  }
}

function validateVideoRef(raw: unknown, path: string, errors: MachineIssue[]): void {
  const ref = requireObject(raw, path, errors)
  if (!ref) return
  rejectUnknownKeys(ref, ['video', 'poster'], path, errors)
  checkPattern(ref.video, BACKBOX_VIDEO, `${path}.video`, 'a .mp4/.webm path under public/backbox/', errors)
  if (ref.poster !== undefined) {
    checkPattern(ref.poster, BACKBOX_POSTER, `${path}.poster`, 'a .png/.webp/.jpg path under public/backbox/', errors)
  }
}

function validateBackbox(raw: unknown, errors: MachineIssue[]): void {
  const backbox = requireObject(raw, 'backbox', errors)
  if (!backbox) return
  rejectUnknownKeys(backbox, ['idle', 'reach', 'fever', 'border', 'shaderParams'], 'backbox', errors)
  validateVideoRef(backbox.idle, 'backbox.idle', errors)
  validateVideoRef(backbox.reach, 'backbox.reach', errors)
  validateVideoRef(backbox.fever, 'backbox.fever', errors)
  checkPattern(backbox.border, HEX_COLOR, 'backbox.border', 'a lower-case #rrggbb colour', errors)
  const params = requireObject(backbox.shaderParams, 'backbox.shaderParams', errors)
  if (!params) return
  const { shaderParams: limits } = MACHINE_LIMITS
  const keys = Object.keys(params)
  if (keys.length > limits.maxCount) {
    errors.push({ path: 'backbox.shaderParams', message: `at most ${limits.maxCount} parameters` })
  }
  for (const key of keys) {
    const path = `backbox.shaderParams.${key}`
    if (!limits.keyPattern.test(key)) errors.push({ path, message: 'parameter names are camelCase identifiers' })
    else checkRange(params[key], limits, path, errors)
  }
}

function validateAudio(raw: unknown, errors: MachineIssue[]): void {
  const audio = requireObject(raw, 'audio', errors)
  if (!audio) return
  rejectUnknownKeys(audio, ['stems', 'bpm'], 'audio', errors)
  checkRange(audio.bpm, MACHINE_LIMITS.bpm, 'audio.bpm', errors)
  if (!Array.isArray(audio.stems)) {
    errors.push({ path: 'audio.stems', message: 'must be an array' })
    return
  }
  if (audio.stems.length > MACHINE_LIMITS.stems.max) {
    errors.push({ path: 'audio.stems', message: `at most ${MACHINE_LIMITS.stems.max} stems` })
  }
  const roles = new Set<string>()
  audio.stems.forEach((raw: unknown, i: number) => {
    const path = `audio.stems[${i}]`
    const stem = requireObject(raw, path, errors)
    if (!stem) return
    rejectUnknownKeys(stem, ['role', 'src'], path, errors)
    checkEnum(stem.role, STEM_ROLES, `${path}.role`, errors)
    checkPattern(stem.src, AUDIO_STEM, `${path}.src`, 'an .opus/.ogg/.webm path under public/audio/', errors)
    if (typeof stem.role === 'string') {
      if (roles.has(stem.role)) errors.push({ path: `${path}.role`, message: `duplicate stem role ${stem.role}` })
      roles.add(stem.role)
    }
  })
}

function validateTracks(raw: unknown, errors: MachineIssue[]): void {
  if (!Array.isArray(raw)) {
    errors.push({ path: 'tracks', message: 'must be an array' })
    return
  }
  const { min, max } = MACHINE_LIMITS.tracks
  if (raw.length < min || raw.length > max) {
    errors.push({ path: 'tracks', message: `needs ${min}–${max} tracks, got ${raw.length}` })
  }
  raw.forEach((entry: unknown, i: number) => {
    const path = `tracks[${i}]`
    const ref = requireObject(entry, path, errors)
    if (!ref) return
    if ('id' in ref) {
      rejectUnknownKeys(ref, ['id'], path, errors)
      if (typeof ref.id !== 'string' || !TRACK_IDS.has(ref.id)) {
        errors.push({ path: `${path}.id`, message: 'unknown track id' })
      }
    } else if ('inline' in ref) {
      rejectUnknownKeys(ref, ['inline'], path, errors)
      const result = validateTrackDefinition(ref.inline)
      if (!result.ok) {
        for (const e of result.errors) errors.push({ path: join(`${path}.inline`, e.path), message: e.message })
      }
    } else {
      errors.push({ path, message: 'needs `id` or `inline`' })
    }
  })
}

function validateBallTable(
  raw: unknown,
  path: string,
  check: (value: unknown, path: string) => void,
  errors: MachineIssue[],
): void {
  const table = requireObject(raw, path, errors)
  if (!table) return
  rejectUnknownKeys(table, BALL_TYPE_KEYS, path, errors)
  for (const key of BALL_TYPE_KEYS) check(table[key], `${path}.${key}`)
}

function validateRules(raw: unknown, errors: MachineIssue[]): void {
  const rules = requireObject(raw, 'rules', errors)
  if (!rules) return
  rejectUnknownKeys(rules, ['balls', 'fever', 'cascade'], 'rules', errors)

  const balls = requireObject(rules.balls, 'rules.balls', errors)
  if (balls) {
    rejectUnknownKeys(balls, ['weights', 'points', 'feverMultipliers'], 'rules.balls', errors)
    validateBallTable(balls.weights, 'rules.balls.weights', (v, p) => checkRange(v, { min: 0, max: 1 }, p, errors), errors)
    if (isPlainObject(balls.weights)) {
      const weights = balls.weights
      const sum = BALL_TYPE_KEYS.reduce((acc, key) => acc + (isFiniteNumber(weights[key]) ? weights[key] : 0), 0)
      if (Math.abs(sum - 1) > 1e-9) errors.push({ path: 'rules.balls.weights', message: `weights sum to ${sum}; must sum to 1` })
    }
    validateBallTable(
      balls.points,
      'rules.balls.points',
      (v, p) => checkRange(v, { min: 0, max: MACHINE_LIMITS.points.max }, p, errors, true),
      errors,
    )
    validateBallTable(
      balls.feverMultipliers,
      'rules.balls.feverMultipliers',
      (v, p) => checkRange(v, MACHINE_LIMITS.feverMultiplier, p, errors),
      errors,
    )
  }

  const fever = requireObject(rules.fever, 'rules.fever', errors)
  if (fever) {
    rejectUnknownKeys(fever, ['threshold'], 'rules.fever', errors)
    checkRange(fever.threshold, MACHINE_LIMITS.feverThreshold, 'rules.fever.threshold', errors, true)
  }

  const cascade = requireObject(rules.cascade, 'rules.cascade', errors)
  if (cascade) {
    rejectUnknownKeys(cascade, ['weekly'], 'rules.cascade', errors)
    if (cascade.weekly !== undefined) {
      const weekly = validateWeeklyMachine(cascade.weekly)
      if (!weekly.ok) {
        for (const e of weekly.errors) errors.push({ path: join('rules.cascade.weekly', e.path), message: e.message })
      }
    }
  }
}

/**
 * Validate a raw JSON value as a `MachineDescriptor`. Does not throw. Every
 * nested part is checked by its own validator: inline tracks by
 * `validateTrackDefinition`, a weekly table by `validateWeeklyMachine` (so the
 * Daily Cascade constraints and spawn probes run on it).
 */
export function validateMachine(raw: unknown): MachineValidation {
  if (!isPlainObject(raw)) return { ok: false, errors: [{ path: '', message: 'machine must be an object' }] }
  const errors: MachineIssue[] = []
  rejectUnknownKeys(
    raw,
    ['schemaVersion', 'id', 'name', 'cabinet', 'tracks', 'backbox', 'audio', 'rules', 'seedPolicy'],
    '',
    errors,
  )
  if (raw.schemaVersion !== MACHINE_SCHEMA_VERSION) {
    errors.push({ path: 'schemaVersion', message: `must be ${MACHINE_SCHEMA_VERSION}` })
  }
  checkPattern(raw.id, MACHINE_LIMITS.idPattern, 'id', 'lower-case letters, digits and dashes (≤ 48)', errors)
  if (typeof raw.name !== 'string' || raw.name.trim() === '' || raw.name.length > MACHINE_LIMITS.nameMaxLength) {
    errors.push({ path: 'name', message: `must be a non-empty string of at most ${MACHINE_LIMITS.nameMaxLength} characters` })
  }
  checkEnum(raw.cabinet, MACHINE_CABINETS, 'cabinet', errors)
  validateTracks(raw.tracks, errors)
  validateBackbox(raw.backbox, errors)
  validateAudio(raw.audio, errors)
  validateRules(raw.rules, errors)
  checkEnum(raw.seedPolicy, MACHINE_SEED_POLICIES, 'seedPolicy', errors)

  if (
    errors.length === 0 &&
    raw.seedPolicy === 'weekly' &&
    !(isPlainObject(raw.rules) && isPlainObject(raw.rules.cascade) && raw.rules.cascade.weekly !== undefined)
  ) {
    errors.push({ path: 'rules.cascade.weekly', message: 'a weekly machine carries its seeded table' })
  }

  if (errors.length > 0) return { ok: false, errors }
  const checked: unknown = raw // every field checked above
  return { ok: true, descriptor: checked as MachineDescriptor }
}

export function formatMachineErrors(errors: readonly MachineIssue[]): string {
  return errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ')
}

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
  return JSON.stringify(rest) === JSON.stringify(defaults)
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
