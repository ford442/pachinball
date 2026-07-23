/**
 * Declarative adventure track schema (v1 / #296).
 *
 * Hand-rolled types + validator — no Zod. Geometry-only; campaign goals live
 * in TRACK_CATALOG. See docs/TRACK_SCHEMA.md.
 */

import { AdventureTrackType } from './adventure-types'
import type { TrackMaterialRole } from '../game-elements/track-theme-profiles'

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
  material?: MaterialRef
}

export interface GateSegment {
  type: 'gate'
  color: 'RED' | 'GREEN' | 'BLUE'
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

export interface TrackDefinition {
  schemaVersion: typeof TRACK_SCHEMA_VERSION
  /** Must match an AdventureTrackType / TRACK_CATALOG key. */
  id: string
  themeProfile?: string
  cameraPresetId?: string
  gravityMultiplier?: number
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
])

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
      break
    }
    case 'gate': {
      if (typeof segment.color !== 'string' || !GATE_COLORS.has(segment.color)) {
        errors.push({
          path: `${path}.color`,
          message: 'color must be RED, GREEN, or BLUE',
        })
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

  if (raw.themeProfile !== undefined && typeof raw.themeProfile !== 'string') {
    errors.push({ path: 'themeProfile', message: 'must be a string' })
  }

  if (raw.cameraPresetId !== undefined && typeof raw.cameraPresetId !== 'string') {
    errors.push({ path: 'cameraPresetId', message: 'must be a string' })
  }

  if (raw.gravityMultiplier !== undefined) {
    if (!isFiniteNumber(raw.gravityMultiplier) || raw.gravityMultiplier <= 0) {
      errors.push({ path: 'gravityMultiplier', message: 'must be a finite number > 0' })
    }
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
