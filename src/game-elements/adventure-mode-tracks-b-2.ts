import { MeshBuilder, Vector3, Quaternion } from '@babylonjs/core'

// Implementation helpers for AdventureModeTracksB (part 2)

export function createGravityForgeTrackImpl(host: any): void {
  const rustMat = host.getTrackMaterial("#8B4513")
  const steelMat = host.getTrackMaterial("#333333")
  const moltenMat = host.getTrackMaterial("#FF4500")

  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const feedLen = 12
  const feedIncline = (30 * Math.PI) / 180
  const conveyorStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, 6, feedLen, feedIncline, rustMat)

  if (host.world) {
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const hLen = feedLen * Math.cos(feedIncline)
    const vDrop = feedLen * Math.sin(feedIncline)
    const center = conveyorStart.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2
    center.y += 0.5

    const sensorBody = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
    const q = Quaternion.FromEulerAngles(feedIncline, heading, 0)
    sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    host.world.createCollider(host.rapier.ColliderDesc.cuboid(3, 1, feedLen / 2).setSensor(true), sensorBody)

    const forceDir = new Vector3(
      Math.sin(heading) * Math.cos(feedIncline),
      -Math.sin(feedIncline),
      Math.cos(heading) * Math.cos(feedIncline)
    )

    host.conveyorZones.push({
      sensor: sensorBody,
      force: forceDir.scale(50.0)
    })
  }

  const crushLen = 20
  const crushWidth = 8
  const crushStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, crushWidth, crushLen, 0, steelMat)

  if (host.world) {
    const pistonWidth = 6
    const pistonDepth = 3
    const pistonHeight = 4
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const positions = [5, 10, 15]
    const phases = [0, 1.5, 3.0]

    for (let i = 0; i < 3; i++) {
      const dist = positions[i]
      const pistonPos = crushStart.add(forward.scale(dist))
      const floorY = pistonPos.y
      const gap = 0.2
      const amp = 2.0
      const minY = floorY + gap + pistonHeight / 2
      const midY = minY + amp
      const basePos = new Vector3(pistonPos.x, midY, pistonPos.z)

      const piston = MeshBuilder.CreateBox("piston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, host.scene)
      piston.position.copyFrom(basePos)
      piston.material = steelMat
      host.adventureTrack.push(piston)

      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z))
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(pistonWidth / 2, pistonHeight / 2, pistonDepth / 2), body)
      host.adventureBodies.push(body)

      host.animatedObstacles.push({
        body,
        mesh: piston,
        type: 'PISTON',
        basePos,
        frequency: 2.0,
        amplitude: amp,
        phase: phases[i]
      })
    }
  }

  currentPos = host.addStraightRamp(currentPos, heading, 2, 10, 0, moltenMat, 0)
  currentPos = host.addCurvedRamp(currentPos, heading, 10, Math.PI, (15 * Math.PI) / 180, 8, 2.0, moltenMat, 20, -(20 * Math.PI) / 180)
  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, moltenMat)
}

export function createTidalNexusTrackImpl(host: any): void {
  const waterMat = host.getTrackMaterial("#0066FF")
  const foamMat = host.getTrackMaterial("#E0FFFF")

  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const spillLen = 15
  const spillIncline = (20 * Math.PI) / 180
  const spillStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, 6, spillLen, spillIncline, waterMat)

  if (host.world) {
    const hLen = spillLen * Math.cos(spillIncline)
    const vDrop = spillLen * Math.sin(spillIncline)
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const center = spillStart.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2
    center.y += 0.5
    const sensorBody = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
    const q = Quaternion.FromEulerAngles(spillIncline, heading, 0)
    sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    host.world.createCollider(host.rapier.ColliderDesc.cuboid(3, 1, spillLen / 2).setSensor(true), sensorBody)
    const forceDir = new Vector3(Math.sin(heading) * Math.cos(spillIncline), -Math.sin(spillIncline), Math.cos(heading) * Math.cos(spillIncline))
    host.conveyorZones.push({ sensor: sensorBody, force: forceDir.scale(60.0) })
  }

  const turbineRadius = 8
  const turbineSpeed = 1.5
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const turbineCenter = currentPos.add(forward.scale(turbineRadius + 1))
  host.createRotatingPlatform(turbineCenter, turbineRadius, -turbineSpeed, waterMat)

  if (host.world) {
    const platformBody = host.adventureBodies[host.adventureBodies.length - 1]
    const paddleCount = 4
    const paddleLen = turbineRadius - 1
    const paddleHeight = 1.5
    const paddleThick = 0.5

    for (let i = 0; i < paddleCount; i++) {
      const angle = (i * Math.PI * 2) / paddleCount
      const paddle = MeshBuilder.CreateBox("paddle", { width: paddleThick, height: paddleHeight, depth: paddleLen }, host.scene)
      const binding = host.kinematicBindings.find((b: any) => b.body === platformBody)
      if (binding) {
        paddle.parent = binding.mesh
        const r = paddleLen / 2
        const lx = Math.sin(angle) * r
        const lz = Math.cos(angle) * r
        paddle.position.set(lx, paddleHeight / 2, lz)
        paddle.rotation.y = angle
        paddle.material = foamMat
      }

      const colRot = Quaternion.FromEulerAngles(0, angle, 0)
      const colliderDesc = host.rapier.ColliderDesc.cuboid(paddleThick / 2, paddleHeight / 2, paddleLen / 2)
        .setTranslation(Math.sin(angle) * paddleLen / 2, paddleHeight / 2 + 0.25, Math.cos(angle) * paddleLen / 2)
        .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })
      host.world.createCollider(colliderDesc, platformBody)
    }
  }

  const turbineExit = turbineCenter.add(forward.scale(turbineRadius))
  currentPos = turbineExit

  const ripRadius = 12
  const ripAngle = Math.PI
  const ripIncline = (5 * Math.PI) / 180
  const ripBank = -(10 * Math.PI) / 180
  const ripStart = currentPos.clone()
  currentPos = host.addCurvedRamp(currentPos, heading, ripRadius, ripAngle, ripIncline, 8, 2.0, waterMat, 20, ripBank)

  if (host.world) {
    const segments = 20
    const segmentAngle = ripAngle / segments
    const arcLength = ripRadius * segmentAngle
    const chordLen = 2 * ripRadius * Math.sin(segmentAngle / 2)
    const segmentDrop = arcLength * Math.sin(ripIncline)
    let curH = heading
    let curP = ripStart.clone()
    for (let i = 0; i < segments; i++) {
      curH += segmentAngle / 2
      const segForward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
      const center = curP.add(segForward.scale(chordLen / 2))
      center.y -= segmentDrop / 2
      center.y += 0.5
      const sensorBody = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
      const q = Quaternion.FromEulerAngles(ripIncline, curH, ripBank)
      sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true), sensorBody)
      const outwardDir = new Vector3(Math.cos(curH), 0, -Math.sin(curH))
      host.conveyorZones.push({ sensor: sensorBody, force: outwardDir.scale(40.0) })
      curP = curP.add(segForward.scale(chordLen))
      curP.y -= segmentDrop
      curH += segmentAngle / 2
    }
  }
  heading += ripAngle

  const poolLen = 20
  const poolWidth = 8
  const poolStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, poolWidth, poolLen, 0, waterMat)

  if (host.world) {
    const rows = 5
    const rowSpacing = 3.0
    const startDist = 3.0
    const boxWidth = poolWidth - 1
    const boxDepth = 2.0
    const boxHeight = 1.0
    const forwardVec = new Vector3(Math.sin(heading), 0, Math.cos(heading))

    for (let i = 0; i < rows; i++) {
      const dist = startDist + i * rowSpacing
      const pos = poolStart.add(forwardVec.scale(dist))
      const basePos = pos.clone()
      basePos.y -= 0.5
      const box = MeshBuilder.CreateBox("waveBox", { width: boxWidth, height: boxHeight, depth: boxDepth }, host.scene)
      box.position.copyFrom(basePos)
      box.rotation.y = heading
      box.material = foamMat
      host.adventureTrack.push(box)
      const q = Quaternion.FromEulerAngles(0, heading, 0)
      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(boxWidth / 2, boxHeight / 2, boxDepth / 2), body)
      host.adventureBodies.push(body)
      host.animatedObstacles.push({ body, mesh: box, type: 'PISTON', basePos, frequency: 3.0, amplitude: 1.5, phase: dist * 0.5 })
    }
  }

  const goalPos = currentPos.clone()
  goalPos.y -= 4
  goalPos.z += 4
  host.createBasin(goalPos, waterMat)
}

export function createDigitalZenGardenTrackImpl(host: any): void {
  const gardenMat = host.getTrackMaterial("#FFFFFF")
  const accentMat = host.getTrackMaterial("#FF69B4")
  const sandFriction = 0.8
  const waterFriction = 0.1
  let currentPos = host.currentStartPos.clone()
  let heading = 0
  const entryLen = 15
  const entryIncline = (15 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, gardenMat, 1.0, sandFriction)

  const rockLen = 20
  const rockWidth = 12
  const rockStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, rockWidth, rockLen, 0, gardenMat, 0.5, sandFriction)

  if (host.world) {
    const rockRadius = 2.0
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    const positions = [ { z: 12, x: 0 }, { z: 6, x: -3.5 }, { z: 6, x: 3.5 } ]
    positions.forEach(p => {
      const rockPos = rockStart.add(forward.scale(p.z)).add(right.scale(p.x))
      rockPos.y += rockRadius * 0.6
      const rock = MeshBuilder.CreateSphere("zenRock", { diameter: rockRadius * 2, segments: 4 }, host.scene)
      rock.position.copyFrom(rockPos)
      rock.material = accentMat
      host.adventureTrack.push(rock)
      const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z))
      host.world.createCollider(host.rapier.ColliderDesc.ball(rockRadius).setRestitution(0.2), body)
      host.adventureBodies.push(body)
    })
  }

  const streamRadius = 15
  const streamAngle = Math.PI / 2
  const streamStart = currentPos.clone()
  const streamStartHeading = heading
  currentPos = host.addCurvedRamp(currentPos, heading, streamRadius, streamAngle, 0, 8, 1.0, gardenMat, 20, 0, waterFriction)

  if (host.world) {
    const segments = 10
    const segAngle = streamAngle / segments
    const chordLen = 2 * streamRadius * Math.sin(segAngle / 2)
    let curH = streamStartHeading
    let curP = streamStart.clone()
    for (let i = 0; i < segments; i++) {
      curH += segAngle / 2
      const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
      const center = curP.add(forward.scale(chordLen / 2))
      center.y += 0.5
      const sensor = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
      const q = Quaternion.FromEulerAngles(0, curH, 0)
      sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true), sensor)
      const leftDir = new Vector3(-Math.cos(curH), 0, Math.sin(curH))
      host.conveyorZones.push({ sensor, force: leftDir.scale(30.0) })
      curP = curP.add(forward.scale(chordLen))
      curH += segAngle / 2
    }
  }

  heading += streamAngle

  const bridgeLen = 10
  const segments = 10
  const segLen = bridgeLen / segments
  const bridgeWidth = 3
  for (let i = 0; i < segments; i++) {
    const x0 = i * segLen
    const x1 = (i + 1) * segLen
    const xm = (x0 + x1) / 2
    const slope = -0.24 * (xm - 5)
    const incline = -Math.atan(slope)
    const meshLen = Math.sqrt(1 + slope * slope) * segLen
    currentPos = host.addStraightRamp(currentPos, heading, bridgeWidth, meshLen, incline, accentMat, 1.0, sandFriction)
  }

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(forward.scale(4))
  host.createBasin(goalPos, accentMat)
}

export function createSynthwaveSurfTrackImpl(host: any): void {
  const floorMat = host.getTrackMaterial("#110022")
  const gridMat = host.getTrackMaterial("#00FFFF")
  const barMat1 = host.getTrackMaterial("#00FF00")
  const barMat2 = host.getTrackMaterial("#FF0000")

  let currentPos = host.currentStartPos.clone()
  let heading = 0
  const dropLen = 15
  const dropIncline = (25 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 8, dropLen, dropIncline, floorMat)
  const eqLen = 20
  const eqWidth = 10
  const eqStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, eqWidth, eqLen, 0, floorMat)

  if (host.world) {
    const rows = 5
    const cols = 4
    const rowSpacing = 3.0
    const colSpacing = 2.0
    const pistonWidth = 1.5
    const pistonHeight = 3.0
    const pistonDepth = 1.5
    const startZ = 2.0
    const startX = -((cols - 1) * colSpacing) / 2
    const forwardVec = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const zOffset = startZ + r * rowSpacing
        const xOffset = startX + c * colSpacing
        const pistonPos = eqStart.add(forwardVec.scale(zOffset)).add(right.scale(xOffset))
        const basePos = pistonPos.clone()
        basePos.y += pistonHeight / 2
        const box = MeshBuilder.CreateBox("eqPiston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, host.scene)
        box.position.copyFrom(basePos)
        box.rotation.y = heading
        box.material = (r % 2 === 0) ? barMat1 : barMat2
        host.adventureTrack.push(box)
        const q = Quaternion.FromEulerAngles(0, heading, 0)
        const body = host.world.createRigidBody(host.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(basePos.x, basePos.y, basePos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
        host.world.createCollider(host.rapier.ColliderDesc.cuboid(pistonWidth / 2, pistonHeight / 2, pistonDepth / 2), body)
        host.adventureBodies.push(body)
        host.animatedObstacles.push({ body, mesh: box, type: 'PISTON', basePos: basePos, frequency: 4.0, amplitude: 1.5, phase: xOffset * 0.5 + r * 1.0 })
      }
    }
  }

  const turnRadius = 12
  const turnAngle = Math.PI
  const turnIncline = -(5 * Math.PI) / 180
  const turnBank = -(15 * Math.PI) / 180
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 8, 2.0, gridMat, 20, turnBank)
  heading += turnAngle

  const spiralRadius = 6
  const spiralAngle = 2 * Math.PI
  const spiralIncline = (15 * Math.PI) / 180
  const spiralBank = -(30 * Math.PI) / 180
  currentPos = host.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 8, 2.0, floorMat, 30, spiralBank)
  heading += spiralAngle

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, gridMat)
}

export function createSolarFlareTrackImpl(host: any): void {
  const plasmaMat = host.getTrackMaterial("#FF4500")
  const coreMat = host.getTrackMaterial("#FFFF00")
  let currentPos = host.currentStartPos.clone()
  let heading = 0
  const launchLen = 15
  const launchIncline = (20 * Math.PI) / 180
  const launchStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, plasmaMat)

  if (host.world) {
    const hLen = launchLen * Math.cos(launchIncline)
    const vDrop = launchLen * Math.sin(launchIncline)
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const center = launchStart.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2
    center.y += 0.5
    const sensor = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
    const q = Quaternion.FromEulerAngles(launchIncline, heading, 0)
    sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    host.world.createCollider(host.rapier.ColliderDesc.cuboid(3, 1, launchLen / 2).setSensor(true), sensor)
    const forceDir = new Vector3(Math.sin(heading) * Math.cos(launchIncline), -Math.sin(launchIncline), Math.cos(heading) * Math.cos(launchIncline))
    host.conveyorZones.push({ sensor, force: forceDir.scale(80.0) })
  }

  const archLen = 20
  const segments = 10
  const segLen = archLen / segments
  const archWidth = 4
  for (let i = 0; i < segments; i++) {
    const x0 = i * segLen
    const x1 = (i + 1) * segLen
    const xm = (x0 + x1) / 2
    const slope = -0.16 * (xm - 10)
    const incline = -Math.atan(slope)
    const meshLen = Math.sqrt(1 + slope * slope) * segLen
    currentPos = host.addStraightRamp(currentPos, heading, archWidth, meshLen, incline, plasmaMat, 0.5)
  }

  const fieldLen = 25
  const fieldWidth = 12
  const fieldStart = currentPos.clone()
  currentPos = host.addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, plasmaMat)

  if (host.world) {
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    const wellStrength = 40.0
    const positions = [ { z: 5, x: -3 }, { z: 12, x: 3 }, { z: 20, x: 0 } ]
    positions.forEach(p => {
      const wellPos = fieldStart.add(forward.scale(p.z)).add(right.scale(p.x))
      wellPos.y += 0.5
      const vortex = MeshBuilder.CreateCylinder("vortex", { diameter: 4, height: 0.1 }, host.scene)
      vortex.position.copyFrom(wellPos)
      vortex.material = coreMat
      host.adventureTrack.push(vortex)
      const sensor = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(wellPos.x, wellPos.y, wellPos.z))
      host.world.createCollider(host.rapier.ColliderDesc.cylinder(1.0, 3.0).setSensor(true), sensor)
      host.gravityWells.push({ sensor, center: wellPos, strength: wellStrength })
    })
  }

  const windRadius = 15
  const windAngle = Math.PI
  const windStart = currentPos.clone()
  const windStartHeading = heading
  currentPos = host.addCurvedRamp(currentPos, heading, windRadius, windAngle, 0, 8, 1.0, plasmaMat, 20, 0)

  if (host.world) {
    const segments = 10
    const segAngle = windAngle / segments
    const chordLen = 2 * windRadius * Math.sin(segAngle / 2)
    let curH = windStartHeading
    let curP = windStart.clone()
    for (let i = 0; i < segments; i++) {
      curH += segAngle / 2
      const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
      const center = curP.add(forward.scale(chordLen / 2))
      center.y += 0.5
      const sensor = host.world.createRigidBody(host.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
      const q = Quaternion.FromEulerAngles(0, curH, 0)
      sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
      host.world.createCollider(host.rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true), sensor)
      const windForce = new Vector3(50.0, 0, 0)
      host.conveyorZones.push({ sensor, force: windForce })
      curP = curP.add(forward.scale(chordLen))
      curH += segAngle / 2
    }
  }
  heading += windAngle

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(forward.scale(4))
  host.createBasin(goalPos, coreMat)
  const ring = MeshBuilder.CreateTorus("dysonRing", { diameter: 8, thickness: 1.0, tessellation: 32 }, host.scene)
  ring.position.copyFrom(goalPos)
  ring.position.y += 2
  ring.rotation.x = Math.PI / 2
  ring.material = coreMat
  host.adventureTrack.push(ring)
}
