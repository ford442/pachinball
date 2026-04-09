/**
 * Polychrome Void Track
 * 
 * A color-based puzzle track with chroma gates and colored platforms.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GROUP_RED, GROUP_GREEN, GROUP_BLUE, MASK_ALL } from '../adventure-types'

export function buildPolychromeVoid(builder: TrackBuilder): void {
  const whiteMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFFFF")
  const redMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF0000")
  const greenMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#00FF00")
  const blueMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#0000FF")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const chromaGates = (builder as unknown as { chromaGates: { sensor: RAPIER.RigidBody, colorType: 'RED' | 'GREEN' | 'BLUE' }[] }).chromaGates
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
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(crimCenter.x, crimCenter.y, crimCenter.z)
    )
    const q = Quaternion.FromEulerAngles(0, heading, 0)
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

    const collider = rapier.ColliderDesc.cuboid(crimWidth / 2, 0.25, crimLen / 2)
    const groups = (GROUP_RED << 16) | MASK_ALL
    collider.setCollisionGroups(groups)

    world.createCollider(collider, body)
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

      const ghostBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(ghostPos.x, ghostPos.y, ghostPos.z)
      )
      const ghostCollider = rapier.ColliderDesc.cuboid(0.5, 0.5, 0.5)
      const ghostGroups = (GROUP_BLUE << 16) | MASK_ALL
      ghostCollider.setCollisionGroups(ghostGroups)

      world.createCollider(ghostCollider, ghostBody)
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
        const body = world.createRigidBody(
          rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
        )
        const col = rapier.ColliderDesc.cuboid(isleSize / 2, 0.25, isleSize / 2)
        col.setCollisionGroups((grp << 16) | MASK_ALL)
        world.createCollider(col, body)
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
