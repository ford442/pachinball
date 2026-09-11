/**
 * Declarative collider descriptors for adventure-mode track geometry (#383).
 *
 * Every adventure collider used to be constructed inline as a
 * `rapier.ColliderDesc.*` call, which left nothing for the C++ engine to
 * consume. Builders now emit descriptors instead, and the list is handed to
 * two consumers:
 *
 *   1. `TrackColliderEmitter` — the Rapier path, a lossless re-expression of
 *      the exact same colliders (same shape, pose, material and group word).
 *   2. `src/game/physics/wasm-adventure-export.ts` — the C++ path, walking
 *      descriptors into addStaticBox / addStaticCylinder / addStaticSphere /
 *      addSensorVolume / addKinematicMover.
 *
 * Shape coverage is deliberately narrow: the 14 tracks between them use only
 * cuboid, cylinder and ball (plus one convexHull in prism-pathway, which has
 * no descriptor and stays on Rapier). Do not widen this without a track that
 * needs it.
 */

import { ADVENTURE_GROUP, CollisionGroups, makeCollisionGroups } from '../game-elements/physics'

export interface DescVec3 {
  x: number
  y: number
  z: number
}

export interface DescQuat {
  x: number
  y: number
  z: number
  w: number
}

/**
 * How the body carrying a collider moves.
 *
 * `kinematic-position` is the one that routes to the C++ `addKinematicMover`
 * (pose pushed per tick, velocity derived from the delta).
 * `kinematic-velocity` bodies spin under a prescribed angular velocity and
 * have no C++ equivalent yet; `dynamic` bodies are not exportable either.
 */
export type AdventureBodyMotion =
  | 'fixed'
  | 'kinematic-position'
  | 'kinematic-velocity'
  | 'dynamic'

export type AdventureColliderKind = 'box' | 'cylinder' | 'sphere'

/**
 * One adventure collider, engine-agnostic.
 *
 * `position`/`rotation` are the BODY's world pose. When `parentIndex` is set
 * there is no body of this descriptor's own, and they are instead the
 * collider's pose in the parent body's frame (how the rotating platform's
 * teeth hang off the platter). `localPosition`/`localRotation` add a further
 * collider offset inside its own body — needed when the body pose is animated
 * about a pivot the collider is not centred on (magnetic-storage's arm).
 *
 * Defaults mirror Rapier's `ColliderDesc` defaults (friction 0.5,
 * restitution 0) so an emitted collider that leaves them unset behaves
 * exactly as the inline `ColliderDesc` call it replaced.
 */
export interface AdventureColliderDesc {
  kind: AdventureColliderKind
  position: DescVec3
  rotation: DescQuat

  /** `box` only — half-extents in local space. */
  halfExtents?: DescVec3
  /** `cylinder` and `sphere`. */
  radius?: number
  /** `cylinder` only — half of the axis length (local Y, as Rapier). */
  halfHeight?: number

  /** Collider offset inside its own body. Ignored when `parentIndex` is set. */
  localPosition?: DescVec3
  localRotation?: DescQuat

  restitution: number
  friction: number

  /** Membership bits (see `CollisionGroups` / the polychrome GROUP_* words). */
  membership: number
  /** Filter bits — which memberships this collider interacts with. */
  filter: number

  /** Trigger volume: overlap events only, no impulse. */
  sensor?: boolean
  /** Rapier `ActiveEvents.COLLISION_EVENTS` (goal/portal sensors). */
  collisionEvents?: boolean

  /** Defaults to `'fixed'`. */
  motion?: AdventureBodyMotion
  /** `kinematic-velocity` only — prescribed spin, world space. */
  angularVelocity?: DescVec3
  /** `dynamic` only — mass per unit volume. */
  density?: number

  /**
   * Index into the same descriptor list whose body this collider attaches to
   * (instead of getting a body of its own). Used by the rotating platform's
   * teeth, which must spin with the platter.
   */
  parentIndex?: number

  /** Free-form tag for diagnostics and for the per-track export report. */
  label?: string
}

export const IDENTITY_ROTATION: DescQuat = { x: 0, y: 0, z: 0, w: 1 }

/** Rapier's own `ColliderDesc` defaults — keep these in sync with Rapier. */
export const RAPIER_DEFAULT_FRICTION = 0.5
export const RAPIER_DEFAULT_RESTITUTION = 0

/** The group word nearly every adventure collider ends up with. */
export const ADVENTURE_MEMBERSHIP = ADVENTURE_GROUP
export const ADVENTURE_FILTER = CollisionGroups.BALL

/** Fields every factory below shares. */
export interface DescOptions {
  rotation?: DescQuat
  restitution?: number
  friction?: number
  membership?: number
  filter?: number
  sensor?: boolean
  collisionEvents?: boolean
  motion?: AdventureBodyMotion
  angularVelocity?: DescVec3
  density?: number
  parentIndex?: number
  label?: string
  localPosition?: DescVec3
  localRotation?: DescQuat
}

function common(opts: DescOptions): Omit<AdventureColliderDesc, 'kind' | 'position'> {
  return {
    rotation: opts.rotation ?? IDENTITY_ROTATION,
    restitution: opts.restitution ?? RAPIER_DEFAULT_RESTITUTION,
    friction: opts.friction ?? RAPIER_DEFAULT_FRICTION,
    membership: opts.membership ?? ADVENTURE_MEMBERSHIP,
    filter: opts.filter ?? ADVENTURE_FILTER,
    ...(opts.sensor ? { sensor: true } : {}),
    ...(opts.collisionEvents ? { collisionEvents: true } : {}),
    ...(opts.motion && opts.motion !== 'fixed' ? { motion: opts.motion } : {}),
    ...(opts.angularVelocity ? { angularVelocity: opts.angularVelocity } : {}),
    ...(opts.density !== undefined ? { density: opts.density } : {}),
    ...(opts.parentIndex !== undefined ? { parentIndex: opts.parentIndex } : {}),
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.localPosition ? { localPosition: opts.localPosition } : {}),
    ...(opts.localRotation ? { localRotation: opts.localRotation } : {}),
  }
}

export function boxDesc(
  position: DescVec3,
  halfExtents: DescVec3,
  opts: DescOptions = {}
): AdventureColliderDesc {
  return { kind: 'box', position, halfExtents, ...common(opts) }
}

/** Matches Rapier's `ColliderDesc.cylinder(halfHeight, radius)` — local Y axis. */
export function cylinderDesc(
  position: DescVec3,
  halfHeight: number,
  radius: number,
  opts: DescOptions = {}
): AdventureColliderDesc {
  return { kind: 'cylinder', position, halfHeight, radius, ...common(opts) }
}

export function sphereDesc(
  position: DescVec3,
  radius: number,
  opts: DescOptions = {}
): AdventureColliderDesc {
  return { kind: 'sphere', position, radius, ...common(opts) }
}

/** Combined Rapier interaction-groups word for a descriptor. */
export function descCollisionGroups(desc: AdventureColliderDesc): number {
  return makeCollisionGroups(desc.membership, desc.filter)
}
