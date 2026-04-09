/**
 * Chrono Core Track
 * 
 * A time-themed track with rotating gears and clockwork mechanisms.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildChronoCore(builder: TrackBuilder): void {
  const chronoMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFD700")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  const heading = 0

  const entryLen = 10
  const entryIncline = (10 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 5, entryLen, entryIncline, chronoMat)

  const gear1Radius = 8
  const gear1Speed = (30 * Math.PI) / 180
  const gear1AngVel = -gear1Speed

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos.y -= 1.0
  const gear1Center = currentPos.add(forward.scale(gear1Radius + 1))

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(gear1Center, gear1Radius, gear1AngVel, chronoMat)

  currentPos = gear1Center.add(forward.scale(gear1Radius))
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 3, 12, 0, chronoMat)

  const gear2Radius = 10
  const gear2Speed = (20 * Math.PI) / 180
  const gear2AngVel = gear2Speed

  const gear2Center = currentPos.add(forward.scale(gear2Radius + 0.5))
  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(gear2Center, gear2Radius, gear2AngVel, chronoMat, true)

  const goalPos = gear2Center.clone()
  goalPos.y += 4.0

  const jumpRampPos = gear2Center.add(forward.scale(gear2Radius - 2))
  const jumpHeading = heading + Math.PI

  ;(builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(jumpRampPos, jumpHeading, 4, 4, -(30 * Math.PI) / 180, chronoMat)
  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, chronoMat)
}
