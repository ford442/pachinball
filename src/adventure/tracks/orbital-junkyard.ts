/**
 * Orbital Junkyard Track
 * 
 * A debris-filled track with space junk obstacles and the Crusher choke point.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildOrbitalJunkyard(builder: TrackBuilder): void {
  const junkMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#888888")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies

  let currentPos = currentStartPos.clone()
  const heading = 0

  // 1. Launch Tube
  const launchLen = 8
  const launchIncline = (10 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 4, launchLen, launchIncline, junkMat)

  // 2. The Debris Field
  const debrisLen = 25
  const debrisIncline = (5 * Math.PI) / 180
  const debrisWidth = 10

  const debrisStartPos = currentPos.clone()
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, debrisWidth, debrisLen, debrisIncline, junkMat)

  // 3. Debris Objects
  if (world) {
    const debrisCount = 25
    const forwardVec = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
    const rightVec = new Vector3(1, 0, 0)
    const normalVec = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

    for (let i = 0; i < debrisCount; i++) {
      const dist = 2 + Math.random() * (debrisLen - 6)
      const offset = (Math.random() - 0.5) * (debrisWidth - 2)

      const debrisPosOnSurface = debrisStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(offset))
      const type = Math.random() > 0.5 ? 'box' : 'tetra'
      const scale = 0.5 + Math.random() * 1.0
      const finalPos = debrisPosOnSurface.add(normalVec.scale(scale * 0.5))

      let mesh: import('@babylonjs/core').Mesh
      let colliderDesc: RAPIER.ColliderDesc

      if (type === 'box') {
        mesh = MeshBuilder.CreateBox("junkBox", { size: scale }, scene)
        colliderDesc = rapier.ColliderDesc.cuboid(scale / 2, scale / 2, scale / 2)
      } else {
        mesh = MeshBuilder.CreatePolyhedron("junkTetra", { type: 0, size: scale * 0.6 }, scene)
        colliderDesc = rapier.ColliderDesc.cuboid(scale / 3, scale / 3, scale / 3)
      }

      mesh.position.copyFrom(finalPos)
      mesh.rotation.x = Math.random() * Math.PI
      mesh.rotation.y = Math.random() * Math.PI
      mesh.rotation.z = Math.random() * Math.PI
      mesh.material = junkMat
      adventureTrack.push(mesh)

      const q = Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed()
          .setTranslation(finalPos.x, finalPos.y, finalPos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      world.createCollider(colliderDesc, body)
      adventureBodies.push(body)
    }

    // 4. The Crusher
    const crusherDistFromEnd = 2
    const forwardVec2 = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
    const rightVec2 = new Vector3(1, 0, 0)
    const normalVec2 = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

    const crusherCenterPos = debrisStartPos.add(forwardVec2.scale(debrisLen - crusherDistFromEnd))
    const gapWidth = 2
    const blockWidth = (debrisWidth - gapWidth) / 2
    const blockHeight = 2
    const blockDepth = 2

    const createCrusherBlock = (direction: number) => {
      const offset = direction * (gapWidth / 2 + blockWidth / 2)
      const pos = crusherCenterPos.add(rightVec2.scale(offset)).add(normalVec2.scale(blockHeight / 2))

      const box = MeshBuilder.CreateBox("crusherBlock", { width: blockWidth, height: blockHeight, depth: blockDepth }, scene)
      box.position.copyFrom(pos)
      box.rotation.x = debrisIncline
      box.material = junkMat
      adventureTrack.push(box)

      const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, box.rotation.z)
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(blockWidth / 2, blockHeight / 2, blockDepth / 2),
        body
      )
      adventureBodies.push(body)
    }

    createCrusherBlock(-1)
    createCrusherBlock(1)
  }

  // 5. Escape Pod
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, junkMat)
}
