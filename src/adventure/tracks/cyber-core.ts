/**
 * Cyber Core Track
 *
 * STATIONARY_TABLE — a compact pinball-style arena with corkscrew lanes,
 * a dense bumper cluster, and conveyor assist zones to keep the ball alive.
 * The exit portal sits in the arena centre, reachable from any lane.
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
  createStaticCylinder: (...args: unknown[]) => void
  createRotatingPlatform: (...args: unknown[]) => void
  addExitPortal: (position: Vector3) => void
}

export function buildCyberCore(builder: TrackBuilder): void {
  const b = builder as unknown as BuilderCtx
  const coreMat = b.getTrackMaterial("#ff0033")
  const accentMat = b.getTrackMaterial("#ff6600")
  let currentPos = b.currentStartPos.clone()
  let heading = 0

  const modeType = b.currentTrackInfo?.modeType ?? 'STATIONARY_TABLE'

  // ── Opening drop ──────────────────────────────────────────────────────────
  const dropLen = 15
  const dropIncline = (20 * Math.PI) / 180
  currentPos = b.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, coreMat) as Vector3

  // ── First banked curve ────────────────────────────────────────────────────
  const curve1Radius = 15
  const curve1Angle = Math.PI
  const curve1Incline = (5 * Math.PI) / 180
  currentPos = b.addCurvedRamp(currentPos, heading, curve1Radius, curve1Angle, curve1Incline, 6, 3.0, coreMat) as Vector3
  heading += curve1Angle

  // ── Gap transition ────────────────────────────────────────────────────────
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(8)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= 2

  currentPos = b.addStraightRamp(currentPos, heading, 6, 5, 0, coreMat) as Vector3

  // ── Corkscrew section ─────────────────────────────────────────────────────
  const corkRadius = 8
  const corkAngle = (270 * Math.PI) / 180
  const corkIncline = (15 * Math.PI) / 180
  currentPos = b.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 6, 1.0, coreMat) as Vector3
  heading += corkAngle

  if (modeType === 'STATIONARY_TABLE') {
    // ── Bumper cluster — diamond arrangement around arena midpoint ──────────
    // Six bumpers in a 2-row diamond for classic pinball density
    const bumpCentre = new Vector3(currentPos.x, currentPos.y + 0.5, currentPos.z + 2)
    const bumperPositions: Vector3[] = [
      new Vector3(bumpCentre.x,      bumpCentre.y, bumpCentre.z - 3),  // top
      new Vector3(bumpCentre.x - 2,  bumpCentre.y, bumpCentre.z - 1),  // mid-left
      new Vector3(bumpCentre.x + 2,  bumpCentre.y, bumpCentre.z - 1),  // mid-right
      new Vector3(bumpCentre.x - 3,  bumpCentre.y, bumpCentre.z + 1),  // lower-left
      new Vector3(bumpCentre.x + 3,  bumpCentre.y, bumpCentre.z + 1),  // lower-right
      new Vector3(bumpCentre.x,      bumpCentre.y, bumpCentre.z + 3),  // bottom
    ]
    for (const pos of bumperPositions) {
      b.createStaticCylinder(pos, 0.8, 1.2, accentMat)
    }

    // ── Slow rotating sling platform at the base of the arena ───────────────
    b.createRotatingPlatform(
      new Vector3(currentPos.x, currentPos.y - 0.5, currentPos.z + 6),
      3.5, 0.8, coreMat
    )
  }

  // ── Catch basin — arena floor ─────────────────────────────────────────────
  const basinPos = new Vector3(currentPos.x, currentPos.y, currentPos.z + 8)

  // Portal hovers above the basin — reachable from any lane
  b.addExitPortal(new Vector3(basinPos.x, basinPos.y + 1.6, basinPos.z))

  b.createBasin(basinPos, coreMat)
}
