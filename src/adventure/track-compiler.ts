/**
 * Compile a validated TrackDefinition into TrackBuilder geometry.
 *
 * Pure segment→API mapping; Babylon/Rapier stay behind TrackBuildApi so Vitest
 * can stub the surface without loading the engine.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type {
  MaterialRef,
  TrackDefinition,
  TrackSegment,
} from './track-schema'
import { isMaterialRole } from './track-schema'
import type { TrackMaterialRole } from './track-theme-profiles'

export interface TrackCursor {
  pos: Vector3
  heading: number
  /** Start of the most recent straight ramp (for pinField / mill). */
  lastRampStart?: Vector3
  lastInclineRad?: number
  lastRampLength?: number
}

export type TrackMaterial = StandardMaterial | PBRMaterial

/**
 * Subset of TrackBuilder methods used by the compiler.
 * Implemented by TrackBuilder.buildFromDefinition; stubbed in unit tests.
 */
export interface TrackBuildApi {
  currentStartPos: Vector3
  getTrackMaterial(colorHex: string): TrackMaterial
  getThemedTrackMaterial(role: TrackMaterialRole): TrackMaterial
  addStraightRamp(
    startPos: Vector3,
    heading: number,
    width: number,
    length: number,
    inclineRad: number,
    material: TrackMaterial,
    wallHeight?: number,
    friction?: number,
  ): Vector3
  addCurvedRamp(
    startPos: Vector3,
    startHeading: number,
    radius: number,
    totalAngle: number,
    inclineRad: number,
    width: number,
    wallHeight: number,
    material: TrackMaterial,
    segments?: number,
    bankingAngle?: number,
    friction?: number,
  ): Vector3
  createBasin(pos: Vector3, material: TrackMaterial): void
  addExitPortal(position: Vector3): void
  createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: TrackMaterial,
    hasTeeth?: boolean,
  ): void
  createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void
  createStaticCylinder(
    pos: Vector3,
    diameter: number,
    height: number,
    material: TrackMaterial,
  ): void
  createPinField(
    rampStart: Vector3,
    heading: number,
    inclineRad: number,
    rampLength: number,
    pinSpacing: number,
    evenOffsets: readonly number[],
    oddOffsets: readonly number[],
    pinDiameter: number,
    pinHeight: number,
    material: TrackMaterial,
  ): void
  createInclinedMill(
    center: Vector3,
    radius: number,
    inclineRad: number,
    angVelAlongNormal: number,
    material: TrackMaterial,
  ): void
  createResetBasin(pos: Vector3, material: TrackMaterial): void
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function resolveMaterial(
  api: TrackBuildApi,
  ref: MaterialRef | undefined,
  fallbackHex: string,
): TrackMaterial {
  if (ref === undefined) {
    return api.getTrackMaterial(fallbackHex)
  }
  if (isMaterialRole(ref)) {
    return api.getThemedTrackMaterial(ref)
  }
  return api.getTrackMaterial(ref)
}

function defaultHex(def: TrackDefinition): string {
  return def.materials?.structure ?? '#00ffff'
}

function forward(heading: number): Vector3 {
  return new Vector3(Math.sin(heading), 0, Math.cos(heading))
}

function rightVec(heading: number): Vector3 {
  return new Vector3(Math.cos(heading), 0, -Math.sin(heading))
}

/** Unit vector along the ramp surface (heading 0 → (0, -sin, cos)). */
function rampForward(heading: number, inclineRad: number): Vector3 {
  const horiz = forward(heading)
  return new Vector3(
    horiz.x * Math.cos(inclineRad),
    -Math.sin(inclineRad),
    horiz.z * Math.cos(inclineRad),
  )
}

/** Ramp surface normal (heading 0 → (0, cos, sin)). */
function rampNormal(heading: number, inclineRad: number): Vector3 {
  const horiz = forward(heading)
  return new Vector3(
    horiz.x * Math.sin(inclineRad),
    Math.cos(inclineRad),
    horiz.z * Math.sin(inclineRad),
  )
}

function applyOffset(pos: Vector3, offset?: { x: number; y: number; z: number }): Vector3 {
  if (!offset) return pos.clone()
  return pos.add(new Vector3(offset.x, offset.y, offset.z))
}

function applySegment(
  api: TrackBuildApi,
  def: TrackDefinition,
  cursor: TrackCursor,
  segment: TrackSegment,
): void {
  const fallback = defaultHex(def)

  switch (segment.type) {
    case 'straight': {
      const mat = resolveMaterial(api, segment.material, fallback)
      cursor.lastRampStart = cursor.pos.clone()
      cursor.lastInclineRad = degToRad(segment.inclineDeg)
      cursor.lastRampLength = segment.length
      cursor.pos = api.addStraightRamp(
        cursor.pos,
        cursor.heading,
        segment.width,
        segment.length,
        degToRad(segment.inclineDeg),
        mat,
        segment.wallHeight ?? 0,
        segment.friction ?? 0.5,
      )
      break
    }
    case 'curve': {
      const mat = resolveMaterial(api, segment.material, fallback)
      const angleRad = degToRad(segment.angleDeg)
      cursor.pos = api.addCurvedRamp(
        cursor.pos,
        cursor.heading,
        segment.radius,
        angleRad,
        degToRad(segment.inclineDeg),
        segment.width,
        segment.wallHeight ?? 0,
        mat,
        segment.segments ?? 20,
        segment.bankingDeg !== undefined ? degToRad(segment.bankingDeg) : 0,
        segment.friction ?? 0.5,
      )
      cursor.heading += angleRad
      break
    }
    case 'gap': {
      const fwd = forward(cursor.heading).scale(segment.length)
      cursor.pos = cursor.pos.add(fwd)
      cursor.pos.y -= segment.drop
      break
    }
    case 'turn': {
      cursor.heading += degToRad(segment.deltaHeadingDeg)
      break
    }
    case 'bucket': {
      const mat = resolveMaterial(api, segment.material, fallback)
      let pos = cursor.pos.clone()
      if (segment.offset) {
        pos = pos.add(new Vector3(segment.offset.x, segment.offset.y, segment.offset.z))
      }
      api.createBasin(pos, mat)
      break
    }
    case 'portal': {
      let pos = cursor.pos.clone()
      if (segment.offset) {
        pos = pos.add(new Vector3(segment.offset.x, segment.offset.y, segment.offset.z))
      }
      api.addExitPortal(pos)
      break
    }
    case 'spinner': {
      const mat = resolveMaterial(api, segment.material, fallback)
      let center: Vector3
      if (segment.offset) {
        center = applyOffset(cursor.pos, segment.offset)
      } else {
        center = cursor.pos.add(forward(cursor.heading).scale(segment.radius + 1))
        center.y -= 1
      }
      api.createRotatingPlatform(
        center,
        segment.radius,
        degToRad(segment.angVelDeg),
        mat,
        segment.teeth ?? false,
      )
      if (segment.advance) {
        cursor.pos = center.add(forward(cursor.heading).scale(segment.radius))
      }
      break
    }
    case 'gate': {
      api.createChromaGate(applyOffset(cursor.pos, segment.offset), segment.color)
      break
    }
    case 'cylinder': {
      const mat = resolveMaterial(api, segment.material, fallback)
      api.createStaticCylinder(
        applyOffset(cursor.pos, segment.offset),
        segment.diameter,
        segment.height,
        mat,
      )
      break
    }
    case 'pinField': {
      const mat = resolveMaterial(api, segment.material, fallback)
      const rampStart = cursor.lastRampStart?.clone() ?? cursor.pos.clone()
      const incline = cursor.lastInclineRad ?? 0
      const rampLength = cursor.lastRampLength ?? 0
      api.createPinField(
        rampStart,
        cursor.heading,
        incline,
        rampLength,
        segment.spacing,
        segment.evenOffsets,
        segment.oddOffsets,
        segment.diameter,
        segment.height,
        mat,
      )
      break
    }
    case 'mill': {
      const mat = resolveMaterial(api, segment.material, fallback)
      const rampStart = cursor.lastRampStart?.clone() ?? cursor.pos.clone()
      const incline = cursor.lastInclineRad ?? 0
      const fwd = rampForward(cursor.heading, incline)
      const right = rightVec(cursor.heading)
      const normal = rampNormal(cursor.heading, incline)
      const surfaceOffset = segment.surfaceOffset ?? 0
      const center = rampStart
        .add(fwd.scale(segment.alongRamp))
        .add(right.scale(segment.lateral))
        .add(normal.scale(surfaceOffset))
      api.createInclinedMill(center, segment.radius, incline, segment.angVel, mat)
      break
    }
    case 'resetBasin': {
      const mat = resolveMaterial(api, segment.material, fallback)
      api.createResetBasin(applyOffset(cursor.pos, segment.offset), mat)
      break
    }
  }
}

/**
 * Compile a validated definition into geometry via the build API.
 * Returns the final cursor (useful for unit tests).
 */
export function compileTrackDefinition(
  def: TrackDefinition,
  api: TrackBuildApi,
): TrackCursor {
  const cursor: TrackCursor = {
    pos: api.currentStartPos.clone(),
    heading: degToRad(def.initialHeadingDeg ?? 0),
  }

  for (const segment of def.segments) {
    applySegment(api, def, cursor, segment)
  }

  return cursor
}
