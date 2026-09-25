/**
 * Declarative adventure track schema (v1 / #296).
 *
 * Hand-rolled types + validator — no Zod. Geometry-only; campaign goals live
 * in TRACK_CATALOG. See docs/TRACK_SCHEMA.md.
 */

import { AdventureTrackType } from './adventure-types'
import { TRACK_THEME_PROFILES, type TrackMaterialRole } from './track-theme-profiles'

export const TRACK_SCHEMA_VERSION = 1 as const

export type MaterialRef = TrackMaterialRole | `#${string}`

export interface Vec3Json {
  x: number
  y: number
  z: number
}

export interface StraightSegment {
  type: 'straight'
  width: number
  length: number
  inclineDeg: number
  material?: MaterialRef
  wallHeight?: number
  friction?: number
}

export interface CurveSegment {
  type: 'curve'
  radius: number
  angleDeg: number
  inclineDeg: number
  width: number
  wallHeight?: number
  bankingDeg?: number
  segments?: number
  material?: MaterialRef
  friction?: number
}

export interface GapSegment {
  type: 'gap'
  /** Horizontal distance along current heading. */
  length: number
  /** Vertical drop (positive = down). Negative rises. */
  drop: number
}

export interface TurnSegment {
  type: 'turn'
  /** Heading delta in degrees (added to current heading). */
  deltaHeadingDeg: number
}

export interface BucketSegment {
  type: 'bucket'
  material?: MaterialRef
  offset?: Vec3Json
}

export interface PortalSegment {
  type: 'portal'
  offset?: Vec3Json
}

export interface SpinnerSegment {
  type: 'spinner'
  radius: number
  /** Angular velocity in degrees/second about Y. */
  angVelDeg: number
  teeth?: boolean
  /** When true, advance cursor by radius along heading past the spinner center. */
  advance?: boolean
  /**
   * World-space offset from the cursor used as the spinner center.
   * When omitted, the compiler uses the legacy (radius+1 along heading, y-1) placement.
   */
  offset?: Vec3Json
  material?: MaterialRef
}

export interface CylinderSegment {
  type: 'cylinder'
  diameter: number
  height: number
  offset?: Vec3Json
  material?: MaterialRef
}

export interface PinFieldSegment {
  type: 'pinField'
  spacing: number
  evenOffsets: number[]
  oddOffsets: number[]
  diameter: number
  height: number
  material?: MaterialRef
}

export interface MillSegment {
  type: 'mill'
  /** Distance along the previous straight ramp surface from its start. */
  alongRamp: number
  /** Lateral offset along ramp right-vector. */
  lateral: number
  radius: number
  /** Angular velocity along the ramp normal (radians/second). */
  angVel: number
  surfaceOffset?: number
  material?: MaterialRef
}

export interface ResetBasinSegment {
  type: 'resetBasin'
  offset?: Vec3Json
  material?: MaterialRef
}

export interface GateSegment {
  type: 'gate'
  color: 'RED' | 'GREEN' | 'BLUE'
  /**
   * World-space offset from the cursor. Gates usually sit above the running
   * surface, so a bare cursor position would bury them in the ramp.
   */
  offset?: Vec3Json
}

/**
 * A native pin lattice (#421 / #424) on the most recent straight ramp: one C++
 * `addPinField` handle however many pins it holds. Rows run down the slope,
 * columns across it; the lattice is centred on the ramp (plus `lateral`).
 * Every pin is deterministic — `dropout` removes slots by a seeded hash that
 * C++ and the visuals share, never by `Math.random`.
 */
export interface PinLatticeSegment {
  type: 'pinLattice'
  rows: number
  cols: number
  /** Pitch across the ramp. */
  spacing: number
  /** Pitch down the ramp; defaults to `spacing`. */
  rowSpacing?: number
  /** Across-ramp shift of odd rows; defaults to `spacing / 2` (the pachinko stagger). */
  rowOffset?: number
  /** Distance down the ramp from its start to row 0; defaults to `rowSpacing`. */
  startAlong?: number
  /** Across-ramp shift of the whole lattice centre; default 0. */
  lateral?: number
  diameter: number
  height: number
  /** Default 0.6 — the bounce the per-pin `pinField` segment has always used. */
  restitution?: number
  /** Default 0.3. */
  friction?: number
  /** Probability in [0, 1) that the seeded hash drops a slot. */
  dropout?: number
  /** Unsigned 32-bit seed for `dropout`; default 0. */
  dropoutSeed?: number
  /** Slots left empty on purpose (a channel, a pocket mouth). */
  holes?: Array<{ row: number; col: number }>
  material?: MaterialRef
}

/**
 * An oriented box that accelerates every ball inside it (C++ `addForceField`):
 * updrafts, crosswinds, conveyors. Mass-independent, like gravity.
 *
 * Placement is one of:
 *   - ramp-anchored (`alongRamp` set): on the most recent straight, framed by
 *     the ramp — size.x across, size.y off the surface, size.z down the slope;
 *   - cursor-anchored (default): world `offset` from the cursor, yawed to the
 *     cursor heading plus `yawDeg`.
 *
 * C++-only: the Rapier dev path builds the track without it, so a field must
 * never be the only way through a track.
 */
export interface ForceFieldSegment {
  type: 'forceField'
  /** Full extents in the field's own frame. */
  size: Vec3Json
  /** m/s². World space unless `space` is `field`. */
  accel: Vec3Json
  space?: 'world' | 'field'
  alongRamp?: number
  lateral?: number
  /** Ramp-anchored only: height of the centre above the surface; default `size.y / 2`. */
  surfaceOffset?: number
  /** Cursor-anchored only. */
  offset?: Vec3Json
  /** Cursor-anchored only: extra yaw on top of the cursor heading. */
  yawDeg?: number
  /** Draw a faint translucent volume; default true. */
  visible?: boolean
  material?: MaterialRef
}

export type TrackSegment =
  | StraightSegment
  | CurveSegment
  | GapSegment
  | TurnSegment
  | BucketSegment
  | PortalSegment
  | SpinnerSegment
  | GateSegment
  | CylinderSegment
  | PinFieldSegment
  | MillSegment
  | ResetBasinSegment
  | PinLatticeSegment
  | ForceFieldSegment

export interface TrackDefinition {
  schemaVersion: typeof TRACK_SCHEMA_VERSION
  /** Must match an AdventureTrackType / TRACK_CATALOG key. */
  id: string
  themeProfile?: string
  cameraPresetId?: string
  gravityMultiplier?: number
  /** Compiler cursor heading in degrees (default 0). NEON_HELIX uses 180. */
  initialHeadingDeg?: number
  materials?: Partial<Record<TrackMaterialRole, string>>
  segments: TrackSegment[]
}

export interface TrackValidationIssue {
  path: string
  message: string
}

export type TrackValidationResult =
  | { ok: true; definition: TrackDefinition }
  | { ok: false; errors: TrackValidationIssue[] }

const MATERIAL_ROLES = new Set<string>(['structure', 'accent', 'energy', 'glow'])
const GATE_COLORS = new Set(['RED', 'GREEN', 'BLUE'])
const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const SEGMENT_TYPES = new Set([
  'straight',
  'curve',
  'gap',
  'turn',
  'bucket',
  'portal',
  'spinner',
  'gate',
  'cylinder',
  'pinField',
  'mill',
  'resetBasin',
  'pinLattice',
  'forceField',
])

/** Ceiling on a lattice's slot count — the occupancy mask and the visuals scale with it. */
export const PIN_LATTICE_MAX_SLOTS = 4096
/** Ceiling on a force field's acceleration — past this a field is a launcher, not a toy. */
export const FORCE_FIELD_MAX_ACCEL = 60


const VALID_TRACK_IDS = new Set<string>(Object.values(AdventureTrackType))

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateMaterialRef(
  value: unknown,
  path: string,
  errors: TrackValidationIssue[],
): void {
  if (typeof value !== 'string') {
    errors.push({ path, message: 'material must be a string (role or #rrggbb)' })
    return
  }
  if (MATERIAL_ROLES.has(value) || HEX_RE.test(value)) return
  errors.push({
    path,
    message: `material must be a theme role (${[...MATERIAL_ROLES].join('|')}) or #rrggbb`,
  })
}

function validateVec3(
  value: unknown,
  path: string,
  errors: TrackValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    errors.push({ path, message: 'expected { x, y, z } object' })
    return
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!isFiniteNumber(value[axis])) {
      errors.push({ path: `${path}.${axis}`, message: 'must be a finite number' })
    }
  }
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value)
}

function validatePinLattice(segment: Record<string, unknown>, path: string, errors: TrackValidationIssue[]): void {
  for (const key of ['rows', 'cols'] as const) {
    if (!isInteger(segment[key]) || segment[key] < 1) {
      errors.push({ path: `${path}.${key}`, message: 'must be an integer >= 1' })
    }
  }
  if (isInteger(segment.rows) && isInteger(segment.cols) && segment.rows * segment.cols > PIN_LATTICE_MAX_SLOTS) {
    errors.push({ path, message: `rows * cols must be <= ${PIN_LATTICE_MAX_SLOTS}` })
  }
  for (const key of ['spacing', 'diameter', 'height'] as const) {
    if (!isFiniteNumber(segment[key]) || segment[key] <= 0) {
      errors.push({ path: `${path}.${key}`, message: 'must be a finite number > 0' })
    }
  }
  if (segment.rowSpacing !== undefined && (!isFiniteNumber(segment.rowSpacing) || segment.rowSpacing <= 0)) {
    errors.push({ path: `${path}.rowSpacing`, message: 'must be a finite number > 0' })
  }
  for (const key of ['rowOffset', 'lateral'] as const) {
    if (segment[key] !== undefined && !isFiniteNumber(segment[key])) {
      errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
    }
  }
  for (const key of ['startAlong', 'restitution', 'friction'] as const) {
    if (segment[key] !== undefined && (!isFiniteNumber(segment[key]) || segment[key] < 0)) {
      errors.push({ path: `${path}.${key}`, message: 'must be a finite number >= 0' })
    }
  }
  if (segment.dropout !== undefined && (!isFiniteNumber(segment.dropout) || segment.dropout < 0 || segment.dropout >= 1)) {
    errors.push({ path: `${path}.dropout`, message: 'must be a number in [0, 1)' })
  }
  if (segment.dropoutSeed !== undefined && (!isInteger(segment.dropoutSeed) || segment.dropoutSeed < 0 || segment.dropoutSeed > 0xffffffff)) {
    errors.push({ path: `${path}.dropoutSeed`, message: 'must be an unsigned 32-bit integer' })
  }
  if (segment.holes !== undefined) {
    if (!Array.isArray(segment.holes)) {
      errors.push({ path: `${path}.holes`, message: 'must be an array of { row, col }' })
    } else {
      segment.holes.forEach((hole, i) => {
        const inRange = (v: unknown, n: unknown) => isInteger(v) && v >= 0 && (!isInteger(n) || v < n)
        if (!isPlainObject(hole) || !inRange(hole.row, segment.rows) || !inRange(hole.col, segment.cols)) {
          errors.push({ path: `${path}.holes[${i}]`, message: 'must be { row, col } inside the lattice' })
        }
      })
    }
  }
  if (segment.material !== undefined) {
    validateMaterialRef(segment.material, `${path}.material`, errors)
  }
}

function validateForceField(segment: Record<string, unknown>, path: string, errors: TrackValidationIssue[]): void {
  validateVec3(segment.size, `${path}.size`, errors)
  if (isPlainObject(segment.size)) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = segment.size[axis]
      if (isFiniteNumber(v) && v <= 0) errors.push({ path: `${path}.size.${axis}`, message: 'must be > 0' })
    }
  }
  validateVec3(segment.accel, `${path}.accel`, errors)
  if (isPlainObject(segment.accel)) {
    const { x, y, z } = segment.accel
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) && Math.hypot(x, y, z) > FORCE_FIELD_MAX_ACCEL) {
      errors.push({ path: `${path}.accel`, message: `magnitude must be <= ${FORCE_FIELD_MAX_ACCEL} m/s²` })
    }
  }
  if (segment.space !== undefined && segment.space !== 'world' && segment.space !== 'field') {
    errors.push({ path: `${path}.space`, message: "must be 'world' or 'field'" })
  }
  const rampAnchored = segment.alongRamp !== undefined
  if (rampAnchored) {
    for (const key of ['offset', 'yawDeg'] as const) {
      if (segment[key] !== undefined) {
        errors.push({ path: `${path}.${key}`, message: 'only applies to a cursor-anchored field (no alongRamp)' })
      }
    }
  } else {
    for (const key of ['lateral', 'surfaceOffset'] as const) {
      if (segment[key] !== undefined) {
        errors.push({ path: `${path}.${key}`, message: 'only applies to a ramp-anchored field (set alongRamp)' })
      }
    }
  }
  for (const key of ['alongRamp', 'lateral', 'surfaceOffset', 'yawDeg'] as const) {
    if (segment[key] !== undefined && !isFiniteNumber(segment[key])) {
      errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
    }
  }
  if (segment.offset !== undefined) validateVec3(segment.offset, `${path}.offset`, errors)
  if (segment.visible !== undefined && typeof segment.visible !== 'boolean') {
    errors.push({ path: `${path}.visible`, message: 'must be a boolean' })
  }
  if (segment.material !== undefined) {
    validateMaterialRef(segment.material, `${path}.material`, errors)
  }
}

/**
 * Placement checks that need the ramp a segment sits on: a `pinLattice` or a
 * ramp-anchored `forceField` must follow a straight, and must fit on it.
 * Runs only once every segment is individually valid.
 */
function validateRampPlacement(segments: TrackSegment[], errors: TrackValidationIssue[]): void {
  let ramp: StraightSegment | null = null
  segments.forEach((segment, i) => {
    const path = `segments[${i}]`
    if (segment.type === 'straight') {
      ramp = segment
      return
    }
    const needsRamp = segment.type === 'pinLattice' || (segment.type === 'forceField' && segment.alongRamp !== undefined)
    if (!needsRamp) return
    if (!ramp) {
      errors.push({ path, message: `${segment.type} must follow a straight segment` })
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
        errors.push({ path, message: `lattice runs ${startAlong}..${lastRow} down a ${length}-long ramp` })
      }
      const span = ((segment.cols - 1) * segment.spacing) / 2
      const lateral = segment.lateral ?? 0
      const minX = lateral - span + Math.min(0, rowOffset) - radius
      const maxX = lateral + span + Math.max(0, rowOffset) + radius
      if (minX < -halfWidth || maxX > halfWidth) {
        errors.push({ path, message: `lattice spans ${minX.toFixed(2)}..${maxX.toFixed(2)} across a ${ramp.width}-wide ramp` })
      }
      return
    }
    if (segment.type === 'forceField') {
      const along = segment.alongRamp ?? 0
      if (along < 0 || along > length) {
        errors.push({ path: `${path}.alongRamp`, message: `must be within the ${length}-long ramp` })
      }
      if (Math.abs(segment.lateral ?? 0) > halfWidth) {
        errors.push({ path: `${path}.lateral`, message: `must be within the ${ramp.width}-wide ramp` })
      }
    }
  })
}

function validateSegment(
  segment: unknown,
  path: string,
  errors: TrackValidationIssue[],
): void {
  if (!isPlainObject(segment)) {
    errors.push({ path, message: 'segment must be an object' })
    return
  }

  const type = segment.type
  if (typeof type !== 'string' || !SEGMENT_TYPES.has(type)) {
    errors.push({
      path: `${path}.type`,
      message: `type must be one of: ${[...SEGMENT_TYPES].join(', ')}`,
    })
    return
  }

  switch (type) {
    case 'straight': {
      for (const key of ['width', 'length', 'inclineDeg'] as const) {
        if (!isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      if (isFiniteNumber(segment.width) && segment.width <= 0) {
        errors.push({ path: `${path}.width`, message: 'must be > 0' })
      }
      if (isFiniteNumber(segment.length) && segment.length <= 0) {
        errors.push({ path: `${path}.length`, message: 'must be > 0' })
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      if (segment.wallHeight !== undefined && !isFiniteNumber(segment.wallHeight)) {
        errors.push({ path: `${path}.wallHeight`, message: 'must be a finite number' })
      }
      if (segment.friction !== undefined && !isFiniteNumber(segment.friction)) {
        errors.push({ path: `${path}.friction`, message: 'must be a finite number' })
      }
      break
    }
    case 'curve': {
      for (const key of ['radius', 'angleDeg', 'inclineDeg', 'width'] as const) {
        if (!isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      if (isFiniteNumber(segment.radius) && segment.radius <= 0) {
        errors.push({ path: `${path}.radius`, message: 'must be > 0' })
      }
      if (isFiniteNumber(segment.width) && segment.width <= 0) {
        errors.push({ path: `${path}.width`, message: 'must be > 0' })
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      for (const key of ['wallHeight', 'bankingDeg', 'friction'] as const) {
        if (segment[key] !== undefined && !isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      if (segment.segments !== undefined) {
        if (!isFiniteNumber(segment.segments) || segment.segments < 1) {
          errors.push({ path: `${path}.segments`, message: 'must be a number >= 1' })
        }
      }
      break
    }
    case 'gap': {
      for (const key of ['length', 'drop'] as const) {
        if (!isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      break
    }
    case 'turn': {
      if (!isFiniteNumber(segment.deltaHeadingDeg)) {
        errors.push({ path: `${path}.deltaHeadingDeg`, message: 'must be a finite number' })
      }
      break
    }
    case 'bucket': {
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      if (segment.offset !== undefined) {
        validateVec3(segment.offset, `${path}.offset`, errors)
      }
      break
    }
    case 'portal': {
      if (segment.offset !== undefined) {
        validateVec3(segment.offset, `${path}.offset`, errors)
      }
      break
    }
    case 'spinner': {
      for (const key of ['radius', 'angVelDeg'] as const) {
        if (!isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      if (isFiniteNumber(segment.radius) && segment.radius <= 0) {
        errors.push({ path: `${path}.radius`, message: 'must be > 0' })
      }
      if (segment.teeth !== undefined && typeof segment.teeth !== 'boolean') {
        errors.push({ path: `${path}.teeth`, message: 'must be a boolean' })
      }
      if (segment.advance !== undefined && typeof segment.advance !== 'boolean') {
        errors.push({ path: `${path}.advance`, message: 'must be a boolean' })
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      if (segment.offset !== undefined) {
        validateVec3(segment.offset, `${path}.offset`, errors)
      }
      break
    }
    case 'cylinder': {
      for (const key of ['diameter', 'height'] as const) {
        if (!isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      if (isFiniteNumber(segment.diameter) && segment.diameter <= 0) {
        errors.push({ path: `${path}.diameter`, message: 'must be > 0' })
      }
      if (isFiniteNumber(segment.height) && segment.height <= 0) {
        errors.push({ path: `${path}.height`, message: 'must be > 0' })
      }
      if (segment.offset !== undefined) {
        validateVec3(segment.offset, `${path}.offset`, errors)
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      break
    }
    case 'pinField': {
      if (!isFiniteNumber(segment.spacing) || segment.spacing <= 0) {
        errors.push({ path: `${path}.spacing`, message: 'must be a finite number > 0' })
      }
      if (!isFiniteNumber(segment.diameter) || segment.diameter <= 0) {
        errors.push({ path: `${path}.diameter`, message: 'must be a finite number > 0' })
      }
      if (!isFiniteNumber(segment.height) || segment.height <= 0) {
        errors.push({ path: `${path}.height`, message: 'must be a finite number > 0' })
      }
      for (const key of ['evenOffsets', 'oddOffsets'] as const) {
        if (!Array.isArray(segment[key]) || segment[key].some((n) => !isFiniteNumber(n))) {
          errors.push({ path: `${path}.${key}`, message: 'must be an array of finite numbers' })
        }
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      break
    }
    case 'mill': {
      for (const key of ['alongRamp', 'lateral', 'radius', 'angVel'] as const) {
        if (!isFiniteNumber(segment[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' })
        }
      }
      if (isFiniteNumber(segment.radius) && segment.radius <= 0) {
        errors.push({ path: `${path}.radius`, message: 'must be > 0' })
      }
      if (segment.surfaceOffset !== undefined && !isFiniteNumber(segment.surfaceOffset)) {
        errors.push({ path: `${path}.surfaceOffset`, message: 'must be a finite number' })
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      break
    }
    case 'resetBasin': {
      if (segment.offset !== undefined) {
        validateVec3(segment.offset, `${path}.offset`, errors)
      }
      if (segment.material !== undefined) {
        validateMaterialRef(segment.material, `${path}.material`, errors)
      }
      break
    }
    case 'pinLattice': {
      validatePinLattice(segment, path, errors)
      break
    }
    case 'forceField': {
      validateForceField(segment, path, errors)
      break
    }
    case 'gate': {
      if (typeof segment.color !== 'string' || !GATE_COLORS.has(segment.color)) {
        errors.push({
          path: `${path}.color`,
          message: 'color must be RED, GREEN, or BLUE',
        })
      }
      if (segment.offset !== undefined) {
        validateVec3(segment.offset, `${path}.offset`, errors)
      }
      break
    }
  }
}

/**
 * Validate a raw JSON value as a TrackDefinition.
 * Does not throw — returns structured errors for soft-fail HUD paths.
 */
export function validateTrackDefinition(raw: unknown): TrackValidationResult {
  const errors: TrackValidationIssue[] = []

  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ path: '', message: 'track definition must be an object' }] }
  }

  if (raw.schemaVersion !== TRACK_SCHEMA_VERSION) {
    errors.push({
      path: 'schemaVersion',
      message: `must be ${TRACK_SCHEMA_VERSION}`,
    })
  }

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    errors.push({ path: 'id', message: 'must be a non-empty string' })
  } else if (!VALID_TRACK_IDS.has(raw.id)) {
    errors.push({
      path: 'id',
      message: `unknown AdventureTrackType: ${raw.id}`,
    })
  }

  if (raw.themeProfile !== undefined) {
    if (typeof raw.themeProfile !== 'string') {
      errors.push({ path: 'themeProfile', message: 'must be a string' })
    } else if (!(raw.themeProfile in TRACK_THEME_PROFILES)) {
      errors.push({ path: 'themeProfile', message: `unknown theme profile: ${raw.themeProfile}` })
    }
  }

  if (raw.cameraPresetId !== undefined && typeof raw.cameraPresetId !== 'string') {
    errors.push({ path: 'cameraPresetId', message: 'must be a string' })
  }

  if (raw.gravityMultiplier !== undefined) {
    if (!isFiniteNumber(raw.gravityMultiplier) || raw.gravityMultiplier <= 0) {
      errors.push({ path: 'gravityMultiplier', message: 'must be a finite number > 0' })
    }
  }

  if (raw.initialHeadingDeg !== undefined && !isFiniteNumber(raw.initialHeadingDeg)) {
    errors.push({ path: 'initialHeadingDeg', message: 'must be a finite number' })
  }

  if (raw.materials !== undefined) {
    if (!isPlainObject(raw.materials)) {
      errors.push({ path: 'materials', message: 'must be an object' })
    } else {
      for (const [role, hex] of Object.entries(raw.materials)) {
        if (!MATERIAL_ROLES.has(role)) {
          errors.push({ path: `materials.${role}`, message: 'unknown material role' })
        } else if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
          errors.push({ path: `materials.${role}`, message: 'must be #rrggbb' })
        }
      }
    }
  }

  if (!Array.isArray(raw.segments)) {
    errors.push({ path: 'segments', message: 'must be an array' })
  } else if (raw.segments.length === 0) {
    errors.push({ path: 'segments', message: 'must contain at least one segment' })
  } else {
    raw.segments.forEach((seg, i) => validateSegment(seg, `segments[${i}]`, errors))
    if (errors.length === 0) validateRampPlacement(raw.segments as TrackSegment[], errors)
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, definition: raw as unknown as TrackDefinition }
}

/** Format validation errors for HUD / console. */
export function formatTrackValidationErrors(errors: TrackValidationIssue[]): string {
  if (errors.length === 0) return 'Invalid track definition'
  const head = errors
    .slice(0, 3)
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join('; ')
  const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : ''
  return `Invalid track: ${head}${more}`
}

export function isMaterialRole(ref: string): ref is TrackMaterialRole {
  return MATERIAL_ROLES.has(ref)
}
