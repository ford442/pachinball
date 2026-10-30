/**
 * Bio-Hazard Lab Track
 * 
 * A toxic laboratory track with centrifuges and contaminated sludge.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilderApi } from '../track-builder-api'
import { boxDesc } from '../track-collider-descriptors'

export function buildBioHazardLab(builder: TrackBuilderApi): void {
  const hazardMat = builder.getTrackMaterial("#39FF14")
  const warningMat = builder.getTrackMaterial("#FFFF00")

  const {
    currentStartPos,
    scene,
    adventureBodies,
    kinematicBindings,
  } = builder

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Sludge Chute
  const chuteLen = 15
  const chuteIncline = (20 * Math.PI) / 180
  const sludgeFriction = 0.1

  currentPos = builder.addStraightRamp(currentPos, heading, 6, chuteLen, chuteIncline, hazardMat, 1.0, sludgeFriction)

  // 2. The Centrifuge
  const centrifugeRadius = 10
  const centrifugeSpeed = 3.0

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const centrifugeCenter = currentPos.add(forward.scale(centrifugeRadius + 1))
  centrifugeCenter.y -= 2.0

  builder.createRotatingPlatform(centrifugeCenter, centrifugeRadius, centrifugeSpeed, hazardMat)

  if (builder.hasWorld && adventureBodies.length > 0) {
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

        builder.attachCollider(
          platformBody,
          boxDesc(
            { x: cx, y: wallHeight / 2 + 0.25, z: cz },
            { x: wallThickness / 2, y: wallHeight / 2, z: arcLen / 2 + 0.2 },
            {
              rotation: { x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w },
              label: 'centrifugeWall',
            }
          )
        )
      }
    }
  }

  const exitDir = heading
  const exitForward = new Vector3(Math.sin(exitDir), 0, Math.cos(exitDir))
  const exitPos = centrifugeCenter.add(exitForward.scale(centrifugeRadius + 2))
  exitPos.y -= 1.0

  currentPos = exitPos

  // 3. The Pipeline
  currentPos = builder.addStraightRamp(currentPos, heading, 6, 4, 0, warningMat, 2.0)
  currentPos = builder.addStraightRamp(currentPos, heading, 2.5, 12, 0, hazardMat, 4.0)

  // 4. The Mixing Vats
  const turnRadius = 8
  const turnAngle = Math.PI / 2
  const halfAngle = turnAngle / 2
  const gapLen = 2.0

  currentPos = builder.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading -= halfAngle

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(gapForward.scale(gapLen))

  currentPos = builder.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading -= halfAngle

  currentPos = builder.addStraightRamp(currentPos, heading, 4, 3, 0, warningMat)

  currentPos = builder.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading += halfAngle

  const gapForward2 = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(gapForward2.scale(gapLen))

  currentPos = builder.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading += halfAngle

  // 5. Containment Unit
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2

  builder.createBasin(goalPos, hazardMat)
}
