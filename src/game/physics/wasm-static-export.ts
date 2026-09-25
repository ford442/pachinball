/**
 * Table collider export for the C++ owner path (#412).
 *
 * Walks the `TableColliderDesc`s recorded by `WasmTableWorld` — nothing is
 * read back off a Rapier collider any more — and adds each one to the C++
 * world:
 *
 *   fixed body, solid    box / capsule / cylinder / sphere → addStatic*
 *   any body, sensor     box / cylinder / sphere          → addSensorVolume
 *   kinematic body       box / cylinder                   → addKinematicMover
 *
 * Every collider the C++ world cannot represent (cones, convex hulls, a
 * kinematic capsule, a dynamic body with no C++ equivalent) is returned in
 * `unsupported` with a reason instead of being silently dropped, so the debug
 * HUD can show exactly what owner mode is missing.
 *
 * Export order is deterministic (bodies in creation order, colliders in
 * attach order) and C++ static ids are index-based, so re-exporting the same
 * table after `clearStaticGeometry()` hands every collider the same WASM id.
 */

import type { PhysicsRotation, PhysicsVector } from '../../core/physics-api'
import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import { WasmVolumeShape } from '../../wasm/physics-module-adventure'
import { STATIC_HANDLE_OVERFLOW } from '../../wasm/wasm-types'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import { composePose, type Pose } from './adventure-kinematics'
import { unpackCollisionGroups, type WasmBody, type WasmCollider } from '../../wasm/wasm-body'
import { TABLE_DEFAULT_COLLISION_GROUPS } from '../../wasm/wasm-physics-api'
import { volumeOf } from '../../wasm/wasm-table-world'

/** One table collider living in C++ as a kinematic mover. */
export interface TableMover {
  moverId: number
  body: WasmBody
  /** Collider pose inside its body. */
  local: Pose
}

export interface UnsupportedTableCollider {
  bodyHandle: number
  colliderIndex: number
  shape: string
  reason: string
}

export interface TableExportResult {
  /** WASM public ids per body, in collider order (colliders C++ refused are absent). */
  idsByBody: Map<WasmBody, number[]>
  /** Reverse maps for contact resolution and in-place group updates. */
  bodyById: Map<number, WasmBody>
  colliderById: Map<number, WasmCollider>
  movers: TableMover[]
  unsupported: UnsupportedTableCollider[]
  debug: WasmDebugCollider[]
}

const VOLUME_SHAPE = {
  box: WasmVolumeShape.Box,
  cylinder: WasmVolumeShape.Cylinder,
  sphere: WasmVolumeShape.Sphere,
} as const

function isExportedId(id: number): boolean {
  return id !== -1 && id !== STATIC_HANDLE_OVERFLOW
}

/** Collision groups the C++ id should carry: the authored word, or none while the body is disabled. */
export function exportedGroups(body: WasmBody, collider: WasmCollider): { membership: number; filter: number } | null {
  if (!body.isEnabled()) return { membership: 0, filter: 0 }
  if (collider.desc.collisionGroups === TABLE_DEFAULT_COLLISION_GROUPS) return null
  return unpackCollisionGroups(collider.desc.collisionGroups)
}

function worldPose(body: WasmBody, collider: WasmCollider): { center: PhysicsVector; rotation: PhysicsRotation; local: Pose } {
  const local: Pose = { position: { ...collider.desc.localPosition }, rotation: { ...collider.desc.localRotation } }
  const pose = composePose({ position: body.translation(), rotation: body.rotation() }, local)
  return { center: pose.position, rotation: pose.rotation, local }
}

/**
 * Export every collider of `bodies` into the C++ static scene. Linked bodies
 * (balls, flippers) already live in C++ and are skipped.
 */
export function exportTableBodiesToWasm(bodies: Iterable<WasmBody>, engine: WasmSimEngine): TableExportResult {
  const result: TableExportResult = {
    idsByBody: new Map(),
    bodyById: new Map(),
    colliderById: new Map(),
    movers: [],
    unsupported: [],
    debug: [],
  }

  for (const body of bodies) {
    if (body.link) continue
    const ids: number[] = []
    body.colliders.forEach((collider, index) => {
      const id = exportCollider(body, collider, index, engine, result)
      if (id === null) return
      ids.push(id)
      result.bodyById.set(id, body)
      result.colliderById.set(id, collider)
      const groups = exportedGroups(body, collider)
      if (groups) engine.setCollisionGroups(id, groups.membership, groups.filter)
    })
    if (ids.length > 0) result.idsByBody.set(body, ids)
  }
  return result
}

function exportCollider(
  body: WasmBody,
  collider: WasmCollider,
  index: number,
  engine: WasmSimEngine,
  result: TableExportResult,
): number | null {
  const desc = collider.desc
  const shape = desc.shape
  const refuse = (reason: string): null => {
    result.unsupported.push({ bodyHandle: body.handle, colliderIndex: index, shape: shape.kind, reason })
    return null
  }
  const accept = (id: number): number | null => (isExportedId(id) ? id : refuse('C++ static capacity reached'))

  if (body.isDynamic()) return refuse('dynamic body with no C++ equivalent')
  const { center, rotation, local } = worldPose(body, collider)

  if (desc.sensor) {
    const volume = volumeOf(desc)
    if (!volume) return refuse('sensor shape has no C++ volume')
    const id = accept(engine.addSensorVolume(center, volume.halfExtents, rotation, VOLUME_SHAPE[volume.kind]))
    if (id !== null) {
      result.debug.push({ kind: 'sensor', center, halfExtents: volume.halfExtents, rotation, volumeShape: volume.kind })
    }
    return id
  }

  if (body.isKinematic()) {
    if (shape.kind !== 'box' && shape.kind !== 'cylinder') return refuse('kinematic movers are box or cylinder only')
    const volume = volumeOf(desc)!
    const id = accept(engine.addKinematicMover(
      center, volume.halfExtents, rotation, desc.restitution, desc.friction, VOLUME_SHAPE[volume.kind],
    ))
    if (id !== null) {
      result.movers.push({ moverId: id, body, local })
      result.debug.push(shape.kind === 'box'
        ? { kind: 'box', center, halfExtents: volume.halfExtents, rotation }
        : { kind: 'cylinder', center, radius: shape.radius, halfHeight: shape.halfHeight, rotation })
    }
    return id
  }

  switch (shape.kind) {
    case 'box': {
      const id = accept(engine.addStaticBox(center, shape.halfExtents, rotation, desc.restitution, desc.friction))
      if (id !== null) result.debug.push({ kind: 'box', center, halfExtents: { ...shape.halfExtents }, rotation })
      return id
    }
    case 'capsule': {
      const id = accept(engine.addStaticCapsule(center, shape.radius, shape.halfHeight, rotation, desc.restitution, desc.friction))
      if (id !== null) result.debug.push({ kind: 'capsule', center, radius: shape.radius, halfHeight: shape.halfHeight, rotation })
      return id
    }
    case 'cylinder': {
      const id = accept(engine.addStaticCylinder(center, shape.radius, shape.halfHeight, rotation, desc.restitution, desc.friction))
      if (id !== null) result.debug.push({ kind: 'cylinder', center, radius: shape.radius, halfHeight: shape.halfHeight, rotation })
      return id
    }
    case 'sphere': {
      const id = accept(engine.addStaticSphere(center, shape.radius, desc.restitution, desc.friction))
      if (id !== null) result.debug.push({ kind: 'sphere', center, radius: shape.radius })
      return id
    }
    case 'cone':
      return refuse('the C++ world has no cone shape')
    case 'convexHull':
      return refuse('the C++ world has no convex hull shape')
  }
}

/** Push each table mover's pose for this tick (the body's kinematic target, else its pose). */
export function driveTableMovers(movers: readonly TableMover[], engine: WasmSimEngine): void {
  for (const mover of movers) {
    const pose = composePose(
      { position: mover.body.nextTranslation(), rotation: mover.body.nextRotation() },
      mover.local,
    )
    engine.setNextKinematicTransform(mover.moverId, pose.position, pose.rotation)
  }
}
