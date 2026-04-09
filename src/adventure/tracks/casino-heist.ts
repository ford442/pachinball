/**
 * Casino Heist Track
 * 
 * A casino-themed track with chip stacks, roulette wheel, and slot machine gates.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildCasinoHeist(builder: TrackBuilder): void {
  const feltMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#880000")
  const goldMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFD700")
  const chipMatRed = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF0000")
  const chipMatBlue = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#0000FF")
  const chipMatBlack = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#111111")
  const chipMatWhite = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFFFF")
  const chipMats = [chipMatRed, chipMatBlue, chipMatBlack, chipMatWhite]

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings
  const resetSensors = (builder as unknown as { resetSensors: RAPIER.RigidBody[] }).resetSensors
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number }[] }).animatedObstacles

  let currentPos = currentStartPos.clone()
  const heading = 0

  const entryLen = 15
  const entryIncline = (15 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, feltMat)

  // 2. The Chip Stack Maze
  const mazeLen = 20
  const mazeWidth = 12
  const mazeStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, mazeWidth, mazeLen, 0, feltMat)

  if (world) {
    const chipCount = 15
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let i = 0; i < chipCount; i++) {
      const dist = 2 + Math.random() * (mazeLen - 4)
      const offset = (Math.random() - 0.5) * (mazeWidth - 2)

      const pos = mazeStart.add(forward.scale(dist)).add(right.scale(offset))
      const stackHeight = 0.5 + Math.random() * 1.5
      const chipRadius = 1.0

      pos.y += stackHeight / 2

      const chip = MeshBuilder.CreateCylinder("pokerChip", { diameter: chipRadius * 2, height: stackHeight }, scene)
      chip.position.copyFrom(pos)
      chip.material = chipMats[Math.floor(Math.random() * chipMats.length)]
      adventureTrack.push(chip)

      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.cylinder(stackHeight / 2, chipRadius).setRestitution(0.8),
        body
      )
      adventureBodies.push(body)
    }

    // 3. The Roulette Wheel
    const wheelRadius = 12
    const wheelSpeed = 1.5

    const wheelCenter = currentPos.add(forward.scale(wheelRadius + 1))

    ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(wheelCenter, wheelRadius, wheelSpeed, feltMat)

    // Zero Pockets
    const pocketCount = 2
    const pocketAngleStep = Math.PI

    const sensorBodyDesc = rapier.RigidBodyDesc.kinematicVelocityBased()
      .setTranslation(wheelCenter.x, wheelCenter.y, wheelCenter.z)
    const sensorBody = world.createRigidBody(sensorBodyDesc)
    sensorBody.setAngvel({ x: 0, y: wheelSpeed, z: 0 }, true)

    resetSensors.push(sensorBody)
    adventureBodies.push(sensorBody)

    for (let i = 0; i < pocketCount; i++) {
      const angle = i * pocketAngleStep
      const r = wheelRadius * 0.7

      const lx = Math.sin(angle) * r
      const lz = Math.cos(angle) * r

      const sensorShape = rapier.ColliderDesc.cylinder(0.5, 1.0)
        .setTranslation(lx, 0.5, lz)
        .setSensor(true)

      world.createCollider(sensorShape, sensorBody)

      const marker = MeshBuilder.CreateCylinder("zeroPocket", { diameter: 2, height: 0.1 }, scene)
      if (kinematicBindings.length > 0) {
        const platformBinding = kinematicBindings[kinematicBindings.length - 1]
        marker.parent = platformBinding.mesh
        marker.position.set(lx, 0.55, lz)
        marker.material = chipMatBlack
      }
    }
  }

  // 4. The Slots
  const slotLen = 12
  const slotWidth = 8

  const wheelExit = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(12 + 1).add(currentPos)
  currentPos = wheelExit
  const slotStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, slotWidth, slotLen, 0, feltMat)

  if (world) {
    const gateCount = 3
    const gateWidth = slotWidth
    const gateHeight = 4.0
    const gateDepth = 0.5
    const spacing = 3.0

    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

    for (let i = 0; i < gateCount; i++) {
      const dist = 2.0 + i * spacing
      const pos = slotStart.add(forward.scale(dist))

      const amp = 2.5
      const phase = Math.random() * Math.PI * 2
      const freq = 1.0 + Math.random()

      const floorY = pos.y
      const basePos = new Vector3(pos.x, floorY, pos.z)

      const gate = MeshBuilder.CreateBox("slotGate", { width: gateWidth, height: gateHeight, depth: gateDepth }, scene)
      gate.position.copyFrom(basePos)
      gate.rotation.y = heading
      gate.material = goldMat
      adventureTrack.push(gate)

      const q = Quaternion.FromEulerAngles(0, heading, 0)
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(basePos.x, basePos.y, basePos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(gateWidth / 2, gateHeight / 2, gateDepth / 2),
        body
      )
      adventureBodies.push(body)

      animatedObstacles.push({
        body,
        mesh: gate,
        type: 'PISTON',
        basePos,
        frequency: freq * 3.0,
        amplitude: amp,
        phase
      })
    }
  }

  // 5. The Vault
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, goldMat)
}
