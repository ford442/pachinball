/**
 * Neon Stronghold Track
 * 
 * A fortress-themed track with drawbridges, portcullis gates, and courtyards.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildNeonStronghold(builder: TrackBuilder): void {
  const stoneMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#2F2F2F")
  const neonMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#0088FF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number }[] }).animatedObstacles

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Approach
  const approachLen = 15
  const approachIncline = (10 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, approachLen, approachIncline, stoneMat)

  // 2. The Drawbridge
  const moatLen = 6
  const jumpHeight = 2.0

  const waterPos = currentPos.clone()
  waterPos.y -= 3.0
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const waterCenter = waterPos.add(forward.scale(moatLen / 2))

  if (world) {
    const water = MeshBuilder.CreateBox("moatWater", { width: 10, height: 1, depth: moatLen }, scene)
    water.position.copyFrom(waterCenter)
    water.material = neonMat
    adventureTrack.push(water)
  }

  currentPos = currentPos.add(forward.scale(moatLen))
  currentPos.y += jumpHeight

  // 3. The Gatehouse
  const gatehouseLen = 18
  const gatehouseWidth = 4
  const gatehouseStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, gatehouseWidth, gatehouseLen, 0, stoneMat, 2.0)

  // Portcullis Gates
  if (world) {
    const gateCount = 3
    const gateSpacing = 4.0
    const startDist = 3.0
    const gateWidth = gatehouseWidth
    const gateHeight = 3.0
    const gateDepth = 0.5

    for (let i = 0; i < gateCount; i++) {
      const dist = startDist + i * gateSpacing
      const pos = gatehouseStart.add(forward.scale(dist))

      const floorY = pos.y
      const midY = floorY + gateHeight / 2 + 1.25
      const amp = 1.25
      const basePos = new Vector3(pos.x, midY, pos.z)

      const gate = MeshBuilder.CreateBox("portcullis", { width: gateWidth, height: gateHeight, depth: gateDepth }, scene)
      gate.position.copyFrom(basePos)
      gate.rotation.y = heading
      gate.material = neonMat
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
        frequency: 2.0,
        amplitude: amp,
        phase: i * 1.5
      })
    }
  }

  // 4. The Courtyard
  const courtRadius = 10
  const courtSpeed = 0.5
  const courtCenter = currentPos.add(forward.scale(courtRadius + 1))

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(courtCenter, courtRadius, courtSpeed, stoneMat)

  if (world && adventureBodies.length > 0) {
    const platformBody = adventureBodies[adventureBodies.length - 1]
    const turretCount = 2
    const turretDist = 6.0

    for (let i = 0; i < turretCount; i++) {
      const angle = i * Math.PI
      const turretHeight = 2.0
      const turretRadius = 1.0

      const turret = MeshBuilder.CreateCylinder("turret", { diameter: turretRadius * 2, height: turretHeight }, scene)
      const binding = kinematicBindings.find(b => b.body === platformBody)
      if (binding) {
        turret.parent = binding.mesh
        const cx = Math.sin(angle) * turretDist
        const cz = Math.cos(angle) * turretDist
        turret.position.set(cx, turretHeight / 2 + 0.25, cz)
        turret.material = neonMat

        world.createCollider(
          rapier.ColliderDesc.cylinder(turretHeight / 2, turretRadius)
            .setTranslation(cx, turretHeight / 2 + 0.25, cz),
          platformBody
        )
      }
    }
  }

  // 5. The Keep
  const keepRadius = 8
  const keepAngle = (270 * Math.PI) / 180
  const keepIncline = -(20 * Math.PI) / 180

  const keepStart = courtCenter.add(forward.scale(courtRadius + 1))
  currentPos = keepStart

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, keepRadius, keepAngle, keepIncline, 6, 2.0, stoneMat, 20)
  heading += keepAngle

  // 6. The Throne
  const goalPos = currentPos.clone()
  goalPos.y -= 1
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const finalGoalPos = goalPos.add(goalForward.scale(4))

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(finalGoalPos, neonMat)
}
