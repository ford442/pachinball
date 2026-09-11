/**
 * Narrow simulation surface shared by in-process WasmPhysicsEngine and the
 * Phase-1 physics worker client. Callers (WasmOwner / WasmMirror / static export)
 * must not depend on Embind or HEAP views.
 */

import type {
  WasmBodyDesc,
  WasmBoxBodyDesc,
  WasmContactEventBus,
  WasmForceFieldDesc,
  WasmHingeDesc,
  WasmVolumeShape,
} from './PhysicsModule'
import type { WasmPhysicsModule } from './wasm-types'

export interface WasmSimEngine {
  isReady: boolean

  load(moduleUrl?: string, preloadedModule?: WasmPhysicsModule): Promise<void>
  init(bus: WasmContactEventBus): void
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

  /**
   * Adventure geometry. Optional because only the in-process engine
   * implements it — the worker client's id allocator does not yet mirror
   * these handle ranges, so `wasm-worker` cannot own an adventure track.
   * Callers must feature-detect rather than assume; see
   * `wasm-adventure-export.ts`, which reports unsupported geometry instead
   * of dropping it silently.
   */
  addStaticCylinder?(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number
  addStaticSphere?(
    center: { x: number; y: number; z: number },
    radius: number,
    restitution?: number,
    friction?: number
  ): number
  addStaticTriangleMesh?(
    vertices: Float32Array,
    indices: Uint32Array,
    restitution?: number,
    friction?: number,
    doubleSided?: boolean
  ): number
  addKinematicMover?(
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number,
    shape?: WasmVolumeShape
  ): number
  setNextKinematicTransform?(
    moverId: number,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number }
  ): void
  addSensorVolume?(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    shape?: WasmVolumeShape
  ): number
  createBoxBody?(desc: WasmBoxBodyDesc): number
  addForceField?(desc: WasmForceFieldDesc): number
  setForceFieldEnabled?(fieldId: number, enabled: boolean): void
  setForceFieldVector?(fieldId: number, fx: number, fy: number, fz: number): void
  setCollisionGroups?(id: number, membership: number, filter: number): void
  /**
   * Drop every static/kinematic collider and force field, invalidating all
   * negative handles. The caller must re-export whatever it still needs — an
   * adventure track switch replaces the entire static world.
   */
  clearStaticGeometry?(): void

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
