/**
 * Prism Pathway Track
 * 
 * A glass-themed track with refracting prisms and laser gauntlets.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilder } from '../track-builder'
import { convexMeshDesc, cylinderDesc } from '../track-collider-descriptors'
import { triangularPrismLayout } from '../track-geometry'
import type { PhysicsBody, PhysicsWorldSink } from '../../core/physics-api'

export function buildPrismPathway(builder: TrackBuilder): void {
  const glassMat = (builder as unknown as { getTrackPBRMaterial: (hex: string) => import('@babylonjs/core/Materials/PBR/pbrMaterial').PBRMaterial }).getTrackPBRMaterial("#E0FFFF")
  const laserMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FF00FF")
  const whiteMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FFFFFF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core/scene').Scene }).scene
  const world = (builder as unknown as { world: PhysicsWorldSink }).world
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core/Meshes/mesh').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: PhysicsBody[] }).adventureBodies
  const animatedObstacles = (builder as unknown as { animatedObstacles: { body: PhysicsBody, mesh: import('@babylonjs/core/Meshes/mesh').Mesh, type: string, basePos: Vector3, frequency: number, amplitude: number, phase: number, axis?: Vector3 }[] }).animatedObstacles

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Fiber Injection
  const entryLen = 15
  const entryIncline = (20 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, entryLen, entryIncline, glassMat)

  // 2. The Refractor Field
  const fieldLen = 20
  const fieldWidth = 10
  const fieldStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, glassMat)

  if (world) {
    const prismCount = 5
    const prismHeight = 1.5
    const prismRadius = 0.5

    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let i = 0; i < prismCount; i++) {
      const dist = 3 + Math.random() * (fieldLen - 6)
      const offset = (Math.random() - 0.5) * (fieldWidth - 2)

      const pos = fieldStart.add(forward.scale(dist)).add(right.scale(offset))
      pos.y += prismHeight / 2

      const prism = MeshBuilder.CreateCylinder("prism", { diameter: prismRadius * 2, height: prismHeight, tessellation: 3 }, scene)
      prism.position.copyFrom(pos)
      prism.rotation.y = Math.random() * Math.PI * 2
      prism.material = glassMat
      adventureTrack.push(prism)

      const q = Quaternion.FromEulerAngles(0, prism.rotation.y, 0)
      const { body } = builder.emitCollider(
        convexMeshDesc({ x: pos.x, y: pos.y, z: pos.z }, triangularPrismLayout(prismRadius, prismHeight), {
          rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
          restitution: 0.8,
          label: 'prism',
        })
      )
      adventureBodies.push(body)
    }

    // 3. The Laser Gauntlet
    const gauntletLen = 25
    const gauntletWidth = 8
    const gauntletStart = currentPos.clone()

    currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, gauntletWidth, gauntletLen, 0, glassMat)

    const laserCount = 3
    const laserHeight = 2.0
    const laserRadius = 0.2
    const spacing = gauntletLen / (laserCount + 1)

    for (let i = 0; i < laserCount; i++) {
      const dist = spacing * (i + 1)
      const basePos = gauntletStart.add(forward.scale(dist))
      basePos.y += laserHeight / 2

      const laser = MeshBuilder.CreateCylinder("laser", { diameter: laserRadius * 2, height: laserHeight }, scene)
      laser.position.copyFrom(basePos)
      laser.material = laserMat
      adventureTrack.push(laser)

      const { body } = builder.emitCollider(
        cylinderDesc({ x: basePos.x, y: basePos.y, z: basePos.z }, laserHeight / 2, laserRadius, {
          motion: 'kinematic-position',
          label: 'laser',
        })
      )
      adventureBodies.push(body)

      const freq = 1.5 + i * 0.5
      const phase = i * 1.0

      animatedObstacles.push({
        body,
        mesh: laser,
        type: 'OSCILLATOR',
        basePos: basePos,
        frequency: freq,
        amplitude: 3.0,
        phase: phase,
        axis: right
      })
    }
  }

  // 4. The Spectrum Loop
  const loopRadius = 8
  const loopAngle = 2 * Math.PI
  const loopIncline = -(10 * Math.PI) / 180
  const loopBank = (20 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, loopRadius, loopAngle, loopIncline, 8, 2.0, glassMat, 30, loopBank)
  heading += loopAngle

  // 5. The White Light
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, glassMat)

  const goalLight = MeshBuilder.CreateSphere("goalLight", { diameter: 2 }, scene)
  goalLight.position.copyFrom(goalPos)
  goalLight.position.y += 2
  goalLight.material = whiteMat
  adventureTrack.push(goalLight)
}
