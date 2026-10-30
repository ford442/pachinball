/**
 * CPU Core Track
 * 
 * A circuit board themed track with logic gates and heatsink fans.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilderApi } from '../track-builder-api'
import { boxDesc } from '../track-collider-descriptors'

export function buildCpuCore(builder: TrackBuilderApi): void {
  const pcbMat = builder.getTrackMaterial("#004400")
  const traceMat = builder.getTrackMaterial("#FFD700")

  const {
    currentStartPos,
    scene,
    adventureBodies,
    kinematicBindings,
  } = builder

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Front Side Bus
  const entryLen = 15
  currentPos = builder.addStraightRamp(currentPos, heading, 6, entryLen, 0, pcbMat)

  // 2. The Logic Gate
  const gateWidth = 3
  const gateLen = 5

  currentPos = builder.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)
  heading -= Math.PI / 2
  currentPos = builder.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)
  heading += Math.PI / 2
  currentPos = builder.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

  // 3. The Heatsink
  const fanRadius = 8
  const fanSpeed = 1.5

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const fanCenter = currentPos.add(forward.scale(fanRadius + 1))

  builder.createRotatingPlatform(fanCenter, fanRadius, -fanSpeed, pcbMat)

  if (builder.hasWorld && adventureBodies.length > 0) {
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
        builder.attachCollider(
          fanBody,
          boxDesc(
            { x: lx, y: bladeHeight / 2 + 0.25, z: lz },
            { x: bladeThickness / 2, y: bladeHeight / 2, z: bladeLength / 2 },
            {
              rotation: { x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w },
              label: 'fanBlade',
            }
          )
        )
      }
    }
  }

  // 4. The Thermal Bridge
  const bridgeStart = fanCenter.add(forward.scale(fanRadius))
  const bridgeLen = 10
  const bridgeWidth = 2.0

  const bridgeEnd = builder.addStraightRamp(bridgeStart, heading, bridgeWidth, bridgeLen, 0, traceMat)

  // 5. The Processor Die
  const goalPos = bridgeEnd.clone()
  goalPos.z += 4

  builder.createBasin(goalPos, pcbMat)

  const socket = MeshBuilder.CreateBox("cpuSocket", { width: 4, height: 0.2, depth: 4 }, scene)
  socket.position.copyFrom(goalPos)
  socket.position.y += 0.5
  socket.material = traceMat
  builder.adventureTrack.push(socket)
}
