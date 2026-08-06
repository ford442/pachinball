/**
 * Lane rollover sensors — thin Rapier-only sensor cuboids on launch lane,
 * inlanes/outlanes, and drain approach. Scoring is handled by CollisionDispatcher
 * via body-handle lookup (see collision-dispatch.ts).
 *
 * WASM note: sensors are not mirrored to the WASM physics engine until Phase 2
 * geometry lands; lane points accrue on the Rapier collision path only.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig, type LaneRolloverKind } from '../config'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'

export interface LaneSensorDef {
  id: string
  kind: LaneRolloverKind
  body: RAPIER.RigidBody
  position: { x: number; y: number; z: number }
}

export class LaneSensorBuilder {
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private sensors: LaneSensorDef[] = []
  private bodies: RAPIER.RigidBody[] = []

  constructor(world: RAPIER.World, rapier: typeof RAPIER) {
    this.world = world
    this.rapier = rapier
  }

  createLaneSensors(): { sensors: LaneSensorDef[] } {
    for (const entry of GameConfig.table.laneSensors) {
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(
          entry.position.x,
          entry.position.y,
          entry.position.z,
        ),
      )

      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(
          entry.halfExtents.x,
          entry.halfExtents.y,
          entry.halfExtents.z,
        )
          .setSensor(true)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body,
      )

      const sensor: LaneSensorDef = {
        id: entry.id,
        kind: entry.kind,
        body,
        position: { ...entry.position },
      }
      this.sensors.push(sensor)
      this.bodies.push(body)
    }

    return { sensors: this.sensors }
  }

  getSensors(): LaneSensorDef[] {
    return this.sensors
  }

  getBodies(): RAPIER.RigidBody[] {
    return this.bodies
  }

  dispose(): void {
    for (const body of this.bodies) {
      if (this.world.getRigidBody(body.handle)) {
        this.world.removeRigidBody(body)
      }
    }
    this.bodies = []
    this.sensors = []
  }
}
