/**
 * Descriptor-recording `PhysicsApi` for the C++ owner path (#412).
 *
 * Table builders, ball spawners, toys and the adventure emitter all author
 * through `PhysicsApi` (src/core/physics-api.ts). On the `rapier`
 * path that is the Rapier namespace itself; on `wasm-owner` / `wasm-worker`
 * it is `WASM_PHYSICS_API` below, whose `RigidBodyDesc` / `ColliderDesc` /
 * `JointData` builders only record plain data. `WasmTableWorld` turns the
 * records into `WasmBody`s + `TableColliderDesc`s, and `WasmOwner` exports
 * those into the C++ world (`wasm-static-export.ts`).
 *
 * Defaults mirror Rapier's own (`ColliderDesc`: friction 0.5, restitution 0,
 * density 1, all collision groups) so a builder that leaves a field unset
 * describes exactly the collider Rapier would have built.
 */

import {
  PhysicsActiveEvents,
  PhysicsBodyType,
  PhysicsCombineRule,
  type PhysicsApi,
  type PhysicsBodyTypeValue,
  type PhysicsColliderDesc,
  type PhysicsJointData,
  type PhysicsRigidBodyDesc,
  type PhysicsRotation,
  type PhysicsVector,
} from '../core/physics-api'
import type { PinFieldSpec } from '../core/pin-field'

/** Rapier's `ColliderDesc` defaults — keep in sync with Rapier. */
export const TABLE_DEFAULT_FRICTION = 0.5
export const TABLE_DEFAULT_RESTITUTION = 0
export const TABLE_DEFAULT_DENSITY = 1
/** Rapier's default group word: member of and interacting with every group. */
export const TABLE_DEFAULT_COLLISION_GROUPS = 0xffffffff

export type TableColliderShape =
  | { kind: 'box'; halfExtents: PhysicsVector }
  | { kind: 'sphere'; radius: number }
  | { kind: 'capsule'; radius: number; halfHeight: number }
  | { kind: 'cylinder'; radius: number; halfHeight: number }
  | { kind: 'cone'; radius: number; halfHeight: number }
  | { kind: 'convexHull'; points: Float32Array }
  /** A whole pin lattice (#421) — only `WasmTableWorld.createPinField` builds one. */
  | { kind: 'pinField'; field: PinFieldSpec }

/** One table collider as a builder authored it, before any engine sees it. */
export interface TableColliderDesc {
  shape: TableColliderShape
  /** Offset inside the parent body (Rapier `ColliderDesc.setTranslation`). */
  localPosition: PhysicsVector
  localRotation: PhysicsRotation
  restitution: number
  friction: number
  density: number
  /** Explicit mass (`setMass`); wins over density when set. */
  mass: number | null
  sensor: boolean
  /** Rapier-packed word: membership in the upper 16 bits, filter in the lower 16. */
  collisionGroups: number
  activeEvents: number
  restitutionCombineRule: number
  frictionCombineRule: number
}

export interface TableBodyDesc {
  type: PhysicsBodyTypeValue
  translation: PhysicsVector
  rotation: PhysicsRotation
  linvel: PhysicsVector
  angvel: PhysicsVector
  linearDamping: number
  angularDamping: number
  ccdEnabled: boolean
  canSleep: boolean
  gravityScale: number
}

export interface RevoluteJointDesc {
  kind: 'revolute'
  anchor1: PhysicsVector
  anchor2: PhysicsVector
  axis: PhysicsVector
}

const IDENTITY: PhysicsRotation = { x: 0, y: 0, z: 0, w: 1 }

function vec(x: number, y: number, z: number): PhysicsVector {
  return { x, y, z }
}

function copyVec(v: PhysicsVector): PhysicsVector {
  return { x: v.x, y: v.y, z: v.z }
}

function copyRot(q: PhysicsRotation): PhysicsRotation {
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

export class WasmRigidBodyDesc implements PhysicsRigidBodyDesc {
  readonly desc: TableBodyDesc

  constructor(type: PhysicsBodyTypeValue) {
    this.desc = {
      type,
      translation: vec(0, 0, 0),
      rotation: { ...IDENTITY },
      linvel: vec(0, 0, 0),
      angvel: vec(0, 0, 0),
      linearDamping: 0,
      angularDamping: 0,
      ccdEnabled: false,
      canSleep: true,
      gravityScale: 1,
    }
  }

  setTranslation(x: number, y: number, z: number): this {
    this.desc.translation = vec(x, y, z)
    return this
  }

  setRotation(rot: PhysicsRotation): this {
    this.desc.rotation = copyRot(rot)
    return this
  }

  setLinvel(x: number, y: number, z: number): this {
    this.desc.linvel = vec(x, y, z)
    return this
  }

  setAngvel(v: PhysicsVector): this {
    this.desc.angvel = copyVec(v)
    return this
  }

  setLinearDamping(damping: number): this {
    this.desc.linearDamping = damping
    return this
  }

  setAngularDamping(damping: number): this {
    this.desc.angularDamping = damping
    return this
  }

  setCcdEnabled(enabled: boolean): this {
    this.desc.ccdEnabled = enabled
    return this
  }

  setCanSleep(canSleep: boolean): this {
    this.desc.canSleep = canSleep
    return this
  }

  setGravityScale(scale: number): this {
    this.desc.gravityScale = scale
    return this
  }
}

export class WasmColliderDesc implements PhysicsColliderDesc {
  readonly desc: TableColliderDesc

  constructor(shape: TableColliderShape) {
    this.desc = {
      shape,
      localPosition: vec(0, 0, 0),
      localRotation: { ...IDENTITY },
      restitution: TABLE_DEFAULT_RESTITUTION,
      friction: TABLE_DEFAULT_FRICTION,
      density: TABLE_DEFAULT_DENSITY,
      mass: null,
      sensor: false,
      collisionGroups: TABLE_DEFAULT_COLLISION_GROUPS,
      activeEvents: PhysicsActiveEvents.NONE,
      restitutionCombineRule: PhysicsCombineRule.Average,
      frictionCombineRule: PhysicsCombineRule.Average,
    }
  }

  setTranslation(x: number, y: number, z: number): this {
    this.desc.localPosition = vec(x, y, z)
    return this
  }

  setRotation(rot: PhysicsRotation): this {
    this.desc.localRotation = copyRot(rot)
    return this
  }

  setRestitution(restitution: number): this {
    this.desc.restitution = restitution
    return this
  }

  setFriction(friction: number): this {
    this.desc.friction = friction
    return this
  }

  setDensity(density: number): this {
    this.desc.density = density
    this.desc.mass = null
    return this
  }

  setMass(mass: number): this {
    this.desc.mass = mass
    return this
  }

  setSensor(sensor: boolean): this {
    this.desc.sensor = sensor
    return this
  }

  setCollisionGroups(groups: number): this {
    this.desc.collisionGroups = groups >>> 0
    return this
  }

  setActiveEvents(events: number): this {
    this.desc.activeEvents = events
    return this
  }

  setContactForceEventThreshold(): this {
    // The C++ world reports every contact's impulse; there is no threshold to set.
    return this
  }

  setRestitutionCombineRule(rule: number): this {
    this.desc.restitutionCombineRule = rule
    return this
  }

  setFrictionCombineRule(rule: number): this {
    this.desc.frictionCombineRule = rule
    return this
  }
}

export class WasmJointData implements PhysicsJointData {
  limitsEnabled = false
  limits: number[] = []

  constructor(readonly joint: RevoluteJointDesc) {}
}

class WasmVector3 implements PhysicsVector {
  constructor(public x: number, public y: number, public z: number) {}
}

class WasmQuaternion implements PhysicsRotation {
  constructor(public x: number, public y: number, public z: number, public w: number) {}
}

/** Volume of a collider shape, for density → mass. Null for shapes without a closed form here. */
export function shapeVolume(shape: TableColliderShape): number | null {
  switch (shape.kind) {
    case 'box':
      return 8 * shape.halfExtents.x * shape.halfExtents.y * shape.halfExtents.z
    case 'sphere':
      return (4 / 3) * Math.PI * shape.radius ** 3
    case 'capsule':
      return Math.PI * shape.radius ** 2 * (2 * shape.halfHeight) + (4 / 3) * Math.PI * shape.radius ** 3
    case 'cylinder':
      return Math.PI * shape.radius ** 2 * (2 * shape.halfHeight)
    case 'cone':
      return (Math.PI * shape.radius ** 2 * (2 * shape.halfHeight)) / 3
    case 'convexHull':
    case 'pinField':
      return null
  }
}

/** Mass a collider contributes, as Rapier derives it (explicit mass, else density × volume). */
export function colliderMass(desc: TableColliderDesc): number {
  if (desc.mass !== null) return desc.mass
  return desc.density * (shapeVolume(desc.shape) ?? 0)
}

export const WASM_PHYSICS_API: PhysicsApi = {
  RigidBodyDesc: {
    fixed: () => new WasmRigidBodyDesc(PhysicsBodyType.Fixed),
    dynamic: () => new WasmRigidBodyDesc(PhysicsBodyType.Dynamic),
    kinematicPositionBased: () => new WasmRigidBodyDesc(PhysicsBodyType.KinematicPositionBased),
    kinematicVelocityBased: () => new WasmRigidBodyDesc(PhysicsBodyType.KinematicVelocityBased),
  },
  ColliderDesc: {
    cuboid: (hx, hy, hz) => new WasmColliderDesc({ kind: 'box', halfExtents: vec(hx, hy, hz) }),
    ball: (radius) => new WasmColliderDesc({ kind: 'sphere', radius }),
    capsule: (halfHeight, radius) => new WasmColliderDesc({ kind: 'capsule', radius, halfHeight }),
    cylinder: (halfHeight, radius) => new WasmColliderDesc({ kind: 'cylinder', radius, halfHeight }),
    cone: (halfHeight, radius) => new WasmColliderDesc({ kind: 'cone', radius, halfHeight }),
    convexHull: (points) =>
      points.length >= 12 ? new WasmColliderDesc({ kind: 'convexHull', points: Float32Array.from(points) }) : null,
  },
  JointData: {
    revolute: (anchor1, anchor2, axis) =>
      new WasmJointData({ kind: 'revolute', anchor1: copyVec(anchor1), anchor2: copyVec(anchor2), axis: copyVec(axis) }),
  },
  Vector3: WasmVector3,
  Quaternion: WasmQuaternion,
  ActiveEvents: PhysicsActiveEvents,
  RigidBodyType: PhysicsBodyType,
  CoefficientCombineRule: PhysicsCombineRule,
}
