/**
 * Compile a validated TrackDefinition into TrackBuilder geometry.
 *
 * Pure segment→API mapping; Babylon/Rapier stay behind TrackBuildApi so Vitest
 * can stub the surface without loading the engine.
 */

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { boxDesc } from './track-collider-descriptors'
import type {
  MaterialRef,
  PinLatticeSegment,
  TrackDefinition,
  TrackSegment,
} from '../schemas/track'
import { isMaterialRole, PBR_MATERIAL_PREFIX } from './track-material-roles'
import type { PinFieldSpec } from '../core/pin-field'
import { pinFieldOccupancy } from '../core/pin-field'
import type { SeededRng } from '../core/seeded-rng'
import type { TrackBuilderApi, TrackMaterial } from './track-builder-api'
import {
  buildArcPylon,
  buildDecor,
  buildObstacle,
  buildPinRows,
  buildScatter,
  buildSpinnerParts,
  degToRad,
  placementPoint,
  rampForward,
  rampNormal,
  type CursorMark,
  type ElementContext,
  type SpinnerAnchor,
} from './track-elements'
import {
  pinLatticeLayout,
  rampQuat,
  rampSurfacePoint,
  yawQuat,
  type GeoQuat,
  type GeoVec3,
} from './track-geometry'

export type { TrackBuildApi, TrackBuilderApi, TrackMaterial } from './track-builder-api'

export interface TrackCursor {
  pos: Vector3
  heading: number
  /** Start of the most recent straight ramp (for pinField / mill). */
  lastRampStart?: Vector3
  lastInclineRad?: number
  lastRampLength?: number
  lastRampWidth?: number
  /**
   * Heading the most recent straight was built with. `pinLattice` and a
   * ramp-anchored `forceField` use it, so a `turn` after the ramp cannot
   * swing them off it (the older `pinField` / `mill` read the live heading).
   */
  lastRampHeading?: number
  /** The most recent spinner (what `spinnerParts` attach to). */
  lastSpinner?: SpinnerAnchor
}

function resolveMaterial(
  api: TrackBuilderApi,
  ref: MaterialRef | undefined,
  fallbackHex: string,
): TrackMaterial {
  if (ref === undefined) {
    return api.getTrackMaterial(fallbackHex)
  }
  if (isMaterialRole(ref)) {
    return api.getThemedTrackMaterial(ref)
  }
  if (ref.startsWith(PBR_MATERIAL_PREFIX)) {
    return api.getTrackPBRMaterial(ref.slice(PBR_MATERIAL_PREFIX.length))
  }
  return api.getTrackMaterial(ref)
}

/** Per-compile state: marks and seeded streams live for the whole track. */
interface CompileState {
  marks: Map<string, CursorMark>
  streams: Map<string, SeededRng>
}

/** An element context whose materials are resolved once per ref for this segment. */
function elementContext(api: TrackBuilderApi, def: TrackDefinition, cursor: TrackCursor, state: CompileState): ElementContext {
  const fallback = defaultHex(def)
  const cache = new Map<string, TrackMaterial>()
  return {
    api,
    cursor,
    marks: state.marks,
    streams: state.streams,
    material(ref) {
      const key = ref ?? ''
      let mat = cache.get(key)
      if (!mat) {
        mat = resolveMaterial(api, ref, fallback)
        cache.set(key, mat)
      }
      return mat
    },
  }
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

function applyOffset(pos: Vector3, offset?: { x: number; y: number; z: number }): Vector3 {
  if (!offset) return pos.clone()
  return pos.add(new Vector3(offset.x, offset.y, offset.z))
}

function applySegment(
  api: TrackBuilderApi,
  def: TrackDefinition,
  cursor: TrackCursor,
  segment: TrackSegment,
  state: CompileState,
): void {
  const fallback = defaultHex(def)
  const elements = () => elementContext(api, def, cursor, state)

  switch (segment.type) {
    case 'straight': {
      const mat = resolveMaterial(api, segment.material, fallback)
      const heading =
        segment.headingOffsetDeg !== undefined ? cursor.heading + degToRad(segment.headingOffsetDeg) : cursor.heading
      cursor.lastRampStart = cursor.pos.clone()
      cursor.lastInclineRad = degToRad(segment.inclineDeg)
      cursor.lastRampLength = segment.length
      cursor.lastRampWidth = segment.width
      cursor.lastRampHeading = heading
      cursor.pos = api.addStraightRamp(
        cursor.pos,
        heading,
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
      const curveStart = cursor.pos.clone()
      const curveHeading = cursor.heading
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
      if (segment.conveyor) {
        curveConveyor(api, curveStart, curveHeading, segment.radius, angleRad, degToRad(segment.inclineDeg), segment.conveyor)
      }
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
      if (segment.at) {
        pos = placementPoint(elements(), segment.at).pos
      } else if (segment.offset) {
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
      if (segment.at) {
        center = placementPoint(elements(), segment.at).pos
      } else if (segment.offset) {
        center = applyOffset(cursor.pos, segment.offset)
      } else {
        center = cursor.pos.add(forward(cursor.heading).scale(segment.radius + 1))
        center.y -= 1
      }
      const angVel = segment.angVel ?? degToRad(segment.angVelDeg ?? 0)
      // A spinner is anchored only when the platform was really built (a world-less build skips it).
      const bindingsBefore = api.hasWorld ? api.kinematicBindings.length : 0
      api.createRotatingPlatform(center, segment.radius, angVel, mat, segment.teeth ?? false)
      const binding = api.hasWorld ? api.kinematicBindings[bindingsBefore] : undefined
      if (binding) {
        cursor.lastSpinner = { center, heading: cursor.heading, radius: segment.radius, angVel, body: binding.body, mesh: binding.mesh }
      }
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
    case 'pinLattice': {
      const mat = resolveMaterial(api, segment.material, fallback)
      api.createPinLattice(pinLatticeSpec(cursor, segment), mat)
      break
    }
    case 'forceField': {
      const mat = resolveMaterial(api, segment.material ?? 'energy', fallback)
      const half = { x: segment.size.x / 2, y: segment.size.y / 2, z: segment.size.z / 2 }
      let center: GeoVec3
      let rotation: GeoQuat
      if (segment.alongRamp !== undefined) {
        const rampStart = cursor.lastRampStart ?? cursor.pos
        const heading = cursor.lastRampHeading ?? cursor.heading
        const incline = cursor.lastInclineRad ?? 0
        center = rampSurfacePoint(
          rampStart,
          heading,
          incline,
          segment.alongRamp,
          segment.lateral ?? 0,
          segment.surfaceOffset ?? half.y,
        )
        rotation = rampQuat(heading, incline)
      } else {
        const pos = applyOffset(cursor.pos, segment.offset)
        center = { x: pos.x, y: pos.y, z: pos.z }
        rotation = yawQuat(cursor.heading + degToRad(segment.yawDeg ?? 0))
      }
      api.createForceField(
        center,
        half,
        rotation,
        { x: segment.accel.x, y: segment.accel.y, z: segment.accel.z },
        segment.space ?? 'world',
        segment.visible ?? true,
        mat,
      )
      break
    }
    case 'cone': {
      const mat = resolveMaterial(api, segment.material, fallback)
      const pos = applyOffset(cursor.pos, segment.offset)
      api.createStaticCone(
        { x: pos.x, y: pos.y, z: pos.z },
        segment.radius,
        segment.halfHeight,
        yawQuat(cursor.heading + degToRad(segment.yawDeg ?? 0)),
        segment.restitution ?? 0.5,
        segment.friction ?? 0.3,
        mat,
      )
      break
    }
    case 'mark': {
      state.marks.set(segment.name, { pos: cursor.pos.clone(), heading: cursor.heading })
      break
    }
    case 'jump': {
      const markOf = (name: string): CursorMark => {
        const mark = state.marks.get(name)
        if (!mark) throw new Error(`no mark named ${name}`)
        return mark
      }
      if (segment.to !== undefined) {
        const mark = markOf(segment.to)
        cursor.pos = mark.pos.clone()
        cursor.heading = mark.heading
      } else if (segment.midpoint) {
        const [a, b] = segment.midpoint
        cursor.pos = markOf(a).pos.add(markOf(b).pos).scale(0.5)
      } else if (segment.at) {
        cursor.pos = placementPoint(elements(), segment.at).pos
      }
      if (segment.headingOf !== undefined) cursor.heading = markOf(segment.headingOf).heading
      break
    }
    case 'scatter':
      buildScatter(elements(), segment)
      break
    case 'obstacle':
      buildObstacle(elements(), segment)
      break
    case 'spinnerParts':
      buildSpinnerParts(elements(), segment)
      break
    case 'pinRows':
      buildPinRows(elements(), segment)
      break
    case 'arcPylon':
      buildArcPylon(elements(), segment)
      break
    case 'decor':
      buildDecor(elements(), segment)
      break
    case 'axisPull': {
      const mat = resolveMaterial(api, segment.material ?? 'energy', fallback)
      const pos = applyOffset(cursor.pos, segment.offset)
      api.createAxisPullWell(
        { x: pos.x, y: pos.y, z: pos.z },
        segment.radius,
        segment.halfHeight ?? 1,
        segment.strength,
        segment.enabled ?? true,
        segment.visible ?? true,
        mat,
      )
      break
    }
  }
}

/** The world-space native pin field a `pinLattice` segment describes. */
export function pinLatticeSpec(cursor: TrackCursor, segment: PinLatticeSegment): PinFieldSpec {
  const rowSpacing = segment.rowSpacing ?? segment.spacing
  const layout = pinLatticeLayout({
    rampStart: cursor.lastRampStart ?? cursor.pos,
    heading: cursor.lastRampHeading ?? cursor.heading,
    inclineRad: cursor.lastInclineRad ?? 0,
    rows: segment.rows,
    cols: segment.cols,
    spacing: segment.spacing,
    rowSpacing,
    rowOffset: segment.rowOffset ?? segment.spacing / 2,
    startAlong: segment.startAlong ?? rowSpacing,
    lateral: segment.lateral ?? 0,
    pinHeight: segment.height,
  })
  const spec: PinFieldSpec = {
    origin: layout.origin,
    rotation: layout.rotation,
    rows: segment.rows,
    cols: segment.cols,
    spacingX: segment.spacing,
    spacingZ: rowSpacing,
    rowOffsetX: segment.rowOffset ?? segment.spacing / 2,
    radius: segment.diameter / 2,
    halfHeight: segment.height / 2,
    restitution: segment.restitution ?? 0.6,
    friction: segment.friction ?? 0.3,
  }
  if (segment.dropout !== undefined && segment.dropout > 0) {
    spec.dropout = segment.dropout
    spec.dropoutSeed = segment.dropoutSeed ?? 0
  }
  if (segment.holes && segment.holes.length > 0) {
    const holes = new Set(segment.holes.map((h) => h.row * segment.cols + h.col))
    const slots: { row: number; col: number }[] = []
    for (let row = 0; row < segment.rows; row++) {
      for (let col = 0; col < segment.cols; col++) {
        if (!holes.has(row * segment.cols + col)) slots.push({ row, col })
      }
    }
    spec.occupancy = pinFieldOccupancy(segment.rows, segment.cols, slots)
  }
  return spec
}

/**
 * Conveyor sensors following a curve (Tesla Tower's induction coil): one box
 * per chord, walked the way the curve's chords are, each pushing `force`
 * along its chord and down the incline.
 */
function curveConveyor(
  api: TrackBuilderApi,
  start: Vector3,
  startHeading: number,
  radius: number,
  angleRad: number,
  inclineRad: number,
  spec: { segments: number; force: number; halfWidth: number; halfHeight: number; lift?: number; label?: string },
): void {
  if (!api.hasWorld) return
  const segAngle = angleRad / spec.segments
  const chordLen = 2 * radius * Math.sin(segAngle / 2)
  const drop = chordLen * Math.sin(inclineRad)
  let heading = startHeading
  let pos = start.clone()
  for (let i = 0; i < spec.segments; i++) {
    heading += segAngle / 2
    const fwd = forward(heading)
    const center = pos.add(fwd.scale(chordLen / 2))
    center.y -= drop / 2
    if (spec.lift !== undefined) center.y += spec.lift
    const q = Quaternion.FromEulerAngles(inclineRad, heading, 0)
    const { body: sensor } = api.emitCollider(
      boxDesc({ x: center.x, y: center.y, z: center.z }, { x: spec.halfWidth, y: spec.halfHeight, z: chordLen / 2 }, {
        rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
        sensor: true,
        label: spec.label ?? 'curveConveyor',
      }),
    )
    const force = new Vector3(Math.sin(heading), -Math.sin(inclineRad), Math.cos(heading)).normalize().scale(spec.force)
    api.conveyorZones.push({ sensor, force })
    pos = pos.add(fwd.scale(chordLen))
    pos.y -= drop
    heading += segAngle / 2
  }
}

/**
 * Compile a validated definition into geometry via the build API.
 * Returns the final cursor (useful for unit tests).
 */
export function compileTrackDefinition(
  def: TrackDefinition,
  api: TrackBuilderApi,
): TrackCursor {
  const cursor: TrackCursor = {
    pos: api.currentStartPos.clone(),
    heading: degToRad(def.initialHeadingDeg ?? 0),
  }
  const state: CompileState = { marks: new Map(), streams: new Map() }

  for (const segment of def.segments) {
    applySegment(api, def, cursor, segment, state)
  }

  return cursor
}
