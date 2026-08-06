import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { BallManagerHost } from './ball-manager-context'

/** Threshold: if ball moves less than this per second, it may be stuck */
export const STUCK_VELOCITY_THRESHOLD = 0.1
/** Time before a stuck ball is auto-reset */
export const STUCK_TIMEOUT = 5.0

/**
 * Detect stuck balls and out-of-bounds balls.
 * Stuck balls are auto-reset after STUCK_TIMEOUT seconds.
 * Out-of-bounds balls are immediately respawned.
 */
export function updateStuckDetection(host: BallManagerHost, dt: number): RAPIER.RigidBody[] {
  const stuckBalls: RAPIER.RigidBody[] = []

  for (const body of host.ballBodies) {
    if (body.isSleeping()) continue

    const pos = body.translation()
    const vel = body.linvel()
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

    // Out-of-bounds detection: immediate reset
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)
        || Math.abs(pos.x) > 50 || Math.abs(pos.y) > 50 || Math.abs(pos.z) > 50) {
      stuckBalls.push(body)
      host.ballStuckTimers.delete(body)
      continue
    }

    // Stuck detection: low velocity for extended time
    let tracker = host.ballStuckTimers.get(body)
    if (!tracker) {
      tracker = { lastPos: { x: pos.x, y: pos.y, z: pos.z }, stuckTime: 0 }
      host.ballStuckTimers.set(body, tracker)
    }

    if (speed < STUCK_VELOCITY_THRESHOLD) {
      tracker.stuckTime += dt
      if (tracker.stuckTime >= STUCK_TIMEOUT) {
        stuckBalls.push(body)
        tracker.stuckTime = 0
      }
    } else {
      tracker.stuckTime = 0
    }

    tracker.lastPos = { x: pos.x, y: pos.y, z: pos.z }
  }

  return stuckBalls
}
