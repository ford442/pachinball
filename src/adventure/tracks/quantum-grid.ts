/**
 * Quantum Grid Track
 * 
 * A maze-like track with zig-zag paths and orbital platforms.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildQuantumGrid(builder: TrackBuilder): void {
  const gridMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#00FF00")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, 10, 0, gridMat)

  const zigzagWidth = 3
  const zigzagLen = 5
  const zigzagIncline = 0

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)
  heading -= Math.PI / 2
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)
  heading += Math.PI / 2
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)

  const orbitRadius = 6
  const orbitAngle = (270 * Math.PI) / 180
  const orbitIncline = -(5 * Math.PI) / 180
  const orbitWallHeight = 0.5

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, orbitRadius, orbitAngle, orbitIncline, zigzagWidth, orbitWallHeight, gridMat)
  heading += orbitAngle

  const gapLength = 4
  const gapDrop = 1
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= gapDrop

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, 3, 0, gridMat)

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(currentPos, gridMat)
}
