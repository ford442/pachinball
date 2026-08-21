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
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { compileTrackDefinition, type TrackBuildApi, type TrackMaterial } from '../src/adventure/track-compiler'
import { validateTrackDefinition } from '../src/adventure/track-schema'
import quantumGridJson from '../src/adventure/track-data/QUANTUM_GRID.json'
import chronoCoreJson from '../src/adventure/track-data/CHRONO_CORE.json'
import singularityWellJson from '../src/adventure/track-data/SINGULARITY_WELL.json'
import cryoChamberJson from '../src/adventure/track-data/CRYO_CHAMBER.json'
import firewallBreachJson from '../src/adventure/track-data/FIREWALL_BREACH.json'
import neonHelixJson from '../src/adventure/track-data/NEON_HELIX.json'
import cyberCoreJson from '../src/adventure/track-data/CYBER_CORE.json'
import pachinkoSpireJson from '../src/adventure/track-data/PACHINKO_SPIRE.json'

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
    createStaticCylinder: (pos, diameter, height, material) =>
      calls.push({ fn: 'cylinder', args: [v(pos), diameter, height, material] }),
    createPinField: (
      rampStart,
      heading,
      inclineRad,
      rampLength,
      pinSpacing,
      evenOffsets,
      oddOffsets,
      pinDiameter,
      pinHeight,
      material,
    ) =>
      calls.push({
        fn: 'pinField',
        args: [
          v(rampStart),
          round(heading),
          round(inclineRad),
          rampLength,
          pinSpacing,
          [...evenOffsets],
          [...oddOffsets],
          pinDiameter,
          pinHeight,
          material,
        ],
      }),
    createInclinedMill: (center, radius, inclineRad, angVelAlongNormal, material) =>
      calls.push({
        fn: 'mill',
        args: [v(center), radius, round(inclineRad), round(angVelAlongNormal), material],
      }),
    createResetBasin: (pos, material) => calls.push({ fn: 'resetBasin', args: [v(pos), material] }),
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

/** SINGULARITY_WELL path geometry (no vista pylons). */
function referenceSingularityWell(api: TrackBuildApi): void {
  const wellMat = api.getTrackMaterial('#9900FF')
  let pos = api.currentStartPos.clone()
  let heading = 0

  pos = api.addStraightRamp(pos, heading, 6, 12, deg(15), wellMat)
  pos = api.addCurvedRamp(pos, heading, 14, Math.PI, deg(5), 6, 4.0, wellMat, 20, deg(-15))
  heading += Math.PI

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(4)
  pos = pos.add(gapForward)
  pos.y -= 2

  pos = api.addStraightRamp(pos, heading, 6, 4, 0, wellMat)
  pos = api.addCurvedRamp(pos, heading, 8, deg(270), deg(10), 6, 1.0, wellMat, 20, deg(-25))
  heading += deg(270)

  pos = api.addStraightRamp(pos, heading, 5, 8, deg(35), wellMat)
  api.addExitPortal(new Vector3(pos.x, pos.y + 1.8, pos.z))
  api.createBasin(pos, wellMat)
}

/** CRYO_CHAMBER path geometry (no ice pillars). */
function referenceCryoChamber(api: TrackBuildApi): void {
  const iceMat = api.getTrackMaterial('#A5F2F3')
  let pos = api.currentStartPos.clone()
  let heading = 0
  const iceFriction = 0.001

  pos = api.addStraightRamp(pos, heading, 6, 15, deg(20), iceMat, 1.0, iceFriction)
  pos = api.addCurvedRamp(pos, heading, 10, -Math.PI / 4, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
  heading -= Math.PI / 4
  pos = api.addCurvedRamp(pos, heading, 10, Math.PI / 2, 0, 8, 1.0, iceMat, 15, 0, iceFriction)
  heading += Math.PI / 2
  pos = api.addCurvedRamp(pos, heading, 10, -Math.PI / 4, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
  heading -= Math.PI / 4
  pos = api.addStraightRamp(pos, heading, 2.5, 12, 0, iceMat, 0.0, iceFriction)
  pos = api.addCurvedRamp(pos, heading, 10, Math.PI, deg(15), 8, 2.0, iceMat, 20, deg(-20), iceFriction)
  heading += Math.PI

  const goalPos = pos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  api.addExitPortal(new Vector3(goalPos.x, goalPos.y - 0.2, goalPos.z))
  api.createBasin(goalPos, iceMat)
}

/** FIREWALL_BREACH path geometry (no debris blocks). */
function referenceFirewallBreach(api: TrackBuildApi): void {
  const wallMat = api.getTrackMaterial('#FF4400')
  let pos = api.currentStartPos.clone()
  let heading = 0

  pos = api.addStraightRamp(pos, heading, 6, 20, deg(25), wallMat)
  pos = api.addStraightRamp(pos, heading, 8, 15, 0, wallMat)
  pos = api.addCurvedRamp(pos, heading, 10, -Math.PI / 2, 0, 8, 1.0, wallMat, 15, 0)
  heading -= Math.PI / 2
  pos = api.addCurvedRamp(pos, heading, 10, Math.PI / 2, 0, 8, 1.0, wallMat, 15, 0)
  heading += Math.PI / 2
  pos = api.addStraightRamp(pos, heading, 8, 10, 0, wallMat)

  const goalPos = pos.clone()
  goalPos.y -= 2
  goalPos.z += 2
  api.addExitPortal(new Vector3(goalPos.x, goalPos.y - 0.2, goalPos.z))
  api.createBasin(goalPos, wallMat)
}

/** NEON_HELIX EXTENDED_MAP path (vista pylons kept as cylinders). */
function referenceNeonHelix(api: TrackBuildApi): void {
  const holoMat = api.getTrackMaterial('#00ffff')
  const accentMat = api.getTrackMaterial('#00aaff')
  let pos = api.currentStartPos.clone()
  let heading = Math.PI

  const addRamp = (width: number, length: number, drop: number) => {
    const incline = Math.atan2(drop, length)
    const meshLen = Math.sqrt(length * length + drop * drop)
    pos = api.addStraightRamp(pos, heading, width, meshLen, incline, holoMat)
  }

  addRamp(6, 14, 6)
  heading += Math.PI / 2
  addRamp(4, 10, 2)
  heading -= Math.PI / 1.5
  addRamp(4, 16, 4)

  pos = api.addCurvedRamp(pos, heading, 12, Math.PI * 0.75, deg(8), 5, 2.0, holoMat, 24, -deg(10))
  heading += Math.PI * 0.75

  addRamp(5, 10, 5)

  api.createStaticCylinder(new Vector3(pos.x - 3, pos.y, pos.z - 2), 0.6, 3.0, accentMat)
  api.createStaticCylinder(new Vector3(pos.x + 3, pos.y, pos.z - 2), 0.6, 3.0, accentMat)
  api.addExitPortal(new Vector3(pos.x, pos.y + 1.8, pos.z))
  api.createBasin(pos, holoMat)
}

/** CYBER_CORE STATIONARY_TABLE arena (catalog mode). */
function referenceCyberCore(api: TrackBuildApi): void {
  const coreMat = api.getThemedTrackMaterial('structure')
  const accentMat = api.getThemedTrackMaterial('energy')
  const glowMat = api.getThemedTrackMaterial('glow')
  let pos = api.currentStartPos.clone()
  let heading = 0

  pos = api.addStraightRamp(pos, heading, 6, 15, deg(20), coreMat)
  pos = api.addCurvedRamp(pos, heading, 15, Math.PI, deg(5), 6, 3.0, coreMat, 48)
  heading += Math.PI

  const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(8)
  pos = pos.add(gapForward)
  pos.y -= 2

  pos = api.addStraightRamp(pos, heading, 6, 5, 0, glowMat)

  pos = api.addCurvedRamp(pos, heading, 8, deg(270), deg(15), 6, 1.0, coreMat, 48)
  heading += deg(270)

  const bumpCentre = new Vector3(pos.x, pos.y + 0.5, pos.z + 2)
  const bumperPositions = [
    new Vector3(bumpCentre.x, bumpCentre.y, bumpCentre.z - 3),
    new Vector3(bumpCentre.x - 2, bumpCentre.y, bumpCentre.z - 1),
    new Vector3(bumpCentre.x + 2, bumpCentre.y, bumpCentre.z - 1),
    new Vector3(bumpCentre.x - 3, bumpCentre.y, bumpCentre.z + 1),
    new Vector3(bumpCentre.x + 3, bumpCentre.y, bumpCentre.z + 1),
    new Vector3(bumpCentre.x, bumpCentre.y, bumpCentre.z + 3),
  ]
  for (const bumperPos of bumperPositions) {
    api.createStaticCylinder(bumperPos, 0.8, 1.2, accentMat)
  }

  api.createRotatingPlatform(
    new Vector3(pos.x, pos.y - 0.5, pos.z + 6),
    3.5,
    0.8,
    api.getThemedTrackMaterial('accent'),
  )

  const basinPos = new Vector3(pos.x, pos.y, pos.z + 8)
  api.addExitPortal(new Vector3(basinPos.x, basinPos.y + 1.6, basinPos.z))
  api.createBasin(basinPos, coreMat)
}

/** PACHINKO_SPIRE STATIONARY_TABLE pin mill (gizmos on TrackBuildApi). */
function referencePachinkoSpire(api: TrackBuildApi): void {
  const spireMat = api.getTrackMaterial('#FFFFFF')
  const accentMat = api.getTrackMaterial('#ffdd00')
  let pos = api.currentStartPos.clone()
  const heading = 0

  pos = api.addStraightRamp(pos, heading, 6, 5, deg(45), spireMat)

  const mainLen = 30
  const mainIncline = deg(75)
  const mainStartPos = pos.clone()
  pos = api.addStraightRamp(pos, heading, 12, mainLen, mainIncline, spireMat)

  api.createPinField(
    mainStartPos,
    heading,
    mainIncline,
    mainLen,
    2.0,
    [-4, -2, 0, 2, 4],
    [-3, -1, 1, 3],
    0.3,
    0.5,
    spireMat,
  )

  const millCenter = (lateral: number) => {
    const horiz = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const fwd = new Vector3(
      horiz.x * Math.cos(mainIncline),
      -Math.sin(mainIncline),
      horiz.z * Math.cos(mainIncline),
    )
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    const normal = new Vector3(
      horiz.x * Math.sin(mainIncline),
      Math.cos(mainIncline),
      horiz.z * Math.sin(mainIncline),
    )
    return mainStartPos.add(fwd.scale(15)).add(right.scale(lateral)).add(normal.scale(0.1))
  }

  api.createInclinedMill(millCenter(-3.5), 3, mainIncline, 2.0, spireMat)
  api.createInclinedMill(millCenter(3.5), 3, mainIncline, -2.0, spireMat)

  const basinY = pos.y - 2
  const basinZ = pos.z
  const bumperRingY = basinY + 2
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    api.createStaticCylinder(
      new Vector3(Math.cos(angle) * 4, bumperRingY, basinZ + Math.sin(angle) * 4),
      0.7,
      1.0,
      accentMat,
    )
  }

  const centralBasinPos = new Vector3(0, basinY, basinZ)
  api.addExitPortal(new Vector3(centralBasinPos.x, centralBasinPos.y + 1.6, centralBasinPos.z))
  api.createBasin(centralBasinPos, spireMat)
  api.createResetBasin(new Vector3(-6, basinY, basinZ), spireMat)
  api.createResetBasin(new Vector3(6, basinY, basinZ), spireMat)
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

  it('SINGULARITY_WELL JSON reproduces the TS path geometry', () => {
    const anchor = new Vector3(0, 25, 0)
    const fromJson = runJson(singularityWellJson, anchor)
    const fromTs = runReference(referenceSingularityWell, anchor)
    expect(fromJson).toEqual(fromTs)
  })

  it('CRYO_CHAMBER JSON reproduces the TS path geometry', () => {
    const anchor = new Vector3(0, 20, 0)
    const fromJson = runJson(cryoChamberJson, anchor)
    const fromTs = runReference(referenceCryoChamber, anchor)
    expect(fromJson).toEqual(fromTs)
  })

  it('FIREWALL_BREACH JSON reproduces the TS path geometry', () => {
    const anchor = new Vector3(0, 25, 0)
    const fromJson = runJson(firewallBreachJson, anchor)
    const fromTs = runReference(referenceFirewallBreach, anchor)
    expect(fromJson).toEqual(fromTs)
  })

  it('NEON_HELIX JSON reproduces the TS builder call-for-call', () => {
    const anchor = new Vector3(0, 2, 8)
    const fromJson = runJson(neonHelixJson, anchor)
    const fromTs = runReference(referenceNeonHelix, anchor)
    expect(fromJson).toEqual(fromTs)
  })

  it('CYBER_CORE JSON reproduces the TS builder call-for-call', () => {
    const anchor = new Vector3(0, 20, 0)
    const fromJson = runJson(cyberCoreJson, anchor)
    const fromTs = runReference(referenceCyberCore, anchor)
    expect(fromJson).toEqual(fromTs)
  })

  it('PACHINKO_SPIRE JSON reproduces the TS builder call-for-call', () => {
    const anchor = new Vector3(0, 30, 0)
    const fromJson = runJson(pachinkoSpireJson, anchor)
    const fromTs = runReference(referencePachinkoSpire, anchor)
    expect(fromJson).toEqual(fromTs)
  })
})
