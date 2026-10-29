/**
 * Zone sensors — the physics-side home of every `ZoneTriggerSystem` zone.
 *
 * A zone is a fixed, box-shaped sensor body on `CollisionGroups.SENSOR` (member
 * of the sensor group, filtered to the ball group), authored through
 * `PhysicsApi` / `PhysicsWorldSink` like any other table collider. On the owner
 * and worker paths the table export turns it into a C++ `SensorVolume`; there
 * the engine sweeps balls against it and reports begin / end contacts, which
 * `CollisionDispatcher` hands to `ZoneTriggerSystem`. Nothing here reads a ball
 * position.
 *
 * Adventure exit portals are not authored here: their cylinder sensor already
 * exists as an adventure body (on `ADVENTURE_GROUP`, filtered to the ball), so
 * `adopt` only maps that body to its zone. Table zones never join
 * `ADVENTURE_GROUP`.
 */

import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
import { COLLISION_GROUP_PRESETS } from './physics'
import { ZONE_MAX_Y, ZONE_MIN_Y, type ZoneBounds, type ZoneSensorSink } from './zone-trigger-system'

/** A box never gets thinner than this, so a degenerate zone still has a volume. */
const MIN_HALF_EXTENT = 0.01

export class ZoneSensors implements ZoneSensorSink {
  private readonly world: PhysicsWorldSink
  private readonly api: PhysicsApi
  /** Bodies this registry created (and so removes), by zone id. */
  private readonly authored = new Map<string, PhysicsBody>()
  private readonly zoneByHandle = new Map<number, string>()
  private readonly handleByZone = new Map<string, number>()

  constructor(world: PhysicsWorldSink, api: PhysicsApi) {
    this.world = world
    this.api = api
  }

  author(id: string, bounds: ZoneBounds): void {
    this.release(id)

    const minY = bounds.minY ?? ZONE_MIN_Y
    const maxY = bounds.maxY ?? ZONE_MAX_Y
    const body = this.world.createRigidBody(
      this.api.RigidBodyDesc.fixed().setTranslation(
        (bounds.minX + bounds.maxX) / 2,
        (minY + maxY) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
      ),
    )
    this.world.createCollider(
      this.api.ColliderDesc.cuboid(
        Math.max(MIN_HALF_EXTENT, (bounds.maxX - bounds.minX) / 2),
        Math.max(MIN_HALF_EXTENT, (maxY - minY) / 2),
        Math.max(MIN_HALF_EXTENT, (bounds.maxZ - bounds.minZ) / 2),
      )
        .setSensor(true)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
        .setActiveEvents(this.api.ActiveEvents.COLLISION_EVENTS),
      body,
    )

    this.authored.set(id, body)
    this.bind(id, body.handle)
  }

  adopt(id: string, bodyHandle: number): void {
    this.release(id)
    this.bind(id, bodyHandle)
  }

  release(id: string): void {
    const handle = this.handleByZone.get(id)
    if (handle !== undefined) {
      this.zoneByHandle.delete(handle)
      this.handleByZone.delete(id)
    }
    const body = this.authored.get(id)
    if (body) {
      this.authored.delete(id)
      if (this.world.getRigidBody(body.handle)) this.world.removeRigidBody(body)
    }
  }

  zoneIdOf(bodyHandle: number): string | null {
    return this.zoneByHandle.get(bodyHandle) ?? null
  }

  bodies(): readonly PhysicsBody[] {
    return [...this.authored.values()]
  }

  dispose(): void {
    for (const id of [...this.handleByZone.keys()]) this.release(id)
  }

  private bind(id: string, handle: number): void {
    this.zoneByHandle.set(handle, id)
    this.handleByZone.set(id, handle)
  }
}
