import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { WasmPhysicsEngine } from '../../wasm'

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
  engine: WasmPhysicsEngine,
  options: StaticExportOptions = {}
): void {
  if (!body.isFixed() && !body.isKinematic()) return

  const skipSensors = options.skipSensors ?? true
  const defaultRestitution = options.defaultRestitution ?? 0.4

  for (let i = 0; i < body.numColliders(); i++) {
    const collider = body.collider(i)
    if (skipSensors && collider.isSensor()) continue

    const pos = collider.translation()
    const rot = collider.rotation()
    const restitution = collider.restitution() ?? defaultRestitution

    switch (collider.shapeType()) {
      case RapierShapeType.Ball: {
        engine.createBody({
          position: { x: pos.x, y: pos.y, z: pos.z },
          velocity: { x: 0, y: 0, z: 0 },
          mass: 0,
          radius: collider.radius(),
          restitution,
          linearDamping: 0,
          bodyType: 1,
        })
        break
      }
      case RapierShapeType.Cuboid: {
        const half = collider.halfExtents()
        engine.addStaticBox(
          { x: pos.x, y: pos.y, z: pos.z },
          { x: half.x, y: half.y, z: half.z },
          { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
          restitution
        )
        break
      }
      case RapierShapeType.Capsule: {
        engine.addStaticCapsule(
          { x: pos.x, y: pos.y, z: pos.z },
          collider.radius(),
          collider.halfHeight(),
          { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
          restitution
        )
        break
      }
      default:
        // Unsupported shapes (tri-mesh, convex hull) — skip for now.
        break
    }
  }
}
