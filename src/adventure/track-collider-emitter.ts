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

import {
  supportsPinFields,
  type PhysicsApi,
  type PhysicsBody,
  type PhysicsColliderDesc,
  type PhysicsRigidBodyDesc,
  type PhysicsWorldSink,
} from '../core/physics-api'
import { resolvePinField } from '../core/pin-field'

import {
  descCollisionGroups,
  type AdventureColliderDesc,
} from './track-collider-descriptors'

/** A descriptor that has been realised as a Rapier body. */
export interface EmittedCollider {
  body: PhysicsBody
  /** Index of the descriptor in the emitter's list — the `parentIndex` anchor. */
  index: number
}

export class TrackColliderEmitter {
  private readonly descriptors: AdventureColliderDesc[] = []
  /** Descriptor index of each body this emitter created, for attach() lookups. */
  private readonly bodyIndex = new Map<PhysicsBody, number>()
  /** The reverse: the Rapier body a descriptor was realised as. */
  private readonly bodyByIndex = new Map<number, PhysicsBody>()

  constructor(
    private readonly world: PhysicsWorldSink,
    private readonly rapier: PhysicsApi
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
  bodyForDescriptor(index: number): PhysicsBody | null {
    const direct = this.bodyByIndex.get(index)
    if (direct) return direct
    const parentIndex = this.descriptors[index]?.parentIndex
    return parentIndex === undefined ? null : (this.bodyByIndex.get(parentIndex) ?? null)
  }

  /**
   * Tombstone every descriptor realised on `body` (its own, and any attached
   * to it) ahead of the caller removing the body from the Rapier world.
   * Returns whether anything was recorded for it.
   */
  retireBody(body: PhysicsBody): boolean {
    const index = this.bodyIndex.get(body)
    if (index === undefined) return false
    this.descriptors.forEach((desc, i) => {
      if (i === index || desc.parentIndex === index) this.descriptors[i] = { ...desc, removed: true }
    })
    this.bodyIndex.delete(body)
    this.bodyByIndex.delete(index)
    return true
  }

  /** Resolve a body this emitter created back to its descriptor anchor. */
  find(body: PhysicsBody): EmittedCollider | null {
    const index = this.bodyIndex.get(body)
    return index === undefined ? null : { body, index }
  }

  /** Record a descriptor and create its own Rapier body carrying the collider. */
  emit(desc: AdventureColliderDesc): EmittedCollider {
    if (desc.kind === 'forceField') throw new Error('force fields have no body — use emitField()')
    if (desc.kind === 'pinField') return this.emitPinField(desc)
    const index = this.descriptors.length
    this.descriptors.push(desc)

    const body: PhysicsBody = this.world.createRigidBody(
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
   * Record a body-less descriptor (a force field) and return its index. The
   * C++ exporter places it; nothing is built on a Rapier world, which has no
   * force fields — the Rapier dev path runs the track without them.
   */
  emitField(desc: AdventureColliderDesc): number {
    if (desc.kind !== 'forceField') throw new Error(`emitField() takes a forceField, not ${desc.kind}`)
    this.descriptors.push(desc)
    return this.descriptors.length - 1
  }

  /**
   * A pin lattice: ONE `pinField` collider on a world that has them (the C++
   * owner's `WasmTableWorld`), else one fixed body carrying a cylinder per
   * resolved pin — the same positions C++ collides with.
   */
  private emitPinField(desc: AdventureColliderDesc): EmittedCollider {
    const spec = desc.pinField
    if (!spec) throw new Error(`pinField descriptor ${desc.label ?? ''} carries no lattice`)
    const index = this.descriptors.length
    this.descriptors.push(desc)

    let body: PhysicsBody
    if (supportsPinFields(this.world)) {
      body = this.world.createPinField({
        ...spec,
        restitution: desc.restitution,
        friction: desc.friction,
        collisionGroups: descCollisionGroups(desc),
      })
    } else {
      body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed())
      const rotation = spec.rotation ?? desc.rotation
      for (const pin of resolvePinField(spec)) {
        const collider = this.rapier.ColliderDesc.cylinder(spec.halfHeight, spec.radius)
        collider.setFriction(desc.friction)
        collider.setRestitution(desc.restitution)
        collider.setCollisionGroups(descCollisionGroups(desc))
        collider.setTranslation(pin.position.x, pin.position.y, pin.position.z)
        collider.setRotation(rotation)
        this.world.createCollider(collider, body)
      }
    }
    this.bodyIndex.set(body, index)
    this.bodyByIndex.set(index, body)
    return { body, index }
  }

  /**
   * Record a descriptor as an extra collider on an already-emitted body. Its
   * position/rotation are body-local (the rotating platform's teeth).
   */
  attach(parent: EmittedCollider | PhysicsBody, desc: AdventureColliderDesc): void {
    const resolved = 'index' in parent ? parent : this.find(parent)
    if (!resolved) {
      // A body this emitter did not create (or a torn-down track): still
      // build the Rapier collider, but do not record an unanchored
      // descriptor the C++ exporter could not place.
      this.world.createCollider(this.colliderDesc(desc, true), parent as PhysicsBody)
      return
    }
    this.descriptors.push({ ...desc, parentIndex: resolved.index })
    this.world.createCollider(this.colliderDesc(desc, true), resolved.body)
  }

  private bodyDesc(desc: AdventureColliderDesc): PhysicsRigidBodyDesc {
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

  private colliderDesc(desc: AdventureColliderDesc, local: boolean): PhysicsColliderDesc {
    let shape: PhysicsColliderDesc
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
      case 'pinField':
      case 'forceField':
        throw new Error(`a ${desc.kind} cannot be attached to another body`)
      case 'convexMesh': {
        const hull = this.rapier.ColliderDesc.convexHull(new Float32Array(desc.vertices ?? []))
        // Only a degenerate (flat or empty) point set has no hull — a builder bug.
        if (!hull) throw new Error(`convexMesh descriptor ${desc.label ?? ''} has no convex hull`)
        shape = hull
        break
      }
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
