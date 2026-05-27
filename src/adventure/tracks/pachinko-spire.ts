/**
 * Pachinko Spire Track
 *
 * STATIONARY_TABLE — a vertical pachinko-style arena with a dense pin field,
 * contra-rotating mills, side reset basins, and an exit portal above the
 * central catch basin.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type { TrackInfo } from '../../game-elements/adventure-track-progression'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildPachinkoSpire(builder: TrackBuilder): void {
  const spireMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFFFF")
  const accentMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#ffdd00")
  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const currentTrackInfo = (builder as unknown as { currentTrackInfo: TrackInfo | null }).currentTrackInfo
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  const kinematicBindings = (builder as unknown as { kinematicBindings: { body: RAPIER.RigidBody, mesh: import('@babylonjs/core').Mesh }[] }).kinematicBindings
  const resetSensors = (builder as unknown as { resetSensors: RAPIER.RigidBody[] }).resetSensors

  const modeType = currentTrackInfo?.modeType ?? 'STATIONARY_TABLE'

  let currentPos = currentStartPos.clone()
  const heading = 0

  // 1. The Drop Gate
  const dropLen = 5
  const dropIncline = (45 * Math.PI) / 180
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, spireMat)

  // 2. The Pin Field
  const mainLen = 30
  const mainIncline = (75 * Math.PI) / 180
  const mainWidth = 12

  const mainStartPos = currentPos.clone()
  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, mainWidth, mainLen, mainIncline, spireMat)

  if (world) {
    const forwardVec = new Vector3(0, -Math.sin(mainIncline), Math.cos(mainIncline))
    const rightVec = new Vector3(1, 0, 0)
    const normalVec = new Vector3(0, Math.cos(mainIncline), Math.sin(mainIncline))

    const pinSpacing = 2.0
    const rows = Math.floor(mainLen / pinSpacing) - 1

    for (let r = 1; r <= rows; r++) {
      const dist = r * pinSpacing
      const isEven = r % 2 === 0
      const xOffsets = isEven ? [-4, -2, 0, 2, 4] : [-3, -1, 1, 3]

      for (const xOff of xOffsets) {
        const pinPos = mainStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(xOff))
        const pinHeight = 0.5
        const surfaceOffset = normalVec.scale(0.25 + pinHeight / 2)
        const finalPos = pinPos.add(surfaceOffset)

        const pin = MeshBuilder.CreateCylinder("pin", { diameter: 0.3, height: pinHeight }, scene)
        pin.position.copyFrom(finalPos)
        pin.rotation.x = mainIncline
        pin.material = spireMat
        adventureTrack.push(pin)

        const q = Quaternion.FromEulerAngles(pin.rotation.x, pin.rotation.y, pin.rotation.z)
        const body = world.createRigidBody(
          rapier.RigidBodyDesc.fixed()
            .setTranslation(finalPos.x, finalPos.y, finalPos.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        )
        world.createCollider(
          rapier.ColliderDesc.cylinder(pinHeight / 2, 0.15).setRestitution(0.6),
          body
        )
        adventureBodies.push(body)
      }
    }

    // 3. The Mills
    const millDist = 15
    const millRadius = 3
    const millOffset = 3.5

    const createMill = (xDir: number, speedDir: number) => {
      const posOnRamp = mainStartPos.add(forwardVec.scale(millDist)).add(rightVec.scale(xDir * millOffset))
      const millPos = posOnRamp.add(normalVec.scale(0.1))

      const mill = MeshBuilder.CreateCylinder("mill", { diameter: millRadius * 2, height: 0.2 }, scene)
      mill.position.copyFrom(millPos)
      mill.rotation.x = mainIncline
      mill.material = spireMat
      adventureTrack.push(mill)

      const bodyDesc = rapier.RigidBodyDesc.kinematicVelocityBased()
        .setTranslation(millPos.x, millPos.y, millPos.z)

      const q = Quaternion.FromEulerAngles(mainIncline, 0, 0)
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })

      const body = world.createRigidBody(bodyDesc)

      const angSpeed = 2.0 * speedDir
      const angVel = normalVec.scale(angSpeed)
      body.setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z }, true)

      world.createCollider(
        rapier.ColliderDesc.cylinder(0.1, millRadius).setFriction(1.0),
        body
      )
      adventureBodies.push(body)
      kinematicBindings.push({ body, mesh: mill })
    }

    createMill(-1, 1)
    createMill(1, -1)

    // 4. Catch Basins
    const bottomPos = mainStartPos.add(forwardVec.scale(mainLen))
    const basinY = bottomPos.y - 2
    const basinZ = bottomPos.z

    if (modeType === 'STATIONARY_TABLE') {
      // Extra bumper ring above the central basin for a denser arena feel
      const bumperRingY = basinY + 2
      const bumperRingRadius = 4
      const bumperCount = 6
      for (let i = 0; i < bumperCount; i++) {
        const angle = (i / bumperCount) * Math.PI * 2
        const bx = Math.cos(angle) * bumperRingRadius
        const bz = basinZ + Math.sin(angle) * bumperRingRadius
        ;(builder as unknown as { createStaticCylinder: (...args: unknown[]) => void }).createStaticCylinder(
          new Vector3(bx, bumperRingY, bz),
          0.7, 1.0, accentMat
        )
      }
    }

    // Central catch basin — the goal for STATIONARY_TABLE
    const centralBasinPos = new Vector3(0, basinY, basinZ)
    ;(builder as unknown as { addExitPortal: (pos: Vector3) => void }).addExitPortal(
      new Vector3(centralBasinPos.x, centralBasinPos.y + 1.6, centralBasinPos.z)
    )
    ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(centralBasinPos, spireMat)

    const createResetBasin = (x: number) => {
      const pos = new Vector3(x, basinY, basinZ)
      const basin = MeshBuilder.CreateBox("resetBasin", { width: 4, height: 1, depth: 4 }, scene)
      basin.position.copyFrom(pos)
      basin.material = spireMat
      adventureTrack.push(basin)

      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(2, 0.5, 2),
        body
      )
      adventureBodies.push(body)

      const sensorPos = pos.clone()
      sensorPos.y += 0.75

      const sensorBody = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(sensorPos.x, sensorPos.y, sensorPos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.cuboid(1.8, 0.25, 1.8).setSensor(true),
        sensorBody
      )
      resetSensors.push(sensorBody)
    }

    createResetBasin(-6)
    createResetBasin(6)
  }
}
