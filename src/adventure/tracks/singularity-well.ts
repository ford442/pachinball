/**
 * Singularity Well Track
 *
 * EXTENDED_MAP — a gravitational odyssey through orbital rings, a rimmed
 * half-pipe, and a steep inner-disc spiral. Exit portal is placed at the
 * bottom of the gravity well — the inescapable terminus.
 */

import { Vector3 } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type { TrackInfo } from '../../game-elements/adventure-track-progression'

type BuilderCtx = {
  getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial
  currentStartPos: Vector3
  currentTrackInfo: TrackInfo | null
  addStraightRamp: (...args: unknown[]) => Vector3
  addCurvedRamp: (...args: unknown[]) => Vector3
  createBasin: (...args: unknown[]) => void
  createArcPylon: (...args: unknown[]) => void
  addExitPortal: (position: Vector3) => void
}

export function buildSingularityWell(builder: TrackBuilder): void {
  const b = builder as unknown as BuilderCtx
  const wellMat = b.getTrackMaterial("#9900FF")
  const accentMat = b.getTrackMaterial("#cc44ff")
  let currentPos = b.currentStartPos.clone()
  let heading = 0

  const modeType = b.currentTrackInfo?.modeType ?? 'EXTENDED_MAP'

  // ── Injection lane ────────────────────────────────────────────────────────
  const injectLen = 12
  const injectIncline = (15 * Math.PI) / 180
  currentPos = b.addStraightRamp(currentPos, heading, 6, injectLen, injectIncline, wellMat) as Vector3

  // ── Outer rim — half-pipe curve ───────────────────────────────────────────
  const rimRadius = 14
  const rimAngle = Math.PI
  const rimIncline = (5 * Math.PI) / 180
  const rimBank = -(15 * Math.PI) / 180

  currentPos = b.addCurvedRamp(currentPos, heading, rimRadius, rimAngle, rimIncline, 6, 4.0, wellMat, 20, rimBank) as Vector3
  heading += rimAngle

  if (modeType === 'EXTENDED_MAP') {
    // Distant vista elements — arc pylons flanking the orbital path
    b.createArcPylon(new Vector3(currentPos.x - 8, currentPos.y, currentPos.z), accentMat)
    b.createArcPylon(new Vector3(currentPos.x + 8, currentPos.y, currentPos.z), accentMat)
  }

  // ── Gap ───────────────────────────────────────────────────────────────────
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(4)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= 2

  currentPos = b.addStraightRamp(currentPos, heading, 6, 4, 0, wellMat) as Vector3

  // ── Inner disc — steep banked spiral ──────────────────────────────────────
  const diskRadius = 8
  const diskAngle = (270 * Math.PI) / 180
  const diskIncline = (10 * Math.PI) / 180
  const diskBank = -(25 * Math.PI) / 180

  currentPos = b.addCurvedRamp(currentPos, heading, diskRadius, diskAngle, diskIncline, 6, 1.0, wellMat, 20, diskBank) as Vector3
  heading += diskAngle

  if (modeType === 'EXTENDED_MAP') {
    // Final plunge — vertical drop into the singularity
    currentPos = b.addStraightRamp(currentPos, heading, 5, 8, (35 * Math.PI) / 180, wellMat) as Vector3
  }

  // Portal at the well bottom — the singularity itself
  b.addExitPortal(new Vector3(currentPos.x, currentPos.y + 1.8, currentPos.z))

  b.createBasin(currentPos, wellMat)
}
