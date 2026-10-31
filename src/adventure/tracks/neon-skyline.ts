/**
 * Neon Skyline Track
 * 
 * A rooftop-themed track with vent jumps and billboard wall rides.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilderApi } from '../track-builder-api'
import { boxDesc, cylinderDesc } from '../track-collider-descriptors'
import { getLayoutRng } from '../../core/seeded-rng'

export function buildNeonSkyline(builder: TrackBuilderApi): void {
  const skylineMat = builder.getTrackMaterial("#111122")
  const windMat = builder.getTrackMaterial("#AAFFFF")

  const {
    currentStartPos,
    scene,
    adventureTrack,
    adventureBodies,
    conveyorZones,
  } = builder

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Rooftop Run
  const entryLen = 15
  const entryIncline = (10 * Math.PI) / 180
  currentPos = builder.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, skylineMat)

  // 2. The Vent Jump
  const gapLen = 5
  const jumpHeight = 5.0

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const gapStart = currentPos.clone()

  if (builder.hasWorld) {
    const center = gapStart.add(forward.scale(gapLen / 2))
    center.y -= 2.0

    const fan = MeshBuilder.CreateCylinder("ventFan", { diameter: 4, height: 0.5 }, scene)
    fan.position.copyFrom(center)
    fan.material = windMat
    adventureTrack.push(fan)

    const { body: sensor } = builder.emitCollider(
      cylinderDesc({ x: center.x, y: center.y + 1.0, z: center.z }, 3.0, 2.5, {
        sensor: true,
        label: 'ventFanUpdraft',
      })
    )

    conveyorZones.push({
      sensor,
      force: new Vector3(0, 250.0, 0)
    })
  }

  currentPos = currentPos.add(forward.scale(gapLen))
  currentPos.y += jumpHeight

  // 3. The Skyscraper
  const skyLen = 15
  const skyWidth = 10
  const skyStart = currentPos.clone()

  currentPos = builder.addStraightRamp(currentPos, heading, skyWidth, skyLen, 0, skylineMat)

  if (builder.hasWorld) {
    const unitCount = 6
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    // AC units are box colliders: seeded placement.
    const layout = getLayoutRng('track:neon-skyline:ac-units')
    for (let i = 0; i < unitCount; i++) {
      const dist = 2 + layout.next() * (skyLen - 4)
      const offset = (layout.next() - 0.5) * (skyWidth - 2)

      const pos = skyStart.add(forward.scale(dist)).add(right.scale(offset))
      pos.y += 1.0

      const ac = MeshBuilder.CreateBox("acUnit", { size: 2 }, scene)
      ac.position.copyFrom(pos)
      ac.material = skylineMat
      adventureTrack.push(ac)

      const { body } = builder.emitCollider(
        boxDesc({ x: pos.x, y: pos.y, z: pos.z }, { x: 1, y: 1, z: 1 }, { label: 'acUnit' })
      )
      adventureBodies.push(body)
    }
  }

  // 4. The Billboard
  const boardRadius = 12
  const boardAngle = Math.PI / 2
  const boardBank = -(45 * Math.PI) / 180

  currentPos = builder.addCurvedRamp(currentPos, heading, boardRadius, boardAngle, 0, 8, 2.0, windMat, 20, boardBank)
  heading += boardAngle

  // 5. The Penthouse Landing
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  builder.createBasin(goalPos, skylineMat)
}
