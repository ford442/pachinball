/**
 * Casino Heist Track
 * 
 * A casino-themed track with chip stacks, roulette wheel, and slot machine gates.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilder } from '../track-builder'
import { boxDesc, cylinderDesc } from '../track-collider-descriptors'
import type { EmittedCollider } from '../track-collider-emitter'
import type { PhysicsBody, PhysicsWorldSink } from '../../core/physics-api'

export function buildCasinoHeist(builder: TrackBuilder): void {
  const feltMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#880000")
  const goldMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FFD700")
  const chipMatRed = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FF0000")
  const chipMatBlue = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#0000FF")
  const chipMatBlack = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#111111")
  const chipMatWhite = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FFFFFF")
  const chipMats = [chipMatRed, chipMatBlue, chipMatBlack, chipMatWhite]

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core/scene').Scene }).scene
  const world = (builder as unknown as { world: PhysicsWorldSink }).world
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core/Meshes/mesh').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: PhysicsBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: PhysicsBody, mesh: import('@babylonjs/core/Meshes/mesh').Mesh }[] }).kinematicBindings
  const resetSensors = (builder as unknown as { resetSensors: PhysicsBody[] }).resetSensors
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: PhysicsBody, mesh: import('@babylonjs/core/Meshes/mesh').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number }[] }).animatedObstacles

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

      const { body } = builder.emitCollider(
        cylinderDesc({ x: pos.x, y: pos.y, z: pos.z }, stackHeight / 2, chipRadius, {
          restitution: 0.8,
          label: 'pokerChip',
        })
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

    // The wheel's zero pockets are sensors riding the spinning wheel body.
    // The first is emitted as the body; the rest attach to it.
    let wheel: EmittedCollider | null = null

    for (let i = 0; i < pocketCount; i++) {
      const angle = i * pocketAngleStep
      const r = wheelRadius * 0.7

      const lx = Math.sin(angle) * r
      const lz = Math.cos(angle) * r

      if (!wheel) {
        wheel = builder.emitCollider(
          cylinderDesc(
            { x: wheelCenter.x, y: wheelCenter.y, z: wheelCenter.z },
            0.5,
            1.0,
            {
              sensor: true,
              motion: 'kinematic-velocity',
              angularVelocity: { x: 0, y: wheelSpeed, z: 0 },
              localPosition: { x: lx, y: 0.5, z: lz },
              label: 'zeroPocket',
            }
          )
        )
        resetSensors.push(wheel.body)
        adventureBodies.push(wheel.body)
      } else {
        builder.attachCollider(
          wheel,
          cylinderDesc({ x: lx, y: 0.5, z: lz }, 0.5, 1.0, { sensor: true, label: 'zeroPocket' })
        )
      }

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
      const { body } = builder.emitCollider(
        boxDesc(
          { x: basePos.x, y: basePos.y, z: basePos.z },
          { x: gateWidth / 2, y: gateHeight / 2, z: gateDepth / 2 },
          {
            rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
            motion: 'kinematic-position',
            label: 'slotGate',
          }
        )
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
