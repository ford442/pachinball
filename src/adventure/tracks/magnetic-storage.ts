/**
 * Magnetic Storage Track
 * 
 * A hard drive themed track with rotating platters and actuator arms.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildMagneticStorage(builder: TrackBuilder): void {
  const storageMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#222222")
  const laserMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF0000")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh, type: string, basePos: Vector3, baseRot?: Quaternion, frequency: number, amplitude: number, phase: number, axis?: Vector3 }[] }).animatedObstacles

  let currentPos = currentStartPos.clone()
  const heading = 0

  // 1. The Write Head
  const entryLen = 12
  const entryIncline = (25 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, storageMat)

  // 2. The Platter
  const platterRadius = 12
  const platterSpeed = 2.5

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const platterCenter = currentPos.add(forward.scale(platterRadius + 1))
  platterCenter.y -= 1.0

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(platterCenter, platterRadius, platterSpeed, storageMat)

  // 3. Bad Sectors
  if (world && adventureBodies.length > 0) {
    const platterBody = adventureBodies[adventureBodies.length - 1]
    const binding = kinematicBindings.find(b => b.body === platterBody)

    const positions = [
      { r: 6, angle: 0 },
      { r: 9, angle: (120 * Math.PI) / 180 },
      { r: 4, angle: (240 * Math.PI) / 180 }
    ]

    positions.forEach(p => {
      const size = 2.0
      const box = MeshBuilder.CreateBox("badSector", { size }, scene)
      if (binding) {
        box.parent = binding.mesh
        const lx = Math.sin(p.angle) * p.r
        const lz = Math.cos(p.angle) * p.r
        box.position.set(lx, size / 2 + 0.25, lz)
        box.rotation.y = p.angle
        box.material = laserMat
      }

      const colRot = Quaternion.FromEulerAngles(0, p.angle, 0)
      world.createCollider(
        rapier.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
          .setTranslation(Math.sin(p.angle) * p.r, size / 2 + 0.25, Math.cos(p.angle) * p.r)
          .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w }),
        platterBody
      )
    })
  }

  // 4. The Actuator Arm
  const pivotDist = 16
  const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
  const pivotPos = platterCenter.add(right.scale(-pivotDist))
  pivotPos.y += 2.0

  const armLength = 10
  const armWidth = 1.0
  const armHeight = 1.0

  if (world) {
    const pivotMesh = MeshBuilder.CreateSphere("actuatorPivot", { diameter: 2 }, scene)
    pivotMesh.position.copyFrom(pivotPos)
    pivotMesh.material = storageMat
    ;(builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack.push(pivotMesh)

    const armBox = MeshBuilder.CreateBox("actuatorArm", { width: armLength, height: armHeight, depth: armWidth }, scene)
    armBox.parent = pivotMesh
    armBox.position.set(armLength / 2, 0, 0)
    armBox.material = storageMat

    const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(pivotPos.x, pivotPos.y, pivotPos.z)
    const body = world.createRigidBody(bodyDesc)

    world.createCollider(
      rapier.ColliderDesc.cuboid(armLength / 2, armHeight / 2, armWidth / 2)
        .setTranslation(armLength / 2, 0, 0),
      body
    )
    adventureBodies.push(body)

    animatedObstacles.push({
      body,
      mesh: pivotMesh,
      type: 'ROTATING_OSCILLATOR',
      basePos: pivotPos,
      baseRot: new Quaternion(),
      frequency: Math.PI,
      amplitude: Math.PI / 4,
      phase: 0,
      axis: new Vector3(0, 1, 0)
    })
  }

  // 5. The Data Cache
  const goalPos = platterCenter.add(right.scale(-platterRadius - 6))
  goalPos.y -= 2.0

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, storageMat)
}
