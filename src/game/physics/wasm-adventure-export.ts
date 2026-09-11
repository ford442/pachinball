import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import type {
  AdventureColliderDesc,
  DescQuat,
  DescVec3,
} from '../../adventure/track-collider-descriptors'
import { WasmVolumeShape } from '../../wasm/PhysicsModule'
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
  index: number
  handle: number
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
  unsupported: UnsupportedCollider[]
  debug: WasmDebugCollider[]
}

interface Pose {
  position: DescVec3
  rotation: DescQuat
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

function quatRotate(q: DescQuat, v: DescVec3): DescVec3 {
  return rotatePoint(q, v.x, v.y, v.z)
}

function conjugate(q: { x: number; y: number; z: number; w: number }) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

function compose(parent: Pose, localPos: DescVec3, localRot: DescQuat): Pose {
  const offset = quatRotate(parent.rotation, localPos)
  return {
    position: {
      x: parent.position.x + offset.x,
      y: parent.position.y + offset.y,
      z: parent.position.z + offset.z,
    },
    rotation: quatMultiply(parent.rotation, localRot),
  }
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

function worldPose(desc: AdventureColliderDesc, all: readonly AdventureColliderDesc[]): Pose | null {
  if (desc.parentIndex === undefined) {
    const body: Pose = { position: desc.position, rotation: desc.rotation }
    if (!desc.localPosition && !desc.localRotation) return body
    return compose(body, desc.localPosition ?? { x: 0, y: 0, z: 0 }, desc.localRotation ?? IDENTITY_DESC)
  }

  const parent = all[desc.parentIndex]
  if (!parent || (parent.motion && parent.motion !== 'fixed')) return null
  const parentPose = worldPose(parent, all)
  if (!parentPose) return null
  return compose(parentPose, desc.position, desc.rotation)
}

export function exportAdventureCollidersToWasm(
  descriptors: readonly AdventureColliderDesc[],
  engine: WasmSimEngine
): AdventureExportResult {
  const handles = new Map<number, number>()
  const movers: ExportedMover[] = []
  const unsupported: UnsupportedCollider[] = []
  const debug: WasmDebugCollider[] = []

  descriptors.forEach((desc, index) => {
    const reject = (reason: string): void => {
      unsupported.push({ index, reason, ...(desc.label ? { label: desc.label } : {}) })
    }

    const motion = desc.motion ?? 'fixed'
    if (motion === 'dynamic') return reject('dynamic bodies have no C++ equivalent')
    if (motion === 'kinematic-velocity') return reject('prescribed-spin kinematic bodies have no C++ equivalent')

    const pose = worldPose(desc, descriptors)
    if (!pose) return reject('collider hangs off a non-fixed parent body')

    const { position: p, rotation: q } = pose
    const restitution = desc.restitution
    const friction = desc.friction

    const debugBefore = debug.length
    const moversBefore = movers.length

    let handle: number | null = null
    if (motion === 'kinematic-position') {
      if (desc.kind !== 'box') return reject(`C++ kinematic movers are box only, got ${desc.kind}`)
      if (desc.sensor) return reject('a kinematic mover cannot also be a sensor')
      if (desc.localPosition || desc.localRotation) {
        return reject('kinematic movers with a body-local collider offset are not supported')
      }
      if (!engine.addKinematicMover) return reject('engine exposes no kinematic movers')
      const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
      handle = engine.addKinematicMover(p, half, q, restitution, friction)
      movers.push({ index, handle })
      debug.push({ kind: 'box', center: p, halfExtents: half, rotation: q })
    } else if (desc.sensor) {
      if (desc.kind !== 'box') return reject(`C++ sensor volumes are box only, got ${desc.kind}`)
      if (!engine.addSensorVolume) return reject('engine exposes no sensor volumes')
      const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
      handle = engine.addSensorVolume(p, half, q)
      debug.push({ kind: 'box', center: p, halfExtents: half, rotation: q })
    } else if (desc.kind === 'box') {
      const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
      handle = engine.addStaticBox(p, half, q, restitution, friction)
      debug.push({ kind: 'box', center: p, halfExtents: half, rotation: q })
    } else if (desc.kind === 'cylinder') {
      if (!engine.addStaticCylinder) return reject('engine exposes no static cylinders')
      const radius = desc.radius ?? 0.5
      const halfHeight = desc.halfHeight ?? 0.5
      handle = engine.addStaticCylinder(p, radius, halfHeight, q, restitution, friction)
      debug.push({ kind: 'cylinder', center: p, radius, halfHeight, rotation: q })
    } else {
      if (!engine.addStaticSphere) return reject('engine exposes no static spheres')
      const radius = desc.radius ?? 0.5
      handle = engine.addStaticSphere(p, radius, restitution, friction)
      debug.push({ kind: 'sphere', center: p, radius })
    }

    if (handle === STATIC_HANDLE_OVERFLOW) {
      // The family is full and native created nothing. Storing the sentinel
      // would name geometry that does not exist, and drawing its debug box
      // would show a collider that is not there — so undo both and report it,
      // which also stops `isFullyExportable` handing the track to C++.
      debug.length = debugBefore
      movers.length = moversBefore
      return reject('native static handle capacity exhausted')
    }
    if (handle === null || handle === -1) return
    handles.set(index, handle)
    engine.setCollisionGroups?.(handle, desc.membership, desc.filter)
  })

  return { handles, movers, unsupported, debug }
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
