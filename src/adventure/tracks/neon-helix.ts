/**
 * Neon Helix Track
 * 
 * The original helix descent track - a classic spiral design.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'

export function buildNeonHelix(builder: TrackBuilder): void {
  const holoMat = (builder as unknown as { getTrackPBRMaterial: (hex: string) => import('@babylonjs/core').PBRMaterial }).getTrackPBRMaterial("#00ffff")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  let currentPos = currentStartPos.clone()
  let heading = Math.PI

  const addRamp = (width: number, length: number, drop: number, rotY: number) => {
    const incline = Math.atan2(drop, length)
    const meshLen = Math.sqrt(length * length + drop * drop)
    ;(builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, rotY, width, meshLen, incline, holoMat)
    const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
    currentPos = currentPos.add(forward.scale(length))
    currentPos.y -= drop
  }

  addRamp(6, 10, 4, heading)
  heading += Math.PI / 2
  addRamp(4, 8, 1, heading)
  heading -= Math.PI / 1.5
  addRamp(4, 12, 3, heading)

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(currentPos, holoMat)
}
