/**
 * Retro Wave Hills Track
 * 
 * A scenic track with rolling hills and jumps.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildRetroWaveHills(builder: TrackBuilder): void {
  const retroMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF8800")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, 10, 0, retroMat)

  const hillLen = 8
  const rise1Incline = -(15 * Math.PI) / 180
  const fall1Incline = (15 * Math.PI) / 180

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, hillLen, rise1Incline, retroMat)
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, hillLen, fall1Incline, retroMat)

  const rise2Incline = -(20 * Math.PI) / 180
  const fall2Incline = (20 * Math.PI) / 180

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, hillLen, rise2Incline, retroMat)
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, hillLen, fall2Incline, retroMat)

  const turnRadius = 12
  const turnAngle = Math.PI
  const turnIncline = 0
  const banking = -(15 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 6, 2.0, retroMat, 20, banking)
  heading += turnAngle

  const jumpLen = 12
  const jumpIncline = -(25 * Math.PI) / 180

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, jumpLen, jumpIncline, retroMat)

  const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalDist = 15
  const goalHeight = 5

  const goalPos = currentPos.add(jumpForward.scale(goalDist))
  goalPos.y += goalHeight

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, retroMat)
}
