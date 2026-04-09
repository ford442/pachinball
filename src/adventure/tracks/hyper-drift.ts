/**
 * Hyper Drift Track
 * 
 * A high-speed drifting track with corkscrew turns and jump ramps.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildHyperDrift(builder: TrackBuilder): void {
  const driftMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#00FFFF")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0

  const launchLen = 15
  const launchIncline = (20 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 8, launchLen, launchIncline, driftMat)

  const alphaRadius = 15
  const alphaAngle = -Math.PI / 2
  const alphaIncline = (5 * Math.PI) / 180
  const alphaBank = (30 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, alphaRadius, alphaAngle, alphaIncline, 8, 2.0, driftMat, 20, alphaBank)
  heading += alphaAngle

  const betaRadius = 15
  const betaAngle = Math.PI / 2
  const betaIncline = (5 * Math.PI) / 180
  const betaBank = -(30 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, betaRadius, betaAngle, betaIncline, 8, 2.0, driftMat, 20, betaBank)
  heading += betaAngle

  const corkRadius = 10
  const corkAngle = 2 * Math.PI
  const corkIncline = (10 * Math.PI) / 180
  const corkBank = -(45 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 8, 2.0, driftMat, 30, corkBank)
  heading += corkAngle

  const jumpLen = 10
  const jumpIncline = -(30 * Math.PI) / 180

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, jumpLen, jumpIncline, driftMat)

  const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalDist = 15
  const goalHeight = 8

  const goalPos = currentPos.add(jumpForward.scale(goalDist))
  goalPos.y += goalHeight

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, driftMat)
}
