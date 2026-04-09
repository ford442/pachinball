/**
 * Singularity Well Track
 * 
 * A gravitational challenge with orbital rings and disk platforms.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildSingularityWell(builder: TrackBuilder): void {
  const wellMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#9900FF")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0

  const injectLen = 12
  const injectIncline = (15 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, injectLen, injectIncline, wellMat)

  const rimRadius = 14
  const rimAngle = Math.PI
  const rimIncline = (5 * Math.PI) / 180
  const rimBank = -(15 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, rimRadius, rimAngle, rimIncline, 6, 4.0, wellMat, 20, rimBank)
  heading += rimAngle

  const gapLength = 4
  const gapDrop = 2
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= gapDrop

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, 4, 0, wellMat)

  const diskRadius = 8
  const diskAngle = (270 * Math.PI) / 180
  const diskIncline = (10 * Math.PI) / 180
  const diskBank = -(25 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, diskRadius, diskAngle, diskIncline, 6, 1.0, wellMat, 20, diskBank)
  heading += diskAngle

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(currentPos, wellMat)
}
