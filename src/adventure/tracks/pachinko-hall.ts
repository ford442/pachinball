/**
 * Pachinko Hall — EXTENDED_MAP campaign hub
 *
 * Neon parlor corridor between Neon Helix (spiral descent) and Cyber Core (pinball arena).
 * Gravity-driven pin lanes, conveyor currents, and machine alcoves — no flipper bumper cluster.
 */

import { Vector3, MeshBuilder, Quaternion } from '@babylonjs/core'
import type { TrackBuilder } from '../track-builder'
import type { TrackInfo } from '../../game-elements/adventure-track-progression'
import type * as RAPIER from '@dimforge/rapier3d-compat'

type BuilderCtx = {
  scene: import('@babylonjs/core').Scene
  world: RAPIER.World
  rapier: typeof RAPIER
  currentStartPos: Vector3
  currentTrackInfo: TrackInfo | null
  adventureTrack: import('@babylonjs/core').Mesh[]
  adventureBodies: RAPIER.RigidBody[]
  conveyorZones: { sensor: RAPIER.RigidBody; force: Vector3 }[]
  getTrackMaterial: (hex: string) => import('@babylonjs/core').StandardMaterial
  addStraightRamp: (...args: unknown[]) => Vector3
  addCurvedRamp: (...args: unknown[]) => Vector3
  createBasin: (...args: unknown[]) => void
  createStaticCylinder: (...args: unknown[]) => void
  addExitPortal: (position: Vector3) => void
}

function addPinLane(
  b: BuilderCtx,
  start: Vector3,
  heading: number,
  length: number,
  incline: number,
  width: number,
  mat: import('@babylonjs/core').StandardMaterial,
  pinMat: import('@babylonjs/core').StandardMaterial,
): Vector3 {
  const laneStart = start.clone()
  const end = b.addStraightRamp(start, heading, width, length, incline, mat) as Vector3

  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
  const normal = new Vector3(0, Math.cos(incline), Math.sin(incline))
  const spacing = 2.2
  const rows = Math.max(2, Math.floor(length / spacing) - 1)

  for (let row = 1; row <= rows; row++) {
    const dist = row * spacing
    const offsets = row % 2 === 0 ? [-2.5, -0.8, 0.8, 2.5] : [-1.6, 0, 1.6]
    for (const lateral of offsets) {
      if (Math.abs(lateral) > width / 2 - 0.6) continue
      const base = laneStart
        .add(forward.scale(dist * Math.cos(incline)))
        .add(right.scale(lateral))
      base.y -= dist * Math.sin(incline)
      const pinHeight = 0.45
      const pinPos = base.add(normal.scale(0.2 + pinHeight / 2))

      const pin = MeshBuilder.CreateCylinder('hallPin', { diameter: 0.28, height: pinHeight }, b.scene)
      pin.position.copyFrom(pinPos)
      pin.rotation.x = incline
      pin.rotation.y = heading
      pin.material = pinMat
      b.adventureTrack.push(pin)

      const q = Quaternion.FromEulerAngles(incline, heading, 0)
      const body = b.world.createRigidBody(
        b.rapier.RigidBodyDesc.fixed()
          .setTranslation(pinPos.x, pinPos.y, pinPos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      )
      b.world.createCollider(
        b.rapier.ColliderDesc.cylinder(pinHeight / 2, 0.12).setRestitution(0.75),
        body,
      )
      b.adventureBodies.push(body)
    }
  }

  return end
}

function addConveyorRamp(
  b: BuilderCtx,
  start: Vector3,
  heading: number,
  length: number,
  incline: number,
  width: number,
  mat: import('@babylonjs/core').StandardMaterial,
  forceScale: number,
): Vector3 {
  const rampStart = start.clone()
  const end = b.addStraightRamp(start, heading, width, length, incline, mat) as Vector3

  const forward = new Vector3(
    Math.sin(heading) * Math.cos(incline),
    -Math.sin(incline),
    Math.cos(heading) * Math.cos(incline),
  )
  const hLen = length * Math.cos(incline)
  const vDrop = length * Math.sin(incline)
  const center = rampStart.add(new Vector3(
    Math.sin(heading) * hLen / 2,
    -vDrop / 2 + 0.4,
    Math.cos(heading) * hLen / 2,
  ))

  const sensor = b.world.createRigidBody(
    b.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
  )
  const q = Quaternion.FromEulerAngles(incline, heading, 0)
  sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
  b.world.createCollider(
    b.rapier.ColliderDesc.cuboid(width / 2, 0.5, length / 2).setSensor(true),
    sensor,
  )
  b.conveyorZones.push({ sensor, force: forward.scale(forceScale) })
  b.adventureBodies.push(sensor)

  return end
}

export function buildPachinkoHall(builder: TrackBuilder): void {
  const b = builder as unknown as BuilderCtx
  const hallMat = b.getTrackMaterial('#ffdd00')
  const pinMat = b.getTrackMaterial('#ff66cc')
  const machineMat = b.getTrackMaterial('#00ffff')
  let currentPos = b.currentStartPos.clone()
  let heading = Math.PI

  const modeType = b.currentTrackInfo?.modeType ?? 'EXTENDED_MAP'

  // Gallery overlook — drop into the main hall
  currentPos = b.addStraightRamp(currentPos, heading, 8, 10, (12 * Math.PI) / 180, hallMat) as Vector3

  if (modeType === 'EXTENDED_MAP') {
    // Left pin lane
    const leftHeading = heading + Math.PI / 6
    currentPos = addPinLane(b, currentPos, leftHeading, 14, (8 * Math.PI) / 180, 5, hallMat, pinMat)

    // Neon machine alcoves flanking the corridor
    b.createStaticCylinder(
      new Vector3(currentPos.x - 5, currentPos.y + 1.5, currentPos.z - 3),
      1.2, 3.5, machineMat,
    )
    b.createStaticCylinder(
      new Vector3(currentPos.x + 5, currentPos.y + 1.5, currentPos.z - 3),
      1.2, 3.5, machineMat,
    )

    // Conveyor merge chute toward hall center
    currentPos = addConveyorRamp(
      b, currentPos, heading, 12, (5 * Math.PI) / 180, 6, hallMat, 55,
    )

    // Central pin forest — classic pachinko density
    currentPos = addPinLane(b, currentPos, heading, 18, (6 * Math.PI) / 180, 7, hallMat, pinMat)

    // Wide banked sweep past side machines
    currentPos = b.addCurvedRamp(
      currentPos, heading,
      14, Math.PI / 2, (4 * Math.PI) / 180,
      6, 1.5, hallMat, 20, -(6 * Math.PI) / 180,
    ) as Vector3
    heading += Math.PI / 2

    b.createStaticCylinder(
      new Vector3(currentPos.x + 4, currentPos.y + 1, currentPos.z + 2),
      0.9, 2.8, machineMat,
    )
    b.createStaticCylinder(
      new Vector3(currentPos.x - 4, currentPos.y + 1, currentPos.z + 2),
      0.9, 2.8, machineMat,
    )

    // Final conveyor push to exit arch
    currentPos = addConveyorRamp(
      b, currentPos, heading, 10, 0, 5, hallMat, 40,
    )
  } else {
    currentPos = b.addStraightRamp(currentPos, heading, 6, 16, (5 * Math.PI) / 180, hallMat) as Vector3
  }

  b.addExitPortal(new Vector3(currentPos.x, currentPos.y + 2.0, currentPos.z))
  b.createBasin(currentPos, hallMat)
}
