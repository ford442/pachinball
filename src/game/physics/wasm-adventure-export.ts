/**
 * Walk an adventure track's collider descriptors into the C++ physics engine.
 *
 * The table's static geometry already has this shape in
 * `wasm-static-export.ts` (it reads Rapier colliders directly, because table
 * statics are built as Rapier bodies). Adventure tracks instead emit
 * `AdventureColliderDesc`s up front — see
 * src/adventure/track-collider-descriptors.ts — so this exporter reads those
 * rather than Rapier, but keeps the same shape: a pure function over an
 * engine handle that returns the debug-draw geometry it created.
 *
 * It is deliberately honest about what it cannot express. Every descriptor
 * the C++ engine has no shape for comes back in `unsupported`, and the
 * adventure Rapier gate only unsteps Rapier for a track whose export is
 * completely clean.
 */

import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import type {
  AdventureColliderDesc,
  DescQuat,
  DescVec3,
} from '../../adventure/track-collider-descriptors'

/** A descriptor the C++ engine cannot represent, and why. */
export interface UnsupportedCollider {
  /** Index into the descriptor list handed to the exporter. */
  index: number
  reason: string
  label?: string
}

/** A kinematic mover created for a descriptor, so callers can push its pose. */
export interface ExportedMover {
  /** Index into the descriptor list. */
  index: number
  /** Negative mover handle from `addKinematicMover`. */
  handle: number
}

export interface AdventureExportResult {
  /**
   * C++ handle per exported descriptor, keyed by descriptor index. A
   * descriptor listed in `unsupported` has no entry.
   */
  handles: Map<number, number>
  movers: ExportedMover[]
  unsupported: UnsupportedCollider[]
  debug: WasmDebugCollider[]
}

const IDENTITY: DescQuat = { x: 0, y: 0, z: 0, w: 1 }

function quatMul(a: DescQuat, b: DescQuat): DescQuat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function quatRotate(q: DescQuat, v: DescVec3): DescVec3 {
  // t = 2 * (q.xyz × v); v' = v + q.w * t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  }
}

interface Pose {
  position: DescVec3
  rotation: DescQuat
}

function compose(parent: Pose, localPos: DescVec3, localRot: DescQuat): Pose {
  const offset = quatRotate(parent.rotation, localPos)
  return {
    position: {
      x: parent.position.x + offset.x,
      y: parent.position.y + offset.y,
      z: parent.position.z + offset.z,
    },
    rotation: quatMul(parent.rotation, localRot),
  }
}

/**
 * World pose of the collider a descriptor describes, or null when it hangs
 * off a parent whose own pose is not fixed (a spinning platter's teeth cannot
 * be baked into a static).
 */
function worldPose(
  desc: AdventureColliderDesc,
  all: readonly AdventureColliderDesc[]
): Pose | null {
  if (desc.parentIndex === undefined) {
    const body: Pose = { position: desc.position, rotation: desc.rotation }
    if (!desc.localPosition && !desc.localRotation) return body
    return compose(body, desc.localPosition ?? { x: 0, y: 0, z: 0 }, desc.localRotation ?? IDENTITY)
  }

  const parent = all[desc.parentIndex]
  if (!parent) return null
  if (parent.motion && parent.motion !== 'fixed') return null
  const parentPose = worldPose(parent, all)
  if (!parentPose) return null
  return compose(parentPose, desc.position, desc.rotation)
}

/**
 * Export one track's descriptors into `engine`.
 *
 * Nothing is exported for a descriptor listed in the result's `unsupported`,
 * so a partially-supported track still gets its supported colliders (useful
 * for debug draw) while the caller can see the export is incomplete.
 */
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
    if (motion === 'dynamic') {
      reject('dynamic bodies have no C++ equivalent')
      return
    }
    if (motion === 'kinematic-velocity') {
      reject('prescribed-spin kinematic bodies have no C++ equivalent')
      return
    }

    const pose = worldPose(desc, descriptors)
    if (!pose) {
      reject('collider hangs off a non-fixed parent body')
      return
    }

    const { position: p, rotation: q } = pose
    const restitution = desc.restitution
    const friction = desc.friction

    let handle: number
    if (motion === 'kinematic-position') {
      if (desc.kind !== 'box') {
        reject(`C++ kinematic movers are OBB only, got ${desc.kind}`)
        return
      }
      if (desc.sensor) {
        reject('a kinematic mover cannot also be a sensor')
        return
      }
      if (desc.localPosition || desc.localRotation) {
        // The mover's pose is pushed per tick; baking an offset here would
        // desynchronise the moment something drives it.
        reject('kinematic movers with a body-local collider offset are not supported')
        return
      }
      const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
      handle = engine.addKinematicMover(p, half, q, restitution, friction)
      movers.push({ index, handle })
      debug.push({ kind: 'box', center: p, halfExtents: half, rotation: q })
    } else if (desc.sensor) {
      if (desc.kind !== 'box') {
        reject(`C++ sensor volumes are OBB only, got ${desc.kind}`)
        return
      }
      const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
      handle = engine.addSensorVolume(p, half, q)
      debug.push({ kind: 'box', center: p, halfExtents: half, rotation: q })
    } else {
      switch (desc.kind) {
        case 'box': {
          const half = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
          handle = engine.addStaticBox(p, half, q, restitution, friction)
          debug.push({ kind: 'box', center: p, halfExtents: half, rotation: q })
          break
        }
        case 'cylinder': {
          const radius = desc.radius ?? 0.5
          const halfHeight = desc.halfHeight ?? 0.5
          handle = engine.addStaticCylinder(p, radius, halfHeight, q, restitution, friction)
          // No cylinder in the debug-draw vocabulary yet; a capsule of the
          // same axis and radius is the closest honest stand-in.
          debug.push({ kind: 'capsule', center: p, radius, halfHeight, rotation: q })
          break
        }
        case 'sphere': {
          const radius = desc.radius ?? 0.5
          handle = engine.addStaticSphere(p, radius, restitution, friction)
          debug.push({ kind: 'sphere', center: p, radius })
          break
        }
      }
    }

    handles.set(index, handle)
    engine.setCollisionGroups(handle, desc.membership, desc.filter)
  })

  return { handles, movers, unsupported, debug }
}

/** True when every descriptor in the track was expressible in C++. */
export function isFullyExportable(descriptors: readonly AdventureColliderDesc[]): boolean {
  return collectUnsupported(descriptors).length === 0
}

/**
 * Dry-run the shape checks without touching an engine. Same rejection rules as
 * `exportAdventureCollidersToWasm` — keep the two in step.
 */
export function collectUnsupported(
  descriptors: readonly AdventureColliderDesc[]
): UnsupportedCollider[] {
  const probe = createNullEngine()
  return exportAdventureCollidersToWasm(descriptors, probe).unsupported
}

/** No-op engine used by `collectUnsupported` to reuse one set of rules. */
function createNullEngine(): WasmSimEngine {
  let next = -1
  const handle = (): number => next--
  return {
    addStaticBox: handle,
    addStaticCapsule: handle,
    addStaticCylinder: handle,
    addStaticSphere: handle,
    addSensorVolume: handle,
    addKinematicMover: handle,
    setCollisionGroups: () => {},
  } as unknown as WasmSimEngine
}
