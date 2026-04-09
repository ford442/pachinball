/**
 * Neon Skyline Track
 * 
 * A rooftop-themed track with vent jumps and billboard wall rides.
 */

import { Vector3, MeshBuilder } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildNeonSkyline(builder: TrackBuilder): void {
  const skylineMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#111122")
  const windMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#AAFFFF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const conveyorZones = (builder as unknown as { conveyorZones: { sensor: RAPIER.RigidBody, force: Vector3 }[] }).conveyorZones

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Rooftop Run
  const entryLen = 15
  const entryIncline = (10 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, skylineMat)

  // 2. The Vent Jump
  const gapLen = 5
  const jumpHeight = 5.0

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const gapStart = currentPos.clone()

  if (world) {
    const center = gapStart.add(forward.scale(gapLen / 2))
    center.y -= 2.0

    const fan = MeshBuilder.CreateCylinder("ventFan", { diameter: 4, height: 0.5 }, scene)
    fan.position.copyFrom(center)
    fan.material = windMat
    adventureTrack.push(fan)

    const sensor = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y + 1.0, center.z)
    )
    world.createCollider(
      rapier.ColliderDesc.cylinder(3.0, 2.5).setSensor(true),
      sensor
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

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, skyWidth, skyLen, 0, skylineMat)

  if (world) {
    const unitCount = 6
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let i = 0; i < unitCount; i++) {
      const dist = 2 + Math.random() * (skyLen - 4)
      const offset = (Math.random() - 0.5) * (skyWidth - 2)

      const pos = skyStart.add(forward.scale(dist)).add(right.scale(offset))
      pos.y += 1.0

      const ac = MeshBuilder.CreateBox("acUnit", { size: 2 }, scene)
      ac.position.copyFrom(pos)
      ac.material = skylineMat
      adventureTrack.push(ac)

      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(1, 1, 1),
        body
      )
      adventureBodies.push(body)
    }
  }

  // 4. The Billboard
  const boardRadius = 12
  const boardAngle = Math.PI / 2
  const boardBank = -(45 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, boardRadius, boardAngle, 0, 8, 2.0, windMat, 20, boardBank)
  heading += boardAngle

  // 5. The Penthouse Landing
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, skylineMat)
}
