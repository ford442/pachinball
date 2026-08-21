/**
 * Shared worker command application + snapshot copy.
 * Used by the Dedicated Worker and by Vitest in-process loopback.
 */

import type { WasmSimEngine } from './wasm-sim-engine'
import {
  encodeHingeAngleBuffer,
  type PhysicsWorkerCommand,
} from './physics-worker-protocol'

export interface WorkerRuntimeState {
  hingeIds: Set<number>
}

export function createWorkerRuntimeState(): WorkerRuntimeState {
  return { hingeIds: new Set() }
}

/** Snapshot accessors the in-process engine exposes for HEAP copies. */
export interface WasmSnapshotSource {
  copyTransformBuffer(): ArrayBuffer
  copyContactBuffer(): { buffer: ArrayBuffer; count: number }
  getHingeAngle(id: number): number
  getStepCount(): number
}

export function applyPhysicsCommand(
  engine: Pick<
    WasmSimEngine,
    | 'setGravity'
    | 'setRollingResistance'
    | 'addStaticPlane'
    | 'addStaticBox'
    | 'addStaticCapsule'
    | 'createBody'
    | 'removeBody'
    | 'applyForce'
    | 'applyImpulse'
    | 'setVelocity'
    | 'setAngularVelocity'
    | 'setBodyPosition'
    | 'setBodyRotation'
    | 'createHinge'
    | 'setHingeMotor'
    | 'removeHinge'
    | 'step'
    | 'dispose'
  >,
  cmd: PhysicsWorkerCommand,
  state: WorkerRuntimeState,
): number {
  switch (cmd.type) {
    case 'setGravity':
      engine.setGravity(cmd.x, cmd.y, cmd.z)
      return 0
    case 'setRollingResistance':
      engine.setRollingResistance(cmd.rr)
      return 0
    case 'addStaticPlane':
      engine.addStaticPlane(cmd.normal, cmd.d, cmd.friction)
      return 0
    case 'addStaticBox':
      return engine.addStaticBox(cmd.center, cmd.halfExtents, cmd.rotation, cmd.restitution, cmd.friction)
    case 'addStaticCapsule':
      return engine.addStaticCapsule(
        cmd.center, cmd.radius, cmd.halfHeight, cmd.rotation, cmd.restitution, cmd.friction,
      )
    case 'createBody':
      return engine.createBody(cmd.desc)
    case 'removeBody':
      engine.removeBody(cmd.id)
      return 0
    case 'applyForce':
      engine.applyForce(cmd.id, cmd.fx, cmd.fy, cmd.fz)
      return 0
    case 'applyImpulse':
      engine.applyImpulse(cmd.id, cmd.ix, cmd.iy, cmd.iz)
      return 0
    case 'setVelocity':
      engine.setVelocity(cmd.id, cmd.vx, cmd.vy, cmd.vz)
      return 0
    case 'setAngularVelocity':
      engine.setAngularVelocity(cmd.id, cmd.wx, cmd.wy, cmd.wz)
      return 0
    case 'setBodyPosition':
      engine.setBodyPosition(cmd.id, cmd.px, cmd.py, cmd.pz)
      return 0
    case 'setBodyRotation':
      engine.setBodyRotation(cmd.id, cmd.qx, cmd.qy, cmd.qz, cmd.qw)
      return 0
    case 'createHinge': {
      const id = engine.createHinge(cmd.desc)
      if (id >= 0) state.hingeIds.add(id)
      return id
    }
    case 'setHingeMotor':
      engine.setHingeMotor(cmd.id, cmd.targetVel, cmd.maxTorque)
      return 0
    case 'removeHinge':
      engine.removeHinge(cmd.id)
      state.hingeIds.delete(cmd.id)
      return 0
    case 'step':
      return engine.step(cmd.rawDt)
    case 'dispose':
      engine.dispose()
      state.hingeIds.clear()
      return 0
  }
}

export function collectStepSnapshot(
  source: WasmSnapshotSource,
  state: WorkerRuntimeState,
  alpha: number,
  stepMs: number,
): {
  alpha: number
  stepCount: number
  stepMs: number
  transformBuffer: ArrayBuffer
  contactBuffer: ArrayBuffer
  contactCount: number
  hingeBuffer: ArrayBuffer
} {
  const transforms = source.copyTransformBuffer()
  const contacts = source.copyContactBuffer()
  const hinges: Array<{ id: number; angle: number }> = []
  for (const id of state.hingeIds) {
    hinges.push({ id, angle: source.getHingeAngle(id) })
  }
  return {
    alpha,
    stepCount: source.getStepCount(),
    stepMs,
    transformBuffer: transforms,
    contactBuffer: contacts.buffer,
    contactCount: contacts.count,
    hingeBuffer: encodeHingeAngleBuffer(hinges),
  }
}

/** Copy a packed contact view of `count * CONTACT_STRIDE` floats. */
