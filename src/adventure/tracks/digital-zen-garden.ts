/**
 * Digital Zen Garden Track
 * 
 * A serene track with raked sand, rock gardens, and gentle streams.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildDigitalZenGarden(builder: TrackBuilder): void {
  const gardenMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFFFF")
  const accentMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF69B4")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const conveyorZones = (builder as unknown as { conveyorZones: { sensor: RAPIER.RigidBody, force: Vector3 }[] }).conveyorZones

  let currentPos = currentStartPos.clone()
  let heading = 0
  const sandFriction = 0.8

  // 1. The Raked Path
  const entryLen = 15
  const entryIncline = (15 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, gardenMat, 1.0, sandFriction)

  // 2. The Rock Garden
  const rockLen = 20
  const rockWidth = 12
  const rockStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, rockWidth, rockLen, 0, gardenMat, 0.5, sandFriction)

  if (world) {
    const rockRadius = 2.0
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    const positions = [
      { z: 12, x: 0 },
      { z: 6, x: -3.5 },
      { z: 6, x: 3.5 }
    ]

    positions.forEach(pos => {
      const rockPos = rockStart
        .add(forward.scale(pos.z))
        .add(right.scale(pos.x))
      rockPos.y += rockRadius * 0.6

      const rock = MeshBuilder.CreateSphere("zenRock", { diameter: rockRadius * 2, segments: 4 }, scene)
      rock.position.copyFrom(rockPos)
      rock.material = accentMat
      adventureTrack.push(rock)

      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.ball(rockRadius).setRestitution(0.2),
        body
      )
      adventureBodies.push(body)
    })
  }

  // 3. The Stream Crossing
  const streamRadius = 15
  const streamAngle = Math.PI / 2

  const streamStart = currentPos.clone()
  const streamStartHeading = heading
  const waterFriction = 0.1

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, streamRadius, streamAngle, 0, 8, 1.0, gardenMat, 20, 0, waterFriction)

  if (world) {
    const segments = 10
    const segAngle = streamAngle / segments
    const chordLen = 2 * streamRadius * Math.sin(segAngle / 2)

    let curH = streamStartHeading
    let curP = streamStart.clone()

    for (let i = 0; i < segments; i++) {
      curH += segAngle / 2
      const segForward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
      const center = curP.add(segForward.scale(chordLen / 2))
      center.y += 0.5

      const sensor = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
      )
      const q = Quaternion.FromEulerAngles(0, curH, 0)
      sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

      world.createCollider(
        rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true),
        sensor
      )

      const leftDir = new Vector3(-Math.cos(curH), 0, Math.sin(curH))
      conveyorZones.push({
        sensor,
        force: leftDir.scale(30.0)
      })

      curP = curP.add(segForward.scale(chordLen))
      curH += segAngle / 2
    }
  }
  heading += streamAngle

  // 4. The Moon Bridge
  const bridgeLen = 10
  const segments = 10
  const segLen = bridgeLen / segments
  const bridgeWidth = 3

  for (let i = 0; i < segments; i++) {
    const x0 = i * segLen
    const x1 = (i + 1) * segLen
    const xm = (x0 + x1) / 2
    const slope = -0.24 * (xm - 5)
    const incline = -Math.atan(slope)
    const meshLen = Math.sqrt(1 + slope * slope) * segLen

    currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, bridgeWidth, meshLen, incline, accentMat, 1.0, sandFriction)
  }

  // 5. The Lotus Shrine
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, accentMat)
}
