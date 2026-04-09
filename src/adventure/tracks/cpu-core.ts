/**
 * CPU Core Track
 * 
 * A circuit board themed track with logic gates and heatsink fans.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildCpuCore(builder: TrackBuilder): void {
  const pcbMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#004400")
  const traceMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFD700")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Front Side Bus
  const entryLen = 15
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, entryLen, 0, pcbMat)

  // 2. The Logic Gate
  const gateWidth = 3
  const gateLen = 5

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)
  heading -= Math.PI / 2
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)
  heading += Math.PI / 2
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

  // 3. The Heatsink
  const fanRadius = 8
  const fanSpeed = 1.5

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const fanCenter = currentPos.add(forward.scale(fanRadius + 1))

  ;(builder as unknown as { createRotatingPlatform: (...args: unknown[]) => void }).createRotatingPlatform(fanCenter, fanRadius, -fanSpeed, pcbMat)

  if (world && adventureBodies.length > 0) {
    const fanBody = adventureBodies[adventureBodies.length - 1]
    const bladeCount = 4
    const bladeLength = fanRadius - 1
    const bladeHeight = 1.5
    const bladeThickness = 0.5

    for (let i = 0; i < bladeCount; i++) {
      const angle = (i * Math.PI * 2) / bladeCount

      const blade = MeshBuilder.CreateBox("fanBlade", { width: bladeThickness, height: bladeHeight, depth: bladeLength }, scene)
      const binding = kinematicBindings.find(b => b.body === fanBody)
      if (binding) {
        blade.parent = binding.mesh
        const lx = Math.sin(angle) * (bladeLength / 2)
        const lz = Math.cos(angle) * (bladeLength / 2)
        blade.position.set(lx, bladeHeight / 2, lz)
        blade.rotation.y = angle
        blade.material = traceMat

        const colRot = Quaternion.FromEulerAngles(0, angle, 0)
        const colliderDesc = rapier.ColliderDesc.cuboid(bladeThickness / 2, bladeHeight / 2, bladeLength / 2)
          .setTranslation(lx, bladeHeight / 2 + 0.25, lz)
          .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

        world.createCollider(colliderDesc, fanBody)
      }
    }
  }

  // 4. The Thermal Bridge
  const bridgeStart = fanCenter.add(forward.scale(fanRadius))
  const bridgeLen = 10
  const bridgeWidth = 2.0

  const bridgeEnd = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(bridgeStart, heading, bridgeWidth, bridgeLen, 0, traceMat)

  // 5. The Processor Die
  const goalPos = bridgeEnd.clone()
  goalPos.z += 4

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, pcbMat)

  const socket = MeshBuilder.CreateBox("cpuSocket", { width: 4, height: 0.2, depth: 4 }, scene)
  socket.position.copyFrom(goalPos)
  socket.position.y += 0.5
  socket.material = traceMat
  ;(builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack.push(socket)
}
