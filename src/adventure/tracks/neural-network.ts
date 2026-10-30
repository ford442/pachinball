/**
 * Neural Network Track
 * 
 * A bio-digital track with axon paths, synaptic gaps, and dendrite forests.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilderApi } from '../track-builder-api'
import { boxDesc, cylinderDesc, sphereDesc } from '../track-collider-descriptors'
import { getLayoutRng } from '../../core/seeded-rng'

export function buildNeuralNetwork(builder: TrackBuilderApi): void {
  const netMat = builder.getTrackMaterial("#FFFFFF")
  const veinMat = builder.getTrackMaterial("#FF0000")

  const {
    currentStartPos,
    scene,
    adventureTrack,
    adventureBodies,
    animatedObstacles,
    dampingZones,
  } = builder

  let currentPos = currentStartPos.clone()
  const heading = 0

  // 1. The Stimulus
  const stimLen = 12
  const stimIncline = (25 * Math.PI) / 180
  currentPos = builder.addStraightRamp(currentPos, heading, 6, stimLen, stimIncline, netMat)

  // 2. The Axon Terminal
  const forkStart = currentPos.clone()
  const forkHeading = heading

  // Left Path
  let leftPos = forkStart.clone()
  let leftHeading = forkHeading
  leftPos = builder.addCurvedRamp(leftPos, leftHeading, 10, Math.PI / 4, 0, 2, 0, veinMat, 10)
  leftHeading -= Math.PI / 4
  leftPos = builder.addStraightRamp(leftPos, leftHeading, 2, 5, 0, veinMat)
  leftPos = builder.addCurvedRamp(leftPos, leftHeading, 10, -Math.PI / 4, 0, 2, 0, veinMat, 10)

  // Right Path
  let rightPos = forkStart.clone()
  let rightHeading = forkHeading
  rightPos = builder.addCurvedRamp(rightPos, rightHeading, 10, -Math.PI / 4, 0, 6, 1.0, netMat, 10)
  rightHeading += Math.PI / 4
  const rightStraightStart = rightPos.clone()
  rightPos = builder.addStraightRamp(rightPos, rightHeading, 6, 5, 0, netMat)

  if (builder.hasWorld) {
    const forward = new Vector3(Math.sin(rightHeading), 0, Math.cos(rightHeading))
    const rockRadius = 0.5
    const rockPos = rightStraightStart.add(forward.scale(2.5))
    rockPos.y += 0.5
    const rock = MeshBuilder.CreateSphere("cellBody", { diameter: rockRadius * 2 }, scene)
    rock.position.copyFrom(rockPos)
    rock.material = veinMat
    adventureTrack.push(rock)
    const { body } = builder.emitCollider(
      sphereDesc({ x: rockPos.x, y: rockPos.y, z: rockPos.z }, rockRadius, { label: 'cellBody' })
    )
    adventureBodies.push(body)
  }

  rightPos = builder.addCurvedRamp(rightPos, rightHeading, 10, Math.PI / 4, 0, 6, 1.0, netMat, 10)

  // Converge
  currentPos = leftPos.add(rightPos).scale(0.5)

  // 3. The Synaptic Gap
  const gapLen = 6
  const gapStart = currentPos.clone()
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

  currentPos = currentPos.add(forward.scale(gapLen))

  if (builder.hasWorld) {
    const bridgeWidth = 4
    const bridgeLen = 4
    const bridgeHeight = 1.0

    const bridgeCenter = gapStart.add(forward.scale(gapLen / 2))
    const surfaceY = gapStart.y
    const submergedY = surfaceY - 2.0
    const midY = (surfaceY + submergedY) / 2
    const amp = (surfaceY - submergedY) / 2

    const basePos = new Vector3(bridgeCenter.x, midY, bridgeCenter.z)

    const box = MeshBuilder.CreateBox("synapseBridge", { width: bridgeWidth, height: bridgeHeight, depth: bridgeLen }, scene)
    box.position.copyFrom(basePos)
    box.rotation.y = heading
    box.material = veinMat
    adventureTrack.push(box)

    const q = Quaternion.FromEulerAngles(0, heading, 0)
    const { body } = builder.emitCollider(
      boxDesc(
        { x: basePos.x, y: basePos.y, z: basePos.z },
        { x: bridgeWidth / 2, y: bridgeHeight / 2, z: bridgeLen / 2 },
        {
          rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
          motion: 'kinematic-position',
          label: 'synapticBridge',
        }
      )
    )
    adventureBodies.push(body)

    animatedObstacles.push({
      body,
      mesh: box,
      type: 'PISTON',
      basePos,
      frequency: 2.0,
      amplitude: amp,
      phase: 0
    })
  }

  // 4. The Dendrite Forest
  const forestLen = 20
  const forestWidth = 10
  const forestStart = currentPos.clone()

  currentPos = builder.addStraightRamp(currentPos, heading, forestWidth, forestLen, 0, netMat)

  if (builder.hasWorld) {
    const hLen = forestLen
    const center = forestStart.add(forward.scale(hLen / 2))
    center.y += 0.5

    const q = Quaternion.FromEulerAngles(0, heading, 0)
    const { body: sensor } = builder.emitCollider(
      boxDesc(
        { x: center.x, y: center.y, z: center.z },
        { x: forestWidth / 2, y: 1, z: forestLen / 2 },
        {
          rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
          sensor: true,
          label: 'dendriteForestDamping',
        }
      )
    )

    dampingZones.push({
      sensor,
      damping: 2.0
    })

    const ciliaCount = 50
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    // Cilia are cylinder colliders: seeded placement.
    const layout = getLayoutRng('track:neural-network:cilia')
    for (let i = 0; i < ciliaCount; i++) {
      const dist = layout.next() * (forestLen - 2) + 1
      const offset = (layout.next() - 0.5) * (forestWidth - 1)
      const pos = forestStart.add(forward.scale(dist)).add(right.scale(offset))
      pos.y += 1.0

      const cilia = MeshBuilder.CreateCylinder("cilia", { diameter: 0.2, height: 2.0 }, scene)
      cilia.position.copyFrom(pos)
      cilia.material = veinMat
      adventureTrack.push(cilia)

      const { body } = builder.emitCollider(
        cylinderDesc({ x: pos.x, y: pos.y, z: pos.z }, 1.0, 0.1, { label: 'cilia' })
      )
      adventureBodies.push(body)
    }
  }

  // 5. The Soma
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2

  builder.createBasin(goalPos, netMat)
}
