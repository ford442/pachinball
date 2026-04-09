/**
 * Solar Flare Track
 * 
 * A sun-themed track with plasma boosts and gravity wells.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export function buildSolarFlare(builder: TrackBuilder): void {
  const plasmaMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FF4500")
  const coreMat = (builder as unknown as { getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial }).getTrackMaterial("#FFFF00")

  const currentStartPos = (builder as unknown as { currentStartPos: Vector3 }).currentStartPos
  const scene = (builder as unknown as { scene: import('@babylonjs/core').Scene }).scene
  const world = (builder as unknown as { world: RAPIER.World }).world
  const rapier = (builder as unknown as { rapier: typeof RAPIER }).rapier
  const adventureTrack = (builder as unknown as { adventureTrack: import('@babylonjs/core').Mesh[] }).adventureTrack
  const adventureBodies = (builder as unknown as { adventureBodies: RAPIER.RigidBody[] }).adventureBodies
  void adventureBodies // Used for physics body tracking
  const conveyorZones = (builder as unknown as { conveyorZones: { sensor: RAPIER.RigidBody, force: Vector3 }[] }).conveyorZones
  const gravityWells = (builder as unknown as { gravityWells: { sensor: RAPIER.RigidBody, center: Vector3, strength: number }[] }).gravityWells

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. Coronal Mass Ejection
  const launchLen = 15
  const launchIncline = (20 * Math.PI) / 180
  const launchStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, plasmaMat)

  if (world) {
    const hLen = launchLen * Math.cos(launchIncline)
    const vDrop = launchLen * Math.sin(launchIncline)
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const center = launchStart.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2
    center.y += 0.5

    const sensor = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
    )
    const q = Quaternion.FromEulerAngles(launchIncline, heading, 0)
    sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

    world.createCollider(
      rapier.ColliderDesc.cuboid(3, 1, launchLen / 2).setSensor(true),
      sensor
    )

    const forceDir = new Vector3(
      Math.sin(heading) * Math.cos(launchIncline),
      -Math.sin(launchIncline),
      Math.cos(heading) * Math.cos(launchIncline)
    )
    conveyorZones.push({
      sensor,
      force: forceDir.scale(80.0)
    })
  }

  // 2. The Prominence (Vertical Arch)
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

    currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, archWidth, meshLen, incline, plasmaMat, 0.5)
  }

  // 3. The Sunspot Field
  const fieldLen = 25
  const fieldWidth = 12
  const fieldStart = currentPos.clone()

  currentPos = (builder as unknown as { addStraightRamp: (...args: unknown[]) => Vector3 }).addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, plasmaMat)

  if (world) {
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    const wellStrength = 40.0

    const positions = [
      { z: 5, x: -3 },
      { z: 12, x: 3 },
      { z: 20, x: 0 }
    ]

    positions.forEach(p => {
      const wellPos = fieldStart.add(forward.scale(p.z)).add(right.scale(p.x))
      wellPos.y += 0.5

      const vortex = MeshBuilder.CreateCylinder("vortex", { diameter: 4, height: 0.1 }, scene)
      vortex.position.copyFrom(wellPos)
      vortex.material = coreMat
      adventureTrack.push(vortex)

      const sensor = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(wellPos.x, wellPos.y, wellPos.z)
      )
      world.createCollider(
        rapier.ColliderDesc.cylinder(1.0, 3.0).setSensor(true),
        sensor
      )

      gravityWells.push({
        sensor,
        center: wellPos,
        strength: wellStrength
      })
    })
  }

  // 4. The Solar Wind
  const windRadius = 15
  const windAngle = Math.PI
  const windStart = currentPos.clone()
  const windStartHeading = heading

  currentPos = (builder as unknown as { addCurvedRamp: (...args: unknown[]) => Vector3 }).addCurvedRamp(currentPos, heading, windRadius, windAngle, 0, 8, 1.0, plasmaMat, 20, 0)

  if (world) {
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

      const sensor = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
      )
      const q = Quaternion.FromEulerAngles(0, curH, 0)
      sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

      world.createCollider(
        rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true),
        sensor
      )

      conveyorZones.push({
        sensor,
        force: new Vector3(50.0, 0, 0)
      })

      curP = curP.add(forward.scale(chordLen))
      curH += segAngle / 2
    }
  }
  heading += windAngle

  // 5. Fusion Core
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  ;(builder as unknown as { createBasin: (...args: unknown[]) => void }).createBasin(goalPos, coreMat)

  const ring = MeshBuilder.CreateTorus("dysonRing", { diameter: 8, thickness: 1.0, tessellation: 32 }, scene)
  ring.position.copyFrom(goalPos)
  ring.position.y += 2
  ring.rotation.x = Math.PI / 2
  ring.material = coreMat
  adventureTrack.push(ring)
}
