import { MeshBuilder, Vector3, Quaternion } from '@babylonjs/core'

// Implementation helpers for AdventureModeTracksB (part 1)

export function createCpuCoreTrackImpl(host: any): void {
  const pcbMat = host.getTrackMaterial("#004400")
  const traceMat = host.getTrackMaterial("#FFD700")
  let currentPos = host.currentStartPos.clone()
  let heading = 0

  const entryLen = 15
  currentPos = host.addStraightRamp(currentPos, heading, 6, entryLen, 0, pcbMat)

  const gateWidth = 3
  const gateLen = 5
  currentPos = host.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)
  heading -= Math.PI / 2
  currentPos = host.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)
  heading += Math.PI / 2
  currentPos = host.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

  const fanRadius = 8
  const fanSpeed = 1.5
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const fanCenter = currentPos.add(forward.scale(fanRadius + 1))

  host.createRotatingPlatform(fanCenter, fanRadius, -fanSpeed, pcbMat, false)

  if (host.world) {
    const fanBody = host.adventureBodies[host.adventureBodies.length - 1]
    const bladeCount = 4
    const bladeLength = fanRadius - 1
    const bladeHeight = 1.5
    const bladeThickness = 0.5

    for (let i = 0; i < bladeCount; i++) {
      const angle = (i * Math.PI * 2) / bladeCount
      const blade = MeshBuilder.CreateBox("fanBlade", { width: bladeThickness, height: bladeHeight, depth: bladeLength }, host.scene)
      const binding = host.kinematicBindings.find((b: any) => b.body === fanBody)
      if (binding) {
        blade.parent = binding.mesh
        const r = bladeLength / 2
        const lx = Math.sin(angle) * r
        const lz = Math.cos(angle) * r
        blade.position.set(lx, bladeHeight / 2, lz)
        blade.rotation.y = angle
        blade.material = traceMat

        const colRot = Quaternion.FromEulerAngles(0, angle, 0)
        const colliderDesc = host.rapier.ColliderDesc.cuboid(bladeThickness / 2, bladeHeight / 2, bladeLength / 2)
          .setTranslation(lx, bladeHeight / 2 + 0.25, lz)
          .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })
        host.world.createCollider(colliderDesc, fanBody)
      }
    }
  }

  const bridgeStart = fanCenter.add(forward.scale(fanRadius))
  const bridgeLen = 10
  const bridgeWidth = 2.0
  const bridgeEnd = host.addStraightRamp(bridgeStart, heading, bridgeWidth, bridgeLen, 0, traceMat)

  const goalPos = bridgeEnd.clone()
  goalPos.z += 4
  host.createBasin(goalPos, pcbMat)

  const socket = MeshBuilder.CreateBox("cpuSocket", { width: 4, height: 0.2, depth: 4 }, host.scene)
  socket.position.copyFrom(goalPos)
  socket.position.y += 0.5
  socket.material = traceMat
  host.adventureTrack.push(socket)
}

export function createCryoChamberTrackImpl(host: any): void {
  const iceMat = host.getTrackMaterial("#A5F2F3")
  const pillarMat = host.getTrackMaterial("#FFFFFF")
  let currentPos = host.currentStartPos.clone()
  let heading = 0
  const iceFriction = 0.001

  const entryLen = 15
  const entryIncline = (20 * Math.PI) / 180
  currentPos = host.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, iceMat, 1.0, iceFriction)

  const slalomRadius = 10
  const turn45 = Math.PI / 4
  const turn90 = Math.PI / 2

  currentPos = host.addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
  heading -= turn45
  host.createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)
  currentPos = host.addCurvedRamp(currentPos, heading, slalomRadius, turn90, 0, 8, 1.0, iceMat, 15, 0, iceFriction)
  heading += turn90
  host.createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)
  currentPos = host.addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
  heading -= turn45

  const bridgeLen = 12
  const bridgeWidth = 2.5
  currentPos = host.addStraightRamp(currentPos, heading, bridgeWidth, bridgeLen, 0, iceMat, 0.0, iceFriction)

  const avRadius = 10
  const avAngle = Math.PI
  const avIncline = (15 * Math.PI) / 180
  const avBank = -(20 * Math.PI) / 180

  currentPos = host.addCurvedRamp(currentPos, heading, avRadius, avAngle, avIncline, 8, 2.0, iceMat, 20, avBank, iceFriction)
  heading += avAngle

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, iceMat)
}

export function createBioHazardLabTrackImpl(host: any): void {
  const hazardMat = host.getTrackMaterial("#39FF14")
  const warningMat = host.getTrackMaterial("#FFFF00")
  let currentPos = host.currentStartPos.clone()
  let heading = 0
  const chuteLen = 15
  const chuteIncline = (20 * Math.PI) / 180
  const sludgeFriction = 0.1
  currentPos = host.addStraightRamp(currentPos, heading, 6, chuteLen, chuteIncline, hazardMat, 1.0, sludgeFriction)

  const centrifugeRadius = 10
  const centrifugeSpeed = 3.0
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const centrifugeCenter = currentPos.add(forward.scale(centrifugeRadius + 1))
  centrifugeCenter.y -= 2.0

  host.createRotatingPlatform(centrifugeCenter, centrifugeRadius, centrifugeSpeed, hazardMat)

  if (host.world && host.adventureBodies.length > 0) {
    const platformBody = host.adventureBodies[host.adventureBodies.length - 1]
    const wallHeight = 0.5
    const wallThickness = 0.5
    const torus = MeshBuilder.CreateTorus("centrifugeWall", { diameter: centrifugeRadius * 2, thickness: wallThickness, tessellation: 32 }, host.scene)
    const binding = host.kinematicBindings.find((b: any) => b.body === platformBody)
    if (binding) {
      torus.parent = binding.mesh
      torus.position.set(0, wallHeight / 2, 0)
      torus.material = warningMat
      const segments = 16
      const angleStep = (Math.PI * 2) / segments
      for (let i = 0; i < segments; i++) {
        const angle = i * angleStep
        const cx = Math.sin(angle) * centrifugeRadius
        const cz = Math.cos(angle) * centrifugeRadius
        const colRot = Quaternion.FromEulerAngles(0, angle, 0)
        const arcLen = centrifugeRadius * angleStep
        const colliderDesc = host.rapier.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, arcLen / 2 + 0.2)
          .setTranslation(cx, wallHeight / 2 + 0.25, cz)
          .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })
        host.world.createCollider(colliderDesc, platformBody)
      }
    }
  }

  const exitDir = heading
  const exitForward = new Vector3(Math.sin(exitDir), 0, Math.cos(exitDir))
  const exitPos = centrifugeCenter.add(exitForward.scale(centrifugeRadius + 2))
  exitPos.y -= 1.0
  currentPos = exitPos
  const pipeLen = 12
  const pipeWidth = 2.5
  const pipeHeight = 4.0
  currentPos = host.addStraightRamp(currentPos, heading, 6, 4, 0, warningMat, 2.0)
  currentPos = host.addStraightRamp(currentPos, heading, pipeWidth, pipeLen, 0, hazardMat, pipeHeight)

  const turnRadius = 8
  const turnAngle = Math.PI / 2
  const halfAngle = turnAngle / 2
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading -= halfAngle
  const gapLen = 2.0
  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(gapForward.scale(gapLen))
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading -= halfAngle
  currentPos = host.addStraightRamp(currentPos, heading, 4, 3, 0, warningMat)
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading += halfAngle
  const gapForward2 = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  currentPos = currentPos.add(gapForward2.scale(gapLen))
  currentPos = host.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
  heading += halfAngle

  const goalPos = currentPos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  host.createBasin(goalPos, hazardMat)
}