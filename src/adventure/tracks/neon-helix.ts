/**
 * Neon Helix Track
 * 
 * EXTENDED_MAP — a long spiralling neon descent emphasising scrolling depth,
 * vertical drops, and distant vistas. Exit portal is placed at the logical
 * terminus of the journey.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type { TrackInfo } from '../../game-elements/adventure-track-progression'

/** Convenience cast helpers — keeps track functions free of boilerplate. */
type BuilderCtx = {
  getTrackPBRMaterial: (hex: string) => import('@babylonjs/core').PBRMaterial
  getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial
  currentStartPos: Vector3
  currentTrackInfo: TrackInfo | null
  addStraightRamp: (...args: unknown[]) => Vector3
  addCurvedRamp: (...args: unknown[]) => Vector3
  createBasin: (...args: unknown[]) => void
  createStaticCylinder: (...args: unknown[]) => void
  addExitPortal: (position: Vector3) => void
}

export function buildNeonHelix(builder: TrackBuilder): void {
  const b = builder as unknown as BuilderCtx
  const holoMat = b.getTrackPBRMaterial("#00ffff")
  const accentMat = b.getTrackMaterial("#00aaff")
  let currentPos = b.currentStartPos.clone()
  let heading = Math.PI

  const addRamp = (width: number, length: number, drop: number, rotY: number) => {
    const incline = Math.atan2(drop, length)
    const meshLen = Math.sqrt(length * length + drop * drop)
    b.addStraightRamp(currentPos, rotY, width, meshLen, incline, holoMat)
    const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
    currentPos = currentPos.add(forward.scale(length))
    currentPos.y -= drop
  }

  const modeType = b.currentTrackInfo?.modeType ?? 'EXTENDED_MAP'

  if (modeType === 'EXTENDED_MAP') {
    // Long scrolling descent — emphasise depth and vertical drama
    addRamp(6, 14, 6, heading)            // sweeping opening drop
    heading += Math.PI / 2
    addRamp(4, 10, 2, heading)            // lateral shelf
    heading -= Math.PI / 1.5
    addRamp(4, 16, 4, heading)            // deep angled run

    // Wide banked curve to change direction and add visual interest
    currentPos = b.addCurvedRamp(
      currentPos, heading,
      12, Math.PI * 0.75, (8 * Math.PI) / 180,
      5, 2.0, holoMat, 24, -(10 * Math.PI) / 180
    ) as Vector3
    heading += Math.PI * 0.75

    // Final plunge
    addRamp(5, 10, 5, heading)

    // Accent pylons flanking the approach to the basin (distant vista elements)
    b.createStaticCylinder(
      new Vector3(currentPos.x - 3, currentPos.y, currentPos.z - 2),
      0.6, 3.0, accentMat
    )
    b.createStaticCylinder(
      new Vector3(currentPos.x + 3, currentPos.y, currentPos.z - 2),
      0.6, 3.0, accentMat
    )
  } else {
    // Compact fallback (should not normally be reached for NEON_HELIX)
    addRamp(6, 10, 4, heading)
    heading += Math.PI / 2
    addRamp(4, 8, 1, heading)
    heading -= Math.PI / 1.5
    addRamp(4, 12, 3, heading)
  }

  // Portal sits just above the catch basin — the logical terminus of the spiral
  b.addExitPortal(new Vector3(currentPos.x, currentPos.y + 1.8, currentPos.z))

  b.createBasin(currentPos, holoMat)
}
