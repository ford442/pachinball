/**
 * Gravity Forge Track
 * 
 * An industrial track with conveyor belts, hydraulic pistons, and centrifugal casters.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildGravityForge(builder: TrackBuilder): void {
  const rustMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#8B4513")
  const steelMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#333333")
  const moltenMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF4500")
  const waterMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#0088FF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings
  const conveyorZones = (builder as unknown as { conveyorZones: { sensor: RAPIER.RigidBody, force: Vector3 }[] }).conveyorZones
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number }[] }).animatedObstacles
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Feed Chute
  const feedLen = 12
  const feedIncline = (30 * Math.PI) / 180
  const conveyorStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, feedLen, feedIncline, rustMat)

  if (world) {
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const hLen = feedLen * Math.cos(feedIncline)
    const vDrop = feedLen * Math.sin(feedIncline)
    const center = conveyorStart.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2
    center.y += 0.5

    const sensorBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
    )
    const q = Quaternion.FromEulerAngles(feedIncline, heading, 0)
    sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

    world.createCollider(
      rapier.ColliderDesc.cuboid(3, 1, feedLen / 2).setSensor(true),
      sensorBody
    )

    const forceDir = new Vector3(
      Math.sin(heading) * Math.cos(feedIncline),
      -Math.sin(feedIncline),
      Math.cos(heading) * Math.cos(feedIncline)
    )

    conveyorZones.push({
      sensor: sensorBody,
      force: forceDir.scale(50.0)
    })
  }

  // 2. The Crusher Line
  const crushLen = 20
  const crushWidth = 8
  const crushStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, crushWidth, crushLen, 0, steelMat)

  if (world) {
    const pistonWidth = 6
    const pistonDepth = 3
    const pistonHeight = 4
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const positions = [5, 10, 15]
    const phases = [0, 1.5, 3.0]

    for (let i = 0; i < 3; i++) {
      const dist = positions[i]
      const pistonPos = crushStart.add(forward.scale(dist))
      const floorY = pistonPos.y
      const gap = 0.2
      const amp = 2.0
      const minY = floorY + gap + pistonHeight / 2
      const midY = minY + amp
      const basePos = new Vector3(pistonPos.x, midY, pistonPos.z)

      const piston = MeshBuilder.CreateBox("piston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, scene)
      piston.position.copyFrom(basePos)
      piston.material = steelMat
      adventureTrack.push(piston)

      const body = world.createRigidBody(
        rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(pistonWidth / 2, pistonHeight / 2, pistonDepth / 2),
        body
      )
      adventureBodies.push(body)

      animatedObstacles.push({
        body,
        mesh: piston,
        type: 'PISTON',
        basePos,
        frequency: 2.0,
        amplitude: amp,
        phase: phases[i]
      })
    }
  }

  // 3. The Slag Bridge
  const turnRadius = 10
  const turnAngle = Math.PI / 2

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, -turnAngle, 0, 2, 0, moltenMat, 15)
  heading -= turnAngle

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 2, 0, moltenMat, 15)
  heading += turnAngle

  // 4. The Centrifugal Caster
  const castRadius = 10
  const castSpeed = 2.0

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const castCenter = currentPos.add(forward.scale(castRadius + 1))

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(castCenter, castRadius, castSpeed, steelMat)

  if (world && adventureBodies.length > 0) {
    const platformBody = adventureBodies[adventureBodies.length - 1]
    const wallHeight = 3.0
    const wallThickness = 0.5
    const gapAngle = (30 * Math.PI) / 180
    const wallAngle = (2 * Math.PI) - gapAngle
    const segments = 20
    const step = wallAngle / segments

    const binding = kinematicBindings.find(b => b.body === platformBody)
    const parentMesh = binding ? binding.mesh : null

    const startAngle = gapAngle / 2

    for (let i = 0; i <= segments; i++) {
      const theta = startAngle + i * step
      const cx = Math.sin(theta) * castRadius
      const cz = Math.cos(theta) * castRadius
      const arcLen = castRadius * step

      const wall = MeshBuilder.CreateBox("casterWall", { width: wallThickness, height: wallHeight, depth: arcLen + 0.2 }, scene)
      if (parentMesh) {
        wall.parent = parentMesh
        wall.position.set(cx, wallHeight / 2, cz)
        wall.rotation.y = theta
        wall.material = steelMat
      }

      const colRot = Quaternion.FromEulerAngles(0, theta, 0)
      const colliderDesc = rapier.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, arcLen / 2 + 0.1)
        .setTranslation(cx, wallHeight / 2 + 0.25, cz)
        .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

      world.createCollider(colliderDesc, platformBody)
    }
  }

  // 5. The Quenching Tank
  const exitForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = castCenter.add(exitForward.scale(castRadius + 4))
  goalPos.y -= 5.0

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, moltenMat)
  const basinMesh = adventureTrack[adventureTrack.length - 1]
  if (basinMesh) basinMesh.material = waterMat
}
