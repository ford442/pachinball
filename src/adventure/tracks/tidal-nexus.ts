/**
 * Tidal Nexus Track
 * 
 * A water-themed track with turbines, riptides, and wave pools.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildTidalNexus(builder: TrackBuilder): void {
  const waterMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#0066FF")
  const foamMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#E0FFFF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings
  const conveyorZones = (builder as unknown as { conveyorZones: { sensor: RAPIER.RigidBody, force: Vector3 }[] }).conveyorZones
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number }[] }).animatedObstacles

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Spillway
  const spillLen = 15
  const spillIncline = (20 * Math.PI) / 180
  const spillStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, spillLen, spillIncline, waterMat)

  if (world) {
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const hLen = spillLen * Math.cos(spillIncline)
    const vDrop = spillLen * Math.sin(spillIncline)
    const center = spillStart.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2
    center.y += 0.5

    const sensorBody = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
    )
    const q = Quaternion.FromEulerAngles(spillIncline, heading, 0)
    sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

    world.createCollider(
      rapier.ColliderDesc.cuboid(3, 1, spillLen / 2).setSensor(true),
      sensorBody
    )

    const forceDir = new Vector3(
      Math.sin(heading) * Math.cos(spillIncline),
      -Math.sin(spillIncline),
      Math.cos(heading) * Math.cos(spillIncline)
    )
    conveyorZones.push({
      sensor: sensorBody,
      force: forceDir.scale(60.0)
    })
  }

  // 2. The Turbine
  const turbineRadius = 8
  const turbineSpeed = 1.5

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const turbineCenter = currentPos.add(forward.scale(turbineRadius + 1))

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(turbineCenter, turbineRadius, -turbineSpeed, waterMat)

  if (world) {
    const platformBody = adventureBodies[adventureBodies.length - 1]
    const paddleCount = 4
    const paddleLen = turbineRadius - 1
    const paddleHeight = 1.5
    const paddleThick = 0.5

    for (let i = 0; i < paddleCount; i++) {
      const angle = (i * Math.PI * 2) / paddleCount
      const paddle = MeshBuilder.CreateBox("paddle", { width: paddleThick, height: paddleHeight, depth: paddleLen }, scene)
      const binding = kinematicBindings.find(b => b.body === platformBody)
      if (binding) {
        paddle.parent = binding.mesh
        const r = paddleLen / 2
        const lx = Math.sin(angle) * r
        const lz = Math.cos(angle) * r
        paddle.position.set(lx, paddleHeight / 2, lz)
        paddle.rotation.y = angle
        paddle.material = foamMat
      }

      const colRot = Quaternion.FromEulerAngles(0, angle, 0)
      const colliderDesc = rapier.ColliderDesc.cuboid(paddleThick / 2, paddleHeight / 2, paddleLen / 2)
        .setTranslation(Math.sin(angle) * paddleLen / 2, paddleHeight / 2 + 0.25, Math.cos(angle) * paddleLen / 2)
        .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

      world.createCollider(colliderDesc, platformBody)
    }
  }

  const turbineExit = turbineCenter.add(forward.scale(turbineRadius))
  currentPos = turbineExit

  // 3. The Riptide
  const ripRadius = 12
  const ripAngle = Math.PI
  const ripIncline = (5 * Math.PI) / 180
  const ripBank = -(10 * Math.PI) / 180

  const ripStart = currentPos.clone()

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, ripRadius, ripAngle, ripIncline, 8, 2.0, waterMat, 20, ripBank)

  if (world) {
    const segments = 20
    const segmentAngle = ripAngle / segments
    const arcLength = ripRadius * segmentAngle
    const chordLen = 2 * ripRadius * Math.sin(segmentAngle / 2)
    const segmentDrop = arcLength * Math.sin(ripIncline)

    let curH = heading
    let curP = ripStart.clone()

    for (let i = 0; i < segments; i++) {
      curH += (segmentAngle / 2)

      const segForward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
      const center = curP.add(segForward.scale(chordLen / 2))
      center.y -= segmentDrop / 2
      center.y += 0.5

      const sensorBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
      )
      const q = Quaternion.FromEulerAngles(ripIncline, curH, ripBank)
      sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

      world.createCollider(
        rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true),
        sensorBody
      )

      const outwardDir = new Vector3(Math.cos(curH), 0, -Math.sin(curH))
      conveyorZones.push({
        sensor: sensorBody,
        force: outwardDir.scale(40.0)
      })

      curP = curP.add(segForward.scale(chordLen))
      curP.y -= segmentDrop
      curH += (segmentAngle / 2)
    }
  }
  heading += ripAngle

  // 4. The Wave Pool
  const poolLen = 20
  const poolWidth = 8

  const poolStart = currentPos.clone()
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, poolWidth, poolLen, 0, waterMat)

  if (world) {
    const rows = 5
    const rowSpacing = 3.0
    const startDist = 3.0
    const boxWidth = poolWidth - 1
    const boxDepth = 2.0
    const boxHeight = 1.0

    for (let i = 0; i < rows; i++) {
      const dist = startDist + i * rowSpacing
      const pos = poolStart.add(forward.scale(dist))
      const basePos = pos.clone()
      basePos.y -= 0.5

      const box = MeshBuilder.CreateBox("waveBox", { width: boxWidth, height: boxHeight, depth: boxDepth }, scene)
      box.position.copyFrom(basePos)
      box.rotation.y = heading
      box.material = foamMat
      ;(builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack.push(box)

      const q = Quaternion.FromEulerAngles(0, heading, 0)
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(basePos.x, basePos.y, basePos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(boxWidth / 2, boxHeight / 2, boxDepth / 2),
        body
      )
      adventureBodies.push(body)

      animatedObstacles.push({
        body,
        mesh: box,
        type: 'PISTON',
        basePos,
        frequency: 3.0,
        amplitude: 1.5,
        phase: dist * 0.5
      })
    }
  }

  // 5. The Abyssal Drop
  const goalPos = currentPos.clone()
  goalPos.y -= 4
  goalPos.z += 4

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, waterMat)
}
