/**
 * Narrow physics authoring surface (#412).
 *
 * Every table object, ball, toy and adventure track builds its colliders
 * through these interfaces instead of `@dimforge/rapier3d-compat` types. Two
 * implementations satisfy them:
 *
 *   - Rapier itself (`typeof RAPIER` / `RAPIER.World` / `RAPIER.RigidBody`),
 *     structurally — the explicit `rapier` / `wasm-mirror` modes and the
 *     fail-closed degrade path hand the real library straight through.
 *   - The C++ owner path (`src/wasm/wasm-physics-api.ts` +
 *     `wasm-table-world.ts`), whose builders record `TableColliderDesc`s and
 *     whose bodies are keyed on WASM public ids.
 *
 * Keep these interfaces to what the game actually calls: every member added
 * here is one more thing the WASM world has to implement. Nothing in this file
 * may import a Rapier *value*.
 */

export interface PhysicsVector {
  x: number
  y: number
  z: number
}

export interface PhysicsRotation {
  x: number
  y: number
  z: number
  w: number
}

/** Numeric values match Rapier's `RigidBodyType` enum. */
export const PhysicsBodyType = {
  Dynamic: 0,
  Fixed: 1,
  KinematicPositionBased: 2,
  KinematicVelocityBased: 3,
} as const
export type PhysicsBodyTypeValue = (typeof PhysicsBodyType)[keyof typeof PhysicsBodyType]

/** Numeric values match Rapier's `ActiveEvents` flags. */
export const PhysicsActiveEvents = {
  NONE: 0,
  COLLISION_EVENTS: 1,
  CONTACT_FORCE_EVENTS: 2,
} as const

/** Numeric values match Rapier's `CoefficientCombineRule` enum. */
export const PhysicsCombineRule = {
  Average: 0,
  Min: 1,
  Multiply: 2,
  Max: 3,
} as const

export interface PhysicsRigidBodyDesc {
  setTranslation(x: number, y: number, z: number): PhysicsRigidBodyDesc
  setRotation(rot: PhysicsRotation): PhysicsRigidBodyDesc
  setLinvel(x: number, y: number, z: number): PhysicsRigidBodyDesc
  setAngvel(vel: PhysicsVector): PhysicsRigidBodyDesc
  setLinearDamping(damping: number): PhysicsRigidBodyDesc
  setAngularDamping(damping: number): PhysicsRigidBodyDesc
  setCcdEnabled(enabled: boolean): PhysicsRigidBodyDesc
  setCanSleep(canSleep: boolean): PhysicsRigidBodyDesc
  setGravityScale(scale: number): PhysicsRigidBodyDesc
}

export interface PhysicsColliderDesc {
  setTranslation(x: number, y: number, z: number): PhysicsColliderDesc
  setRotation(rot: PhysicsRotation): PhysicsColliderDesc
  setRestitution(restitution: number): PhysicsColliderDesc
  setFriction(friction: number): PhysicsColliderDesc
  setDensity(density: number): PhysicsColliderDesc
  setMass(mass: number): PhysicsColliderDesc
  setSensor(sensor: boolean): PhysicsColliderDesc
  setCollisionGroups(groups: number): PhysicsColliderDesc
  setActiveEvents(events: number): PhysicsColliderDesc
  setContactForceEventThreshold(threshold: number): PhysicsColliderDesc
  setRestitutionCombineRule(rule: number): PhysicsColliderDesc
  setFrictionCombineRule(rule: number): PhysicsColliderDesc
}

export interface PhysicsCollider {
  readonly handle: number
  parent(): PhysicsBody | null
  translation(): PhysicsVector
  rotation(): PhysicsRotation
  isSensor(): boolean
  collisionGroups(): number
  setCollisionGroups(groups: number): void
  setRestitutionCombineRule(rule: number): void
}

export interface PhysicsBody {
  /** Stable for the body's lifetime; unique within its world. */
  readonly handle: number
  isValid(): boolean

  translation(): PhysicsVector
  rotation(): PhysicsRotation
  nextTranslation(): PhysicsVector
  nextRotation(): PhysicsRotation
  linvel(): PhysicsVector
  angvel(): PhysicsVector
  mass(): number

  setTranslation(translation: PhysicsVector, wakeUp: boolean): void
  setRotation(rotation: PhysicsRotation, wakeUp: boolean): void
  setLinvel(linvel: PhysicsVector, wakeUp: boolean): void
  setAngvel(angvel: PhysicsVector, wakeUp: boolean): void
  setNextKinematicTranslation(translation: PhysicsVector): void
  setNextKinematicRotation(rotation: PhysicsRotation): void
  applyImpulse(impulse: PhysicsVector, wakeUp: boolean): void

  bodyType(): number
  setBodyType(type: number, wakeUp: boolean): void
  isFixed(): boolean
  isKinematic(): boolean
  isDynamic(): boolean

  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  isSleeping(): boolean
  wakeUp(): void

  numColliders(): number
  collider(index: number): PhysicsCollider
}

export interface PhysicsJointData {
  limitsEnabled: boolean
  limits: number[]
}

export interface PhysicsImpulseJoint {
  readonly handle: number
}

export interface PhysicsRevoluteJoint extends PhysicsImpulseJoint {
  configureMotorPosition(targetPos: number, stiffness: number, damping: number): void
}

/** The world a builder authors into. Deliberately excludes stepping and debug draw. */
export interface PhysicsWorldSink {
  gravity: PhysicsVector
  createRigidBody(desc: PhysicsRigidBodyDesc): PhysicsBody
  createCollider(desc: PhysicsColliderDesc, parent?: PhysicsBody): PhysicsCollider
  removeRigidBody(body: PhysicsBody): void
  getRigidBody(handle: number): PhysicsBody | null | undefined
  getCollider(handle: number): PhysicsCollider | null | undefined
  createImpulseJoint(params: PhysicsJointData, body1: PhysicsBody, body2: PhysicsBody, wakeUp: boolean): PhysicsImpulseJoint
  removeImpulseJoint(joint: PhysicsImpulseJoint, wakeUp: boolean): void
  intersectionPair(collider1: PhysicsCollider, collider2: PhysicsCollider): boolean
}

/** The value namespace builders construct descriptors from (`typeof RAPIER` satisfies it). */
export interface PhysicsApi {
  readonly RigidBodyDesc: {
    fixed(): PhysicsRigidBodyDesc
    dynamic(): PhysicsRigidBodyDesc
    kinematicPositionBased(): PhysicsRigidBodyDesc
    kinematicVelocityBased(): PhysicsRigidBodyDesc
  }
  readonly ColliderDesc: {
    cuboid(hx: number, hy: number, hz: number): PhysicsColliderDesc
    ball(radius: number): PhysicsColliderDesc
    capsule(halfHeight: number, radius: number): PhysicsColliderDesc
    cylinder(halfHeight: number, radius: number): PhysicsColliderDesc
    cone(halfHeight: number, radius: number): PhysicsColliderDesc
    convexHull(points: Float32Array): PhysicsColliderDesc | null
  }
  readonly JointData: {
    revolute(anchor1: PhysicsVector, anchor2: PhysicsVector, axis: PhysicsVector): PhysicsJointData
  }
  readonly Vector3: new (x: number, y: number, z: number) => PhysicsVector
  readonly Quaternion: new (x: number, y: number, z: number, w: number) => PhysicsRotation
  readonly ActiveEvents: {
    readonly NONE: number
    readonly COLLISION_EVENTS: number
    readonly CONTACT_FORCE_EVENTS: number
  }
  readonly RigidBodyType: {
    readonly Dynamic: number
    readonly Fixed: number
    readonly KinematicPositionBased: number
    readonly KinematicVelocityBased: number
  }
  readonly CoefficientCombineRule: {
    readonly Average: number
    readonly Min: number
    readonly Multiply: number
    readonly Max: number
  }
}
