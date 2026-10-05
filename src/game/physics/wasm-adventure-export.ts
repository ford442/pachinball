import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import type {
  AdventureColliderDesc,
  DescQuat,
  DescVec3,
} from '../../adventure/track-collider-descriptors'
import { WasmForceSpace, WasmVolumeShape } from '../../wasm/PhysicsModule'
import { composePose, quatRotateVec, type Pose, type VolumeKind } from './adventure-kinematics'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import { STATIC_HANDLE_OVERFLOW } from '../../wasm/wasm-types'

const IDENTITY_DESC: DescQuat = { x: 0, y: 0, z: 0, w: 1 }

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

export interface AdventureExportResult {
  handles: Map<number, number>
  movers: ExportedMover[]
  movingSensors: MovingSensor[]
  kinematicBodies: KinematicBody[]
  unsupported: UnsupportedCollider[]
  debug: WasmDebugCollider[]
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
 *   fixed               → static box / cylinder / sphere / triangle mesh, a
 *                         static sensor volume, one pin field, or a force field
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
        // The loop bound guarantees v, v + 1 and v + 2 are in range.
        const w = quatRotateVec(q, { x: verts[v]!, y: verts[v + 1]!, z: verts[v + 2]! })
        world[v] = p.x + w.x
        world[v + 1] = p.y + w.y
        world[v + 2] = p.z + w.z
      }
      const indices = Uint32Array.from(desc.indices ?? [])
      const handle = engine.addStaticTriangleMesh(world, indices, restitution, friction, false)
      return finish(handle, { kind: 'mesh', center: p, triangleCount: indices.length / 3 })
    }

    if (desc.kind === 'pinField' || desc.kind === 'forceField') {
      if (moving || desc.parentIndex !== undefined) return reject(`a ${desc.kind} must be static and unattached`)
      if (desc.sensor) return reject(`a ${desc.kind} cannot be a sensor`)
      if (desc.kind === 'pinField') {
        if (!desc.pinField) return reject('pinField descriptor carries no lattice')
        if (!engine.addPinField) return reject('engine exposes no pin fields')
        const field = { ...desc.pinField, restitution, friction }
        return finish(engine.addPinField(field), { kind: 'pinField', field })
      }
      if (!engine.addForceField) return reject('engine exposes no force fields')
      const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
      const handle = engine.addForceField({
        center: p,
        halfExtents: half,
        rotation: q,
        force: desc.acceleration ?? ZERO_VEC,
        space: desc.forceSpace === 'field' ? WasmForceSpace.Local : WasmForceSpace.World,
        acceleration: true,
      })
      // Drawn as a wireframe volume: a field applies no impulse, like a sensor.
      return finish(handle, { kind: 'sensor', center: p, halfExtents: half, rotation: q, volumeShape: 'box' })
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
    addPinField: handle,
    addForceField: handle,
    setCollisionGroups: () => {},
  } as unknown as WasmSimEngine
  return exportAdventureCollidersToWasm(descriptors, probe).unsupported
}
