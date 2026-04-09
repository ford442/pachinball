/**
 * Glitch Spire Track
 * 
 * A chaotic vertical track with uplinks and spiral sections.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildGlitchSpire(builder: TrackBuilder): void {
  const glitchMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF00FF")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0

  const uplinkLen = 15
  const uplinkIncline = -(20 * Math.PI) / 180

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, uplinkLen, uplinkIncline, glitchMat)

  const gapLength = 6
  const gapDrop = 4
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= gapDrop

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, 3, 0, glitchMat)

  heading += Math.PI / 2
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)
  heading -= Math.PI / 2
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)

  const spiralRadius = 8
  const spiralAngle = 2 * Math.PI
  const spiralIncline = (10 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 3, 0.5, glitchMat, 30)
  heading += spiralAngle

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(currentPos, glitchMat)
}
