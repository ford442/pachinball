/**
 * The weekly machine's shape and tested envelope, as a Valibot schema
 * (#505 §A). `validateWeeklyMachine` (`src/cascade/weekly-machine.ts`) parses
 * with it, then checks the table the descriptor resolves to — the Daily
 * Cascade layout constraints, bumper gaps and spawn probes, which need the
 * resolver and so are not schema rules.
 *
 * Offsets, keep-outs and the dropout rate live on a 1/64 grid (a power of
 * two), so they survive JSON exactly. Out-of-envelope values are errors;
 * nothing is clamped.
 *
 * Pure TS — no Babylon / Rapier, so it runs in the worker compile graph and in Vitest.
 */

import * as v from 'valibot'
import { CANONICAL_BUMPERS, LAYOUT_CONSTANTS } from '../cascade/daily-cascade-layout'
import { bool, intInRange, strict, u32, withCrossCheck, isRecord } from './schema-kit'

export const WEEKLY_MACHINE_VERSION = 1

/** Offsets, keep-outs and the dropout rate live on this grid (a power of two), so they survive JSON exactly. */
export const WEEKLY_GRID = 64

/** The tested envelope. Everything the generator draws, and everything the validator accepts, is inside it. */
export const WEEKLY_ENVELOPE = {
  rows: { min: 8, max: 12 },
  cols: { min: 11, max: 15 },
  /** Fraction of slots the seeded hash removes: 12.5 % – 37.5 %. */
  dropout: { min: 8 / WEEKLY_GRID, max: 24 / WEEKLY_GRID },
  /** A bumper may move this far from its canonical spot along each axis. */
  bumperOffsetMax: 1,
  keepOuts: { maxCount: 3, minWidth: 1, maxWidth: 3, minHeight: 3, maxHeight: 10 },
  armedFeeders: { min: 2, max: 4 },
  /** Fewer resolved pins than this is not a pachinko field. */
  minPins: 40,
  /** Clear space between two bumpers' rims. */
  bumperGap: 0.5,
} as const

/** Wall of the field the extra keep-outs must stay inside (the lattice's own footprint). */
export const WEEKLY_FIELD_BOUNDS = {
  minX: LAYOUT_CONSTANTS.fieldCenter.x - LAYOUT_CONSTANTS.fieldWidth / 2,
  maxX: LAYOUT_CONSTANTS.fieldCenter.x + LAYOUT_CONSTANTS.fieldWidth / 2,
  minZ: LAYOUT_CONSTANTS.fieldCenter.z - LAYOUT_CONSTANTS.fieldHeight / 2,
  maxZ: LAYOUT_CONSTANTS.fieldCenter.z + LAYOUT_CONSTANTS.fieldHeight / 2,
} as const

const onGrid = (value: number): boolean => Number.isInteger(value * WEEKLY_GRID)

/**
 * A number on the 1/64 grid inside `range`: one message per value, in the
 * order the hand-written check reported them (type, grid, envelope).
 */
function gridNumber(range: { readonly min: number; readonly max: number }) {
  return v.pipe(
    v.number('must be a finite number'),
    v.finite('must be a finite number'),
    v.check(onGrid, `must be a multiple of 1/${WEEKLY_GRID}`),
    v.check(
      (n) => !onGrid(n) || (n >= range.min && n <= range.max),
      (issue) => `${String(issue.input)} is outside the envelope [${range.min}, ${range.max}]`,
    ),
  )
}

const { keepOuts: keepOutLimits } = WEEKLY_ENVELOPE

const KeepOut = withCrossCheck(
  strict({
    minX: gridNumber({ min: WEEKLY_FIELD_BOUNDS.minX, max: WEEKLY_FIELD_BOUNDS.maxX }),
    maxX: gridNumber({ min: WEEKLY_FIELD_BOUNDS.minX, max: WEEKLY_FIELD_BOUNDS.maxX }),
    minZ: gridNumber({ min: WEEKLY_FIELD_BOUNDS.minZ, max: WEEKLY_FIELD_BOUNDS.maxZ }),
    maxZ: gridNumber({ min: WEEKLY_FIELD_BOUNDS.minZ, max: WEEKLY_FIELD_BOUNDS.maxZ }),
  }),
  (box, issue, clean) => {
    if (!clean || !isRecord(box)) return
    const width = (box.maxX as number) - (box.minX as number)
    const height = (box.maxZ as number) - (box.minZ as number)
    if (width < keepOutLimits.minWidth || width > keepOutLimits.maxWidth) {
      issue([], `width ${width} is outside [${keepOutLimits.minWidth}, ${keepOutLimits.maxWidth}]`)
    }
    if (height < keepOutLimits.minHeight || height > keepOutLimits.maxHeight) {
      issue([], `height ${height} is outside [${keepOutLimits.minHeight}, ${keepOutLimits.maxHeight}]`)
    }
  },
)

const WeeklyPinField = strict({
  rows: intInRange(WEEKLY_ENVELOPE.rows),
  cols: intInRange(WEEKLY_ENVELOPE.cols),
  /** Fraction of slots removed by the seeded hash. */
  dropout: gridNumber(WEEKLY_ENVELOPE.dropout),
  dropoutSeed: u32(),
  /** Rectangles, beyond the table's own keep-outs, the pins stay out of. */
  keepOuts: v.pipe(
    v.array(KeepOut, 'must be an array'),
    v.maxLength(keepOutLimits.maxCount, `at most ${keepOutLimits.maxCount} extra keep-outs`),
  ),
})

const bumperRange = { min: -WEEKLY_ENVELOPE.bumperOffsetMax, max: WEEKLY_ENVELOPE.bumperOffsetMax }
const BumperOffset = strict({ dx: gridNumber(bumperRange), dz: gridNumber(bumperRange) })

/** Which feeders are armed (`FEEDER_KEYS`, in that order). */
const Feeders = withCrossCheck(
  strict({
    magSpin: bool(),
    nanoLoom: bool(),
    prismCore: bool(),
    gaussCannon: bool(),
    quantumTunnel: bool(),
  }),
  (feeders, issue) => {
    if (!isRecord(feeders)) return
    const armed = Object.values(feeders).filter((on) => on === true).length
    const { min, max } = WEEKLY_ENVELOPE.armedFeeders
    if (armed < min || armed > max) issue([], `${armed} armed; must be ${min}–${max}`)
  },
)

export const WeeklyMachineSchema = strict(
  {
    schemaVersion: v.literal(WEEKLY_MACHINE_VERSION, `must be ${WEEKLY_MACHINE_VERSION}`),
    seed: u32(),
    pinField: WeeklyPinField,
    /** One offset per `CANONICAL_BUMPERS` entry, in order. */
    bumpers: v.pipe(
      v.array(BumperOffset, 'must be an array'),
      v.length(CANONICAL_BUMPERS.length, (issue) => {
        const got = Array.isArray(issue.input) ? issue.input.length : 0
        return `needs exactly ${CANONICAL_BUMPERS.length} offsets, got ${got}`
      }),
    ),
    feeders: Feeders,
  },
  'descriptor must be an object',
)

export type WeeklyMachineDescriptor = v.InferOutput<typeof WeeklyMachineSchema>
export type WeeklyPinFieldDescriptor = WeeklyMachineDescriptor['pinField']
export type WeeklyBumperOffset = WeeklyMachineDescriptor['bumpers'][number]
