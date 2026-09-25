/**
 * WasmTableWorld — the `PhysicsWorldSink` builders author into on the C++
 * owner path (#412).
 *
 * Nothing here links Rapier. `createRigidBody` / `createCollider` record a
 * `WasmBody` and its `TableColliderDesc`s; a dynamic body whose first collider
 * is a ball becomes a C++ rigid body on the spot (balls, gold swarms,
 * multiball), so its WASM public id is the scoring identity from birth.
 * Everything else — walls, rails, pins, bumpers, lane sensors, toys, the
 * plunger, adventure tracks — stays a pose store that `WasmOwner` exports
 * (`wasm-static-export.ts`, `wasm-adventure-export.ts`).
 *
 * `WasmOwner` listens for changes: a structural edit to an exported body
 * (added, removed, moved, retyped) bumps `structureRevision` so the statics
 * get re-exported, and an enable/collision-group change is applied to the
 * already-exported ids in place.
 */

import type {
  PhysicsBody,
  PhysicsCollider,
  PhysicsColliderDesc,
  PhysicsImpulseJoint,
  PhysicsJointData,
  PhysicsRevoluteJoint,
  PhysicsRigidBodyDesc,
  PhysicsVector,
  PhysicsWorldSink,
} from '../core/physics-api'
import { PhysicsBodyType, type PinFieldWorldSink } from '../core/physics-api'
import type { PinFieldSpec } from '../core/pin-field'
import type { WasmSimEngine } from './wasm-sim-engine'
import { sphereTouchesVolume, type VolumeKind } from '../core/pose-math'
import { WasmBody, WasmCollider, type WasmBodyHost, type WasmBodyLink } from './wasm-body'
import {
  WasmColliderDesc,
  WasmJointData,
  WasmRigidBodyDesc,
  colliderMass,
  type RevoluteJointDesc,
  type TableColliderDesc,
} from './wasm-physics-api'

export interface WasmTableWorldListener {
  /** An enable or collision-group change on an exported, unlinked body. */
  groupsChanged?(body: WasmBody): void
  /** A body is about to be removed; the owner drops any C++ state it created for it. */
  bodyRemoved?(body: WasmBody): void
}

export class WasmRevoluteJoint implements PhysicsRevoluteJoint {
  motorTarget: number | null = null
  motorStiffness = 0
  motorDamping = 0

  constructor(
    readonly handle: number,
    readonly desc: RevoluteJointDesc,
    readonly limits: readonly number[] | null,
    readonly body1: WasmBody,
    readonly body2: WasmBody,
  ) {}

  configureMotorPosition(targetPos: number, stiffness: number, damping: number): void {
    // The owner drives flipper hinges itself (WasmOwner.driveFlippers); keep the
    // request so diagnostics can see what gameplay asked for.
    this.motorTarget = targetPos
    this.motorStiffness = stiffness
    this.motorDamping = damping
  }
}

function asWasmBodyDesc(desc: PhysicsRigidBodyDesc): WasmRigidBodyDesc {
  if (!(desc instanceof WasmRigidBodyDesc)) {
    throw new TypeError('WasmTableWorld.createRigidBody needs a WASM_PHYSICS_API descriptor (was a Rapier one passed?)')
  }
  return desc
}

function asWasmColliderDesc(desc: PhysicsColliderDesc): WasmColliderDesc {
  if (!(desc instanceof WasmColliderDesc)) {
    throw new TypeError('WasmTableWorld.createCollider needs a WASM_PHYSICS_API descriptor (was a Rapier one passed?)')
  }
  return desc
}

/** Collider shape as a C++ volume (sensor / overlap convention), or null. */
export function volumeOf(desc: TableColliderDesc): { kind: VolumeKind; halfExtents: PhysicsVector } | null {
  const shape = desc.shape
  switch (shape.kind) {
    case 'box':
      return { kind: 'box', halfExtents: { ...shape.halfExtents } }
    case 'cylinder':
      return { kind: 'cylinder', halfExtents: { x: shape.radius, y: shape.halfHeight, z: shape.radius } }
    case 'sphere':
      return { kind: 'sphere', halfExtents: { x: shape.radius, y: shape.radius, z: shape.radius } }
    default:
      return null
  }
}

export class WasmTableWorld implements PhysicsWorldSink, PinFieldWorldSink, WasmBodyHost {
  private readonly bodies = new Map<number, WasmBody>()
  private readonly colliders = new Map<number, WasmCollider>()
  private readonly joints = new Map<number, WasmRevoluteJoint>()
  private readonly linkedById = new Map<number, WasmBody>()
  private nextBodyHandle = 0
  private nextColliderHandle = 0
  private nextJointHandle = 0
  private gravityValue: PhysicsVector
  private listener: WasmTableWorldListener | null = null
  /** Bumped by every change that invalidates the exported static scene. */
  structureRevision = 0
  /** Bumped whenever a body gains or loses its C++ rigid body (a ball spawned or removed). */
  linkRevision = 0

  constructor(readonly engine: WasmSimEngine, gravity: PhysicsVector) {
    this.gravityValue = { ...gravity }
  }

  setListener(listener: WasmTableWorldListener | null): void {
    this.listener = listener
  }

  // ---- PhysicsWorldSink --------------------------------------------------

  get gravity(): PhysicsVector {
    return { ...this.gravityValue }
  }

  /** Adventure tracks scale gravity per track; the C++ world follows. */
  set gravity(g: PhysicsVector) {
    this.gravityValue = { x: g.x, y: g.y, z: g.z }
    this.engine.setGravity(g.x, g.y, g.z)
  }

  createRigidBody(desc: PhysicsRigidBodyDesc): WasmBody {
    const body = new WasmBody(this, this.nextBodyHandle++, asWasmBodyDesc(desc).desc)
    this.bodies.set(body.handle, body)
    return body
  }

  createCollider(desc: PhysicsColliderDesc, parent?: PhysicsBody): WasmCollider {
    const colliderDesc = asWasmColliderDesc(desc).desc
    const body = parent ? this.requireBody(parent) : this.createRigidBody(new WasmRigidBodyDesc(PhysicsBodyType.Fixed))
    const collider = new WasmCollider(this.nextColliderHandle++, body, colliderDesc)
    body.colliders.push(collider)
    this.colliders.set(collider.handle, collider)

    if (body.isDynamic() && !body.link && body.colliders.length === 1 && colliderDesc.shape.kind === 'sphere') {
      this.realizeDynamicSphere(body, collider)
    } else if (!body.link && !body.isDynamic()) {
      this.structureRevision++
    }
    return collider
  }

  /**
   * A whole pin lattice as one fixed body with one `pinField` collider (#421).
   * The owner exports it as a single `addPinField` handle; removing the body
   * (a Daily Cascade rebuild) drops the field with the rest of the statics.
   */
  createPinField(spec: PinFieldSpec): WasmBody {
    const body = this.createRigidBody(new WasmRigidBodyDesc(PhysicsBodyType.Fixed))
    const field: PinFieldSpec = {
      ...spec,
      origin: { ...spec.origin },
      rotation: spec.rotation ? { ...spec.rotation } : undefined,
      keepOuts: spec.keepOuts?.map((k) => ({ ...k })),
      occupancy: spec.occupancy?.slice(),
    }
    const desc = new WasmColliderDesc({ kind: 'pinField', field })
      .setRestitution(spec.restitution)
      .setFriction(spec.friction)
    if (spec.collisionGroups !== undefined) desc.setCollisionGroups(spec.collisionGroups)
    this.createCollider(desc, body)
    return body
  }

  removeRigidBody(body: PhysicsBody): void {
    const wasmBody = this.bodies.get(body.handle)
    if (!wasmBody || wasmBody !== body) return
    this.listener?.bodyRemoved?.(wasmBody)
    for (const joint of [...this.joints.values()]) {
      if (joint.body1 === wasmBody || joint.body2 === wasmBody) this.joints.delete(joint.handle)
    }
    const link = wasmBody.link
    if (link) {
      this.linkedById.delete(link.id)
      if (link.owned) this.engine.removeBody(link.id)
      wasmBody.detachLink()
      this.linkRevision++
    } else if (!wasmBody.isDynamic() && wasmBody.colliders.length > 0) {
      this.structureRevision++
    }
    for (const c of wasmBody.colliders) this.colliders.delete(c.handle)
    this.bodies.delete(wasmBody.handle)
    wasmBody.invalidate()
  }

  getRigidBody(handle: number): WasmBody | null {
    return this.bodies.get(handle) ?? null
  }

  getCollider(handle: number): WasmCollider | null {
    return this.colliders.get(handle) ?? null
  }

  createImpulseJoint(params: PhysicsJointData, body1: PhysicsBody, body2: PhysicsBody): PhysicsImpulseJoint {
    if (!(params instanceof WasmJointData)) {
      throw new TypeError('WasmTableWorld.createImpulseJoint needs a WASM_PHYSICS_API joint descriptor')
    }
    const joint = new WasmRevoluteJoint(
      this.nextJointHandle++,
      params.joint,
      params.limitsEnabled ? [...params.limits] : null,
      this.requireBody(body1),
      this.requireBody(body2),
    )
    this.joints.set(joint.handle, joint)
    return joint
  }

  removeImpulseJoint(joint: PhysicsImpulseJoint): void {
    this.joints.delete(joint.handle)
  }

  /**
   * Overlap test between two colliders, answered analytically (sphere against
   * box / cylinder / sphere) from the current poses — the same maths the C++
   * sensor volumes use. Anything else reports no overlap.
   */
  intersectionPair(collider1: PhysicsCollider, collider2: PhysicsCollider): boolean {
    const a = this.colliders.get(collider1.handle)
    const b = this.colliders.get(collider2.handle)
    if (!a || !b || !a.body.isEnabled() || !b.body.isEnabled()) return false
    const [sphere, other] = a.desc.shape.kind === 'sphere' ? [a, b] : [b, a]
    if (sphere.desc.shape.kind !== 'sphere') return false
    const volume = volumeOf(other.desc)
    if (!volume) return false
    return sphereTouchesVolume(sphere.translation(), sphere.desc.shape.radius, volume.kind, volume.halfExtents, {
      position: other.translation(),
      rotation: other.rotation(),
    })
  }

  // ---- WasmBodyHost ------------------------------------------------------

  bodyChanged(body: WasmBody, change: 'structure' | 'groups'): void {
    if (change === 'structure') {
      if (body.colliders.length > 0) this.structureRevision++
      return
    }
    this.listener?.groupsChanged?.(body)
  }

  // ---- Owner / controller surface ---------------------------------------

  /** Live bodies in creation order. */
  allBodies(): WasmBody[] {
    return [...this.bodies.values()]
  }

  allJoints(): WasmRevoluteJoint[] {
    return [...this.joints.values()]
  }

  /** The body backed by a C++ rigid body with this WASM public id. */
  bodyForLinkedId(id: number): WasmBody | null {
    return this.linkedById.get(id) ?? null
  }

  /** Bind a body to a C++ rigid body the owner created (flipper hinges). */
  linkBody(body: WasmBody, link: WasmBodyLink): void {
    if (body.link) this.linkedById.delete(body.link.id)
    body.attachLink(link)
    this.linkedById.set(link.id, body)
    this.linkRevision++
  }

  unlinkBody(body: WasmBody): void {
    if (!body.link) return
    this.linkedById.delete(body.link.id)
    body.detachLink()
    this.linkRevision++
  }

  /** After the C++ step: kinematic pose stores arrive at their targets. */
  endStep(): void {
    for (const body of this.bodies.values()) {
      if (!body.link && body.isKinematic()) body.commitKinematicStep()
    }
  }

  /** Remove every C++ body this world created. */
  dispose(): void {
    for (const body of [...this.bodies.values()]) this.removeRigidBody(body)
    this.listener = null
  }

  private requireBody(body: PhysicsBody): WasmBody {
    const wasmBody = this.bodies.get(body.handle)
    if (!wasmBody || wasmBody !== body) {
      throw new TypeError(`WasmTableWorld: body ${body.handle} does not belong to this world`)
    }
    return wasmBody
  }

  private realizeDynamicSphere(body: WasmBody, collider: WasmCollider): void {
    const shape = collider.desc.shape
    if (shape.kind !== 'sphere') return
    const d = body.desc
    const t = body.translation()
    const v = body.linvel()
    const mass = colliderMass(collider.desc)
    const id = this.engine.createBody({
      position: t,
      velocity: v,
      mass,
      radius: shape.radius,
      restitution: collider.desc.restitution,
      friction: collider.desc.friction,
      linearDamping: d.linearDamping,
      angularDamping: d.angularDamping,
      bodyType: 0,
    })
    if (id < 0) return
    this.linkBody(body, { id, owned: true, mass })
    const w = d.angvel
    if (w.x !== 0 || w.y !== 0 || w.z !== 0) this.engine.setAngularVelocity(id, w.x, w.y, w.z)
  }
}
