/**
 * Migration parity — the 14 TS track modules vs the JSON that replaced them (#505 §A).
 *
 * Each track used to be a hand-written builder in `src/adventure/tracks/`. A
 * frozen copy of every builder lives in `tests/fixtures/ts-tracks/` (the
 * originals are deleted from src/); this test builds it and the JSON track
 * through the same real `TrackBuilder` (Babylon mocked) from the same session
 * seed, and requires the two to leave the same physics behind, exactly:
 *
 *   - the ordered collider descriptor list the C++ exporter walks, with
 *     unrounded floats (the mock quaternion records the Euler angles it was
 *     given, so a rotation that differs in the last bit fails too);
 *   - body creation order (Rapier handles) and every per-track list —
 *     movers, kinematic bindings, conveyor / damping zones, gravity wells,
 *     chroma gates, reset sensors, the goal sensor and the exit portal;
 *   - the position and rotation of every track mesh.
 *
 * Two seeds, so the seeded scatters are compared on more than one stream.
 * A failure here is a geometry change, not a refactor.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { PhysicsBody } from '../src/core/physics-api'
import { initSessionRng } from '../src/core/seeded-rng'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import type { TrackInfo } from '../src/adventure/adventure-track-progression'
import { TRACK_CATALOG } from '../src/adventure/adventure-track-progression'
import { getManifestStartAnchor } from '../src/adventure/manifests'
import type { TrackBuilderApi } from '../src/adventure/track-builder-api'
import { validateTrackDefinition, type TrackDefinition } from '../src/schemas/track'
import { ExportHarnessBuilder } from './helpers/track-export-harness'
import { buildBioHazardLab } from './fixtures/ts-tracks/bio-hazard-lab'
import { buildCasinoHeist } from './fixtures/ts-tracks/casino-heist'
import { buildCpuCore } from './fixtures/ts-tracks/cpu-core'
import { buildGravityForge } from './fixtures/ts-tracks/gravity-forge'
import { buildMagneticStorage } from './fixtures/ts-tracks/magnetic-storage'
import { buildNeonSkyline } from './fixtures/ts-tracks/neon-skyline'
import { buildNeonStronghold } from './fixtures/ts-tracks/neon-stronghold'
import { buildNeuralNetwork } from './fixtures/ts-tracks/neural-network'
import { buildOrbitalJunkyard } from './fixtures/ts-tracks/orbital-junkyard'
import { buildPachinkoHall } from './fixtures/ts-tracks/pachinko-hall'
import { buildPolychromeVoid } from './fixtures/ts-tracks/polychrome-void'
import { buildPrismPathway } from './fixtures/ts-tracks/prism-pathway'
import { buildSynthwaveSurf } from './fixtures/ts-tracks/synthwave-surf'
import { buildTeslaTower } from './fixtures/ts-tracks/tesla-tower'

type TsBuilder = (api: TrackBuilderApi) => void

const CASES: Array<{ id: AdventureTrackType; build: TsBuilder }> = [
  { id: AdventureTrackType.BIO_HAZARD_LAB, build: buildBioHazardLab },
  { id: AdventureTrackType.CASINO_HEIST, build: buildCasinoHeist },
  { id: AdventureTrackType.CPU_CORE, build: buildCpuCore },
  { id: AdventureTrackType.GRAVITY_FORGE, build: buildGravityForge },
  { id: AdventureTrackType.MAGNETIC_STORAGE, build: buildMagneticStorage },
  { id: AdventureTrackType.NEON_SKYLINE, build: buildNeonSkyline },
  { id: AdventureTrackType.NEON_STRONGHOLD, build: buildNeonStronghold },
  { id: AdventureTrackType.NEURAL_NETWORK, build: buildNeuralNetwork },
  { id: AdventureTrackType.ORBITAL_JUNKYARD, build: buildOrbitalJunkyard },
  { id: AdventureTrackType.PACHINKO_HALL, build: buildPachinkoHall },
  { id: AdventureTrackType.POLYCHROME_VOID, build: buildPolychromeVoid },
  { id: AdventureTrackType.PRISM_PATHWAY, build: buildPrismPathway },
  { id: AdventureTrackType.SYNTHWAVE_SURF, build: buildSynthwaveSurf },
  { id: AdventureTrackType.TESLA_TOWER, build: buildTeslaTower },
]

/** 444007 is the CASINO_HEIST golden tape's seed. */
const SEEDS = [444007, 0x12345678]

const DATA_DIR = join(import.meta.dirname, '../src/adventure/track-data')

function loadDefinition(id: string): TrackDefinition {
  const raw: unknown = JSON.parse(readFileSync(join(DATA_DIR, `${id}.json`), 'utf8'))
  const result = validateTrackDefinition(raw)
  if (!result.ok) throw new Error(`${id}: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`)
  return result.definition
}

const xyz = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z })

/** Everything a build leaves behind that physics (or the per-frame systems) can see. */
class ParityHarness extends ExportHarnessBuilder {
  runTs(build: TsBuilder, start: Vector3, info: TrackInfo | null) {
    this.resetTrackColliders()
    this.currentStartPos = start
    this.currentTrackInfo = info
    build(this.trackBuilderApi())
    return this.snapshot()
  }

  runJson(def: TrackDefinition, start: Vector3, info: TrackInfo | null) {
    this.resetTrackColliders()
    this.currentStartPos = start
    this.currentTrackInfo = info
    this.buildFromDefinition(def)
    return this.snapshot()
  }

  private snapshot() {
    const handle = (body: PhysicsBody) => body.handle
    const meshIndex = (mesh: Mesh) => this.adventureTrack.indexOf(mesh)
    return {
      descriptors: this.getColliderDescriptors(),
      unexported: this.getUnexportedColliders(),
      bodies: this.adventureBodies.map(handle),
      kinematicBindings: this.kinematicBindings.map((b) => ({ body: handle(b.body), mesh: meshIndex(b.mesh) })),
      animatedObstacles: this.animatedObstacles.map((o) => ({
        body: handle(o.body),
        mesh: meshIndex(o.mesh),
        type: o.type,
        basePos: xyz(o.basePos),
        baseRot: o.baseRot ? { x: o.baseRot.x, y: o.baseRot.y, z: o.baseRot.z, w: o.baseRot.w } : null,
        frequency: o.frequency,
        amplitude: o.amplitude,
        phase: o.phase,
        axis: o.axis ? xyz(o.axis) : null,
      })),
      conveyorZones: this.conveyorZones.map((z) => ({ sensor: handle(z.sensor), force: xyz(z.force) })),
      dampingZones: this.dampingZones.map((z) => ({ sensor: handle(z.sensor), damping: z.damping })),
      gravityWells: this.gravityWells.map((w) => ({ sensor: handle(w.sensor), center: xyz(w.center), strength: w.strength })),
      chromaGates: this.chromaGates.map((g) => ({ sensor: handle(g.sensor), colorType: g.colorType })),
      resetSensors: this.resetSensors.map(handle),
      goalSensor: this.adventureSensor ? handle(this.adventureSensor) : null,
      portal: this.portalPosition ? xyz(this.portalPosition) : null,
      meshes: this.adventureTrack.map((m) => ({ position: xyz(m.position), rotation: xyz(m.rotation) })),
    }
  }
}

describe('JSON tracks reproduce the TS builders they replaced', () => {
  for (const seed of SEEDS) {
    for (const { id, build } of CASES) {
      it(`${id} (seed ${seed})`, () => {
        const a = getManifestStartAnchor(id)
        const start = new Vector3(a.x, a.y, a.z)
        const info = TRACK_CATALOG[id] ?? null

        initSessionRng(seed)
        const expected = new ParityHarness().runTs(build, start.clone(), info)
        initSessionRng(seed)
        const actual = new ParityHarness().runJson(loadDefinition(id), start.clone(), info)

        expect(actual.descriptors.length).toBe(expected.descriptors.length)
        expect(actual.descriptors).toEqual(expected.descriptors)
        if (id === AdventureTrackType.PACHINKO_HALL) {
          // The one intended difference: the TS lane builder also listed its two conveyor
          // sensors in adventureBodies, so clearTrack() removed them twice (the second time as
          // a "lingering" body). A zone sensor now belongs to its zone list only.
          const sensors = new Set(expected.conveyorZones.map((z) => z.sensor))
          expect(sensors.size).toBe(2)
          expected.bodies = expected.bodies.filter((body) => !sensors.has(body))
        }
        expect(actual).toEqual(expected)
      })
    }
  }
})
