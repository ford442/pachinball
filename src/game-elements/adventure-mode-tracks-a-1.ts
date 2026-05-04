import { MeshBuilder, Vector3, Quaternion } from '@babylonjs/core'

// Implementation helpers for AdventureModeTracksA (part 1)

export function createHyperDriftTrackImpl(host: any): void {
  const driftMat = host.getTrackMaterial("#00FFFF")
  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const launchLen = 15
  const launchIncline = (20 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 8, launchLen, launchIncline, driftMat)

  const alphaRadius = 15
  const alphaAngle = -Math.PI / 2
  const alphaIncline = (5 * Math.PI) / 180
  const alphaBank = (30 * Math.PI) / 180

  currentPos = host.addCurvedRamp(currentPos, heading, alphaRadius, alphaAngle, alphaIncline, 8, 2.0, driftMat, 20, alphaBank)
  heading += alphaAngle

  const betaRadius = 15
  const betaAngle = Math.PI / 2
  const betaIncline = (5 * Math.PI) / 180
  const betaBank = -(30 * Math.PI) / 180

  currentPos = host.addCurvedRamp(currentPos, heading, betaRadius, betaAngle, betaIncline, 8, 2.0, driftMat, 20, betaBank)
  heading += betaAngle

  const corkRadius = 10
  const corkAngle = 2 * Math.PI
  const corkIncline = (10 * Math.PI) / 180
  const corkBank = -(45 * Math.PI) / 180

  currentPos = host.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 8, 2.0, driftMat, 30, corkBank)
  heading += corkAngle

  const jumpLen = 10
  const jumpIncline = -(30 * Math.PI) / 180

  currentPos = host.addStraightRamp(currentPos, heading, 6, jumpLen, jumpIncline, driftMat)

  const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalDist = 15
  const goalHeight = 8

  const goalPos = currentPos.add(jumpForward.scale(goalDist))
  goalPos.y += goalHeight

  host.createBasin(goalPos, driftMat)
}

export function createPachinkoSpireTrackImpl(host: any): void {
  const spireMat = host.getTrackMaterial("#FFFFFF") // Silver/Chrome
  let currentPos = host.currentStartPos.clone()
  const heading = 0 // North

  // 1. The Drop Gate
  const dropLen = 5
  const dropIncline = (45 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, spireMat)

  // 2. The Pin Field (Main Body)
  const mainLen = 30
  const mainIncline = (75 * Math.PI) / 180
  const mainWidth = 12

  const mainStartPos = currentPos.clone()

  currentPos = host.addStraightRamp(currentPos, heading, mainWidth, mainLen, mainIncline, spireMat)

  const forwardVec = new Vector3(0, -Math.sin(mainIncline), Math.cos(mainIncline))
  const rightVec = new Vector3(1, 0, 0)
  const normalVec = new Vector3(0, Math.cos(mainIncline), Math.sin(mainIncline))

  const pinSpacing = 2.0
  const rows = Math.floor(mainLen / pinSpacing) - 1

  if (host.world) {
    for (let r = 1; r <= rows; r++) {
      const dist = r * pinSpacing
      const isEven = r % 2 === 0
      const xOffsets = isEven ? [-4, -2, 0, 2, 4] : [-3, -1, 1, 3]

      for (const xOff of xOffsets) {
        const pinPos = mainStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(xOff))
        const pinHeight = 0.5
        const surfaceOffset = normalVec.scale(0.25 + pinHeight / 2)
        const finalPos = pinPos.add(surfaceOffset)

        const pin = MeshBuilder.CreateCylinder("pin", { diameter: 0.3, height: pinHeight }, host.scene)
        pin.position.copyFrom(finalPos)
        pin.rotation.x = mainIncline
        pin.material = spireMat
        host.adventureTrack.push(pin)

        const q = Quaternion.FromEulerAngles(pin.rotation.x, pin.rotation.y, pin.rotation.z)
        const body = host.world.createRigidBody(
          host.rapier.RigidBodyDesc.fixed()
            .setTranslation(finalPos.x, finalPos.y, finalPos.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        )
        host.world.createCollider(
          host.rapier.ColliderDesc.cylinder(pinHeight / 2, 0.15).setRestitution(0.6),
          body
        )
        host.adventureBodies.push(body)
      }
    }
  }

  const millDist = 15
  const millRadius = 3
  const millOffset = 3.5

  const createMill = (xDir: number, speedDir: number) => {
    const posOnRamp = mainStartPos.add(forwardVec.scale(millDist)).add(rightVec.scale(xDir * millOffset))
    const millPos = posOnRamp.add(normalVec.scale(0.1))

    const mill = MeshBuilder.CreateCylinder("mill", { diameter: millRadius * 2, height: 0.2 }, host.scene)
    mill.position.copyFrom(millPos)
    mill.rotation.x = mainIncline
    mill.material = spireMat
    host.adventureTrack.push(mill)

    if (host.world) {
      const bodyDesc = host.rapier.RigidBodyDesc.kinematicVelocityBased()
        .setTranslation(millPos.x, millPos.y, millPos.z)
      const q = Quaternion.FromEulerAngles(mainIncline, 0, 0)
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })

      const body = host.world.createRigidBody(bodyDesc)
      const angSpeed = 2.0 * speedDir
      const angVel = normalVec.scale(angSpeed)
      body.setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z }, true)

      host.world.createCollider(
        host.rapier.ColliderDesc.cylinder(0.1, millRadius).setFriction(1.0),
        body
      )
      host.adventureBodies.push(body)
      host.kinematicBindings.push({ body, mesh: mill })
    }
  }

  createMill(-1, 1)
  createMill(1, -1)

  const bottomPos = mainStartPos.add(forwardVec.scale(mainLen))
  const basinY = bottomPos.y - 2
  const basinZ = bottomPos.z

  host.createBasin(new Vector3(0, basinY, basinZ), spireMat)

  const createResetBasin = (x: number) => {
    const pos = new Vector3(x, basinY, basinZ)
    const basin = MeshBuilder.CreateBox("resetBasin", { width: 4, height: 1, depth: 4 }, host.scene)
    basin.position.copyFrom(pos)
    basin.material = spireMat
    host.adventureTrack.push(basin)

    if (host.world) {
      const body = host.world.createRigidBody(
        host.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      host.world.createCollider(
        host.rapier.ColliderDesc.cuboid(2, 0.5, 2),
        body
      )
      host.adventureBodies.push(body)

      const sensorPos = pos.clone()
      sensorPos.y += 0.75
      const sensorBody = host.world.createRigidBody(
        host.rapier.RigidBodyDesc.fixed().setTranslation(sensorPos.x, sensorPos.y, sensorPos.z)
      )
      host.world.createCollider(
        host.rapier.ColliderDesc.cuboid(1.8, 0.25, 1.8).setSensor(true),
        sensorBody
      )
      host.resetSensors.push(sensorBody)
    }
  }

  createResetBasin(-6)
  createResetBasin(6)
}

export function createOrbitalJunkyardTrackImpl(host: any): void {
  const junkMat = host.getTrackMaterial("#888888")
  let currentPos = host.currentStartPos.clone()
  const heading = 0

  const launchLen = 8
  const launchIncline = (10 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 4, launchLen, launchIncline, junkMat)

  const debrisLen = 25
  const debrisIncline = (5 * Math.PI) / 180
  const debrisWidth = 10
  const debrisStartPos = currentPos.clone()

  currentPos = host.addStraightRamp(currentPos, heading, debrisWidth, debrisLen, debrisIncline, junkMat)

  if (host.world) {
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
      let mesh: any
      let colliderDesc: any
      const finalPos = debrisPosOnSurface.add(normalVec.scale(scale * 0.5))

      if (type === 'box') {
        mesh = MeshBuilder.CreateBox("junkBox", { size: scale }, host.scene)
        colliderDesc = host.rapier.ColliderDesc.cuboid(scale / 2, scale / 2, scale / 2)
      } else {
        mesh = MeshBuilder.CreatePolyhedron("junkTetra", { type: 0, size: scale * 0.6 }, host.scene)
        colliderDesc = host.rapier.ColliderDesc.cuboid(scale / 3, scale / 3, scale / 3)
      }

      mesh.position.copyFrom(finalPos)
      mesh.rotation.x = Math.random() * Math.PI
      mesh.rotation.y = Math.random() * Math.PI
      mesh.rotation.z = Math.random() * Math.PI
      mesh.material = junkMat
      host.adventureTrack.push(mesh)

      const q = Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
      const body = host.world.createRigidBody(
        host.rapier.RigidBodyDesc.fixed()
          .setTranslation(finalPos.x, finalPos.y, finalPos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      host.world.createCollider(colliderDesc, body)
      host.adventureBodies.push(body)
    }
  }

  const crusherDistFromEnd = 2
  const forwardVec = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
  const rightVec = new Vector3(1, 0, 0)
  const normalVec = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

  const crusherCenterPos = debrisStartPos.add(forwardVec.scale(debrisLen - crusherDistFromEnd))
  const gapWidth = 2
  const blockWidth = (debrisWidth - gapWidth) / 2
  const blockHeight = 2
  const blockDepth = 2

  const createCrusherBlock = (direction: number) => {
    const offset = direction * (gapWidth / 2 + blockWidth / 2)
    const pos = crusherCenterPos.add(rightVec.scale(offset)).add(normalVec.scale(blockHeight / 2))
    const box = MeshBuilder.CreateBox("crusherBlock", { width: blockWidth, height: blockHeight, depth: blockDepth }, host.scene)
    box.position.copyFrom(pos)
    box.rotation.x = debrisIncline
    box.material = junkMat
    host.adventureTrack.push(box)

    if (host.world) {
      const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, box.rotation.z)
      const body = host.world.createRigidBody(
        host.rapier.RigidBodyDesc.fixed()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      host.world.createCollider(
        host.rapier.ColliderDesc.cuboid(blockWidth / 2, blockHeight / 2, blockDepth / 2),
        body
      )
      host.adventureBodies.push(body)
    }
  }

  createCrusherBlock(-1)
  createCrusherBlock(1)

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, junkMat)
}

export function createFirewallBreachTrackImpl(host: any): void {
  const wallMat = host.getTrackMaterial("#FF4400")
  const debrisMat = host.getTrackMaterial("#0088FF")
  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const launchLen = 20
  const launchIncline = (25 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, wallMat)

  const debrisLen = 15
  const debrisWidth = 8
  const debrisStartPos = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, debrisWidth, debrisLen, 0, wallMat)

  if (host.world) {
    const rows = 5
    const cols = 4
    const spacing = 1.5
    const startX = -(cols - 1) * spacing / 2
    const startZ = 2.0
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const xOffset = startX + c * spacing
        const zOffset = startZ + r * spacing
        const blockPos = debrisStartPos.add(forward.scale(zOffset)).add(right.scale(xOffset))
        blockPos.y += 0.5
        host.createDynamicBlock(blockPos, 1.0, 0.5, debrisMat)
      }
    }
  }

  const turnRadius = 10
  const turnAngle = Math.PI / 2
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
  heading -= turnAngle
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
  heading += turnAngle

  const wallLen = 10
  const wallStartPos = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, 8, wallLen, 0, wallMat)

  if (host.world) {
    const blockCount = 3
    const blockSize = 2.5
    const spacing = 2.6
    const startX = -(blockCount - 1) * spacing / 2
    const zOffset = 5.0
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let i = 0; i < blockCount; i++) {
      const xOffset = startX + i * spacing
      const blockPos = wallStartPos.add(forward.scale(zOffset)).add(right.scale(xOffset))
      blockPos.y += blockSize / 2
      host.createDynamicBlock(blockPos, blockSize, 5.0, wallMat)
    }
  }

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, wallMat)
}

export function createPrismPathwayTrackImpl(host: any): void {
  const glassMat = host.getTrackMaterial("#E0FFFF")
  const laserMat = host.getTrackMaterial("#FF00FF")

  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const entryLen = 15
  const entryIncline = (20 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 4, entryLen, entryIncline, glassMat)

  const fieldLen = 20
  const fieldWidth = 10
  const fieldStart = currentPos.clone()

  currentPos = host.addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, glassMat)

  if (host.world) {
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
      const prism = MeshBuilder.CreateCylinder("prism", { diameter: prismRadius * 2, height: prismHeight, tessellation: 3 }, host.scene)
      prism.position.copyFrom(pos)
      prism.rotation.y = Math.random() * Math.PI * 2
      prism.material = glassMat
      host.adventureTrack.push(prism)
      const positions = prism.getVerticesData.bind(prism)("position")
      if (positions) {
        const q = Quaternion.FromEulerAngles(0, prism.rotation.y, 0)
        const body = host.world.createRigidBody(
          host.rapier.RigidBodyDesc.fixed()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        )
        const vertices = new Float32Array(positions)
        const hull = host.rapier.ColliderDesc.convexHull(vertices)
        if (hull) {
          hull.setRestitution(0.8)
          host.world.createCollider(hull, body)
          host.adventureBodies.push(body)
        }
      }
    }
  }

  const gauntletLen = 25
  const gauntletWidth = 8
  const gauntletStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, gauntletWidth, gauntletLen, 0, glassMat)

  if (host.world) {
    const laserCount = 3
    const laserHeight = 2.0
    const laserRadius = 0.2
    const spacing = gauntletLen / (laserCount + 1)
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let i = 0; i < laserCount; i++) {
      const dist = spacing * (i + 1)
      const basePos = gauntletStart.add(forward.scale(dist))
      basePos.y += laserHeight / 2
      const laser = MeshBuilder.CreateCylinder("laser", { diameter: laserRadius * 2, height: laserHeight }, host.scene)
      laser.position.copyFrom(basePos)
      laser.material = laserMat
      host.adventureTrack.push(laser)
      const body = host.world.createRigidBody(
        host.rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(basePos.x, basePos.y, basePos.z)
      )
      host.world.createCollider(
        host.rapier.ColliderDesc.cylinder(laserHeight / 2, laserRadius),
        body
      )
      host.adventureBodies.push(body)
      const freq = 1.5 + i * 0.5
      const phase = i * 1.0
      host.animatedObstacles.push({
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

  const loopRadius = 8
  const loopAngle = 2 * Math.PI
  const loopIncline = -(10 * Math.PI) / 180
  const loopBank = (20 * Math.PI) / 180
  currentPos = host.addCurvedRamp(currentPos, heading, loopRadius, loopAngle, loopIncline, 8, 2.0, glassMat, 30, loopBank)
  heading += loopAngle

  const forwardVec = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(forwardVec.scale(4))
  host.createBasin(goalPos, glassMat)
  const goalLight = MeshBuilder.CreateSphere("goalLight", { diameter: 2 }, host.scene)
  goalLight.position.copyFrom(goalPos)
  goalLight.position.y += 2
  const whiteMat = host.getTrackMaterial("#FFFFFF")
  goalLight.material = whiteMat
  host.adventureTrack.push(goalLight)
}
