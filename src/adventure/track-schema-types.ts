/**
 * Declarative adventure track schema (v1 / #296) — the type surface.
 *
 * Segment interfaces, the `TrackSegment` union, `TrackDefinition` and the
 * validation result shapes: everything `track-compiler.ts` and the JSON track
 * data are typed against. The validator lives in `track-schema.ts`, which
 * re-exports this module, so importers keep using `./track-schema`.
 * See docs/TRACK_SCHEMA.md.
 */

import type { TrackMaterialRole } from './track-theme-profiles'

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
