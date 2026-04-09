/**
 * Bio-Hazard Lab Track
 * 
 * A toxic laboratory track with centrifuges and contaminated sludge.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildBioHazardLab(builder: TrackBuilder): void {
  const hazardMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#39FF14")
  const warningMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFF00")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  void adventureTrack // Used for visual mesh tracking
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Sludge Chute
  const chuteLen = 15
  const chuteIncline = (20 * Math.PI) / 180
  const sludgeFriction = 0.1

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, chuteLen, chuteIncline, hazardMat, 1.0, sludgeFriction)

  // 2. The Centrifuge
  const centrifugeRadius = 10
  const centrifugeSpeed = 3.0

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const centrifugeCenter = currentPos.add(forward.scale(centrifugeRadius + 1))
  centrifugeCenter.y -= 2.0

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(centrifugeCenter, centrifugeRadius, centrifugeSpeed, hazardMat)

  if (world && adventureBodies.length > 0) {
    const platformBody = adventureBodies[adventureBodies.length - 1]
    const wallHeight = 0.5
    const wallThickness = 0.5

    const torus = MeshBuilder.CreateTorus("centrifugeWall", {
      diameter: centrifugeRadius * 2,
      thickness: wallThickness,
      tessellation: 32
    }, scene)

    const binding = kinematicBindings.find(b => b.body === platformBody)
    if (binding) {
      torus.parent = binding.mesh
      torus.position.set(0, wallHeight / 2, 0)
      torus.material = warningMat

      const segments = 16
      const angleStep = (Math.PI * 2) / segments

      for (let i = 0; i < segments; i++) {
        const angle = i * angleStep
        const cx = Math.sin(angle) * centrifugeRadius
        const cz = Math.cos(angle) * centrifugeRadius

        const colRot = Quaternion.FromEulerAngles(0, angle, 0)
        const arcLen = centrifugeRadius * angleStep

        const colliderDesc = rapier.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, arcLen / 2 + 0.2)
          .setTranslation(cx, wallHeight / 2 + 0.25, cz)
          .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

        world.createCollider(colliderDesc, platformBody)
      }
    }
  }

  const exitDir = heading
  const exitForward = new Vector3(Math.sin(exitDir), 0, Math.cos(exitDir))
  const exitPos = centrifugeCenter.add(exitForward.scale(centrifugeRadius + 2))
  exitPos.y -= 1.0

  currentPos = exitPos

  // 3. The Pipeline
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, 4, 0, warningMat, 2.0)
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 2.5, 12, 0, hazardMat, 4.0)

  // 4. The Mixing Vats
  const turnRadius = 8
  const turnAngle = Math.PI / 2
  const halfAngle = turnAngle / 2
  const gapLen = 2.0

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading -= halfAngle

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(gapForward.scale(gapLen))

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading -= halfAngle

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, 3, 0, warningMat)

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading += halfAngle

  const gapForward2 = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(gapForward2.scale(gapLen))

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading += halfAngle

  // 5. Containment Unit
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, hazardMat)
}
