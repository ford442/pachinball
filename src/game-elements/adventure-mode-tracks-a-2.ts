import { MeshBuilder, Vector3, Quaternion } from '@babylonjs/core'

// Implementation helpers for AdventureModeTracksA (part 2)

export function createMagneticStorageTrackImpl(host: any): void {
  const storageMat = host.getTrackMaterial("#222222")
  const laserMat = host.getTrackMaterial("#FF0000")

  let currentPos = host.currentStartPos.clone()
  const heading = 0

  const entryLen = 12
  const entryIncline = (25 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, storageMat)

  const platterRadius = 12
  const platterSpeed = 2.5
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const platterCenter = currentPos.add(forward.scale(platterRadius + 1))
  platterCenter.y -= 1.0

  host.createRotatingPlatform(platterCenter, platterRadius, platterSpeed, storageMat)

  if (host.world && host.adventureBodies.length > 0) {
    const platterBody = host.adventureBodies[host.adventureBodies.length - 1]
    const binding = host.kinematicBindings.find((b: any) => b.body === platterBody)
    const positions = [
      { r: 6, angle: 0 },
      { r: 9, angle: (120 * Math.PI) / 180 },
      { r: 4, angle: (240 * Math.PI) / 180 }
    ]

    positions.forEach((p: any) => {
      const size = 2.0
      const box = MeshBuilder.CreateBox("badSector", { size }, host.scene)
      if (binding) {
        box.parent = binding.mesh
        const lx = Math.sin(p.angle) * p.r
        const lz = Math.cos(p.angle) * p.r
        box.position.set(lx, size / 2 + 0.25, lz)
        box.rotation.y = p.angle
        box.material = laserMat
      }

      const lx = Math.sin(p.angle) * p.r
      const lz = Math.cos(p.angle) * p.r
      const colRot = Quaternion.FromEulerAngles(0, p.angle, 0)

      host.world.createCollider(
        host.rapier.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
          .setTranslation(lx, size / 2 + 0.25, lz)
          .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w }),
        platterBody
      )
    })
  }

  const pivotDist = 16
  const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
  const pivotPos = platterCenter.add(right.scale(-pivotDist))
  pivotPos.y += 2.0

  const armLength = 10
  const armWidth = 1.0
  const armHeight = 1.0

  if (host.world) {
    const pivotMesh = MeshBuilder.CreateSphere("actuatorPivot", { diameter: 2 }, host.scene)
    pivotMesh.position.copyFrom(pivotPos)
    pivotMesh.material = storageMat
    host.adventureTrack.push(pivotMesh)

    const armBox = MeshBuilder.CreateBox("actuatorArm", { width: armLength, height: armHeight, depth: armWidth }, host.scene)
    armBox.parent = pivotMesh
    armBox.position.set(armLength / 2, 0, 0)
    armBox.material = storageMat

    const bodyDesc = host.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(pivotPos.x, pivotPos.y, pivotPos.z)
    const body = host.world.createRigidBody(bodyDesc)

    host.world.createCollider(
      host.rapier.ColliderDesc.cuboid(armLength / 2, armHeight / 2, armWidth / 2)
        .setTranslation(armLength / 2, 0, 0),
      body
    )
    host.adventureBodies.push(body)

    host.animatedObstacles.push({
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

  const goalPos = platterCenter.add(right.scale(-platterRadius - 6))
  goalPos.y -= 2.0
  host.createBasin(goalPos, storageMat)
}

export function createNeuralNetworkTrackImpl(host: any): void {
  const netMat = host.getTrackMaterial("#FFFFFF")
  const veinMat = host.getTrackMaterial("#FF0000")

  let currentPos = host.currentStartPos.clone()
  const heading = 0

  const stimLen = 12
  const stimIncline = (25 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, stimLen, stimIncline, netMat)

  const forkStart = currentPos.clone()
  const forkHeading = heading

  let leftPos = forkStart.clone()
  let leftHeading = forkHeading
  leftPos = host.addCurvedRamp(leftPos, leftHeading, 10, Math.PI / 4, 0, 2, 0, veinMat, 10)
  leftHeading -= Math.PI / 4
  leftPos = host.addStraightRamp(leftPos, leftHeading, 2, 5, 0, veinMat)
  leftPos = host.addCurvedRamp(leftPos, leftHeading, 10, -Math.PI / 4, 0, 2, 0, veinMat, 10)
  leftHeading += Math.PI / 4

  let rightPos = forkStart.clone()
  let rightHeading = forkHeading
  rightPos = host.addCurvedRamp(rightPos, rightHeading, 10, -Math.PI / 4, 0, 6, 1.0, netMat, 10)
  rightHeading += Math.PI / 4
  const rightStraightStart = rightPos.clone()
  rightPos = host.addStraightRamp(rightPos, rightHeading, 6, 5, 0, netMat)

  if (host.world) {
    const rockRadius = 0.5
    const rockPos = rightStraightStart.add(new Vector3(Math.sin(rightHeading), 0, Math.cos(rightHeading)).scale(2.5))
    rockPos.y += 0.5
    const rock = MeshBuilder.CreateSphere("cellBody", { diameter: rockRadius * 2 }, host.scene)
    rock.position.copyFrom(rockPos)
    rock.material = veinMat
    host.adventureTrack.push(rock)
    const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z))
    host.world.createCollider(host.rapier.ColliderDesc.ball(rockRadius), body)
    host.adventureBodies.push(body)
  }

  rightPos = host.addCurvedRamp(rightPos, rightHeading, 10, Math.PI / 4, 0, 6, 1.0, netMat, 10)
  rightHeading -= Math.PI / 4

  const convergePos = leftPos.add(rightPos).scale(0.5)
  currentPos = convergePos

  const gapLen = 6
  const gapStart = currentPos.clone()
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(forward.scale(gapLen))

  if (host.world) {
    const bridgeWidth = 4
    const bridgeLen = 4
    const bridgeHeight = 1.0
    const bridgeCenter = gapStart.add(forward.scale(gapLen / 2))
    const surfaceY = gapStart.y
    const submergedY = surfaceY - 2.0
    const midY = (surfaceY + submergedY) / 2
    const amp = (surfaceY - submergedY) / 2
    const basePos = new Vector3(bridgeCenter.x, midY, bridgeCenter.z)
    const box = MeshBuilder.CreateBox("synapseBridge", { width: bridgeWidth, height: bridgeHeight, depth: bridgeLen }, host.scene)
    box.position.copyFrom(basePos)
    box.rotation.y = heading
    box.material = veinMat
    host.adventureTrack.push(box)
    const q = Quaternion.FromEulerAngles(0, heading, 0)
    const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
    host.world.createCollider(host.rapier.ColliderDesc.cuboid(bridgeWidth / 2, bridgeHeight / 2, bridgeLen / 2), body)
    host.adventureBodies.push(body)
    host.animatedObstacles.push({ body, mesh: box, type: 'PISTON', basePos, frequency: 2.0, amplitude: amp, phase: 0 })
  }

  const forestLen = 20
  const forestWidth = 10
  const forestStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, forestWidth, forestLen, 0, netMat)

  if (host.world) {
    const hLen = forestLen
    const center = forestStart.add(forward.scale(hLen / 2))
    center.y += 0.5
    const sensor = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
    const q = Quaternion.FromEulerAngles(0, heading, 0)
    sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    host.world.createCollider(host.rapier.ColliderDesc.cuboid(forestWidth / 2, 1, forestLen / 2).setSensor(true), sensor)
    host.dampingZones.push({ sensor, damping: 2.0 })

    const ciliaCount = 50
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    for (let i = 0; i < ciliaCount; i++) {
      const dist = Math.random() * (forestLen - 2) + 1
      const offset = (Math.random() - 0.5) * (forestWidth - 1)
      const pos = forestStart.add(forward.scale(dist)).add(right.scale(offset))
      pos.y += 1.0
      const cilia = MeshBuilder.CreateCylinder("cilia", { diameter: 0.2, height: 2.0 }, host.scene)
      cilia.position.copyFrom(pos)
      cilia.material = veinMat
      host.adventureTrack.push(cilia)
      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
      host.world.createCollider(host.rapier.ColliderDesc.cylinder(1.0, 0.1), body)
      host.adventureBodies.push(body)
    }
  }

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, netMat)
}

export function createNeonStrongholdTrackImpl(host: any): void {
  const stoneMat = host.getTrackMaterial("#2F2F2F")
  const neonMat = host.getTrackMaterial("#0088FF")

  let currentPos = host.currentStartPos.clone()
  let heading = 0
  const approachLen = 15
  const approachIncline = (10 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, approachLen, approachIncline, stoneMat)

  const moatLen = 6
  const jumpHeight = 2.0
  const waterPos = currentPos.clone()
  waterPos.y -= 3.0
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const waterCenter = waterPos.add(forward.scale(moatLen / 2))

  if (host.world) {
    const water = MeshBuilder.CreateBox("moatWater", { width: 10, height: 1, depth: moatLen }, host.scene)
    water.position.copyFrom(waterCenter)
    water.material = neonMat
    host.adventureTrack.push(water)
  }

  currentPos = currentPos.add(forward.scale(moatLen))
  currentPos.y += jumpHeight

  const gatehouseLen = 18
  const gatehouseWidth = 4
  const gatehouseStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, gatehouseWidth, gatehouseLen, 0, stoneMat, 2.0)

  if (host.world) {
    const gateCount = 3
    const gateSpacing = 4.0
    const startDist = 3.0
    const gateWidth = gatehouseWidth
    const gateHeight = 3.0
    const gateDepth = 0.5

    for (let i = 0; i < gateCount; i++) {
      const dist = startDist + i * gateSpacing
      const pos = gatehouseStart.add(forward.scale(dist))
      const floorY = pos.y
      const midY = floorY + gateHeight / 2 + 1.25
      const amp = 1.25
      const basePos = new Vector3(pos.x, midY, pos.z)
      const gate = MeshBuilder.CreateBox("portcullis", { width: gateWidth, height: gateHeight, depth: gateDepth }, host.scene)
      gate.position.copyFrom(basePos)
      gate.rotation.y = heading
      gate.material = neonMat
      host.adventureTrack.push(gate)
      const q = Quaternion.FromEulerAngles(0, heading, 0)
      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(gateWidth / 2, gateHeight / 2, gateDepth / 2), body)
      host.adventureBodies.push(body)
      host.animatedObstacles.push({ body, mesh: gate, type: 'PISTON', basePos, frequency: 2.0, amplitude: amp, phase: i * 1.5 })
    }
  }

  const courtRadius = 10
  const courtSpeed = 0.5
  const courtCenter = currentPos.add(forward.scale(courtRadius + 1))
  host.createRotatingPlatform(courtCenter, courtRadius, courtSpeed, stoneMat)

  if (host.world && host.adventureBodies.length > 0) {
    const platformBody = host.adventureBodies[host.adventureBodies.length - 1]
    const turretCount = 2
    const turretDist = 6.0
    for (let i = 0; i < turretCount; i++) {
      const angle = i * Math.PI
      const turretHeight = 2.0
      const turretRadius = 1.0
      const turret = MeshBuilder.CreateCylinder("turret", { diameter: turretRadius * 2, height: turretHeight }, host.scene)
      const binding = host.kinematicBindings.find((b: any) => b.body === platformBody)
      if (binding) {
        turret.parent = binding.mesh
        const cx = Math.sin(angle) * turretDist
        const cz = Math.cos(angle) * turretDist
        turret.position.set(cx, turretHeight / 2 + 0.25, cz)
        turret.material = neonMat
        const colliderDesc = host.rapier.ColliderDesc.cylinder(turretHeight / 2, turretRadius).setTranslation(cx, turretHeight / 2 + 0.25, cz)
        host.world.createCollider(colliderDesc, platformBody)
      }
    }
  }

  const keepRadius = 8
  const keepAngle = (270 * Math.PI) / 180
  const keepIncline = -(20 * Math.PI) / 180
  const keepStart = courtCenter.add(forward.scale(courtRadius + 1))
  currentPos = keepStart
  currentPos = host.addCurvedRamp(currentPos, heading, keepRadius, keepAngle, keepIncline, 6, 2.0, stoneMat, 20)
  heading += keepAngle

  const goalPos = currentPos.clone()
  goalPos.y -= 1
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const finalGoalPos = goalPos.add(goalForward.scale(4))
  host.createBasin(finalGoalPos, neonMat)
}

export function createCasinoHeistTrackImpl(host: any): void {
  const feltMat = host.getTrackMaterial("#880000")
  const goldMat = host.getTrackMaterial("#FFD700")
  const chipMatRed = host.getTrackMaterial("#FF0000")
  const chipMatBlue = host.getTrackMaterial("#0000FF")
  const chipMatBlack = host.getTrackMaterial("#111111")
  const chipMatWhite = host.getTrackMaterial("#FFFFFF")
  const chipMats = [chipMatRed, chipMatBlue, chipMatBlack, chipMatWhite]

  let currentPos = host.currentStartPos.clone()
  const heading = 0
  const entryLen = 15
  const entryIncline = (15 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, feltMat)

  const mazeLen = 20
  const mazeWidth = 12
  const mazeStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, mazeWidth, mazeLen, 0, feltMat)

  if (host.world) {
    const chipCount = 15
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let i = 0; i < chipCount; i++) {
      const dist = 2 + Math.random() * (mazeLen - 4)
      const offset = (Math.random() - 0.5) * (mazeWidth - 2)
      const pos = mazeStart.add(forward.scale(dist)).add(right.scale(offset))
      const stackHeight = 0.5 + Math.random() * 1.5
      const chipRadius = 1.0
      pos.y += stackHeight / 2
      const chip = MeshBuilder.CreateCylinder("pokerChip", { diameter: chipRadius * 2, height: stackHeight }, host.scene)
      chip.position.copyFrom(pos)
      chip.material = chipMats[Math.floor(Math.random() * chipMats.length)]
      host.adventureTrack.push(chip)
      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
      host.world.createCollider(host.rapier.ColliderDesc.cylinder(stackHeight / 2, chipRadius).setRestitution(0.8), body)
      host.adventureBodies.push(body)
    }
  }

  const wheelRadius = 12
  const wheelSpeed = 1.5
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const wheelCenter = currentPos.add(forward.scale(wheelRadius + 1))
  host.createRotatingPlatform(wheelCenter, wheelRadius, wheelSpeed, feltMat)

  if (host.world) {
    const pocketCount = 2
    const sensorBodyDesc = host.rapier.RigidBodyDesc.kinematicVelocityBased().setTranslation(wheelCenter.x, wheelCenter.y, wheelCenter.z)
    const sensorBody = host.world.createRigidBody(sensorBodyDesc)
    sensorBody.setAngvel({ x: 0, y: wheelSpeed, z: 0 }, true)
    host.resetSensors.push(sensorBody)
    host.adventureBodies.push(sensorBody)

    for (let i = 0; i < pocketCount; i++) {
      const angle = i * Math.PI
      const r = wheelRadius * 0.7
      const lx = Math.sin(angle) * r
      const lz = Math.cos(angle) * r
      const sensorShape = host.rapier.ColliderDesc.cylinder(0.5, 1.0)
        .setTranslation(lx, 0.5, lz)
        .setSensor(true)
      host.world.createCollider(sensorShape, sensorBody)
      const marker = MeshBuilder.CreateCylinder("zeroPocket", { diameter: 2, height: 0.1 }, host.scene)
      if (host.kinematicBindings.length > 0) {
        const platformBinding = host.kinematicBindings[host.kinematicBindings.length - 1]
        marker.parent = platformBinding.mesh
        marker.position.set(lx, 0.55, lz)
        marker.material = chipMatBlack
      }
    }
  }

  const slotLen = 12
  const slotWidth = 8
  const wheelExit = wheelCenter.add(forward.scale(wheelRadius + 1))
  currentPos = wheelExit
  const slotStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, slotWidth, slotLen, 0, feltMat)

  if (host.world) {
    const gateCount = 3
    const gateWidth = slotWidth
    const gateHeight = 4.0
    const gateDepth = 0.5
    const spacing = 3.0

    for (let i = 0; i < gateCount; i++) {
      const dist = 2.0 + i * spacing
      const pos = slotStart.add(forward.scale(dist))
      const amp = 2.5
      const phase = Math.random() * Math.PI * 2
      const freq = 1.0 + Math.random()
      const floorY = pos.y
      const basePos = new Vector3(pos.x, floorY, pos.z)
      const gate = MeshBuilder.CreateBox("slotGate", { width: gateWidth, height: gateHeight, depth: gateDepth }, host.scene)
      gate.position.copyFrom(basePos)
      gate.rotation.y = heading
      gate.material = goldMat
      host.adventureTrack.push(gate)
      const q = Quaternion.FromEulerAngles(0, heading, 0)
      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(gateWidth / 2, gateHeight / 2, gateDepth / 2), body)
      host.adventureBodies.push(body)
      host.animatedObstacles.push({ body, mesh: gate, type: 'PISTON', basePos, frequency: freq * 3.0, amplitude: amp, phase })
    }
  }

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, goldMat)
}
