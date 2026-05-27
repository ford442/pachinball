/**
 * Quantum Grid Track
 *
 * EXTENDED_MAP — a labyrinthine maze of quantum pathways with zig-zag runs,
 * an orbital loop, and navigation gates. Exit portal is placed at the far end
 * of the maze journey.
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
  createChromaGate: (...args: unknown[]) => void
  addExitPortal: (position: Vector3) => void
}

export function buildQuantumGrid(builder: TrackBuilder): void {
  const b = builder as unknown as BuilderCtx
  const gridMat = b.getTrackMaterial("#00FF00")
  let currentPos = b.currentStartPos.clone()
  let heading = 0

  const modeType = b.currentTrackInfo?.modeType ?? 'EXTENDED_MAP'

  // ── Opening straight ──────────────────────────────────────────────────────
  currentPos = b.addStraightRamp(currentPos, heading, 4, 10, 0, gridMat) as Vector3

  // ── Zig-zag maze section ──────────────────────────────────────────────────
  const zigzagWidth = 3
  const zigzagLen = 5

  currentPos = b.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, 0, gridMat) as Vector3
  heading -= Math.PI / 2
  currentPos = b.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, 0, gridMat) as Vector3
  heading += Math.PI / 2
  currentPos = b.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, 0, gridMat) as Vector3

  if (modeType === 'EXTENDED_MAP') {
    // Additional zig-zag legs for a longer scrolling path
    heading -= Math.PI / 2
    currentPos = b.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, 0, gridMat) as Vector3
    heading += Math.PI / 2
    currentPos = b.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, 0, gridMat) as Vector3

    // Navigation gate (chroma check) before the orbital loop
    b.createChromaGate(
      new Vector3(currentPos.x, currentPos.y + 1.5, currentPos.z + 2),
      'GREEN'
    )
  }

  // ── Orbital loop ──────────────────────────────────────────────────────────
  const orbitRadius = 6
  const orbitAngle = (270 * Math.PI) / 180
  const orbitIncline = -(5 * Math.PI) / 180
  const orbitWallHeight = 0.5

  currentPos = b.addCurvedRamp(
    currentPos, heading, orbitRadius, orbitAngle, orbitIncline, zigzagWidth, orbitWallHeight, gridMat
  ) as Vector3
  heading += orbitAngle

  // ── Final run to terminus ─────────────────────────────────────────────────
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(4)
  currentPos = currentPos.add(gapForward)
  currentPos.y -= 1

  currentPos = b.addStraightRamp(currentPos, heading, 4, 3, 0, gridMat) as Vector3

  // Portal at the maze terminus — the logical end of the quantum labyrinth
  b.addExitPortal(new Vector3(currentPos.x, currentPos.y + 1.8, currentPos.z))

  b.createBasin(currentPos, gridMat)
}
