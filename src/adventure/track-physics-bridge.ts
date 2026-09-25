import type { PhysicsBody, PhysicsWorldSink } from '../core/physics-api'

/**
 * Overlap + impulse operations a track needs, abstracted over the engine that
 * actually owns the simulation. See `TrackBuilder.setPhysicsBridge`.
 *
 * Zone effects (conveyors, gravity wells, damping zones, chroma gates, exit
 * portals) were written against Rapier directly: `world.intersectionPair` for
 * overlap and `body.applyImpulse` for the push. Neither works once WASM owns
 * the track — Rapier's narrowphase only produces intersection pairs while it
 * is being stepped, and the ball bodies are disabled puppets by then.
 *
 * Routing both through this one seam lets `wasm-owner` substitute the WASM
 * contact stream and impulse path without the zone logic knowing which engine
 * is underneath. With no bridge installed, both fall back to Rapier.
 */
export interface AdventurePhysicsBridge {
  overlaps(sensorBody: PhysicsBody, ball: PhysicsBody): boolean
  applyImpulse(ball: PhysicsBody, x: number, y: number, z: number): void
}

/** True when `ball` currently overlaps `sensorBody`'s trigger volume. */
export function testSensorOverlap(
  bridge: AdventurePhysicsBridge | null,
  world: PhysicsWorldSink,
  sensorBody: PhysicsBody,
  ball: PhysicsBody
): boolean {
  if (bridge) return bridge.overlaps(sensorBody, ball)
  const sensorCollider = sensorBody.collider(0)
  const ballCollider = ball.collider(0)
  if (!sensorCollider || !ballCollider) return false
  return world.intersectionPair(sensorCollider, ballCollider)
}

/** Apply a world-space impulse to a ball, on whichever engine owns it. */
export function applyBallImpulse(
  bridge: AdventurePhysicsBridge | null,
  ball: PhysicsBody,
  x: number,
  y: number,
  z: number
): void {
  if (bridge) {
    bridge.applyImpulse(ball, x, y, z)
    return
  }
  ball.applyImpulse({ x, y, z }, true)
}
