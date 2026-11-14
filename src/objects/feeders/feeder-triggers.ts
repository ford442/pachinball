/**
 * The idle-state capture tests of the feeders that poll ball positions every fixed step: which
 * ball (if any) a feeder takes this step. Pure (no Babylon, #528): each feeder runs its own test
 * through these, and so does the headless replay runner's feeder guard, which must know exactly
 * when a feeder would leave IDLE — a step it cannot replay without the feeder's state machine.
 */

import type { PhysicsBody, PhysicsWorldSink } from '../../core/physics-api'
import { distance3, type Vec3Like } from '../../core/vec3-scalar'

/** The plunger corridor: balls still climbing the launch lane are never captured. */
function inLaunchClimb(pos: Vec3Like): boolean {
  return pos.x > 8.5 && pos.z < 16
}

/** MagSpin (idle): the first ball within `catchRadius` of the well and below `maxCaptureHeightY`. */
export function magSpinCaptureCandidate(
  balls: readonly PhysicsBody[],
  well: Vec3Like,
  config: { catchRadius: number; maxCaptureHeightY: number },
): PhysicsBody | null {
  for (const body of balls) {
    const pos = body.translation()
    // Plunger lane runs along x≈10.5 — don't vacuum balls still exiting launch.
    // Full corridor height matches KEEP_OUT_BOXES.launchLane (z up to 18).
    if (inLaunchClimb(pos)) continue
    if (distance3(pos, well) < config.catchRadius && pos.y < config.maxCaptureHeightY) return body
  }
  return null
}

/** Gauss cannon (idle): the first ball within `intakeRadius` (default 1) of the breech. */
export function gaussCannonCaptureCandidate(
  balls: readonly PhysicsBody[],
  position: Vec3Like,
  config: { intakeRadius?: number },
): PhysicsBody | null {
  const pullRadius = config.intakeRadius || 1.0
  for (const body of balls) {
    if (distance3(body.translation(), position) < pullRadius) return body
  }
  return null
}

/**
 * Quantum tunnel (idle): the first ball outside the launch climb whose collider overlaps the input
 * sensor's, as the physics world answers it (`intersectionPair`).
 */
export function quantumTunnelCaptureCandidate(
  balls: readonly PhysicsBody[],
  world: Pick<PhysicsWorldSink, 'intersectionPair'>,
  inputSensor: PhysicsBody,
): PhysicsBody | null {
  const sensorHandle = inputSensor.collider(0)
  for (const ball of balls) {
    // Input portal sits on the right wall at the top of the plunger corridor —
    // ignore the entire launch climb so every launch is not a free teleport.
    if (inLaunchClimb(ball.translation())) continue
    if (world.intersectionPair(sensorHandle, ball.collider(0))) return ball
  }
  return null
}
