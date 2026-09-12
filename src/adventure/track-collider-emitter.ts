/**
 * Rapier consumer for the adventure collider descriptors (#383).
 *
 * Builders hand this emitter a descriptor; it records the descriptor on the
 * track's list and constructs the equivalent Rapier body + collider. The
 * construction is a lossless re-expression of the inline `ColliderDesc` calls
 * it replaced — descriptor defaults are Rapier's own defaults (friction 0.5,
 * restitution 0), so a shape that leaves them unset behaves identically.
 *
 * The recorded list is what `src/game/physics/wasm-adventure-export.ts` walks
 * into the C++ engine.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  descCollisionGroups,
  type AdventureColliderDesc,
} from './track-collider-descriptors'

/** A descriptor that has been realised as a Rapier body. */
export interface EmittedCollider {
  body: RAPIER.RigidBody
  /** Index of the descriptor in the emitter's list — the `parentIndex` anchor. */
  index: number
}

export class TrackColliderEmitter {
  private readonly descriptors: AdventureColliderDesc[] = []
  /** Descriptor index of each body this emitter created, for attach() lookups. */
  private readonly bodyIndex = new Map<RAPIER.RigidBody, number>()
  /** The reverse: the Rapier body a descriptor was realised as. */
  private readonly bodyByIndex = new Map<number, RAPIER.RigidBody>()

  constructor(
    private readonly world: RAPIER.World,
    private readonly rapier: typeof RAPIER
  ) {}

  /** Descriptors recorded so far, in emission order. */
  list(): readonly AdventureColliderDesc[] {
    return this.descriptors
  }

  clear(): void {
    this.descriptors.length = 0
    this.bodyIndex.clear()
    this.bodyByIndex.clear()
  }

  /**
   * The Rapier body a descriptor was realised as. Attached descriptors
   * resolve to their parent's body, which is the body their collider lives on.
   */
  bodyForDescriptor(index: number): RAPIER.RigidBody | null {
    const direct = this.bodyByIndex.get(index)
    if (direct) return direct
    const parentIndex = this.descriptors[index]?.parentIndex
    return parentIndex === undefined ? null : (this.bodyByIndex.get(parentIndex) ?? null)
  }

  /** Resolve a body this emitter created back to its descriptor anchor. */
  find(body: RAPIER.RigidBody): EmittedCollider | null {
    const index = this.bodyIndex.get(body)
    return index === undefined ? null : { body, index }
  }

  /** Record a descriptor and create its own Rapier body carrying the collider. */
  emit(desc: AdventureColliderDesc): EmittedCollider {
    const index = this.descriptors.length
    this.descriptors.push(desc)

    const body: RAPIER.RigidBody = this.world.createRigidBody(
      this.bodyDesc(desc)
        .setTranslation(desc.position.x, desc.position.y, desc.position.z)
        .setRotation(desc.rotation)
    )
    if (desc.angularVelocity) {
      body.setAngvel(desc.angularVelocity, true)
    }
    this.world.createCollider(this.colliderDesc(desc, false), body)
    this.bodyIndex.set(body, index)
    this.bodyByIndex.set(index, body)

    return { body, index }
  }

  /**
   * Record a descriptor as an extra collider on an already-emitted body. Its
   * position/rotation are body-local (the rotating platform's teeth).
   */
  attach(parent: EmittedCollider | RAPIER.RigidBody, desc: AdventureColliderDesc): void {
    const resolved = 'index' in parent ? parent : this.find(parent)
    if (!resolved) {
      // A body this emitter did not create (or a torn-down track): still
      // build the Rapier collider, but do not record an unanchored
      // descriptor the C++ exporter could not place.
      this.world.createCollider(this.colliderDesc(desc, true), parent as RAPIER.RigidBody)
      return
    }
    this.descriptors.push({ ...desc, parentIndex: resolved.index })
    this.world.createCollider(this.colliderDesc(desc, true), resolved.body)
  }

  private bodyDesc(desc: AdventureColliderDesc): RAPIER.RigidBodyDesc {
    switch (desc.motion) {
      case 'kinematic-position':
        return this.rapier.RigidBodyDesc.kinematicPositionBased()
      case 'kinematic-velocity':
        return this.rapier.RigidBodyDesc.kinematicVelocityBased()
      case 'dynamic':
        return this.rapier.RigidBodyDesc.dynamic()
      default:
        return this.rapier.RigidBodyDesc.fixed()
    }
  }

  private colliderDesc(desc: AdventureColliderDesc, local: boolean): RAPIER.ColliderDesc {
    let shape: RAPIER.ColliderDesc
    switch (desc.kind) {
      case 'box': {
        const h = desc.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
        shape = this.rapier.ColliderDesc.cuboid(h.x, h.y, h.z)
        break
      }
      case 'cylinder':
        shape = this.rapier.ColliderDesc.cylinder(desc.halfHeight ?? 0.5, desc.radius ?? 0.5)
        break
      case 'sphere':
        shape = this.rapier.ColliderDesc.ball(desc.radius ?? 0.5)
        break
    }

    shape.setFriction(desc.friction)
    shape.setRestitution(desc.restitution)
    shape.setCollisionGroups(descCollisionGroups(desc))
    if (desc.sensor) shape.setSensor(true)
    if (desc.collisionEvents) shape.setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)
    if (desc.density !== undefined) shape.setDensity(desc.density)

    if (local) {
      // Attached collider: position/rotation are already parent-body-local.
      shape.setTranslation(desc.position.x, desc.position.y, desc.position.z)
      shape.setRotation(desc.rotation)
    } else {
      if (desc.localPosition) {
        shape.setTranslation(desc.localPosition.x, desc.localPosition.y, desc.localPosition.z)
      }
      if (desc.localRotation) shape.setRotation(desc.localRotation)
    }
    return shape
  }
}
