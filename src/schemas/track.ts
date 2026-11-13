/**
 * Declarative adventure track schema (v1 / #296), as one Valibot schema
 * (#505 §A). The types every track consumer uses (`TrackDefinition`, the
 * `TrackSegment` union, one type per segment) are inferred from it, and
 * `validateTrackDefinition` is a parse with it — there is no second,
 * hand-written description of a track. Geometry only; campaign goals live in
 * TRACK_CATALOG. See docs/TRACK_SCHEMA.md.
 *
 * `public/schemas/track.json` is generated from this file
 * (`npm run schemas:json`), so a track file can name it in `$schema`.
 *
 * Pure TS — no Babylon, no DOM.
 */

import * as v from 'valibot'
import { AdventureTrackType } from '../adventure/adventure-types'
import { TRACK_THEME_PROFILES, type TrackMaterialRole } from '../adventure/track-theme-profiles'
import {
  bool,
  formatSchemaIssues,
  intInRange,
  isRecord,
  num,
  numSplit,
  parseWith,
  strict,
  withCrossCheck,
  type IssueReporter,
  type SchemaIssue,
} from './schema-kit'

export const TRACK_SCHEMA_VERSION = 1 as const

/** Ceiling on a lattice's slot count — the occupancy mask and the visuals scale with it. */
export const PIN_LATTICE_MAX_SLOTS = 4096
/** Ceiling on a force field's acceleration — past this a field is a launcher, not a toy. */
export const FORCE_FIELD_MAX_ACCEL = 60

export const TRACK_MATERIAL_ROLES = ['structure', 'accent', 'energy', 'glow'] as const satisfies readonly TrackMaterialRole[]
export const GATE_COLORS = ['RED', 'GREEN', 'BLUE'] as const
const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const TRACK_IDS: ReadonlySet<string> = new Set(Object.values(AdventureTrackType))
const ROLE_SET: ReadonlySet<string> = new Set(TRACK_MATERIAL_ROLES)

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const MATERIAL_MESSAGE = `material must be a theme role (${TRACK_MATERIAL_ROLES.join('|')}) or #rrggbb`

/** A theme role (resolved through the track's theme profile) or a literal `#rrggbb`. */
const MaterialRef = v.union(
  [
    v.picklist(TRACK_MATERIAL_ROLES, MATERIAL_MESSAGE),
    v.pipe(v.string(MATERIAL_MESSAGE), v.regex(HEX_RE, MATERIAL_MESSAGE), v.transform((s) => s as `#${string}`)),
  ],
  (issue) => (typeof issue.input === 'string' ? MATERIAL_MESSAGE : 'material must be a string (role or #rrggbb)'),
)
export type MaterialRef = v.InferOutput<typeof MaterialRef>

const finite = () => num()
/** `must be a finite number`, then `must be > 0`: the split the hand-written validator reported. */
const gt0 = () => numSplit('must be a finite number', { gt: 0 }, 'must be > 0')
/** One message for both. */
const positive = () => num('must be a finite number > 0', { gt: 0 })
const nonNegative = () => num('must be a finite number >= 0', { min: 0 })
const opt = v.optional

const Vec3 = strict({ x: finite(), y: finite(), z: finite() }, 'expected { x, y, z } object')
export type Vec3Json = v.InferOutput<typeof Vec3>

/** A `Vec3` whose every axis is > 0 (a size). */
const PositiveVec3 = strict({ x: gt0(), y: gt0(), z: gt0() }, 'expected { x, y, z } object')

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const StraightSegment = strict({
  type: v.literal('straight'),
  width: gt0(),
  length: gt0(),
  inclineDeg: finite(),
  material: opt(MaterialRef),
  wallHeight: opt(finite()),
  friction: opt(finite()),
})

const CurveSegment = strict({
  type: v.literal('curve'),
  radius: gt0(),
  angleDeg: finite(),
  inclineDeg: finite(),
  width: gt0(),
  wallHeight: opt(finite()),
  bankingDeg: opt(finite()),
  segments: opt(num('must be a number >= 1', { min: 1 })),
  material: opt(MaterialRef),
  friction: opt(finite()),
})

const GapSegment = strict({
  type: v.literal('gap'),
  /** Horizontal distance along current heading. */
  length: finite(),
  /** Vertical drop (positive = down). Negative rises. */
  drop: finite(),
})

const TurnSegment = strict({
  type: v.literal('turn'),
  /** Heading delta in degrees (added to current heading). */
  deltaHeadingDeg: finite(),
})

const BucketSegment = strict({
  type: v.literal('bucket'),
  material: opt(MaterialRef),
  offset: opt(Vec3),
})

const PortalSegment = strict({
  type: v.literal('portal'),
  offset: opt(Vec3),
})

const SpinnerSegment = strict({
  type: v.literal('spinner'),
  radius: gt0(),
  /** Angular velocity in degrees/second about Y. */
  angVelDeg: finite(),
  teeth: opt(bool()),
  /** When true, advance cursor by radius along heading past the spinner center. */
  advance: opt(bool()),
  /**
   * World-space offset from the cursor used as the spinner center. When
   * omitted, the compiler uses the legacy (radius+1 along heading, y-1) placement.
   */
  offset: opt(Vec3),
  material: opt(MaterialRef),
})

const GateSegment = strict({
  type: v.literal('gate'),
  color: v.picklist(GATE_COLORS, 'color must be RED, GREEN, or BLUE'),
  /** World-space offset from the cursor; gates usually sit above the running surface. */
  offset: opt(Vec3),
})

const CylinderSegment = strict({
  type: v.literal('cylinder'),
  diameter: gt0(),
  height: gt0(),
  offset: opt(Vec3),
  material: opt(MaterialRef),
})

const PinFieldSegment = strict({
  type: v.literal('pinField'),
  spacing: positive(),
  evenOffsets: v.array(num('must be an array of finite numbers'), 'must be an array of finite numbers'),
  oddOffsets: v.array(num('must be an array of finite numbers'), 'must be an array of finite numbers'),
  diameter: positive(),
  height: positive(),
  material: opt(MaterialRef),
})

const MillSegment = strict({
  type: v.literal('mill'),
  /** Distance along the previous straight ramp surface from its start. */
  alongRamp: finite(),
  /** Lateral offset along ramp right-vector. */
  lateral: finite(),
  radius: gt0(),
  /** Angular velocity along the ramp normal (radians/second). */
  angVel: finite(),
  surfaceOffset: opt(finite()),
  material: opt(MaterialRef),
})

const ResetBasinSegment = strict({
  type: v.literal('resetBasin'),
  offset: opt(Vec3),
  material: opt(MaterialRef),
})

/**
 * A native pin lattice (#421 / #424) on the most recent straight ramp: one C++
 * `addPinField` handle however many pins it holds. Rows run down the slope,
 * columns across it; the lattice is centred on the ramp (plus `lateral`).
 * `dropout` removes slots by a seeded hash that C++ and the visuals share.
 */
const PinLatticeSegment = withCrossCheck(
  strict({
    type: v.literal('pinLattice'),
    rows: intInRange({ min: 1, max: Number.MAX_SAFE_INTEGER }, 'must be an integer >= 1'),
    cols: intInRange({ min: 1, max: Number.MAX_SAFE_INTEGER }, 'must be an integer >= 1'),
    /** Pitch across the ramp. */
    spacing: positive(),
    /** Pitch down the ramp; defaults to `spacing`. */
    rowSpacing: opt(positive()),
    /** Across-ramp shift of odd rows; defaults to `spacing / 2` (the pachinko stagger). */
    rowOffset: opt(finite()),
    /** Distance down the ramp from its start to row 0; defaults to `rowSpacing`. */
    startAlong: opt(nonNegative()),
    /** Across-ramp shift of the whole lattice centre; default 0. */
    lateral: opt(finite()),
    diameter: positive(),
    height: positive(),
    /** Default 0.6. */
    restitution: opt(nonNegative()),
    /** Default 0.3. */
    friction: opt(nonNegative()),
    /** Probability in [0, 1) that the seeded hash drops a slot. */
    dropout: opt(num('must be a number in [0, 1)', { min: 0, lt: 1 })),
    /** Unsigned 32-bit seed for `dropout`; default 0. */
    dropoutSeed: opt(intInRange({ min: 0, max: 0xffffffff }, 'must be an unsigned 32-bit integer')),
    /** Slots left empty on purpose (a channel, a pocket mouth). */
    holes: opt(
      v.array(
        strict(
          {
            row: intInRange({ min: 0, max: Number.MAX_SAFE_INTEGER }, 'must be { row, col } inside the lattice'),
            col: intInRange({ min: 0, max: Number.MAX_SAFE_INTEGER }, 'must be { row, col } inside the lattice'),
          },
          'must be { row, col } inside the lattice',
        ),
        'must be an array of { row, col }',
      ),
    ),
    material: opt(MaterialRef),
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    const { rows, cols, holes } = seg
    const isInt = (n: unknown): n is number => Number.isInteger(n)
    if (isInt(rows) && isInt(cols) && rows * cols > PIN_LATTICE_MAX_SLOTS) {
      issue([], `rows * cols must be <= ${PIN_LATTICE_MAX_SLOTS}`)
    }
    if (!Array.isArray(holes)) return
    holes.forEach((hole: unknown, i) => {
      if (!isRecord(hole)) return
      const outside = (value: unknown, n: unknown) => isInt(value) && isInt(n) && value >= n
      if (outside(hole.row, rows) || outside(hole.col, cols)) issue(['holes', i], 'must be { row, col } inside the lattice')
    })
  },
)

/**
 * An oriented box that accelerates every ball inside it (C++ `addForceField`):
 * updrafts, crosswinds, conveyors. Ramp-anchored (`alongRamp` set: framed by
 * the most recent straight) or cursor-anchored (world `offset`, cursor heading
 * plus `yawDeg`). C++-only: the Rapier dev path builds the track without it.
 */
const ForceFieldSegment = withCrossCheck(
  strict({
    type: v.literal('forceField'),
    /** Full extents in the field's own frame. */
    size: PositiveVec3,
    /** m/s². World space unless `space` is `field`. */
    accel: Vec3,
    space: opt(v.picklist(['world', 'field'], "must be 'world' or 'field'")),
    alongRamp: opt(finite()),
    lateral: opt(finite()),
    /** Ramp-anchored only: height of the centre above the surface; default `size.y / 2`. */
    surfaceOffset: opt(finite()),
    /** Cursor-anchored only. */
    offset: opt(Vec3),
    /** Cursor-anchored only: extra yaw on top of the cursor heading. */
    yawDeg: opt(finite()),
    /** Draw a faint translucent volume; default true. */
    visible: opt(bool()),
    material: opt(MaterialRef),
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    const accel = seg.accel
    if (isRecord(accel)) {
      const { x, y, z } = accel
      if (
        typeof x === 'number' && typeof y === 'number' && typeof z === 'number' &&
        Math.hypot(x, y, z) > FORCE_FIELD_MAX_ACCEL
      ) {
        issue(['accel'], `magnitude must be <= ${FORCE_FIELD_MAX_ACCEL} m/s²`)
      }
    }
    if (seg.alongRamp !== undefined) {
      for (const key of ['offset', 'yawDeg'] as const) {
        if (seg[key] !== undefined) issue([key], 'only applies to a cursor-anchored field (no alongRamp)')
      }
    } else {
      for (const key of ['lateral', 'surfaceOffset'] as const) {
        if (seg[key] !== undefined) issue([key], 'only applies to a ramp-anchored field (set alongRamp)')
      }
    }
  },
)

/**
 * A static cone (C++ `addStaticCone`): apex up along local +Y, base seated on
 * cursor + `offset`. One handle, not a triangle fan.
 */
const ConeSegment = strict({
  type: v.literal('cone'),
  /** Base radius. */
  radius: positive(),
  /** Half of the base-to-apex height. */
  halfHeight: positive(),
  /** World-space offset from the cursor to the centre of the base. */
  offset: opt(Vec3),
  /** Extra yaw on top of the cursor heading (orients the visual seam). */
  yawDeg: opt(finite()),
  /** Default 0.5. */
  restitution: opt(nonNegative()),
  /** Default 0.3. */
  friction: opt(nonNegative()),
  material: opt(MaterialRef),
})

/**
 * The Mag Spin well as data: a C++ axis-pull force field (`addAxisPullField`)
 * that draws every ball within `radius` of its axis inward. C++-only.
 */
const AxisPullSegment = withCrossCheck(
  strict({
    type: v.literal('axisPull'),
    /** World-space offset from the cursor to the well's origin. */
    offset: opt(Vec3),
    /** Pull axis: ±Y only (the C++ well takes no rotation); default `{ 0, 1, 0 }`. */
    axis: opt(Vec3),
    radius: positive(),
    /** Half-height of the pulled band about the origin; default 1. */
    halfHeight: opt(positive()),
    /** Pull at the axis in m/s² (mass-independent). */
    strength: num(`must be a number in [0, ${FORCE_FIELD_MAX_ACCEL}] m/s²`, { min: 0, max: FORCE_FIELD_MAX_ACCEL }),
    /** Default true. A disabled well is built but pulls nothing. */
    enabled: opt(bool()),
    /** Draw a faint translucent column; default true. */
    visible: opt(bool()),
    material: opt(MaterialRef),
  }),
  (seg, issue) => {
    if (!isRecord(seg) || !isRecord(seg.axis)) return
    const { x, y, z } = seg.axis
    if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && (x !== 0 || z !== 0 || y === 0)) {
      issue(['axis'], 'must be vertical ({ x: 0, y: ±1, z: 0 }): the C++ well takes no rotation')
    }
  },
)

const SEGMENT_SCHEMAS = [
  StraightSegment,
  CurveSegment,
  GapSegment,
  TurnSegment,
  BucketSegment,
  PortalSegment,
  SpinnerSegment,
  GateSegment,
  CylinderSegment,
  PinFieldSegment,
  MillSegment,
  ResetBasinSegment,
  PinLatticeSegment,
  ForceFieldSegment,
  ConeSegment,
  AxisPullSegment,
] as const

export const TRACK_SEGMENT_TYPES = SEGMENT_SCHEMAS.map((s) => s.entries.type.literal)

const TrackSegmentSchema = v.variant('type', SEGMENT_SCHEMAS, (issue) =>
  issue.path ? `type must be one of: ${TRACK_SEGMENT_TYPES.join(', ')}` : 'segment must be an object',
)

export type StraightSegment = v.InferOutput<typeof StraightSegment>
export type CurveSegment = v.InferOutput<typeof CurveSegment>
export type GapSegment = v.InferOutput<typeof GapSegment>
export type TurnSegment = v.InferOutput<typeof TurnSegment>
export type BucketSegment = v.InferOutput<typeof BucketSegment>
export type PortalSegment = v.InferOutput<typeof PortalSegment>
export type SpinnerSegment = v.InferOutput<typeof SpinnerSegment>
export type GateSegment = v.InferOutput<typeof GateSegment>
export type CylinderSegment = v.InferOutput<typeof CylinderSegment>
export type PinFieldSegment = v.InferOutput<typeof PinFieldSegment>
export type MillSegment = v.InferOutput<typeof MillSegment>
export type ResetBasinSegment = v.InferOutput<typeof ResetBasinSegment>
export type PinLatticeSegment = v.InferOutput<typeof PinLatticeSegment>
export type ForceFieldSegment = v.InferOutput<typeof ForceFieldSegment>
export type ConeSegment = v.InferOutput<typeof ConeSegment>
export type AxisPullSegment = v.InferOutput<typeof AxisPullSegment>
export type TrackSegment = v.InferOutput<typeof TrackSegmentSchema>

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

/**
 * Placement checks that need the ramp a segment sits on: a `pinLattice` or a
 * ramp-anchored `forceField` must follow a straight, and must fit on it.
 * Runs only once every segment is individually valid.
 */
function checkRampPlacement(segments: readonly TrackSegment[], issue: IssueReporter): void {
  let ramp: StraightSegment | null = null
  segments.forEach((segment, i) => {
    const at = (key?: string) => (key ? ['segments', i, key] : ['segments', i])
    if (segment.type === 'straight') {
      ramp = segment
      return
    }
    const needsRamp = segment.type === 'pinLattice' || (segment.type === 'forceField' && segment.alongRamp !== undefined)
    if (!needsRamp) return
    if (!ramp) {
      issue(at(), `${segment.type} must follow a straight segment`)
      return
    }
    const halfWidth = ramp.width / 2
    const length = ramp.length
    if (segment.type === 'pinLattice') {
      const rowSpacing = segment.rowSpacing ?? segment.spacing
      const rowOffset = segment.rows > 1 ? (segment.rowOffset ?? segment.spacing / 2) : 0
      const startAlong = segment.startAlong ?? rowSpacing
      const radius = segment.diameter / 2
      const lastRow = startAlong + (segment.rows - 1) * rowSpacing
      if (startAlong - radius < 0 || lastRow + radius > length) {
        issue(at(), `lattice runs ${startAlong}..${lastRow} down a ${length}-long ramp`)
      }
      const span = ((segment.cols - 1) * segment.spacing) / 2
      const lateral = segment.lateral ?? 0
      const minX = lateral - span + Math.min(0, rowOffset) - radius
      const maxX = lateral + span + Math.max(0, rowOffset) + radius
      if (minX < -halfWidth || maxX > halfWidth) {
        issue(at(), `lattice spans ${minX.toFixed(2)}..${maxX.toFixed(2)} across a ${ramp.width}-wide ramp`)
      }
      return
    }
    if (segment.type === 'forceField') {
      const along = segment.alongRamp ?? 0
      if (along < 0 || along > length) issue(at('alongRamp'), `must be within the ${length}-long ramp`)
      if (Math.abs(segment.lateral ?? 0) > halfWidth) issue(at('lateral'), `must be within the ${ramp.width}-wide ramp`)
    }
  })
}

const MaterialOverrides = v.record(
  v.picklist(TRACK_MATERIAL_ROLES, 'unknown material role'),
  v.pipe(v.string('must be #rrggbb'), v.regex(HEX_RE, 'must be #rrggbb')),
  'must be an object',
)

export const TrackDefinitionSchema = withCrossCheck(
  strict(
    {
      /** Editor completion only (`public/schemas/track.json`); ignored by the compiler. */
      $schema: opt(v.string('must be a string')),
      schemaVersion: v.literal(TRACK_SCHEMA_VERSION, `must be ${TRACK_SCHEMA_VERSION}`),
      /** Must match an AdventureTrackType / TRACK_CATALOG key. */
      id: v.pipe(
        v.string('must be a non-empty string'),
        v.minLength(1, 'must be a non-empty string'),
        v.check((id) => id === '' || TRACK_IDS.has(id), (issue) => `unknown AdventureTrackType: ${String(issue.input)}`),
      ),
      themeProfile: opt(
        v.pipe(
          v.string('must be a string'),
          v.check((id) => id in TRACK_THEME_PROFILES, (issue) => `unknown theme profile: ${String(issue.input)}`),
        ),
      ),
      cameraPresetId: opt(v.string('must be a string')),
      gravityMultiplier: opt(positive()),
      /** Compiler cursor heading in degrees (default 0). NEON_HELIX uses 180. */
      initialHeadingDeg: opt(finite()),
      materials: opt(MaterialOverrides),
      segments: v.pipe(
        v.array(TrackSegmentSchema, 'must be an array'),
        v.minLength(1, 'must contain at least one segment'),
      ),
    },
    'track definition must be an object',
  ),
  (track, issue, clean) => {
    // Clean: every segment parsed, so `segments` has the TrackSegment shape.
    if (clean && isRecord(track) && Array.isArray(track.segments)) checkRampPlacement(track.segments as TrackSegment[], issue)
  },
)

export type TrackDefinition = v.InferOutput<typeof TrackDefinitionSchema>

export type TrackValidationIssue = SchemaIssue

export type TrackValidationResult =
  | { ok: true; definition: TrackDefinition }
  | { ok: false; errors: TrackValidationIssue[] }

/**
 * Validate a raw JSON value as a TrackDefinition.
 * Does not throw — returns structured errors for soft-fail HUD paths.
 */
export function validateTrackDefinition(raw: unknown): TrackValidationResult {
  const result = parseWith(TrackDefinitionSchema, raw)
  return result.ok ? { ok: true, definition: result.value } : result
}

/** Format validation errors for HUD / console. */
export function formatTrackValidationErrors(errors: readonly TrackValidationIssue[]): string {
  if (errors.length === 0) return 'Invalid track definition'
  const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : ''
  return `Invalid track: ${formatSchemaIssues(errors.slice(0, 3))}${more}`
}

export function isMaterialRole(ref: string): ref is TrackMaterialRole {
  return ROLE_SET.has(ref)
}
