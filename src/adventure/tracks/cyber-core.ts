/**
 * Cyber Core Track
 * 
 * A vertical descent track with curves and corkscrew sections.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildCyberCore(builder: TrackBuilder): void {
  const coreMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#ff0033")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0

  const dropLen = 15
  const dropIncline = (20 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, coreMat)

  const curve1Radius = 15
  const curve1Angle = Math.PI
  const curve1Incline = (5 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, curve1Radius, curve1Angle, curve1Incline, 6, 3.0, coreMat)
  heading += curve1Angle

  const gapLength = 8
  const gapDrop = 2
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= gapDrop

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, 5, 0, coreMat)

  const corkRadius = 8
  const corkAngle = (270 * Math.PI) / 180
  const corkIncline = (15 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 6, 1.0, coreMat)
  heading += corkAngle

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(currentPos, coreMat)
}
