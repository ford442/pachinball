/**
 * Adventure track primitives (#383).
 *
 * Each primitive builds its Babylon mesh and emits its collider descriptor
 * from ONE layout computed by `track-geometry.ts`, so the visual and the
 * physics can never drift. Descriptors go to the caller's emitter, which
 * realises them on Rapier today and hands the same list to
 * `wasm-adventure-export.ts` for the C++ engine.
 *
 * These are free functions over a `TrackPrimitiveContext` rather than
 * methods so track-builder.ts can stay the lifecycle/state class it is.
 */

import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Scene } from '@babylonjs/core/scene'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import type {
  ChromaGate,
  GravityWell,
  KinematicBinding,
} from './adventure-types'
import { INTENSITY, emissive } from '../game-elements/visual-language'
import {
  boxDesc,
  cylinderDesc,
  sphereDesc,
  type AdventureColliderDesc,
  type DescQuat,
} from './track-collider-descriptors'
import type { EmittedCollider } from './track-collider-emitter'
import {
  curvedRampLayout,
  inclinedMillAxis,
  pinFieldLayout,
  platformToothLayout,
  straightRampLayout,
  wallLayout,
  RAMP_HALF_THICKNESS,
  WALL_HALF_THICKNESS,
  type GeoVec3,
} from './track-geometry'

export type TrackMaterial = StandardMaterial | PBRMaterial

/** Everything a primitive needs from the builder that owns it. */
export interface TrackPrimitiveContext {
  scene: Scene
  /** False when there is no Rapier world — primitives become no-ops. */
  hasWorld: boolean
  adventureTrack: Mesh[]
  adventureBodies: RAPIER.RigidBody[]
  kinematicBindings: KinematicBinding[]
  gravityWells: GravityWell[]
  chromaGates: ChromaGate[]
  resetSensors: RAPIER.RigidBody[]
  materials: TrackMaterial[]
  emit: (desc: AdventureColliderDesc) => EmittedCollider
  attach: (parent: EmittedCollider, desc: AdventureColliderDesc) => void
  getTrackMaterial: (colorHex: string) => StandardMaterial
  setGoalSensor: (body: RAPIER.RigidBody) => void
}

/** Quaternion for a Babylon YXZ Euler triple, as a plain descriptor quat. */
function eulerQuat(x: number, y: number, z: number): DescQuat {
  const q = Quaternion.FromEulerAngles(x, y, z)
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

function toVector3(v: GeoVec3): Vector3 {
  return new Vector3(v.x, v.y, v.z)
}

/**
 * Straight ramp segment.
 * @returns End position of the segment.
 */
export function addStraightRamp(
  ctx: TrackPrimitiveContext,
  startPos: Vector3,
  heading: number,
  width: number,
  length: number,
  inclineRad: number,
  material: TrackMaterial,
  wallHeight = 0,
  friction = 0.5
): Vector3 {
  if (!ctx.hasWorld) return startPos

  const layout = straightRampLayout(startPos, heading, length, inclineRad)
  const center = toVector3(layout.center)

  const box = MeshBuilder.CreateBox(
    'straightRamp',
    { width, height: 0.5, depth: length },
    ctx.scene
  )
  box.position.copyFrom(center)
  box.rotation.y = heading
  box.rotation.x = inclineRad
  box.material = material
  ctx.adventureTrack.push(box)

  const { body } = ctx.emit(
    boxDesc(
      layout.center,
      { x: width / 2, y: RAMP_HALF_THICKNESS, z: length / 2 },
      { rotation: eulerQuat(inclineRad, heading, 0), friction, label: 'straightRamp' }
    )
  )
  ctx.adventureBodies.push(body)

  if (wallHeight > 0) {
    createWall(ctx, center, heading, length, width, wallHeight, inclineRad, material, friction)
  }

  return toVector3(layout.endPos)
}

/** Curved ramp, built as a fan of chord slabs. */
export function addCurvedRamp(
  ctx: TrackPrimitiveContext,
  startPos: Vector3,
  startHeading: number,
  radius: number,
  totalAngle: number,
  inclineRad: number,
  width: number,
  wallHeight: number,
  material: TrackMaterial,
  segments = 48,
  bankingAngle = 0,
  friction = 0.5
): Vector3 {
  if (!ctx.hasWorld) return startPos

  const layout = curvedRampLayout(
    startPos,
    startHeading,
    radius,
    totalAngle,
    inclineRad,
    segments
  )
  const { chordLen } = layout

  for (const segment of layout.segments) {
    const center = toVector3(segment.center)

    const box = MeshBuilder.CreateBox(
      'curveSeg',
      { width, height: 0.5, depth: chordLen },
      ctx.scene
    )
    box.position.copyFrom(center)
    box.rotation.x = inclineRad
    box.rotation.y = segment.heading
    box.rotation.z = bankingAngle
    box.material = material
    ctx.adventureTrack.push(box)

    const { body } = ctx.emit(
      boxDesc(
        segment.center,
        { x: width / 2, y: RAMP_HALF_THICKNESS, z: chordLen / 2 },
        {
          rotation: eulerQuat(inclineRad, segment.heading, bankingAngle),
          friction,
          label: 'curveSeg',
        }
      )
    )
    ctx.adventureBodies.push(body)

    if (wallHeight > 0) {
      createWall(
        ctx,
        center,
        segment.heading,
        chordLen,
        width,
        wallHeight,
        inclineRad,
        material,
        friction
      )
    }
  }

  return toVector3(layout.endPos)
}

/** The pair of side walls flanking a track segment. */
export function createWall(
  ctx: TrackPrimitiveContext,
  center: Vector3,
  heading: number,
  length: number,
  trackWidth: number,
  height: number,
  inclineRad: number,
  mat: TrackMaterial,
  friction = 0.5
): void {
  if (!ctx.hasWorld) return

  for (const wallPos of wallLayout(center, heading, trackWidth, height)) {
    const wall = MeshBuilder.CreateBox('wall', { width: 0.5, height, depth: length }, ctx.scene)
    wall.position.copyFrom(toVector3(wallPos))
    wall.rotation.y = heading
    wall.rotation.x = inclineRad
    wall.material = mat
    ctx.adventureTrack.push(wall)

    const { body } = ctx.emit(
      boxDesc(
        wallPos,
        { x: WALL_HALF_THICKNESS, y: height / 2, z: length / 2 },
        { rotation: eulerQuat(inclineRad, heading, 0), friction, label: 'wall' }
      )
    )
    ctx.adventureBodies.push(body)
  }
}

/** Spinning platter, optionally ringed with teeth. */
export function createRotatingPlatform(
  ctx: TrackPrimitiveContext,
  center: Vector3,
  radius: number,
  angVelY: number,
  material: TrackMaterial,
  hasTeeth = false
): void {
  if (!ctx.hasWorld) return

  const thickness = 0.5
  const cylinder = MeshBuilder.CreateCylinder(
    'gear',
    { diameter: radius * 2, height: thickness, tessellation: 32 },
    ctx.scene
  )
  cylinder.position.copyFrom(center)
  cylinder.material = material
  ctx.adventureTrack.push(cylinder)

  const platter = ctx.emit(
    cylinderDesc({ x: center.x, y: center.y, z: center.z }, thickness / 2, radius, {
      friction: 1.0,
      motion: 'kinematic-velocity',
      angularVelocity: { x: 0, y: angVelY, z: 0 },
      label: 'rotatingPlatform',
    })
  )
  ctx.adventureBodies.push(platter.body)
  ctx.kinematicBindings.push({ body: platter.body, mesh: cylinder })

  if (!hasTeeth) return

  for (const tooth of platformToothLayout(radius, 12)) {
    const { angle, x: tx, z: tz } = tooth
    ctx.attach(
      platter,
      boxDesc({ x: tx, y: 0.75, z: tz }, { x: 0.5, y: 0.5, z: 1.0 }, {
        rotation: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) },
        label: 'rotatingPlatformTooth',
      })
    )

    const toothMesh = MeshBuilder.CreateBox('tooth', { width: 1, height: 1, depth: 2 }, ctx.scene)
    toothMesh.parent = cylinder
    toothMesh.position.set(tx, 0.75, tz)
    toothMesh.rotation.y = angle
    toothMesh.material = material
  }
}

/** Goal basin plus the sensor that detects a ball landing in it. */
export function createBasin(
  ctx: TrackPrimitiveContext,
  pos: Vector3,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  const basin = MeshBuilder.CreateBox('basin', { width: 8, height: 1, depth: 8 }, ctx.scene)
  basin.position.set(pos.x, pos.y - 1, pos.z)
  basin.material = material
  ctx.adventureTrack.push(basin)

  const { body } = ctx.emit(
    boxDesc({ x: pos.x, y: pos.y - 1, z: pos.z }, { x: 4, y: 0.5, z: 4 }, { label: 'basin' })
  )
  ctx.adventureBodies.push(body)

  const { body: sensor } = ctx.emit(
    boxDesc({ x: pos.x, y: pos.y - 0.5, z: pos.z }, { x: 2, y: 1, z: 1 }, {
      sensor: true,
      collisionEvents: true,
      label: 'basinGoalSensor',
    })
  )
  ctx.setGoalSensor(sensor)
}

/** Static pillar obstacle, seated on `pos`. */
export function createStaticCylinder(
  ctx: TrackPrimitiveContext,
  pos: Vector3,
  diameter: number,
  height: number,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  const mesh = MeshBuilder.CreateCylinder('staticPillar', { diameter, height }, ctx.scene)
  mesh.position.copyFrom(pos)
  mesh.position.y += height / 2
  mesh.material = material
  ctx.adventureTrack.push(mesh)

  const { body } = ctx.emit(
    cylinderDesc(
      { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      height / 2,
      diameter / 2,
      { label: 'staticPillar' }
    )
  )
  ctx.adventureBodies.push(body)
}

/** Lattice of static pins on the most recent straight ramp surface. */
export function createPinField(
  ctx: TrackPrimitiveContext,
  rampStart: Vector3,
  heading: number,
  inclineRad: number,
  rampLength: number,
  pinSpacing: number,
  evenOffsets: readonly number[],
  oddOffsets: readonly number[],
  pinDiameter: number,
  pinHeight: number,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  const positions = pinFieldLayout(
    rampStart,
    heading,
    inclineRad,
    rampLength,
    pinSpacing,
    evenOffsets,
    oddOffsets,
    pinHeight
  )

  for (const finalPos of positions) {
    const pin = MeshBuilder.CreateCylinder(
      'pin',
      { diameter: pinDiameter, height: pinHeight },
      ctx.scene
    )
    pin.position.copyFrom(toVector3(finalPos))
    pin.rotation.x = inclineRad
    pin.material = material
    ctx.adventureTrack.push(pin)

    const { body } = ctx.emit(
      cylinderDesc(finalPos, pinHeight / 2, pinDiameter / 2, {
        rotation: eulerQuat(inclineRad, 0, 0),
        restitution: 0.6,
        label: 'pin',
      })
    )
    ctx.adventureBodies.push(body)
  }
}

/** Kinematic mill whose angular velocity is along the ramp normal, not world Y. */
export function createInclinedMill(
  ctx: TrackPrimitiveContext,
  center: Vector3,
  radius: number,
  inclineRad: number,
  angVelAlongNormal: number,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  const mill = MeshBuilder.CreateCylinder('mill', { diameter: radius * 2, height: 0.2 }, ctx.scene)
  mill.position.copyFrom(center)
  mill.rotation.x = inclineRad
  mill.material = material
  ctx.adventureTrack.push(mill)

  const { body } = ctx.emit(
    cylinderDesc({ x: center.x, y: center.y, z: center.z }, 0.1, radius, {
      rotation: eulerQuat(inclineRad, 0, 0),
      friction: 1.0,
      motion: 'kinematic-velocity',
      angularVelocity: inclinedMillAxis(inclineRad, angVelAlongNormal),
      label: 'inclinedMill',
    })
  )
  ctx.adventureBodies.push(body)
  ctx.kinematicBindings.push({ body, mesh: mill })
}

/** Side catch basin with a reset sensor (penalty zone). */
export function createResetBasin(
  ctx: TrackPrimitiveContext,
  pos: Vector3,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  const basin = MeshBuilder.CreateBox('resetBasin', { width: 4, height: 1, depth: 4 }, ctx.scene)
  basin.position.copyFrom(pos)
  basin.material = material
  ctx.adventureTrack.push(basin)

  const { body } = ctx.emit(
    boxDesc({ x: pos.x, y: pos.y, z: pos.z }, { x: 2, y: 0.5, z: 2 }, { label: 'resetBasin' })
  )
  ctx.adventureBodies.push(body)

  const { body: sensorBody } = ctx.emit(
    boxDesc({ x: pos.x, y: pos.y + 0.75, z: pos.z }, { x: 1.8, y: 0.25, z: 1.8 }, {
      sensor: true,
      label: 'resetBasinSensor',
    })
  )
  ctx.resetSensors.push(sensorBody)
}

/** Dynamic physics block. */
export function createDynamicBlock(
  ctx: TrackPrimitiveContext,
  pos: Vector3,
  size: number,
  mass: number,
  material: StandardMaterial
): void {
  if (!ctx.hasWorld) return

  const box = MeshBuilder.CreateBox('dynBlock', { size }, ctx.scene)
  box.position.copyFrom(pos)
  box.material = material
  ctx.adventureTrack.push(box)

  const { body } = ctx.emit(
    boxDesc({ x: pos.x, y: pos.y, z: pos.z }, { x: size / 2, y: size / 2, z: size / 2 }, {
      density: mass / (size * size * size),
      friction: 0.5,
      restitution: 0.2,
      motion: 'dynamic',
      label: 'dynamicBlock',
    })
  )
  ctx.adventureBodies.push(body)
  ctx.kinematicBindings.push({ body, mesh: box })
}

/** Chroma gate that changes the ball's colour state. */
export function createChromaGate(
  ctx: TrackPrimitiveContext,
  pos: Vector3,
  color: 'RED' | 'GREEN' | 'BLUE'
): void {
  if (!ctx.hasWorld) return

  const gateMat = ctx.getTrackMaterial(
    color === 'RED' ? '#FF0000' : color === 'GREEN' ? '#00FF00' : '#0000FF'
  )
  const gate = MeshBuilder.CreateTorus('gate', { diameter: 4, thickness: 0.2 }, ctx.scene)
  gate.position.copyFrom(pos)
  gate.rotation.x = Math.PI / 2
  gate.material = gateMat
  ctx.adventureTrack.push(gate)

  const { body: sensor } = ctx.emit(
    cylinderDesc({ x: pos.x, y: pos.y, z: pos.z }, 0.5, 2.0, {
      sensor: true,
      label: 'chromaGate',
    })
  )
  ctx.chromaGates.push({ sensor, colorType: color })
}

/** Arc pylon with a repulsive gravity well around it. */
export function createArcPylon(
  ctx: TrackPrimitiveContext,
  pos: Vector3,
  mat: StandardMaterial
): void {
  if (!ctx.hasWorld) return

  const pylon = MeshBuilder.CreateCylinder('pylon', { diameter: 1.0, height: 3.0 }, ctx.scene)
  pylon.position.copyFrom(pos)
  pylon.position.y += 1.5
  pylon.material = mat
  ctx.adventureTrack.push(pylon)

  const { body } = ctx.emit(
    cylinderDesc({ x: pos.x, y: pos.y + 1.5, z: pos.z }, 1.5, 0.5, { label: 'arcPylon' })
  )
  ctx.adventureBodies.push(body)

  const { body: sensor } = ctx.emit(
    sphereDesc({ x: pos.x, y: pos.y + 1.5, z: pos.z }, 3.0, {
      sensor: true,
      label: 'arcPylonWell',
    })
  )

  ctx.gravityWells.push({ sensor, center: pos, strength: -50.0 })
}

export interface ExitPortalParts {
  root: Mesh
  core: Mesh
  ringMaterial: StandardMaterial
  coreMaterial: StandardMaterial
  sensor: RAPIER.RigidBody
}

/** Visual exit portal plus its goal sensor. */
export function createExitPortal(
  ctx: TrackPrimitiveContext,
  position: Vector3,
  ringColorHex: string,
  coreColorHex: string,
  radius = 2.1,
  depth = 0.8
): ExitPortalParts {
  const ring = MeshBuilder.CreateTorus(
    'exitPortalRing',
    { diameter: radius * 2, thickness: 0.45, tessellation: 48 },
    ctx.scene
  )
  ring.position.copyFrom(position)
  ring.rotation.x = Math.PI / 2

  const core = MeshBuilder.CreateDisc(
    'exitPortalCore',
    { radius: radius * 0.82, tessellation: 48 },
    ctx.scene
  )
  core.parent = ring
  core.position.z = -0.08

  const ringMaterial = new StandardMaterial('exitPortalRingMat', ctx.scene)
  ringMaterial.diffuseColor = Color3.Black()
  ringMaterial.emissiveColor = emissive(ringColorHex, INTENSITY.HIGH)
  ring.material = ringMaterial

  const coreMaterial = new StandardMaterial('exitPortalCoreMat', ctx.scene)
  coreMaterial.diffuseColor = Color3.Black()
  coreMaterial.emissiveColor = emissive(coreColorHex, INTENSITY.ACTIVE)
  coreMaterial.alpha = 0.72
  core.material = coreMaterial

  ctx.adventureTrack.push(ring, core)
  ctx.materials.push(ringMaterial, coreMaterial)

  const { body: sensor } = ctx.emit(
    cylinderDesc({ x: position.x, y: position.y, z: position.z }, depth, radius * 0.9, {
      sensor: true,
      collisionEvents: true,
      label: 'exitPortalSensor',
    })
  )
  ctx.adventureBodies.push(sensor)

  return { root: ring, core, ringMaterial, coreMaterial, sensor }
}
