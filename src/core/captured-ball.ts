/**
 * CapturedBall — the one capture protocol every ball-holding toy shares
 * (#420): the five feeders (MagSpin, NanoLoom, Prism Core, Gauss Cannon,
 * Quantum Tunnel), BallManager's hologram catch and the ball traps.
 *
 *   capture(ball)          stop it dead, hand it to the toy (kinematic)
 *   steer(ball, pose)      where it should be after the next physics step
 *   release(ball, …)       dynamic again, then the toy's launch
 *
 * Written against `PhysicsBody` / `PhysicsApi`, so it drives either world:
 * on the C++ owner path a ball is a `WasmBody` and each call lands on the
 * body the solver actually steps (`setBodyType` → C++ `setBodyType`,
 * `steer` → `setNextKinematicTransform` on the ball's WASM id — never a
 * Rapier puppet); on the explicit Rapier path it is a Rapier body.
 *
 * Nothing here may import Babylon or a Rapier value.
 */

import type { PhysicsApi, PhysicsBody, PhysicsRotation, PhysicsVector } from './physics-api'

const ZERO: PhysicsVector = { x: 0, y: 0, z: 0 }

export interface CapturedBallPose {
  translation?: PhysicsVector
  rotation?: PhysicsRotation
}

export interface CapturedBallRelease {
  /** Velocity to set once dynamic, before any impulse (a trap's boost). */
  linvel?: PhysicsVector
  /** Launch impulse applied once dynamic. */
  impulse?: PhysicsVector
  /** Spin set after the launch. */
  angvel?: PhysicsVector
}

export interface CapturedBallOptions {
  /** Zero the ball's velocity before the flip (default true). */
  stop?: boolean
}

export class CapturedBall {
  constructor(private readonly api: Pick<PhysicsApi, 'RigidBodyType'>) {}

  /** Take `ball` out of free flight: stopped and kinematic until `release`. */
  capture(ball: PhysicsBody, options: CapturedBallOptions = {}): void {
    if (options.stop ?? true) {
      ball.setLinvel(ZERO, true)
      ball.setAngvel(ZERO, true)
    }
    ball.setBodyType(this.api.RigidBodyType.KinematicPositionBased, true)
  }

  /** Target pose for the next physics step; the body carries the delta as velocity. */
  steer(ball: PhysicsBody, pose: CapturedBallPose): void {
    if (pose.translation) ball.setNextKinematicTranslation(pose.translation)
    if (pose.rotation) ball.setNextKinematicRotation(pose.rotation)
  }

  /** Back to dynamic — keeping the well's last motion — then the toy's launch. */
  release(ball: PhysicsBody, launch: CapturedBallRelease = {}): void {
    ball.setBodyType(this.api.RigidBodyType.Dynamic, true)
    if (launch.linvel) ball.setLinvel(launch.linvel, true)
    if (launch.impulse) ball.applyImpulse(launch.impulse, true)
    if (launch.angvel) ball.setAngvel(launch.angvel, true)
  }

  isCaptured(ball: PhysicsBody): boolean {
    return ball.isKinematic()
  }
}
