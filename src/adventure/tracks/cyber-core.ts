/**
 * Cyber Core Track — Cyber-Shock premium theme
 *
 * STATIONARY_TABLE pinball arena: electric magenta structure, cyan accents,
 * tiger-orange bumper cluster. Materials resolve from TRACK_THEME_PROFILES.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type { TrackInfo } from '../../game-elements/adventure-track-progression'

type BuilderCtx = {
  getThemedTrackMaterial: (role: 'structure' | 'accent' | 'energy' | 'glow') => import('@babylonjs/core').StandardMaterial
  currentStartPos: Vector3
  currentTrackInfo: TrackInfo | null
  addStraightRamp: (...args: unknown[]) => Vector3
  addCurvedRamp: (...args: unknown[]) => Vector3
  createBasin: (...args: unknown[]) => void
  createStaticCylinder: (...args: unknown[]) => void
  createRotatingPlatform: (...args: unknown[]) => void
  addExitPortal: (position: Vector3) => void
}

export function buildCyberCore(builder: TrackBuilder): void {
  const b = builder as unknown as BuilderCtx
  const coreMat = b.getThemedTrackMaterial('structure')
  const accentMat = b.getThemedTrackMaterial('energy')
  const glowMat = b.getThemedTrackMaterial('glow')
  let currentPos = b.currentStartPos.clone()
  let heading = 0

  const modeType = b.currentTrackInfo?.modeType ?? 'STATIONARY_TABLE'

  const dropLen = 15
  const dropIncline = (20 * Math.PI) / 180
  currentPos = b.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, coreMat) as Vector3

  const curve1Radius = 15
  const curve1Angle = Math.PI
  const curve1Incline = (5 * Math.PI) / 180
  currentPos = b.addCurvedRamp(currentPos, heading, curve1Radius, curve1Angle, curve1Incline, 6, 3.0, coreMat) as Vector3
  heading += curve1Angle

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(8)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= 2

  currentPos = b.addStraightRamp(currentPos, heading, 6, 5, 0, glowMat) as Vector3

  const corkRadius = 8
  const corkAngle = (270 * Math.PI) / 180
  const corkIncline = (15 * Math.PI) / 180
  currentPos = b.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 6, 1.0, coreMat) as Vector3
  heading += corkAngle

  if (modeType === 'STATIONARY_TABLE') {
    const bumpCentre = new Vector3(currentPos.x, currentPos.y + 0.5, currentPos.z + 2)
    const bumperPositions: Vector3[] = [
      new Vector3(bumpCentre.x,      bumpCentre.y, bumpCentre.z - 3),
      new Vector3(bumpCentre.x - 2,  bumpCentre.y, bumpCentre.z - 1),
      new Vector3(bumpCentre.x + 2,  bumpCentre.y, bumpCentre.z - 1),
      new Vector3(bumpCentre.x - 3,  bumpCentre.y, bumpCentre.z + 1),
      new Vector3(bumpCentre.x + 3,  bumpCentre.y, bumpCentre.z + 1),
      new Vector3(bumpCentre.x,      bumpCentre.y, bumpCentre.z + 3),
    ]
    for (const pos of bumperPositions) {
      b.createStaticCylinder(pos, 0.8, 1.2, accentMat)
    }

    b.createRotatingPlatform(
      new Vector3(currentPos.x, currentPos.y - 0.5, currentPos.z + 6),
      3.5, 0.8, b.getThemedTrackMaterial('accent'),
    )
  }

  const basinPos = new Vector3(currentPos.x, currentPos.y, currentPos.z + 8)
  b.addExitPortal(new Vector3(basinPos.x, basinPos.y + 1.6, basinPos.z))
  b.createBasin(basinPos, coreMat)
}
