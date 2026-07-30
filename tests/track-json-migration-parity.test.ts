/**
 * Migration parity — JSON tracks vs the TS builders they replaced (#321).
 *
 * QUANTUM_GRID and CHRONO_CORE moved from hand-written builders to declarative
 * JSON. Both drive the same TrackBuilder surface, so recording the call sequence
 * from each and diffing them proves the migration preserved the geometry rather
 * than merely producing *some* track.
 *
 * The reference builders are inlined here on purpose: the originals are deleted
 * from src/, and a frozen copy is what makes this a regression test — if the
 * compiler or a JSON edit drifts, this fails.
 */

import { describe, it, expect } from 'vitest'
import { Vector3 } from '@babylonjs/core'
import { compileTrackDefinition, type TrackBuildApi, type TrackMaterial } from '../src/adventure/track-compiler'
import { validateTrackDefinition } from '../src/adventure/track-schema'
import quantumGridJson from '../src/adventure/track-data/QUANTUM_GRID.json'
import chronoCoreJson from '../src/adventure/track-data/CHRONO_CORE.json'

type Call = { fn: string; args: unknown[] }

const round = (n: number) => Math.round(n * 1000) / 1000
const v = (p: Vector3) => [round(p.x), round(p.y), round(p.z)]

/**
 * Records calls and models addStraightRamp/addCurvedRamp cursor advancement the
 * same way TrackBuilder does, so both paths walk identical positions.
 */
function makeRecorder(startPos: Vector3) {
  const calls: Call[] = []
  const mat = (tag: string) => tag as unknown as TrackMaterial

  const api: TrackBuildApi = {
    currentStartPos: startPos.clone(),
    getTrackMaterial: (hex) => mat(`hex:${hex}`),
    getThemedTrackMaterial: (role) => mat(`role:${role}`),
    // End-position maths below mirrors TrackBuilder.addStraightRamp /
    // addCurvedRamp exactly (note: positive incline DROPS the surface —
    // the builder subtracts vDrop). Keep in sync if those change.
    addStraightRamp(pos, heading, width, length, inclineRad, material, wallHeight, friction) {
      calls.push({
        fn: 'straight',
        args: [v(pos), round(heading), width, length, round(inclineRad), material, wallHeight ?? 0, friction ?? 0.5],
      })
      const hLen = length * Math.cos(inclineRad)
      const vDrop = length * Math.sin(inclineRad)
      const fwd = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const end = pos.add(fwd.scale(hLen))
      end.y -= vDrop
      return end
    },
    addCurvedRamp(pos, startHeading, radius, totalAngle, inclineRad, width, wallHeight, material, segments, banking, friction) {
      const segCount = segments ?? 20
      calls.push({
        fn: 'curve',
        args: [
          v(pos), round(startHeading), radius, round(totalAngle), round(inclineRad),
          width, wallHeight, material, segCount, round(banking ?? 0), friction ?? 0.5,
        ],
      })
      const segmentAngle = totalAngle / segCount
      const arcLength = radius * Math.abs(segmentAngle)
      const chordLen = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2)
      const segmentDrop = arcLength * Math.sin(inclineRad)

      let currentHeading = startHeading
      let currentP = pos.clone()
      for (let i = 0; i < Math.abs(segCount); i++) {
        currentHeading += segmentAngle / 2
        const f = new Vector3(Math.sin(currentHeading), 0, Math.cos(currentHeading))
        currentP = currentP.add(f.scale(chordLen))
        currentP.y -= segmentDrop
        currentHeading += segmentAngle / 2
      }
      return currentP
    },
    createBasin: (pos, material) => calls.push({ fn: 'basin', args: [v(pos), material] }),
    addExitPortal: (pos) => calls.push({ fn: 'portal', args: [v(pos)] }),
    createRotatingPlatform: (center, radius, angVelY, material, hasTeeth) =>
      calls.push({ fn: 'spinner', args: [v(center), radius, round(angVelY), material, hasTeeth ?? false] }),
    createChromaGate: (pos, color) => calls.push({ fn: 'gate', args: [v(pos), color] }),
  }

  return { api, calls }
}

const deg = (d: number) => (d * Math.PI) / 180

// ── Frozen reference builders (pre-migration source of truth) ────────────────

/** QUANTUM_GRID as it was built in src/adventure/tracks/quantum-grid.ts, EXTENDED_MAP branch. */
function referenceQuantumGrid(api: TrackBuildApi): void {
  const gridMat = api.getTrackMaterial('#00FF00')
  let pos = api.currentStartPos.clone()
  let heading = 0

  pos = api.addStraightRamp(pos, heading, 4, 10, 0, gridMat)

  const zigzagWidth = 3
  const zigzagLen = 5
  pos = api.addStraightRamp(pos, heading, zigzagWidth, zigzagLen, 0, gridMat)
  heading -= Math.PI / 2
  pos = api.addStraightRamp(pos, heading, zigzagWidth, zigzagLen, 0, gridMat)
  heading += Math.PI / 2
  pos = api.addStraightRamp(pos, heading, zigzagWidth, zigzagLen, 0, gridMat)

  heading -= Math.PI / 2
  pos = api.addStraightRamp(pos, heading, zigzagWidth, zigzagLen, 0, gridMat)
  heading += Math.PI / 2
  pos = api.addStraightRamp(pos, heading, zigzagWidth, zigzagLen, 0, gridMat)

  api.createChromaGate(new Vector3(pos.x, pos.y + 1.5, pos.z + 2), 'GREEN')

  const orbitAngle = deg(270)
  pos = api.addCurvedRamp(pos, heading, 6, orbitAngle, deg(-5), zigzagWidth, 0.5, gridMat)
  heading += orbitAngle

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(4)
  pos = pos.add(gapForward)
  pos.y -= 1

  pos = api.addStraightRamp(pos, heading, 4, 3, 0, gridMat)

  api.addExitPortal(new Vector3(pos.x, pos.y + 1.8, pos.z))
  api.createBasin(pos, gridMat)
}

/** CHRONO_CORE as it was built in src/adventure/tracks/chrono-core.ts. */
function referenceChronoCore(api: TrackBuildApi): void {
  const chronoMat = api.getTrackMaterial('#FFD700')
  let pos = api.currentStartPos.clone()
  const heading = 0

  pos = api.addStraightRamp(pos, heading, 5, 10, deg(10), chronoMat)

  const gear1Radius = 8
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
  pos.y -= 1.0
  const gear1Center = pos.add(forward.scale(gear1Radius + 1))
  api.createRotatingPlatform(gear1Center, gear1Radius, -deg(30), chronoMat)

  pos = gear1Center.add(forward.scale(gear1Radius))
  pos = api.addStraightRamp(pos, heading, 3, 12, 0, chronoMat)

  const gear2Radius = 10
  const gear2Center = pos.add(forward.scale(gear2Radius + 0.5))
  api.createRotatingPlatform(gear2Center, gear2Radius, deg(20), chronoMat, true)

  const goalPos = gear2Center.clone()
  goalPos.y += 4.0

  const jumpRampPos = gear2Center.add(forward.scale(gear2Radius - 2))
  api.addStraightRamp(jumpRampPos, heading + Math.PI, 4, 4, -deg(30), chronoMat)
  api.createBasin(goalPos, chronoMat)
}

// ── Parity assertions ────────────────────────────────────────────────────────

function runJson(raw: unknown, startPos: Vector3): Call[] {
  const result = validateTrackDefinition(raw)
  expect(result.ok, `definition must validate: ${JSON.stringify('errors' in result ? result.errors : [])}`).toBe(true)
  if (!result.ok) throw new Error('unreachable')
  const { api, calls } = makeRecorder(startPos)
  compileTrackDefinition(result.definition, api)
  return calls
}

function runReference(builder: (api: TrackBuildApi) => void, startPos: Vector3): Call[] {
  const { api, calls } = makeRecorder(startPos)
  builder(api)
  return calls
}

describe('JSON migration parity (#321)', () => {
  // Anchors come from the track manifests (startAnchor).
  const quantumGridAnchor = new Vector3(0, 10, 0)
  const chronoCoreAnchor = new Vector3(0, 15, 0)

  it('QUANTUM_GRID JSON reproduces the TS builder call-for-call', () => {
    const fromJson = runJson(quantumGridJson, quantumGridAnchor)
    const fromTs = runReference(referenceQuantumGrid, quantumGridAnchor)
    expect(fromJson).toEqual(fromTs)
  })

  it('CHRONO_CORE JSON reproduces the TS builder call-for-call', () => {
    const fromJson = runJson(chronoCoreJson, chronoCoreAnchor)
    const fromTs = runReference(referenceChronoCore, chronoCoreAnchor)
    expect(fromJson).toEqual(fromTs)
  })
})
