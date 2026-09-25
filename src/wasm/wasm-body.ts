/**
 * `PhysicsBody` / `PhysicsCollider` for the C++ owner path (#412).
 *
 * A `WasmBody` is the game-wide identity token on `wasm-owner` /
 * `wasm-worker`, in place of the disabled Rapier puppet it replaces. Two kinds:
 *
 *   - **Linked** bodies are backed by a C++ rigid body (`link.id` is its WASM
 *     public id): balls, realised by `WasmTableWorld` the moment their sphere
 *     collider is attached, and flippers, realised by `WasmOwner` as hinged
 *     capsules. Reads come from the engine; writes go straight to it.
 *   - **Unlinked** bodies (fixed, kinematic, and dynamic shapes C++ has no
 *     body for) are pose stores. `WasmOwner` exports their colliders as C++
 *     statics, sensor volumes and kinematic movers (`wasm-static-export.ts`).
 *
 * A linked body's Rapier type maps onto the C++ body type (#420): a toy
 * making a captured ball `KinematicPositionBased` flips the C++ body to
 * `Kinematic` (infinite mass, no gravity) and its `setNextKinematic*` targets
 * become C++ pose targets, committed by the next step with the pose delta as
 * velocity; back to `Dynamic` restores the mass and keeps that velocity. A
 * disabled body is frozen the same way and also leaves every collision
 * group. Hinged flippers (a `pivot` link) are never retyped — disabling one
 * only drops its groups.
 */

import {
  PhysicsBodyType,
  type PhysicsBody,
  type PhysicsBodyTypeValue,
  type PhysicsCollider,
  type PhysicsRotation,
  type PhysicsVector,
} from '../core/physics-api'
import type { WasmSimEngine } from './wasm-sim-engine'
import { WasmBodyType } from './physics-module-adventure'
import { quatMul, quatRotateVec } from '../core/pose-math'
import { colliderMass, type TableBodyDesc, type TableColliderDesc } from './wasm-physics-api'

export interface WasmBodyLink {
  /** WASM public id of the backing C++ rigid body. */
  readonly id: number
  /**
   * Point `translation()` reports instead of the C++ centre of mass. A hinged
   * flipper reports its pivot, exactly as its Rapier body's origin did.
   */
  readonly pivot?: PhysicsVector
  /** Authored body frame = C++ rotation × this (e.g. capsule axis → blade axis). */
  readonly rotationOffset?: PhysicsRotation
  /** Mass the C++ body was created with (impulses change its velocity by J / mass at once). */
  readonly mass: number
  /** The world created the C++ body and removes it with the WasmBody. */
  readonly owned: boolean
}

/** What a body needs from its world. Implemented by `WasmTableWorld`. */
export interface WasmBodyHost {
  readonly engine: WasmSimEngine
  bodyChanged(body: WasmBody, change: 'structure' | 'groups'): void
}

function copyVec(v: PhysicsVector): PhysicsVector {
  return { x: v.x, y: v.y, z: v.z }
}

function copyRot(q: PhysicsRotation): PhysicsRotation {
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

function conjugate(q: PhysicsRotation): PhysicsRotation {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

const ZERO: PhysicsVector = { x: 0, y: 0, z: 0 }

/** C++'s default group word (`COLLISION_GROUPS_ALL`): member of, and interacting with, everything. */
export const CPP_ALL_GROUPS = 0xffffffff

/** Split Rapier's packed group word into the C++ membership/filter pair. */
export function unpackCollisionGroups(groups: number): { membership: number; filter: number } {
  return { membership: (groups >>> 16) & 0xffff, filter: groups & 0xffff }
}

export class WasmCollider implements PhysicsCollider {
  constructor(
    readonly handle: number,
    readonly body: WasmBody,
    readonly desc: TableColliderDesc,
  ) {}

  parent(): WasmBody | null {
    return this.body.isValid() ? this.body : null
  }

  /** World-space centre: body pose ∘ local offset (what Rapier's `Collider.translation()` returns). */
  translation(): PhysicsVector {
    const t = this.body.translation()
    const offset = quatRotateVec(this.body.rotation(), this.desc.localPosition)
    return { x: t.x + offset.x, y: t.y + offset.y, z: t.z + offset.z }
  }

  rotation(): PhysicsRotation {
    return quatMul(this.body.rotation(), this.desc.localRotation)
  }

  isSensor(): boolean {
    return this.desc.sensor
  }

  collisionGroups(): number {
    return this.desc.collisionGroups
  }

  setCollisionGroups(groups: number): void {
    this.desc.collisionGroups = groups >>> 0
    this.body.collisionGroupsChanged()
  }

  setRestitutionCombineRule(rule: number): void {
    this.desc.restitutionCombineRule = rule
  }
}

export class WasmBody implements PhysicsBody {
  readonly colliders: WasmCollider[] = []
  link: WasmBodyLink | null = null

  private type: PhysicsBodyTypeValue
  private valid = true
  private enabled = true
  private pose: { translation: PhysicsVector; rotation: PhysicsRotation }
  private next: { translation: PhysicsVector | null; rotation: PhysicsRotation | null } = {
    translation: null,
    rotation: null,
  }
  /** Velocities of an unlinked body (Rapier keeps them even when nothing integrates them). */
  private storedLinvel: PhysicsVector
  private storedAngvel: PhysicsVector
  /** Linked-body values written since the engine last stepped (its transform snapshot is stale until then). */
  private written: {
    atStep: number
    translation?: PhysicsVector
    rotation?: PhysicsRotation
    linvel?: PhysicsVector
    angvel?: PhysicsVector
  } = { atStep: -1 }
  /** Linked bodies only: the C++ body type last sent (C++ bodies are born Dynamic). */
  private cppType: WasmBodyType = WasmBodyType.Dynamic
  /**
   * Linked kinematic bodies only: the pose most recently sent as a C++ target
   * (authored frame). Rapier takes translation and rotation targets
   * separately; C++ takes a whole pose, so each push completes the other half
   * from here.
   */
  private kinematicTarget: { translation: PhysicsVector; rotation: PhysicsRotation } | null = null

  constructor(
    private readonly host: WasmBodyHost,
    readonly handle: number,
    readonly desc: TableBodyDesc,
  ) {
    this.type = desc.type
    this.pose = { translation: copyVec(desc.translation), rotation: copyRot(desc.rotation) }
    this.storedLinvel = copyVec(desc.linvel)
    this.storedAngvel = copyVec(desc.angvel)
  }

  // ---- Identity ---------------------------------------------------------

  isValid(): boolean {
    return this.valid
  }

  /** WASM public id of the backing C++ body, or null for pose-store bodies. */
  get wasmId(): number | null {
    return this.link?.id ?? null
  }

  /** @internal WasmTableWorld only. */
  invalidate(): void {
    this.valid = false
  }

  // ---- Pose reads -------------------------------------------------------

  translation(): PhysicsVector {
    const link = this.link
    if (!link) return copyVec(this.pose.translation)
    if (link.pivot) return copyVec(link.pivot)
    // A driven kinematic body is where its last target sends it — the worker's
    // snapshot can trail by a frame, and a toy steering from `translation()`
    // would otherwise crawl at half speed.
    if (this.kinematicTarget) return copyVec(this.kinematicTarget.translation)
    const w = this.freshWrites()
    if (w?.translation) return copyVec(w.translation)
    if (!this.host.engine.hasTransformSnapshot()) return copyVec(this.pose.translation)
    return this.host.engine.getPosition(link.id)
  }

  rotation(): PhysicsRotation {
    const link = this.link
    if (!link) return copyRot(this.pose.rotation)
    if (this.kinematicTarget) return copyRot(this.kinematicTarget.rotation)
    const w = this.freshWrites()
    if (w?.rotation) return copyRot(w.rotation)
    if (!this.host.engine.hasTransformSnapshot()) return copyRot(this.pose.rotation)
    const rot = this.host.engine.getRotation(link.id)
    return link.rotationOffset ? quatMul(rot, link.rotationOffset) : rot
  }

  nextTranslation(): PhysicsVector {
    if (!this.link && this.next.translation) return copyVec(this.next.translation)
    return this.translation()
  }

  nextRotation(): PhysicsRotation {
    if (!this.link && this.next.rotation) return copyRot(this.next.rotation)
    return this.rotation()
  }

  linvel(): PhysicsVector {
    const link = this.link
    if (!link) return copyVec(this.storedLinvel)
    if (!this.enabled) return copyVec(ZERO)
    const w = this.freshWrites()
    if (w?.linvel) return copyVec(w.linvel)
    if (!this.host.engine.hasTransformSnapshot()) return copyVec(this.storedLinvel)
    return this.host.engine.getVelocity(link.id)
  }

  angvel(): PhysicsVector {
    const link = this.link
    if (!link) return copyVec(this.storedAngvel)
    if (!this.enabled) return copyVec(ZERO)
    const w = this.freshWrites()
    if (w?.angvel) return copyVec(w.angvel)
    if (!this.host.engine.hasTransformSnapshot()) return copyVec(this.storedAngvel)
    return this.host.engine.getAngularVelocity(link.id)
  }

  mass(): number {
    let total = 0
    for (const c of this.colliders) total += colliderMass(c.desc)
    return total
  }

  // ---- Pose writes ------------------------------------------------------

  setTranslation(translation: PhysicsVector, _wakeUp: boolean): void {
    const t = copyVec(translation)
    this.pose.translation = t
    this.next.translation = null
    const link = this.link
    if (!link) {
      if (this.type === PhysicsBodyType.Fixed) this.host.bodyChanged(this, 'structure')
      return
    }
    if (link.pivot) return
    // A teleport also resets where a kinematic target would continue from.
    if (this.kinematicTarget) this.kinematicTarget.translation = copyVec(t)
    this.host.engine.setBodyPosition(link.id, t.x, t.y, t.z)
    this.write({ translation: t })
  }

  setRotation(rotation: PhysicsRotation, _wakeUp: boolean): void {
    const r = copyRot(rotation)
    this.pose.rotation = r
    this.next.rotation = null
    const link = this.link
    if (!link) {
      if (this.type === PhysicsBodyType.Fixed) this.host.bodyChanged(this, 'structure')
      return
    }
    if (this.kinematicTarget) this.kinematicTarget.rotation = copyRot(r)
    const cpp = this.toCppRotation(r)
    this.host.engine.setBodyRotation(link.id, cpp.x, cpp.y, cpp.z, cpp.w)
    this.write({ rotation: r })
  }

  setLinvel(linvel: PhysicsVector, _wakeUp: boolean): void {
    const v = copyVec(linvel)
    const link = this.link
    if (!link) {
      if (this.type === PhysicsBodyType.Dynamic) this.storedLinvel = v
      return
    }
    // Rapier ignores velocity writes on a kinematic-position body (its targets
    // set the velocity); a disabled body stays frozen.
    if (this.isFrozen()) return
    this.host.engine.setVelocity(link.id, v.x, v.y, v.z)
    this.write({ linvel: v })
  }

  setAngvel(angvel: PhysicsVector, _wakeUp: boolean): void {
    const v = copyVec(angvel)
    const link = this.link
    if (!link) {
      // Kinematic-velocity bodies keep their prescribed spin (adventure platters read it back).
      this.storedAngvel = v
      return
    }
    if (this.isFrozen()) return
    this.host.engine.setAngularVelocity(link.id, v.x, v.y, v.z)
    this.write({ angvel: v })
  }

  setNextKinematicTranslation(translation: PhysicsVector): void {
    const t = copyVec(translation)
    if (!this.link) {
      if (this.isKinematic()) this.next.translation = t
      return
    }
    this.pushKinematicTarget(t, null)
  }

  setNextKinematicRotation(rotation: PhysicsRotation): void {
    const r = copyRot(rotation)
    if (!this.link) {
      if (this.isKinematic()) this.next.rotation = r
      return
    }
    this.pushKinematicTarget(null, r)
  }

  applyImpulse(impulse: PhysicsVector, _wakeUp: boolean): void {
    const link = this.link
    if (!link) {
      if (this.type !== PhysicsBodyType.Dynamic) return
      const m = this.mass()
      if (m <= 0) return
      this.storedLinvel = {
        x: this.storedLinvel.x + impulse.x / m,
        y: this.storedLinvel.y + impulse.y / m,
        z: this.storedLinvel.z + impulse.z / m,
      }
      return
    }
    // Rapier drops impulses on kinematic bodies, and C++ has no mass to push while frozen.
    if (this.isFrozen()) return
    // C++ changes the velocity at once (v += J / m) but its transform snapshot only
    // refreshes on the next step, so remember the result — Rapier reads it back immediately too.
    const v = this.linvel()
    this.host.engine.applyImpulse(link.id, impulse.x, impulse.y, impulse.z)
    if (link.mass > 0) {
      this.write({
        linvel: { x: v.x + impulse.x / link.mass, y: v.y + impulse.y / link.mass, z: v.z + impulse.z / link.mass },
      })
    }
  }

  // ---- Type / enable ----------------------------------------------------

  bodyType(): number {
    return this.type
  }

  setBodyType(type: number, _wakeUp: boolean): void {
    const next = type as PhysicsBodyTypeValue
    if (next === this.type) return
    this.type = next
    if (!this.link) {
      this.host.bodyChanged(this, 'structure')
      return
    }
    this.syncCppType()
  }

  isFixed(): boolean {
    return this.type === PhysicsBodyType.Fixed
  }

  isKinematic(): boolean {
    return this.type === PhysicsBodyType.KinematicPositionBased || this.type === PhysicsBodyType.KinematicVelocityBased
  }

  isDynamic(): boolean {
    return this.type === PhysicsBodyType.Dynamic
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (this.link) {
      this.applyLinkedCollisionGroups()
      this.syncCppType()
    }
    this.host.bodyChanged(this, 'groups')
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isSleeping(): boolean {
    return false
  }

  wakeUp(): void {
    // The C++ world wakes bodies on contact and on every write; nothing to do.
  }

  // ---- Colliders --------------------------------------------------------

  numColliders(): number {
    return this.colliders.length
  }

  collider(index: number): WasmCollider {
    const c = this.colliders[index]
    if (!c) throw new RangeError(`WasmBody ${this.handle} has no collider ${index}`)
    return c
  }

  /** @internal WasmCollider only. Linked bodies keep C++'s default groups; see applyLinkedCollisionGroups. */
  collisionGroupsChanged(): void {
    if (!this.link) this.host.bodyChanged(this, 'groups')
  }

  // ---- Stepping (WasmTableWorld) -----------------------------------------

  /** @internal After a step a kinematic pose store sits at the pose it was sent to (Rapier semantics). */
  commitKinematicStep(): void {
    if (this.link) return
    if (this.next.translation) this.pose.translation = this.next.translation
    if (this.next.rotation) this.pose.rotation = this.next.rotation
    this.next = { translation: null, rotation: null }
  }

  /** @internal Bind this body to a C++ rigid body (born Dynamic). */
  attachLink(link: WasmBodyLink): void {
    this.link = link
    this.written = { atStep: -1 }
    this.cppType = WasmBodyType.Dynamic
    this.kinematicTarget = null
    if (!this.enabled) this.applyLinkedCollisionGroups()
    this.syncCppType()
  }

  /** @internal Drop the C++ binding (the owner removed its body). */
  detachLink(): void {
    if (this.link) {
      this.pose.translation = this.translation()
      this.pose.rotation = this.rotation()
    }
    this.link = null
    this.cppType = WasmBodyType.Dynamic
    this.kinematicTarget = null
  }

  /** Linked and currently kinematic in C++ (a toy holds it, or it is disabled). */
  isFrozen(): boolean {
    return this.link !== null && (this.cppType !== WasmBodyType.Dynamic || !this.enabled)
  }

  /** The C++ body type this body's Rapier type and enable flag call for. */
  private wantedCppType(): WasmBodyType {
    if (this.link?.pivot) return WasmBodyType.Dynamic
    return this.isDynamic() && this.enabled ? WasmBodyType.Dynamic : WasmBodyType.Kinematic
  }

  private syncCppType(): void {
    const link = this.link
    if (!link) return
    const wanted = this.wantedCppType()
    if (wanted === this.cppType) return
    this.cppType = wanted
    this.host.engine.setBodyType(link.id, wanted)
    if (wanted === WasmBodyType.Kinematic) {
      // C++ stops the body dead; it moves again only by its targets.
      this.write({ linvel: copyVec(ZERO), angvel: copyVec(ZERO) })
    } else {
      // C++ keeps the last kinematic velocity, so a release carries the well's motion.
      this.kinematicTarget = null
    }
  }

  /** Send a C++ pose target, completing whichever half Rapier left out. */
  private pushKinematicTarget(translation: PhysicsVector | null, rotation: PhysicsRotation | null): void {
    const link = this.link
    if (!link || link.pivot || !this.isKinematic() || !this.enabled) return
    const t = translation ?? this.translation()
    const r = rotation ?? this.rotation()
    this.kinematicTarget = { translation: copyVec(t), rotation: copyRot(r) }
    this.host.engine.setNextKinematicTransform(link.id, t, this.toCppRotation(r))
  }

  private toCppRotation(r: PhysicsRotation): PhysicsRotation {
    const offset = this.link?.rotationOffset
    return offset ? quatMul(r, conjugate(offset)) : r
  }

  /**
   * A linked body sits on C++'s all-groups default while enabled — what the
   * owner path has always simulated — and on no groups while disabled. The
   * authored group word stays on the collider for readers but is not
   * forwarded: the adventure chroma masks (`MASK_RED` …) omit
   * `ADVENTURE_GROUP`, so a coloured ball would drop through ordinary track
   * geometry. Forwarding waits on those masks being fixed.
   */
  private applyLinkedCollisionGroups(): void {
    const link = this.link
    if (!link) return
    const groups = this.enabled ? CPP_ALL_GROUPS : 0
    this.host.engine.setCollisionGroups(link.id, groups, groups)
  }

  private write(values: Omit<WasmBody['written'], 'atStep'>): void {
    const step = this.host.engine.getStepCount()
    if (this.written.atStep !== step) this.written = { atStep: step }
    Object.assign(this.written, values)
  }

  private freshWrites(): WasmBody['written'] | null {
    return this.written.atStep === this.host.engine.getStepCount() ? this.written : null
  }
}
