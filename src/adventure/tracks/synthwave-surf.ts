/**
 * Synthwave Surf Track
 * 
 * A retro-futuristic track with equalizer obstacles and high-pass filter turns.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildSynthwaveSurf(builder: TrackBuilder): void {
  const floorMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#110022")
  const gridMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#00FFFF")
  const barMat1 = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#00FF00")
  const barMat2 = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF0000")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number }[] }).animatedObstacles

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Bass Drop
  const dropLen = 15
  const dropIncline = (25 * Math.PI) / 180

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 8, dropLen, dropIncline, floorMat)

  // 2. The Equalizer
  const eqLen = 20
  const eqWidth = 10
  const eqStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, eqWidth, eqLen, 0, floorMat)

  if (world) {
    const rows = 5
    const cols = 4
    const rowSpacing = 3.0
    const colSpacing = 2.0
    const pistonWidth = 1.5
    const pistonHeight = 3.0
    const pistonDepth = 1.5
    const startZ = 2.0
    const startX = -((cols - 1) * colSpacing) / 2

    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const zOffset = startZ + r * rowSpacing
        const xOffset = startX + c * colSpacing

        const pistonPos = eqStart.add(forward.scale(zOffset)).add(right.scale(xOffset))
        const floorY = pistonPos.y
        const oscBaseY = floorY + pistonHeight / 2
        const animBasePos = new Vector3(pistonPos.x, oscBaseY - pistonHeight / 2, pistonPos.z)

        const box = MeshBuilder.CreateBox("eqPiston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, scene)
        box.position.copyFrom(animBasePos)
        box.rotation.y = heading
        box.material = (r % 2 === 0) ? barMat1 : barMat2
        adventureTrack.push(box)

        const q = Quaternion.FromEulerAngles(0, heading, 0)
        const body = world.createRigidBody(
          rapier.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(animBasePos.x, animBasePos.y, animBasePos.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        )
        world.createCollider(
          rapier.ColliderDesc.cuboid(pistonWidth / 2, pistonHeight / 2, pistonDepth / 2),
          body
        )
        adventureBodies.push(body)

        animatedObstacles.push({
          body,
          mesh: box,
          type: 'PISTON',
          basePos: animBasePos,
          frequency: 4.0,
          amplitude: 1.5,
          phase: xOffset * 0.5 + r * 1.0
        })
      }
    }
  }

  // 3. The High-Pass Filter
  const turnRadius = 12
  const turnAngle = Math.PI
  const turnIncline = -(5 * Math.PI) / 180
  const turnBank = -(15 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 8, 2.0, gridMat, 20, turnBank)
  heading += turnAngle

  // 4. The Sub-Woofer
  const spiralRadius = 6
  const spiralAngle = 2 * Math.PI
  const spiralIncline = (15 * Math.PI) / 180
  const spiralBank = -(30 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 8, 2.0, floorMat, 30, spiralBank)
  heading += spiralAngle

  // 5. The Mic Drop
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, gridMat)
}
