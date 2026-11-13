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
import { TRACK_THEME_PROFILES } from '../adventure/track-theme-profiles'
import { isMaterialRole, TRACK_MATERIAL_ROLES } from '../adventure/track-material-roles'
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

export { isMaterialRole, TRACK_MATERIAL_ROLES }
export const GATE_COLORS = ['RED', 'GREEN', 'BLUE'] as const
const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const PBR_HEX_RE = /^pbr:#[0-9A-Fa-f]{6}$/
const TRACK_IDS: ReadonlySet<string> = new Set(Object.values(AdventureTrackType))

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const MATERIAL_MESSAGE = `material must be a theme role (${TRACK_MATERIAL_ROLES.join('|')}) or #rrggbb`

/**
 * A theme role (resolved through the track's theme profile), a literal
 * `#rrggbb`, or `pbr:#rrggbb` for the glassy PBR track material.
 */
const MaterialRef = v.union(
  [
    v.picklist(TRACK_MATERIAL_ROLES, MATERIAL_MESSAGE),
    v.pipe(v.string(MATERIAL_MESSAGE), v.regex(HEX_RE, MATERIAL_MESSAGE), v.transform((s) => s as `#${string}`)),
    v.pipe(v.string(MATERIAL_MESSAGE), v.regex(PBR_HEX_RE, MATERIAL_MESSAGE), v.transform((s) => s as `pbr:#${string}`)),
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
// Placement, values and shapes shared by the element segments (#505 §A)
// ---------------------------------------------------------------------------

const MARK_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const MarkName = v.pipe(v.string('must be a mark name'), v.regex(MARK_RE, 'must be a mark name (a letter, then letters, digits, _ or -)'))

/** What a placement is measured from. */
export const PLACEMENT_ANCHORS = ['cursor', 'rampStart', 'rampCenter', 'spinner'] as const

/**
 * Where an element sits. From an anchor (`from`, default the cursor, or a
 * `mark`) the compiler adds, in this order: the world-space `offset`, `along`
 * the anchor's heading, `lateral` along its right, `normal` off the ramp
 * surface (`frame: "surface"` only), then each `up` entry to y in turn. Every
 * step is one vector add, so a placement reproduces the arithmetic of the TS
 * builders it replaced.
 *
 * - `rampStart`: the start of the most recent straight, its heading.
 * - `rampCenter`: that straight's centre line at half its length (horizontal
 *   half-length forward, half the drop down).
 * - `spinner`: the centre of the most recent spinner, the heading it was built at.
 * - `frame: "surface"` measures `along` down the ramp surface and `normal` off it
 *   (most recent straight, `rampStart` only).
 */
const Placement = withCrossCheck(
  strict({
    from: opt(v.picklist(PLACEMENT_ANCHORS, `must be one of ${PLACEMENT_ANCHORS.join(' | ')}`)),
    mark: opt(MarkName),
    frame: opt(v.picklist(['flat', 'surface'], "must be 'flat' or 'surface'")),
    offset: opt(Vec3),
    along: opt(finite()),
    lateral: opt(finite()),
    normal: opt(finite()),
    up: opt(v.array(num('must be an array of finite numbers'), 'must be an array of finite numbers')),
  }),
  (at, issue) => {
    if (!isRecord(at)) return
    if (at.from !== undefined && at.mark !== undefined) issue(['mark'], 'set `from` or `mark`, not both')
    if (at.frame === 'surface' && at.from !== 'rampStart') issue(['frame'], 'a surface frame is measured from rampStart')
    if (at.normal !== undefined && at.frame !== 'surface') issue(['normal'], 'only applies to frame "surface"')
  },
)
export type Placement = v.InferOutput<typeof Placement>

/** `min + r * (max - min)` from the segment's seeded stream, times `scale` when set. */
const SeededNumber = strict({
  random: v.tuple([finite(), finite()], 'must be [min, max]'),
  scale: opt(finite()),
})
/** `start + i * step`, `i` the element's index. */
const SteppedNumber = strict({ start: finite(), step: finite() })

export type SeededNumberSpec = v.InferOutput<typeof SeededNumber>
export type SteppedNumberSpec = v.InferOutput<typeof SteppedNumber>
/** A literal, a seeded draw or an index-linear value. */
export type NumberSpec = number | SeededNumberSpec | SteppedNumberSpec

const NUMBER_SPEC_MESSAGE = 'must be a number, { random: [min, max] } or { start, step }'
const NumberSpecSchema = v.lazy((input: unknown): v.GenericSchema<unknown, NumberSpec> => {
  if (typeof input === 'number') return finite()
  if (isRecord(input) && 'random' in input) return SeededNumber
  if (isRecord(input) && 'start' in input) return SteppedNumber
  return v.union([num(NUMBER_SPEC_MESSAGE), SeededNumber, SteppedNumber], NUMBER_SPEC_MESSAGE)
})

/** A dimension: a size, or `"size"` for the scatter's seeded size. */
const Dim = v.union([gt0(), v.literal('size')], 'must be a number > 0 or "size"')

/** A collider shape; the element's mesh matches it unless `mesh` says otherwise. */
const ShapeSchema = v.variant(
  'kind',
  [
    strict({ kind: v.literal('box'), size: v.union([PositiveVec3, v.literal('size')], 'must be { x, y, z } or "size"') }),
    strict({ kind: v.literal('cylinder'), diameter: Dim, height: Dim }),
    strict({ kind: v.literal('sphere'), diameter: Dim }),
    /** Triangular prism (one convex hull). */
    strict({ kind: v.literal('prism'), diameter: Dim, height: Dim }),
    /** Tetrahedron debris: a cube collider of half-extent `size / 3`, a tetrahedron mesh. */
    strict({ kind: v.literal('tetra'), size: Dim }),
  ],
  (issue) => (issue.path ? 'kind must be one of: box, cylinder, sphere, prism, tetra' : 'shape must be an object'),
)
export type ShapeSpec = v.InferOutput<typeof ShapeSchema>

/** A mesh-only shape (decor, custom visuals). */
const MeshShapeSchema = v.variant(
  'kind',
  [
    strict({ kind: v.literal('box'), size: PositiveVec3 }),
    strict({ kind: v.literal('cylinder'), diameter: gt0(), height: gt0(), tessellation: opt(intInRange({ min: 3, max: 128 })) }),
    strict({ kind: v.literal('sphere'), diameter: gt0() }),
    strict({ kind: v.literal('torus'), diameter: gt0(), thickness: gt0(), tessellation: opt(intInRange({ min: 3, max: 128 })) }),
    strict({ kind: v.literal('tetra'), size: gt0() }),
  ],
  (issue) => (issue.path ? 'kind must be one of: box, cylinder, sphere, torus, tetra' : 'shape must be an object'),
)
export type MeshShapeSpec = v.InferOutput<typeof MeshShapeSchema>

/** A custom visual: the first mesh rides the body, the rest are its children at `local`. */
const VisualMesh = strict({ shape: MeshShapeSchema, local: opt(Vec3), material: opt(MaterialRef) })
export type VisualMeshSpec = v.InferOutput<typeof VisualMesh>
/** `false` builds no mesh; a list replaces the default mesh (which matches the collider). */
const MeshOption = v.union(
  [v.literal(false), v.pipe(v.array(VisualMesh, 'must be an array of meshes'), v.minLength(1, 'must hold at least one mesh'))],
  'must be false or a list of meshes',
)

export const COLLISION_COLORS = ['RED', 'GREEN', 'BLUE'] as const

/** A kinematic mover (`AnimatedObstacle`); every number may be seeded or index-linear. */
const MotionSchema = strict({
  kind: opt(v.picklist(['piston', 'oscillator', 'rotatingOscillator'], 'must be piston, oscillator or rotatingOscillator')),
  frequency: opt(NumberSpecSchema),
  amplitude: opt(NumberSpecSchema),
  /** Default 0. */
  phase: opt(NumberSpecSchema),
  /** Oscillator / rotating-oscillator axis; `"right"` is the anchor's right. */
  axis: opt(v.union([v.literal('right'), Vec3], 'must be "right" or { x, y, z }')),
  /** Piston only: travel between y offsets [top, bottom] from the placement; centre and amplitude follow. */
  travel: opt(v.tuple([finite(), finite()], 'must be [top, bottom]')),
  /** Order of this element's seeded draws (default frequency, amplitude, phase). */
  draw: opt(v.array(v.picklist(['frequency', 'amplitude', 'phase'], 'must be frequency, amplitude or phase'))),
  /** Also register a kinematic binding (the mesh follows the body every frame). */
  bindMesh: opt(bool()),
})
export type MotionSpec = v.InferOutput<typeof MotionSchema>

/** A sensor zone the per-frame systems act on. */
const ZoneSchema = v.variant(
  'kind',
  [
    /** A constant world-space force on every ball inside. */
    strict({ kind: v.literal('conveyor'), force: Vec3 }),
    /** A force of `force` down the most recent straight's slope. */
    strict({ kind: v.literal('rampConveyor'), force: finite() }),
    strict({ kind: v.literal('damping'), damping: nonNegative() }),
  ],
  (issue) => (issue.path ? 'kind must be one of: conveyor, rampConveyor, damping' : 'zone must be an object'),
)
export type ZoneSpec = v.InferOutput<typeof ZoneSchema>

const SEED_KEY_RE = /^[a-z0-9][a-z0-9:_-]{0,63}$/
const SeedKey = v.pipe(v.string('must be a seed key'), v.regex(SEED_KEY_RE, 'must be a seed key (lower-case letters, digits, :, _ and -)'))
const Label = v.pipe(v.string('must be a string'), v.maxLength(48, 'must be at most 48 characters'))

/** Fields an element group and each of its items may set (an item overrides its group). */
const ELEMENT_FIELDS = {
  shape: opt(ShapeSchema),
  material: opt(MaterialRef),
  label: opt(Label),
  /** Yaw the collider and mesh to the anchor heading, or also tilt them with the most recent straight. */
  orient: opt(v.picklist(['heading', 'ramp'], "must be 'heading' or 'ramp'")),
  restitution: opt(nonNegative()),
  friction: opt(nonNegative()),
  /** Chroma collision group (the ball passes only in its own colour). */
  collisionColor: opt(v.picklist(COLLISION_COLORS, 'must be RED, GREEN or BLUE')),
  /** Collider offset inside its body (the body sits on the placement). */
  local: opt(Vec3),
  sensor: opt(bool()),
  zone: opt(ZoneSchema),
  motion: opt(MotionSchema),
  mesh: opt(MeshOption),
}

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
  /** Build this ramp at the cursor heading plus this, leaving the cursor heading as it is. */
  headingOffsetDeg: opt(finite()),
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
  /**
   * Conveyor sensors following the curve: `segments` chord boxes from its
   * start, each pushing `force` along its chord and down the incline.
   */
  conveyor: opt(
    strict({
      segments: intInRange({ min: 1, max: 256 }),
      force: finite(),
      halfWidth: positive(),
      halfHeight: positive(),
      lift: opt(finite()),
      label: opt(Label),
    }),
  ),
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

const BucketSegment = withCrossCheck(
  strict({
    type: v.literal('bucket'),
    material: opt(MaterialRef),
    /** World-space offset from the cursor. */
    offset: opt(Vec3),
    /** Placement of the basin (instead of `offset`). */
    at: opt(Placement),
  }),
  (seg, issue) => {
    if (isRecord(seg) && seg.offset !== undefined && seg.at !== undefined) issue(['at'], 'set `offset` or `at`, not both')
  },
)

const PortalSegment = strict({
  type: v.literal('portal'),
  offset: opt(Vec3),
})

const SpinnerSegment = withCrossCheck(
  strict({
    type: v.literal('spinner'),
    radius: gt0(),
    /** Angular velocity in degrees/second about Y. */
    angVelDeg: opt(finite()),
    /** Angular velocity in radians/second about Y (instead of `angVelDeg`). */
    angVel: opt(finite()),
    teeth: opt(bool()),
    /** When true, advance cursor by radius along heading past the spinner center. */
    advance: opt(bool()),
    /**
     * World-space offset from the cursor used as the spinner center. When
     * omitted (and no `at`), the compiler uses the legacy (radius+1 along heading, y-1) placement.
     */
    offset: opt(Vec3),
    /** Placement of the spinner centre (instead of `offset`). */
    at: opt(Placement),
    material: opt(MaterialRef),
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    if ((seg.angVelDeg === undefined) === (seg.angVel === undefined)) issue(['angVelDeg'], 'set exactly one of `angVelDeg` and `angVel`')
    if (seg.offset !== undefined && seg.at !== undefined) issue(['at'], 'set `offset` or `at`, not both')
  },
)

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


// ---------------------------------------------------------------------------
// Element segments: what the hand-written TS track modules built (#505 §A)
// ---------------------------------------------------------------------------

/** Remember the cursor (position and heading) under `name`. */
const MarkSegment = strict({
  type: v.literal('mark'),
  name: MarkName,
})

/**
 * Move the cursor: back to a mark (its heading too), to the midpoint of two
 * marks, or to a placement. `headingOf` takes the heading from a mark.
 */
const JumpSegment = withCrossCheck(
  strict({
    type: v.literal('jump'),
    to: opt(MarkName),
    midpoint: opt(v.tuple([MarkName, MarkName], 'must be [mark, mark]')),
    at: opt(Placement),
    headingOf: opt(MarkName),
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    const set = ['to', 'midpoint', 'at'].filter((key) => seg[key] !== undefined).length
    if (set !== 1) issue([], 'set exactly one of `to`, `midpoint` and `at`')
  },
)

/** Placement draws: `random` → seeded, `start` / `step` → by index, a number → fixed. */
const ScatterAxis = NumberSpecSchema

/**
 * `count` copies of a shape strewn by one seeded stream (`getLayoutRng(seedKey)`),
 * the way the TS modules strewed prisms, chips, debris and cilia. Each copy
 * draws, in this order: `along`, `lateral`, the shape (when `shapes` lists
 * several: copy uses `shapes[k]`, k = how many of 1/n, 2/n, … the draw exceeds),
 * `size`, the `rotation` axes x, y, z (in turns), then its motion numbers.
 * Positions are measured like a placement from `from` (default `rampStart`);
 * `seat` lifts each copy by half its height (off the surface in a surface frame).
 */
const ScatterSegment = withCrossCheck(
  strict({
    type: v.literal('scatter'),
    seedKey: SeedKey,
    count: intInRange({ min: 1, max: 1024 }),
    from: opt(v.picklist(PLACEMENT_ANCHORS, `must be one of ${PLACEMENT_ANCHORS.join(' | ')}`)),
    mark: opt(MarkName),
    frame: opt(v.picklist(['flat', 'surface'], "must be 'flat' or 'surface'")),
    along: ScatterAxis,
    lateral: opt(ScatterAxis),
    shapes: opt(v.pipe(v.array(ShapeSchema, 'must be an array of shapes'), v.minLength(2, 'list at least two shapes (or use `shape`)'))),
    size: opt(v.tuple([positive(), positive()], 'must be [min, max]')),
    rotation: opt(strict({ x: opt(NumberSpecSchema), y: opt(NumberSpecSchema), z: opt(NumberSpecSchema) })),
    seat: opt(bool()),
    up: opt(v.array(num('must be an array of finite numbers'), 'must be an array of finite numbers')),
    /** Cosmetic: copy i uses `materials[i % n]` (instead of `material`). */
    materials: opt(v.pipe(v.array(MaterialRef, 'must be an array of materials'), v.minLength(1, 'must hold at least one material'))),
    ...ELEMENT_FIELDS,
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    if ((seg.shape === undefined) === (seg.shapes === undefined)) issue([], 'set exactly one of `shape` and `shapes`')
    if (seg.seat === true && seg.up !== undefined) issue(['up'], 'set `seat` or `up`, not both')
    if (seg.from !== undefined && seg.mark !== undefined) issue(['mark'], 'set `from` or `mark`, not both')
    if (seg.frame === 'surface' && (seg.from ?? 'rampStart') !== 'rampStart') issue(['frame'], 'a surface frame is measured from rampStart')
    if (seg.zone !== undefined) issue(['zone'], 'a scatter builds solid copies, not zones')
    const shapes: unknown[] = Array.isArray(seg.shapes) ? seg.shapes : [seg.shape]
    const usesSize = shapes.some((shape) => isRecord(shape) && Object.values(shape).includes('size'))
    if (usesSize && seg.size === undefined) issue(['size'], 'a shape dimension is "size", so set `size: [min, max]`')
  },
)

const ObstacleItem = strict({ at: Placement, ...ELEMENT_FIELDS })
export type ObstacleItemSpec = v.InferOutput<typeof ObstacleItem>

/**
 * Explicitly placed elements: static colliders, sensors / zones and
 * kinematic movers. The segment's fields are defaults each item may override;
 * `variants` (with a `seedKey`) picks one item list by one seeded draw.
 */
const ObstacleSegment = withCrossCheck(
  strict({
    type: v.literal('obstacle'),
    seedKey: opt(SeedKey),
    items: opt(v.pipe(v.array(ObstacleItem, 'must be an array of items'), v.minLength(1, 'must hold at least one item'))),
    variants: opt(
      v.pipe(
        v.array(v.pipe(v.array(ObstacleItem, 'must be an array of items'), v.minLength(1, 'must hold at least one item')), 'must be an array of item lists'),
        v.minLength(2, 'list at least two variants'),
      ),
    ),
    ...ELEMENT_FIELDS,
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    if ((seg.items === undefined) === (seg.variants === undefined)) issue([], 'set exactly one of `items` and `variants`')
    if (seg.variants !== undefined && seg.seedKey === undefined) issue(['seedKey'], 'variants are picked by a seeded draw; set `seedKey`')
    const lists = Array.isArray(seg.items) ? [seg.items] : Array.isArray(seg.variants) ? seg.variants : []
    lists.forEach((list: unknown, l) => {
      if (!Array.isArray(list)) return
      list.forEach((item: unknown, i) => {
        if (!isRecord(item)) return
        const path = seg.items !== undefined ? ['items', i] : ['variants', l, i]
        if (item.shape === undefined && seg.shape === undefined) issue(path, 'needs a `shape` (here or on the segment)')
      })
    })
  },
)

/**
 * Colliders riding the most recent spinner: a `ring` of `count` evenly spaced
 * (a `gapDeg` gap leaves an opening; `segments` steps span the rest) or a list
 * of `points`, at `radius` (or `radiusFactor` × the spinner radius) and local
 * height `y`. `body: "own"` builds them as one co-rotating kinematic sensor
 * body instead of attaching them to the platform (`reset`: a reset sensor).
 */
const SpinnerPartsSegment = withCrossCheck(
  strict({
    type: v.literal('spinnerParts'),
    ring: opt(strict({ count: intInRange({ min: 1, max: 256 }), gapDeg: opt(num('must be a number in [0, 360)', { min: 0, lt: 360 })), segments: opt(intInRange({ min: 1, max: 256 })) })),
    points: opt(v.pipe(v.array(strict({ angleDeg: finite(), radius: positive() }), 'must be an array of { angleDeg, radius }'), v.minLength(1, 'must hold at least one point'))),
    radius: opt(positive()),
    radiusFactor: opt(positive()),
    y: finite(),
    shape: v.variant(
      'kind',
      [
        /** `size.z: "arc"` makes each box as deep as its ring step (plus `arcPad` each side). */
        strict({ kind: v.literal('box'), size: strict({ x: positive(), y: positive(), z: v.union([positive(), v.literal('arc')], 'must be a number > 0 or "arc"') }), arcPad: opt(nonNegative()) }),
        strict({ kind: v.literal('cylinder'), diameter: positive(), height: positive() }),
      ],
      (issue) => (issue.path ? 'kind must be box or cylinder' : 'shape must be an object'),
    ),
    /** Turn each part to its angle (boxes on a ring). */
    yaw: opt(bool()),
    sensor: opt(bool()),
    label: opt(Label),
    material: opt(MaterialRef),
    /** `false`: no meshes. Otherwise each part's mesh (default: the collider shape) at local height `y`. */
    mesh: opt(v.union([v.literal(false), strict({ shape: opt(MeshShapeSchema), y: opt(finite()) })], 'must be false or { shape, y }')),
    body: opt(v.picklist(['platform', 'own'], "must be 'platform' or 'own'")),
    reset: opt(bool()),
  }),
  (seg, issue) => {
    if (!isRecord(seg)) return
    if ((seg.ring === undefined) === (seg.points === undefined)) issue([], 'set exactly one of `ring` and `points`')
    if (seg.ring !== undefined && (seg.radius === undefined) === (seg.radiusFactor === undefined)) {
      issue(['radius'], 'a ring needs exactly one of `radius` and `radiusFactor`')
    }
    if (seg.points !== undefined && (seg.radius !== undefined || seg.radiusFactor !== undefined)) {
      issue(['radius'], 'points carry their own radius')
    }
    if (seg.reset === true && seg.body !== 'own') issue(['reset'], 'only an own body can be a reset sensor')
  },
)

/**
 * Rows of pins on the most recent straight (the Pachinko Hall lanes): row k
 * (1-based) sits `k × spacing` down the ramp, its pins at `oddOffsets` /
 * `evenOffsets` across it, skipping any closer than `edgeMargin` to a side;
 * `max(2, floor(length / spacing) − 1)` rows. One static cylinder per pin.
 */
const PinRowsSegment = strict({
  type: v.literal('pinRows'),
  spacing: positive(),
  evenOffsets: v.array(num('must be an array of finite numbers'), 'must be an array of finite numbers'),
  oddOffsets: v.array(num('must be an array of finite numbers'), 'must be an array of finite numbers'),
  pinHeight: positive(),
  pinRadius: positive(),
  /** Mesh diameter; default `2 × pinRadius`. */
  meshDiameter: opt(positive()),
  /** Gap between the ramp surface and the pin base; default 0. */
  lift: opt(finite()),
  edgeMargin: opt(nonNegative()),
  restitution: opt(nonNegative()),
  label: opt(Label),
  material: opt(MaterialRef),
})

/** An arc pylon: a static post with a repulsive gravity well. */
const ArcPylonSegment = strict({
  type: v.literal('arcPylon'),
  at: opt(Placement),
  material: opt(MaterialRef),
})

const DecorItem = withCrossCheck(
  strict({
    /** Placement (a world mesh), or `local` (a child of the segment's `parent`). */
    at: opt(Placement),
    local: opt(Vec3),
    /** A tube from `at` to `to` (radius `tubeRadius`) instead of `shape`. */
    to: opt(Placement),
    tubeRadius: opt(positive()),
    shape: opt(MeshShapeSchema),
    rotationDeg: opt(Vec3),
    material: opt(MaterialRef),
  }),
  (item, issue) => {
    if (!isRecord(item)) return
    if ((item.shape === undefined) === (item.to === undefined)) issue([], 'set exactly one of `shape` and `to` (a tube)')
    if (item.to !== undefined && item.tubeRadius === undefined) issue(['tubeRadius'], 'a tube needs `tubeRadius`')
  },
)

/** Meshes only: no colliders, no physics. `parent: "spinner"` hangs them on the most recent spinner. */
const DecorSegment = withCrossCheck(
  strict({
    type: v.literal('decor'),
    parent: opt(v.literal('spinner', "must be 'spinner'")),
    items: v.pipe(v.array(DecorItem, 'must be an array of items'), v.minLength(1, 'must hold at least one item')),
  }),
  (seg, issue) => {
    if (!isRecord(seg) || !Array.isArray(seg.items)) return
    seg.items.forEach((item: unknown, i) => {
      if (!isRecord(item)) return
      if (seg.parent === 'spinner' && item.local === undefined) issue(['items', i, 'local'], 'a spinner child needs `local`')
      if (seg.parent === undefined && item.at === undefined) issue(['items', i, 'at'], 'needs `at`')
    })
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
  MarkSegment,
  JumpSegment,
  ScatterSegment,
  ObstacleSegment,
  SpinnerPartsSegment,
  PinRowsSegment,
  ArcPylonSegment,
  DecorSegment,
] as const

export const TRACK_SEGMENT_TYPES = SEGMENT_SCHEMAS.map((s) => s.entries.type.literal)

const TrackSegmentSchema = v.variant('type', SEGMENT_SCHEMAS, (issue) =>
  issue.path ? `type must be one of: ${TRACK_SEGMENT_TYPES.join(', ')}` : 'segment must be an object',
)

/**
 * The named parts of the track schema, for tools that describe it rather than
 * parse with it: the JSON Schema generator emits each as one definition
 * instead of inlining it at every use, and the machine editor's inspector can
 * render one form per part.
 */
export const TRACK_SCHEMA_PARTS = {
  Vec3,
  MaterialRef,
  Placement,
  NumberSpec: NumberSpecSchema,
  Shape: ShapeSchema,
  MeshShape: MeshShapeSchema,
  VisualMesh,
  Motion: MotionSchema,
  Zone: ZoneSchema,
  TrackSegment: TrackSegmentSchema,
} as const

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
export type MarkSegment = v.InferOutput<typeof MarkSegment>
export type JumpSegment = v.InferOutput<typeof JumpSegment>
export type ScatterSegment = v.InferOutput<typeof ScatterSegment>
export type ObstacleSegment = v.InferOutput<typeof ObstacleSegment>
export type SpinnerPartsSegment = v.InferOutput<typeof SpinnerPartsSegment>
export type PinRowsSegment = v.InferOutput<typeof PinRowsSegment>
export type ArcPylonSegment = v.InferOutput<typeof ArcPylonSegment>
export type DecorSegment = v.InferOutput<typeof DecorSegment>
export type DecorItemSpec = v.InferOutput<typeof DecorItem>
export type TrackSegment = v.InferOutput<typeof TrackSegmentSchema>

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------


/** Every placement a segment carries, with its path below the segment. */
function placementsOf(segment: TrackSegment): Array<{ keys: (string | number)[]; at: Placement }> {
  const out: Array<{ keys: (string | number)[]; at: Placement }> = []
  const add = (keys: (string | number)[], at: Placement | undefined) => {
    if (at) out.push({ keys, at })
  }
  switch (segment.type) {
    case 'bucket':
    case 'spinner':
    case 'arcPylon':
    case 'jump':
      add(['at'], segment.at)
      break
    case 'obstacle':
      segment.items?.forEach((item, i) => add(['items', i, 'at'], item.at))
      segment.variants?.forEach((list, l) => list.forEach((item, i) => add(['variants', l, i, 'at'], item.at)))
      break
    case 'decor':
      segment.items.forEach((item, i) => {
        add(['items', i, 'at'], item.at)
        add(['items', i, 'to'], item.to)
      })
      break
    case 'scatter':
      out.push({ keys: [], at: { from: segment.mark === undefined ? (segment.from ?? 'rampStart') : undefined, mark: segment.mark } })
      break
    default:
      break
  }
  return out
}

/**
 * What a segment needs built before it: a straight for ramp-anchored work, a
 * spinner for spinner parts and spinner-anchored placements, and every mark
 * it names. Runs only once every segment is individually valid.
 */
function checkSegmentOrder(segments: readonly TrackSegment[], issue: IssueReporter): void {
  const marks = new Set<string>()
  let straight = false
  let spinner = false
  segments.forEach((segment, i) => {
    const at = (...keys: (string | number)[]) => ['segments', i, ...keys]
    const needMark = (name: string | undefined, keys: (string | number)[]) => {
      if (name !== undefined && !marks.has(name)) issue(at(...keys), `no earlier mark named ${name}`)
    }
    for (const { keys, at: placement } of placementsOf(segment)) {
      needMark(placement.mark, [...keys, 'mark'])
      const from = placement.mark === undefined ? (placement.from ?? 'cursor') : 'mark'
      if ((from === 'rampStart' || from === 'rampCenter') && !straight) issue(at(...keys), `${from} needs an earlier straight`)
      if (from === 'spinner' && !spinner) issue(at(...keys), 'spinner needs an earlier spinner')
    }
    if (segment.type === 'jump') {
      needMark(segment.to, ['to'])
      segment.midpoint?.forEach((name, k) => needMark(name, ['midpoint', k]))
      needMark(segment.headingOf, ['headingOf'])
    }
    if ((segment.type === 'spinnerParts' || (segment.type === 'decor' && segment.parent === 'spinner')) && !spinner) {
      issue(at(), `${segment.type} needs an earlier spinner`)
    }
    if (segment.type === 'pinRows' && !straight) issue(at(), 'pinRows must follow a straight segment')
    if (segment.type === 'obstacle') {
      const items = segment.items ?? segment.variants?.flat() ?? []
      const usesRamp = [segment.zone, ...items.map((item) => item.zone)].some((zone) => zone?.kind === 'rampConveyor')
      const tilts = [segment.orient, ...items.map((item) => item.orient)].includes('ramp')
      if ((usesRamp || tilts) && !straight) issue(at(), 'a ramp conveyor or ramp-oriented element needs an earlier straight')
    }
    if (segment.type === 'straight') straight = true
    if (segment.type === 'spinner') spinner = true
    if (segment.type === 'mark') marks.add(segment.name)
  })
}

/** True when a number spec draws from the segment's stream. */
export function isSeededNumber(spec: NumberSpec | undefined): spec is SeededNumberSpec {
  return typeof spec === 'object' && 'random' in spec
}

/** A seeded number (anywhere in an obstacle) needs the segment's `seedKey`. */
function checkSeeds(segments: readonly TrackSegment[], issue: IssueReporter): void {
  segments.forEach((segment, i) => {
    if (segment.type !== 'obstacle' || segment.seedKey !== undefined) return
    const items = segment.items ?? []
    const motions = [segment.motion, ...items.map((item) => item.motion)]
    const seeded = motions.some((m) => m && [m.frequency, m.amplitude, m.phase].some(isSeededNumber))
    if (seeded) issue(['segments', i, 'seedKey'], 'a { random } value draws from a seeded stream; set `seedKey`')
  })
}

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
    if (!clean || !isRecord(track) || !Array.isArray(track.segments)) return
    const segments = track.segments as TrackSegment[]
    checkRampPlacement(segments, issue)
    checkSegmentOrder(segments, issue)
    checkSeeds(segments, issue)
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

