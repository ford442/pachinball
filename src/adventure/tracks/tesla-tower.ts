/**
 * Tesla Tower Track
 * 
 * An electric-themed track with induction coils and spark gaps.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TrackBuilderApi } from '../track-builder-api'
import { boxDesc, sphereDesc } from '../track-collider-descriptors'
import { getLayoutRng } from '../../core/seeded-rng'

export function buildTeslaTower(builder: TrackBuilderApi): void {
  const coilMat = builder.getTrackMaterial("#CD7F32")
  const lightningMat = builder.getTrackMaterial("#00DDFF")

  const {
    currentStartPos,
    scene,
    adventureTrack,
    adventureBodies,
    kinematicBindings,
    animatedObstacles,
    conveyorZones,
  } = builder

  let currentPos = currentStartPos.clone()
  let heading = 0

  // 1. The Induction Coil
  const coilRadius = 10
  const coilAngle = 2 * Math.PI
  const coilIncline = (15 * Math.PI) / 180

  const coilStart = currentPos.clone()
  const coilStartHeading = heading

  currentPos = builder.addCurvedRamp(currentPos, heading, coilRadius, coilAngle, coilIncline, 8, 2.0, coilMat, 30)

  if (builder.hasWorld) {
    const segments = 20
    const segAngle = coilAngle / segments
    const chordLen = 2 * coilRadius * Math.sin(segAngle / 2)
    const drop = chordLen * Math.sin(coilIncline)

    let curH = coilStartHeading
    let curP = coilStart.clone()

    for (let i = 0; i < segments; i++) {
      curH += segAngle / 2
      const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
      const center = curP.add(forward.scale(chordLen / 2))
      center.y -= drop / 2
      center.y += 0.5

      const q = Quaternion.FromEulerAngles(coilIncline, curH, 0)
      const { body: sensor } = builder.emitCollider(
        boxDesc({ x: center.x, y: center.y, z: center.z }, { x: 4, y: 1, z: chordLen / 2 }, {
          rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
          sensor: true,
          label: 'coilConveyor',
        })
      )

      const forceVec = new Vector3(Math.sin(curH), -Math.sin(coilIncline), Math.cos(curH)).normalize().scale(200.0)

      conveyorZones.push({
        sensor,
        force: forceVec
      })

      curP = curP.add(forward.scale(chordLen))
      curP.y -= drop
      curH += segAngle / 2
    }
  }
  heading += coilAngle

  // 2. The Spark Gap
  const gapLen = 8
  const gapDrop = 2

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const gapStart = currentPos.clone()

  const arcPoints = [
    gapStart,
    gapStart.add(gapForward.scale(gapLen)).subtract(new Vector3(0, gapDrop, 0))
  ]
  const arc = MeshBuilder.CreateTube("sparkArc", { path: arcPoints, radius: 0.2 }, scene)
  arc.material = lightningMat
  adventureTrack.push(arc)

  currentPos = currentPos.add(gapForward.scale(gapLen))
  currentPos.y -= gapDrop

  // 3. The Step-Down Transformer
  const zigLen = 6
  const zigWidth = 4

  currentPos = builder.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)
  builder.createArcPylon(currentPos, lightningMat)
  heading -= Math.PI / 2

  currentPos = builder.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)
  builder.createArcPylon(currentPos, lightningMat)
  heading += Math.PI / 2

  currentPos = builder.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

  // 4. The Faraday Cage
  const cageSize = 12
  const cageStart = currentPos.clone()

  currentPos = builder.addStraightRamp(currentPos, heading, cageSize, cageSize, 0, coilMat)

  if (builder.hasWorld) {
    const sphereRadius = 1.0
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

    // Kinematic colliders: placement and oscillation are both physics — seeded.
    const layout = getLayoutRng('track:tesla-tower:lightning')
    for (let i = 0; i < 3; i++) {
      const offsetZ = 2 + layout.next() * (cageSize - 4)
      const offsetX = (layout.next() - 0.5) * (cageSize - 4)

      const pos = cageStart.add(forward.scale(offsetZ)).add(right.scale(offsetX))
      pos.y += 2.0

      const sphere = MeshBuilder.CreateSphere("ballLightning", { diameter: sphereRadius * 2 }, scene)
      sphere.position.copyFrom(pos)
      sphere.material = lightningMat
      adventureTrack.push(sphere)

      const { body } = builder.emitCollider(
        sphereDesc({ x: pos.x, y: pos.y, z: pos.z }, sphereRadius, {
          restitution: 1.2,
          // Position-based: the OSCILLATOR animator below sets its next pose.
          // (It was velocity-based, which ignores that pose, so it never moved.)
          motion: 'kinematic-position',
          label: 'ballLightning',
        })
      )
      adventureBodies.push(body)
      kinematicBindings.push({ body, mesh: sphere })

      animatedObstacles.push({
        body,
        mesh: sphere,
        type: 'OSCILLATOR',
        basePos: pos,
        frequency: 0.5 + layout.next(),
        amplitude: 3.0,
        axis: right,
        phase: layout.next() * Math.PI
      })
    }
  }

  // 5. Grounding Rod
  const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  const goalPos = currentPos.add(goalForward.scale(4))

  builder.createBasin(goalPos, coilMat)
}
