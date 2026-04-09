/**
 * Cryo Chamber Track
 * 
 * An ice-themed track with slalom curves and freezing hazards.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildCryoChamber(builder: TrackBuilder): void {
  const iceMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#A5F2F3")
  const pillarMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFFFF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = 0
  const iceFriction = 0.001

  // 1. Flash Freeze
  const entryLen = 15
  const entryIncline = (20 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, iceMat, 1.0, iceFriction)

  // 2. The Slalom
  const slalomRadius = 10
  const turn45 = Math.PI / 4
  const turn90 = Math.PI / 2

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
  heading -= turn45
  ;(builder as unknown as { createStaticCylinder: (...args: unknown[]) => void }).createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, slalomRadius, turn90, 0, 8, 1.0, iceMat, 15, 0, iceFriction)
  heading += turn90
  ;(builder as unknown as { createStaticCylinder: (...args: unknown[]) => void }).createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
  heading -= turn45

  // 3. The Ice Bridge
  const bridgeLen = 12
  const bridgeWidth = 2.5
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, bridgeWidth, bridgeLen, 0, iceMat, 0.0, iceFriction)

  // 4. The Avalanche
  const avRadius = 10
  const avAngle = Math.PI
  const avIncline = (15 * Math.PI) / 180
  const avBank = -(20 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, avRadius, avAngle, avIncline, 8, 2.0, iceMat, 20, avBank, iceFriction)
  heading += avAngle

  // 5. Absolute Zero
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, iceMat)
}
