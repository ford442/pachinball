/**
 * Firewall Breach Track
 * 
 * A security-themed track with data blocks and firewall panels.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildFirewallBreach(builder: TrackBuilder): void {
  const wallMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF4400")
  const debrisMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#0088FF")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos

  let cp = currentStartPos.clone()
  let heading = 0

  // 1. Packet Stream
  const launchLen = 20
  const launchIncline = (25 * Math.PI) / 180
  cp = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(cp, heading, 6, launchLen, launchIncline, wallMat)

  // 2. Security Layer 1
  const debrisLen = 15
  const debrisWidth = 8

  const debrisStartPos = cp.clone()
  cp = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(cp, heading, debrisWidth, debrisLen, 0, wallMat)

  // Add Data Blocks
  ;(builder as unknown as { createDynamicBlock: (...args: unknown[]) => void }).createDynamicBlock(debrisStartPos.add(new Vector3(0, 1, 5)), 1.0, 0.5, debrisMat)
  ;(builder as unknown as { createDynamicBlock: (...args: unknown[]) => void }).createDynamicBlock(debrisStartPos.add(new Vector3(2, 1, 8)), 1.0, 0.5, debrisMat)
  ;(builder as unknown as { createDynamicBlock: (...args: unknown[]) => void }).createDynamicBlock(debrisStartPos.add(new Vector3(-2, 1, 12)), 1.0, 0.5, debrisMat)

  // 3. The Chicane
  const turnRadius = 10
  const turnAngle = Math.PI / 2

  cp = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(cp, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
  heading -= turnAngle

  cp = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(cp, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
  heading += turnAngle

  // 4. Security Layer 2
  const wallLen = 10
  const wallStartPos = cp.clone()
  cp = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(cp, heading, 8, wallLen, 0, wallMat)

  // Add Firewall Panels
  ;(builder as unknown as { createDynamicBlock: (...args: unknown[]) => void }).createDynamicBlock(wallStartPos.add(new Vector3(-3, 1.5, 5)), 2.5, 5.0, wallMat)
  ;(builder as unknown as { createDynamicBlock: (...args: unknown[]) => void }).createDynamicBlock(wallStartPos.add(new Vector3(0, 1.5, 5)), 2.5, 5.0, wallMat)
  ;(builder as unknown as { createDynamicBlock: (...args: unknown[]) => void }).createDynamicBlock(wallStartPos.add(new Vector3(3, 1.5, 5)), 2.5, 5.0, wallMat)

  // 5. Root Access
  const goalPos = cp.clone()
  goalPos.y -= 2
  goalPos.z += 2

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, wallMat)
}
