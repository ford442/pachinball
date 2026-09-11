import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import type { WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'

/** Mirrors `ShapeType` without importing Rapier values (keeps Vitest node-safe). */
const RapierShapeType = {
  Ball: 0,
  Cuboid: 1,
  Capsule: 2,
} as const

export interface StaticExportOptions {
  /** Skip sensor colliders (death zones, portals, etc.). */
  skipSensors?: boolean
  /** Default restitution when Rapier does not expose one. */
  defaultRestitution?: number
}

/**
 * Export a Rapier fixed/kinematic body's colliders into the WASM static scene.
 * Supports balls (as static spheres), cuboids, and capsules.
 */
export function exportRapierBodyToWasm(
  body: RAPIER.RigidBody,
  engine: WasmSimEngine,
  options: StaticExportOptions = {}
): WasmDebugCollider[] {
  if (!body.isFixed() && !body.isKinematic()) return []

  const skipSensors = options.skipSensors ?? true
  const defaultRestitution = options.defaultRestitution ?? 0.4
  const debug: WasmDebugCollider[] = []

  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i)
    if (skipSensors && collider.isSensor()) continue

    const pos = collider.translation()
    const rot = collider.rotation()
    const restitution = collider.restitution() ?? defaultRestitution
    const friction = typeof collider.friction === 'function' ? collider.friction() : 0.2
    const center = { x: pos.x, y: pos.y, z: pos.z }
    const rotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w }

    switch (collider.shapeType()) {
      case RapierShapeType.Ball: {
        const radius = collider.radius()
        engine.createBody({
          position: center,
          velocity: { x: 0, y: 0, z: 0 },
          mass: 0,
          radius,
          restitution,
          friction,
          linearDamping: 0,
          bodyType: 1,
        })
        debug.push({ kind: 'sphere', center, radius })
        break
      }
      case RapierShapeType.Cuboid: {
        const half = collider.halfExtents()
        const halfExtents = { x: half.x, y: half.y, z: half.z }
        engine.addStaticBox(
          center,
          halfExtents,
          rotation,
          restitution,
          friction
        )
        debug.push({ kind: 'box', center, halfExtents, rotation })
        break
      }
      case RapierShapeType.Capsule: {
        const radius = collider.radius()
        const halfHeight = collider.halfHeight()
        engine.addStaticCapsule(
          center,
          radius,
          halfHeight,
          rotation,
          restitution,
          friction
        )
        debug.push({ kind: 'capsule', center, radius, halfHeight, rotation })
        break
      }
      default:
        break
    }
  }
  return debug
}
