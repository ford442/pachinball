/**
 * Narrow simulation surface shared by in-process WasmPhysicsEngine and the
 * Phase-1 physics worker client. Callers (WasmOwner / WasmMirror / static export)
 * must not depend on Embind or HEAP views.
 */

import type { EventBus } from '../core/event-bus'
import type { WasmBodyDesc, WasmHingeDesc } from './PhysicsModule'
import type { WasmPhysicsModule } from './wasm-types'

export interface WasmSimEngine {
  isReady: boolean

  load(moduleUrl?: string, preloadedModule?: WasmPhysicsModule): Promise<void>
  init(bus: EventBus): void
  dispose(): void

  setGravity(x: number, y: number, z: number): void
  setRollingResistance(rr: number): void
  addStaticPlane(normal: { x: number; y: number; z: number }, d: number, friction?: number): void
  addStaticBox(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number
  addStaticCapsule(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number

  addStaticCylinder(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number
  addStaticSphere(
    center: { x: number; y: number; z: number },
    radius: number,
    restitution?: number,
    friction?: number
  ): number
  /**
   * Drop every static collider, sensor volume and kinematic mover. Statics
   * are append-only, so a rebuilt scene must clear before re-adding or it
   * stacks a second copy. Invalidates every negative handle; dynamic bodies
   * and hinges are untouched.
   */
  clearStaticGeometry(): void

  /** Static OBB trigger volume — Enter/Stay/Exit contacts, zero impulse. */
  addSensorVolume(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number }
  ): number
  /** Kinematic OBB mover (piston, platter, gate); pose pushed per tick. */
  addKinematicMover(
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number
  setNextKinematicTransform(
    moverId: number,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number }
  ): void
  /**
   * Membership/filter mask for any handle — a body (id ≥ 0) or a static
   * box/capsule/cylinder/sphere/mover/sensor (id < 0). Mirrors
   * `CollisionGroups` in src/game-elements/physics.ts.
   */
  setCollisionGroups(id: number, membership: number, filter: number): void

  createBody(desc?: WasmBodyDesc): number
  removeBody(id: number): void
  applyForce(id: number, fx: number, fy: number, fz: number): void
  applyImpulse(id: number, ix: number, iy: number, iz: number): void
  setVelocity(id: number, vx: number, vy: number, vz: number): void
  setAngularVelocity(id: number, wx: number, wy: number, wz: number): void
  setBodyPosition(id: number, px: number, py: number, pz: number): void
  setBodyRotation(id: number, qx: number, qy: number, qz: number, qw: number): void

  createHinge(desc: WasmHingeDesc): number
  setHingeMotor(id: number, targetVel: number, maxTorque: number): void
  getHingeAngle(id: number): number
  removeHinge(id: number): void

  getPosition(id: number): { x: number; y: number; z: number }
  getVelocity(id: number): { x: number; y: number; z: number }
  getAngularVelocity(id: number): { x: number; y: number; z: number }
  getRotation(id: number): { x: number; y: number; z: number; w: number }

  step(rawDt: number): number
  getStepCount(): number
  getActiveBodyCount(): number

  /** False until the first worker STEP_RESULT arrives. In-process engines always true. */
  hasTransformSnapshot(): boolean
  /** Worker-reported C++ step time (ms). In-process engines return 0. */
  getLastWorkerStepMs(): number
}
