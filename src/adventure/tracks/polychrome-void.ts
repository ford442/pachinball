/**
 * Polychrome Void Track
 * 
 * A color-based puzzle track with chroma gates and colored platforms.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilder } from '../track-builder'
import { boxDesc } from '../track-collider-descriptors'
import type { PhysicsBody, PhysicsWorldSink } from '../../core/physics-api'
import { GROUP_RED, GROUP_GREEN, GROUP_BLUE, MASK_ALL } from '../adventure-types'

export function buildPolychromeVoid(builder: TrackBuilder): void {
  const whiteMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FFFFFF")
  const redMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#FF0000")
  const greenMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#00FF00")
  const blueMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core/Materials/standardMaterial').StandardMaterial }).getTrackMaterial("#0000FF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core/scene').Scene }).scene
  const world = (builder as unknown as { world: PhysicsWorldSink }).world
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core/Meshes/mesh').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: PhysicsBody[] }).adventureBodies
  const chromaGates = (builder as unknown as { chromaGates: { sensor: PhysicsBody, colorType: 'RED' | 'GREEN' | 'BLUE' }[] }).chromaGates
  void chromaGates // Used for gate tracking

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. Monochrome Injection
  const entryLen = 10
  const entryIncline = (15 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, whiteMat, 0, 0.5)

  // 2. The Red Shift
  const gatePos = currentPos.clone()
  gatePos.y += 1.0
  ;(builder as unknown as { createChromaGate: (...args: unknown[]) => void }).createChromaGate(gatePos, 'RED')

  // 3. Crimson Walkway
  const crimLen = 15
  const crimWidth = 4
  const crimStart = currentPos.clone()

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const crimCenter = crimStart.add(forward.scale(crimLen / 2))

  const floor = MeshBuilder.CreateBox("crimsonFloor", { width: crimWidth, height: 0.5, depth: crimLen }, scene)
  floor.position.copyFrom(crimCenter)
  floor.rotation.y = heading
  floor.material = redMat
  adventureTrack.push(floor)

  if (world) {
    const q = Quaternion.FromEulerAngles(0, heading, 0)
    const { body } = builder.emitCollider(
      boxDesc(
        { x: crimCenter.x, y: crimCenter.y, z: crimCenter.z },
        { x: crimWidth / 2, y: 0.25, z: crimLen / 2 },
        {
          rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
          membership: GROUP_RED,
          filter: MASK_ALL,
          label: 'crimsonWalkway',
        }
      )
    )
    adventureBodies.push(body)

    // Add Blue Ghosts
    const ghostCount = 5
    for (let i = 0; i < ghostCount; i++) {
      const dist = 3 + i * 2.5
      const offset = (Math.random() - 0.5) * (crimWidth - 1)
      const pos = crimStart.add(forward.scale(dist))
      const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
      const ghostPos = pos.add(right.scale(offset))
      ghostPos.y += 0.5

      const ghost = MeshBuilder.CreateBox("blueGhost", { size: 1.0 }, scene)
      ghost.position.copyFrom(ghostPos)
      ghost.material = blueMat
      adventureTrack.push(ghost)

      const { body: ghostBody } = builder.emitCollider(
        boxDesc({ x: ghostPos.x, y: ghostPos.y, z: ghostPos.z }, { x: 0.5, y: 0.5, z: 0.5 }, {
          membership: GROUP_BLUE,
          filter: MASK_ALL,
          label: 'blueGhost',
        })
      )
      adventureBodies.push(ghostBody)
    }
  }

  currentPos = crimStart.add(forward.scale(crimLen))

  // 4. The Green Filter
  const jumpGap = 4
  currentPos = currentPos.add(forward.scale(jumpGap))
  const greenGatePos = currentPos.clone()
  greenGatePos.y += 2.0
  ;(builder as unknown as { createChromaGate: (...args: unknown[]) => void }).createChromaGate(greenGatePos, 'GREEN')

  // 5. Emerald Isles
  const isleCount = 5
  const isleSpacing = 3
  const isleSize = 2

  for (let i = 0; i < isleCount; i++) {
    currentPos = currentPos.add(forward.scale(isleSpacing))

    const offset = 1.5
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    const greenLeft = Math.random() > 0.5

    const p1Pos = currentPos.add(right.scale(-offset))
    const p2Pos = currentPos.add(right.scale(offset))

    const createIsle = (pos: Vector3, color: 'GREEN' | 'RED') => {
      const mat = color === 'GREEN' ? greenMat : redMat
      const grp = color === 'GREEN' ? GROUP_GREEN : GROUP_RED

      const box = MeshBuilder.CreateBox("isle", { width: isleSize, height: 0.5, depth: isleSize }, scene)
      box.position.copyFrom(pos)
      box.material = mat
      adventureTrack.push(box)

      if (world) {
        const { body } = builder.emitCollider(
          boxDesc({ x: pos.x, y: pos.y, z: pos.z }, { x: isleSize / 2, y: 0.25, z: isleSize / 2 }, {
            membership: grp,
            filter: MASK_ALL,
            label: 'emeraldIsle',
          })
        )
        adventureBodies.push(body)
      }
    }

    createIsle(p1Pos, greenLeft ? 'GREEN' : 'RED')
    createIsle(p2Pos, greenLeft ? 'RED' : 'GREEN')
  }

  // 6. The Blue Shift
  currentPos = currentPos.add(forward.scale(isleSpacing))
  ;(builder as unknown as { createChromaGate: (...args: unknown[]) => void }).createChromaGate(currentPos, 'BLUE')

  // 7. Sapphire Spiral
  const spiralRadius = 10
  const spiralAngle = 2 * Math.PI
  const spiralIncline = -(10 * Math.PI) / 180

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 6, 1.0, blueMat, 20)
  heading += spiralAngle

  // 8. Whiteout
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, whiteMat)
}
