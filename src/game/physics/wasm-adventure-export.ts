import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import type {
  AdventureColliderDesc,
  DescQuat,
  DescVec3,
} from '../../adventure/track-collider-descriptors'
import { WasmVolumeShape } from '../../wasm/PhysicsModule'
import { composePose, quatRotateVec, type Pose, type VolumeKind } from './adventure-kinematics'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import { STATIC_HANDLE_OVERFLOW } from '../../wasm/wasm-types'

const RapierShapeType = {
  Ball: 0,
  Cuboid: 1,
  Capsule: 2,
  TriMesh: 6,
  ConvexPolyhedron: 9,
  Cylinder: 10,
  Cone: 11,
} as const

const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 } as const
const IDENTITY_DESC: DescQuat = { x: 0, y: 0, z: 0, w: 1 }

export interface AdventureExportOptions {
  membership?: number
  filter?: number
  defaultRestitution?: number
  defaultFriction?: number
  tessellateCuboids?: boolean
}

export interface AdventureMover {
  moverId: number
  body: RAPIER.RigidBody
  colliderIndex: number
  localOffset: { x: number; y: number; z: number }
  localRotation: { x: number; y: number; z: number; w: number }
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  velocityDriven: boolean
}

export interface ExportedMover {
  /** Descriptor of the collider. */
  index: number
  handle: number
  /** Descriptor whose body carries the collider — itself, or its parent. */
  bodyIndex: number
  /** Collider pose inside that body. */
  local: Pose
}

/** A trigger volume riding on a moving body; see `exportAdventureCollidersToWasm`. */
export interface MovingSensor {
  index: number
  bodyIndex: number
  local: Pose
  kind: VolumeKind
  /** VolumeShape convention — see `sphereTouchesVolume`. */
  halfExtents: DescVec3
}

/** A moving body whose pose WasmOwner advances each tick. */
export interface KinematicBody {
  bodyIndex: number
  /** World-space spin for `kinematic-velocity` bodies; null when an animator poses it. */
  angularVelocity: DescVec3 | null
}

export interface UnsupportedCollider {
  index: number
  reason: string
  label?: string
}

interface AdventureBodyExportResult {
  handles: number[]
  movers: AdventureMover[]
  sensors: Array<{ handle: number; body: RAPIER.RigidBody }>
  debug: WasmDebugCollider[]
  unsupported: Array<{ shapeType: number; reason: string }>
}

export interface AdventureExportResult {
  handles: Map<number, number>
  movers: ExportedMover[]
  movingSensors: MovingSensor[]
  kinematicBodies: KinematicBody[]
  unsupported: UnsupportedCollider[]
  debug: WasmDebugCollider[]
}

function emptyBodyResult(): AdventureBodyExportResult {
  return { handles: [], movers: [], sensors: [], debug: [], unsupported: [] }
}

function quatMultiply(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number }
) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function normalizeQuat(q: { x: number; y: number; z: number; w: number }) {
  const len = Math.hypot(q.x, q.y, q.z, q.w)
  if (len < 1e-9) return { x: 0, y: 0, z: 0, w: 1 }
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}

function rotatePoint(
  q: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number
): { x: number; y: number; z: number } {
  const ux = q.y * z - q.z * y
  const uy = q.z * x - q.x * z
  const uz = q.x * y - q.y * x
  const vx = q.y * uz - q.z * uy
  const vy = q.z * ux - q.x * uz
  const vz = q.x * uy - q.y * ux
  return {
    x: x + 2 * (q.w * ux + vx),
    y: y + 2 * (q.w * uy + vy),
    z: z + 2 * (q.w * uz + vz),
  }
}

function conjugate(q: { x: number; y: number; z: number; w: number }) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

export function tessellateBox(
  center: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number }
): { vertices: Float32Array; indices: Uint32Array } {
  const signs: Array<[number, number, number]> = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]

  const vertices = new Float32Array(signs.length * 3)
  signs.forEach(([sx, sy, sz], i) => {
    const lx = sx * halfExtents.x
    const ly = sy * halfExtents.y
    const lz = sz * halfExtents.z
    const rotated = rotatePoint(rotation, lx, ly, lz)
    vertices[i * 3] = center.x + rotated.x
    vertices[i * 3 + 1] = center.y + rotated.y
    vertices[i * 3 + 2] = center.z + rotated.z
  })

  const indices = new Uint32Array([
    4, 5, 6, 4, 6, 7,
    1, 0, 3, 1, 3, 2,
    5, 1, 2, 5, 2, 6,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ])

  return { vertices, indices }
}

export function exportAdventureBodyToWasm(
  body: RAPIER.RigidBody,
  engine: WasmSimEngine,
  options: AdventureExportOptions = {}
): AdventureBodyExportResult {
  const result = emptyBodyResult()
  const defaultRestitution = options.defaultRestitution ?? 0.4
  const defaultFriction = options.defaultFriction ?? 0.2
  const isFixed = body.isFixed()
  const isKinematic = body.isKinematic()
  const isDynamic = !isFixed && !isKinematic

  const applyGroups = (handle: number) => {
    if (handle === -1) return
    result.handles.push(handle)
    if (options.membership !== undefined && options.filter !== undefined) {
      engine.setCollisionGroups?.(handle, options.membership, options.filter)
    }
  }

  const bodyPos = body.translation()
  const bodyRot = body.rotation()

  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i)
    const shapeType = collider.shapeType()
    const pos = collider.translation()
    const rot = collider.rotation()
    const center = { x: pos.x, y: pos.y, z: pos.z }
    const rotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    const restitution = collider.restitution() ?? defaultRestitution
    const friction = typeof collider.friction === 'function' ? collider.friction() : defaultFriction

    if (collider.isSensor()) {
      let volumeShape: WasmVolumeShape = WasmVolumeShape.Box
      let halfExtents = { x: 0.5, y: 0.5, z: 0.5 }
      let debugShape: 'box' | 'cylinder' | 'sphere' = 'box'

      if (shapeType === RapierShapeType.Cuboid) {
        const half = collider.halfExtents()
        halfExtents = { x: half.x, y: half.y, z: half.z }
      } else if (shapeType === RapierShapeType.Cylinder) {
        const radius = collider.radius()
        halfExtents = { x: radius, y: collider.halfHeight(), z: radius }
        volumeShape = WasmVolumeShape.Cylinder
        debugShape = 'cylinder'
      } else if (shapeType === RapierShapeType.Ball) {
        const radius = collider.radius()
        halfExtents = { x: radius, y: radius, z: radius }
        volumeShape = WasmVolumeShape.Sphere
        debugShape = 'sphere'
      } else {
        result.unsupported.push({ shapeType, reason: 'sensor shape has no volume equivalent' })
        continue
      }

      if (!engine.addSensorVolume) {
        result.unsupported.push({ shapeType, reason: 'engine exposes no sensor volumes' })
        continue
      }
      const sensorHandle = engine.addSensorVolume(center, halfExtents, rotation, volumeShape)
      applyGroups(sensorHandle)
      if (sensorHandle !== -1) result.sensors.push({ handle: sensorHandle, body })
      result.debug.push({ kind: 'sensor', center, halfExtents, rotation, volumeShape: debugShape })
      continue
    }

    if (isKinematic) {
      let halfExtents: { x: number; y: number; z: number }
      let volumeShape: WasmVolumeShape
      if (shapeType === RapierShapeType.Cylinder) {
        const radius = collider.radius()
        halfExtents = { x: radius, y: collider.halfHeight(), z: radius }
        volumeShape = WasmVolumeShape.Cylinder
      } else if (shapeType === RapierShapeType.Cuboid) {
        const half = collider.halfExtents()
        halfExtents = { x: half.x, y: half.y, z: half.z }
        volumeShape = WasmVolumeShape.Box
      } else {
        result.unsupported.push({ shapeType, reason: 'kinematic movers are box or cylinder only' })
        continue
      }

      if (!engine.addKinematicMover) {
        result.unsupported.push({ shapeType, reason: 'engine exposes no kinematic movers' })
        continue
      }
      const moverId = engine.addKinematicMover(
        center,
        halfExtents,
        rotation,
        restitution,
        friction,
        volumeShape,
      )
      applyGroups(moverId)
      if (moverId !== -1) {
        const angvel = body.angvel()
        const linvel = body.linvel()
        const velocityDriven =
          angvel.x !== 0 || angvel.y !== 0 || angvel.z !== 0 ||
          linvel.x !== 0 || linvel.y !== 0 || linvel.z !== 0
        const invBody = conjugate({ x: bodyRot.x, y: bodyRot.y, z: bodyRot.z, w: bodyRot.w })
        result.movers.push({
          moverId,
          body,
          colliderIndex: i,
          localOffset: rotatePoint(invBody, center.x - bodyPos.x, center.y - bodyPos.y, center.z - bodyPos.z),
          localRotation: quatMultiply(invBody, rotation),
          position: { ...center },
          rotation: { ...rotation },
          velocityDriven,
        })
      }
      result.debug.push(
        volumeShape === WasmVolumeShape.Cylinder
          ? { kind: 'cylinder', center, radius: halfExtents.x, halfHeight: halfExtents.y, rotation }
          : { kind: 'box', center, halfExtents, rotation },
      )
      continue
    }

    if (isDynamic) {
      if (shapeType !== RapierShapeType.Cuboid) {
        result.unsupported.push({ shapeType, reason: 'dynamic adventure bodies must be cuboids' })
        continue
      }
      if (!engine.createBoxBody) {
        result.unsupported.push({ shapeType, reason: 'engine exposes no dynamic box bodies' })
        continue
      }
      const half = collider.halfExtents()
      const vel = body.linvel()
      const handle = engine.createBoxBody({
        position: { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        halfExtents: { x: half.x, y: half.y, z: half.z },
        mass: body.mass() || 1,
        restitution,
        friction,
      })
      applyGroups(handle)
      result.debug.push({
        kind: 'box',
        center: { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
        halfExtents: { x: half.x, y: half.y, z: half.z },
        rotation: { x: bodyRot.x, y: bodyRot.y, z: bodyRot.z, w: bodyRot.w },
      })
      continue
    }

    switch (shapeType) {
      case RapierShapeType.Cuboid: {
        const half = collider.halfExtents()
        const halfExtents = { x: half.x, y: half.y, z: half.z }
        if (options.tessellateCuboids && engine.addStaticTriangleMesh) {
          const { vertices, indices } = tessellateBox(center, halfExtents, rotation)
          applyGroups(engine.addStaticTriangleMesh(vertices, indices, restitution, friction, false))
          result.debug.push({ kind: 'mesh', center, triangleCount: indices.length / 3 })
        } else {
          applyGroups(engine.addStaticBox(center, halfExtents, rotation, restitution, friction))
          result.debug.push({ kind: 'box', center, halfExtents, rotation })
        }
        break
      }
      case RapierShapeType.Cylinder: {
        if (!engine.addStaticCylinder) {
          result.unsupported.push({ shapeType, reason: 'engine exposes no static cylinders' })
          break
        }
        const radius = collider.radius()
        const halfHeight = collider.halfHeight()
        applyGroups(engine.addStaticCylinder(center, radius, halfHeight, rotation, restitution, friction))
        result.debug.push({ kind: 'cylinder', center, radius, halfHeight, rotation })
        break
      }
      case RapierShapeType.Capsule: {
        const radius = collider.radius()
        const halfHeight = collider.halfHeight()
        applyGroups(engine.addStaticCapsule(center, radius, halfHeight, rotation, restitution, friction))
        result.debug.push({ kind: 'capsule', center, radius, halfHeight, rotation })
        break
      }
      case RapierShapeType.Ball: {
        const radius = collider.radius()
        if (engine.addStaticSphere) {
          applyGroups(engine.addStaticSphere(center, radius, restitution, friction))
        } else {
          applyGroups(engine.createBody({
            position: center,
            velocity: { x: 0, y: 0, z: 0 },
            mass: 0,
            radius,
            restitution,
            friction,
            linearDamping: 0,
            bodyType: 1,
          }))
        }
        result.debug.push({ kind: 'sphere', center, radius })
        break
      }
      case RapierShapeType.TriMesh:
      case RapierShapeType.ConvexPolyhedron: {
        const verts = collider.vertices()
        const idx = collider.indices()
        if (!engine.addStaticTriangleMesh || !verts || !idx) {
          result.unsupported.push({ shapeType, reason: 'engine exposes no triangle meshes' })
          break
        }
        const world = new Float32Array(verts.length)
        for (let v = 0; v + 2 < verts.length; v += 3) {
          const p = rotatePoint(rotation, verts[v], verts[v + 1], verts[v + 2])
          world[v] = center.x + p.x
          world[v + 1] = center.y + p.y
          world[v + 2] = center.z + p.z
        }
        applyGroups(engine.addStaticTriangleMesh(world, Uint32Array.from(idx), restitution, friction, false))
        result.debug.push({ kind: 'mesh', center, triangleCount: idx.length / 3 })
        break
      }
      default:
        result.unsupported.push({ shapeType, reason: 'no WASM equivalent' })
        break
    }
  }

  return result
}

const ZERO_VEC: DescVec3 = { x: 0, y: 0, z: 0 }

/** C++ volume-shape tag and half-extents (VolumeShape convention) for a descriptor. */
function volumeOf(desc: AdventureColliderDesc): { kind: VolumeKind; shape: WasmVolumeShape; half: DescVec3 } | null {
  switch (desc.kind) {
    case 'box':
      return { kind: 'box', shape: WasmVolumeShape.Box, half: desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 } }
    case 'cylinder': {
      const r = desc.radius ?? 0.5
      return { kind: 'cylinder', shape: WasmVolumeShape.Cylinder, half: { x: r, y: desc.halfHeight ?? 0.5, z: r } }
    }
    case 'sphere': {
      const r = desc.radius ?? 0.5
      return { kind: 'sphere', shape: WasmVolumeShape.Sphere, half: { x: r, y: r, z: r } }
    }
    default:
      return null
  }
}

function volumeDebug(volume: { kind: VolumeKind; half: DescVec3 }, pose: Pose, sensor: boolean): WasmDebugCollider {
  const { position: center, rotation } = pose
  if (sensor) return { kind: 'sensor', center, halfExtents: volume.half, rotation, volumeShape: volume.kind }
  if (volume.kind === 'cylinder') return { kind: 'cylinder', center, radius: volume.half.x, halfHeight: volume.half.y, rotation }
  if (volume.kind === 'sphere') return { kind: 'sphere', center, radius: volume.half.x }
  return { kind: 'box', center, halfExtents: volume.half, rotation }
}

/**
 * Walk a track's descriptors into the C++ engine.
 *
 * A collider's body is its own descriptor, or its `parentIndex` descriptor
 * when attached; the body's `motion` decides the route:
 *
 *   fixed               → static box / cylinder / sphere / triangle mesh, or a
 *                         static sensor volume
 *   kinematic-position  → kinematic mover (pose supplied by the track's
 *   kinematic-velocity    animator, or integrated from the body's spin)
 *   dynamic             → unsupported (no track builds one)
 *
 * A sensor on a moving body has no C++ equivalent — C++ sensors are static —
 * and is returned in `movingSensors` for WasmOwner to test analytically.
 */
export function exportAdventureCollidersToWasm(
  descriptors: readonly AdventureColliderDesc[],
  engine: WasmSimEngine
): AdventureExportResult {
  const handles = new Map<number, number>()
  const movers: ExportedMover[] = []
  const movingSensors: MovingSensor[] = []
  const kinematicBodies = new Map<number, KinematicBody>()
  const unsupported: UnsupportedCollider[] = []
  const debug: WasmDebugCollider[] = []

  descriptors.forEach((desc, index) => {
    const reject = (reason: string): void => {
      unsupported.push({ index, reason, ...(desc.label ? { label: desc.label } : {}) })
    }

    /** Record a created handle; false when native created nothing. */
    const finish = (created: number, debugEntry: WasmDebugCollider): boolean => {
      if (created === STATIC_HANDLE_OVERFLOW) {
        // The family is full and native created nothing. Storing the sentinel
        // would name geometry that does not exist, and drawing it would show a
        // collider that is not there — so report it instead, which also stops
        // `isFullyExportable` handing the track to C++.
        reject('native static handle capacity exhausted')
        return false
      }
      if (created === -1) return false
      handles.set(index, created)
      debug.push(debugEntry)
      engine.setCollisionGroups?.(created, desc.membership, desc.filter)
      return true
    }

    if (desc.removed) return

    const bodyIndex = desc.parentIndex ?? index
    const body = descriptors[bodyIndex]
    if (!body) return reject('parent descriptor is missing')
    if (body.parentIndex !== undefined) return reject('nested collider attachment is not supported')

    const motion = body.motion ?? 'fixed'
    if (motion === 'dynamic') return reject('dynamic bodies have no C++ equivalent')
    const moving = motion !== 'fixed'

    const bodyPose: Pose = { position: body.position, rotation: body.rotation }
    const local: Pose = desc.parentIndex !== undefined
      ? { position: desc.position, rotation: desc.rotation }
      : { position: desc.localPosition ?? ZERO_VEC, rotation: desc.localRotation ?? IDENTITY_DESC }
    const pose = composePose(bodyPose, local)
    const { position: p, rotation: q } = pose
    const { restitution, friction } = desc

    const noteKinematicBody = (): void => {
      if (kinematicBodies.has(bodyIndex)) return
      kinematicBodies.set(bodyIndex, {
        bodyIndex,
        angularVelocity: motion === 'kinematic-velocity' ? (body.angularVelocity ?? ZERO_VEC) : null,
      })
    }

    if (desc.kind === 'convexMesh') {
      if (moving) return reject('a convex mesh must be static')
      if (desc.sensor) return reject('a convex mesh cannot be a sensor')
      if (!engine.addStaticTriangleMesh) return reject('engine exposes no triangle meshes')
      const verts = desc.vertices ?? []
      const world = new Float32Array(verts.length)
      for (let v = 0; v + 2 < verts.length; v += 3) {
        const w = quatRotateVec(q, { x: verts[v], y: verts[v + 1], z: verts[v + 2] })
        world[v] = p.x + w.x
        world[v + 1] = p.y + w.y
        world[v + 2] = p.z + w.z
      }
      const indices = Uint32Array.from(desc.indices ?? [])
      const handle = engine.addStaticTriangleMesh(world, indices, restitution, friction, false)
      return finish(handle, { kind: 'mesh', center: p, triangleCount: indices.length / 3 })
    }

    const volume = volumeOf(desc)
    if (!volume) return reject(`no C++ equivalent for ${desc.kind}`)

    if (moving && desc.sensor) {
      movingSensors.push({ index, bodyIndex, local, kind: volume.kind, halfExtents: volume.half })
      noteKinematicBody()
      return
    }

    if (moving) {
      if (!engine.addKinematicMover) return reject('engine exposes no kinematic movers')
      const handle = engine.addKinematicMover(p, volume.half, q, restitution, friction, volume.shape)
      if (!finish(handle, volumeDebug(volume, pose, false))) return
      movers.push({ index, handle, bodyIndex, local })
      noteKinematicBody()
      return
    }

    if (desc.sensor) {
      if (!engine.addSensorVolume) return reject('engine exposes no sensor volumes')
      return finish(engine.addSensorVolume(p, volume.half, q, volume.shape), volumeDebug(volume, pose, true))
    }

    let handle: number
    if (desc.kind === 'box') {
      handle = engine.addStaticBox(p, volume.half, q, restitution, friction)
    } else if (desc.kind === 'cylinder') {
      if (!engine.addStaticCylinder) return reject('engine exposes no static cylinders')
      handle = engine.addStaticCylinder(p, volume.half.x, volume.half.y, q, restitution, friction)
    } else {
      if (!engine.addStaticSphere) return reject('engine exposes no static spheres')
      handle = engine.addStaticSphere(p, volume.half.x, restitution, friction)
    }
    finish(handle, volumeDebug(volume, pose, false))
  })

  return { handles, movers, movingSensors, kinematicBodies: [...kinematicBodies.values()], unsupported, debug }
}

export function isFullyExportable(descriptors: readonly AdventureColliderDesc[]): boolean {
  return collectUnsupported(descriptors).length === 0
}

export function collectUnsupported(descriptors: readonly AdventureColliderDesc[]): UnsupportedCollider[] {
  let next = -1
  const handle = (): number => next--
  const probe = {
    addStaticBox: handle,
    addStaticCapsule: handle,
    addStaticCylinder: handle,
    addStaticSphere: handle,
    addStaticTriangleMesh: handle,
    addSensorVolume: handle,
    addKinematicMover: handle,
    setCollisionGroups: () => {},
  } as unknown as WasmSimEngine
  return exportAdventureCollidersToWasm(descriptors, probe).unsupported
}

export function driveAdventureMovers(
  movers: AdventureMover[],
  engine: WasmSimEngine,
  dt: number
): void {
  if (!engine.setNextKinematicTransform) return
  const clamped = Math.min(Math.max(dt, 0), 1 / 30)

  for (const mover of movers) {
    if (mover.velocityDriven) {
      const w = mover.body.angvel()
      const v = mover.body.linvel()
      const half = clamped * 0.5
      const spin = quatMultiply({ x: w.x * half, y: w.y * half, z: w.z * half, w: 0 }, mover.rotation)
      mover.rotation = normalizeQuat({
        x: mover.rotation.x + spin.x,
        y: mover.rotation.y + spin.y,
        z: mover.rotation.z + spin.z,
        w: mover.rotation.w + spin.w,
      })
      mover.position = {
        x: mover.position.x + v.x * clamped,
        y: mover.position.y + v.y * clamped,
        z: mover.position.z + v.z * clamped,
      }
    } else {
      const nextT = mover.body.nextTranslation?.() ?? mover.body.translation()
      const nextR = mover.body.nextRotation?.() ?? mover.body.rotation()
      const bodyRot = { x: nextR.x, y: nextR.y, z: nextR.z, w: nextR.w }
      const offset = rotatePoint(bodyRot, mover.localOffset.x, mover.localOffset.y, mover.localOffset.z)
      mover.position = { x: nextT.x + offset.x, y: nextT.y + offset.y, z: nextT.z + offset.z }
      mover.rotation = quatMultiply(bodyRot, mover.localRotation)
    }

    engine.setNextKinematicTransform(mover.moverId, mover.position, mover.rotation)
  }
}

export { IDENTITY_Q }
