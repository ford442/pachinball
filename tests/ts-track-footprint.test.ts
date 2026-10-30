/**
 * Golden footprint of every TS track module (#489 slice A/B).
 *
 * Each `src/adventure/tracks/*` builder runs through the real TrackBuilder
 * (Babylon mocked) and must leave exactly the colliders, meshes and zone
 * lists it did when this was pinned. Typing the builder surface, or porting a
 * track to JSON, must not move any of these numbers: a drift is a geometry
 * change, not a refactor. Re-pin only for an intended layout change.
 */

import { describe, expect, it } from 'vitest'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { getAllTrackManifests, getManifestStartAnchor } from '../src/adventure/manifests'
import { TRACK_CATALOG } from '../src/adventure/adventure-track-progression'
import { TsTrackHarnessBuilder, type TrackFootprint } from './helpers/track-export-harness'

const GOLDEN: Record<string, TrackFootprint> = {
  BIO_HAZARD_LAB: {
    descriptors: 149, meshes: 132, bodies: 132, kinematicBindings: 1, animatedObstacles: 0, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: '58d7a133',
  },
  CASINO_HEIST: {
    descriptors: 26, meshes: 23, bodies: 24, kinematicBindings: 1, animatedObstacles: 3, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 1, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'f3c70c7b',
  },
  CPU_CORE: {
    descriptors: 12, meshes: 8, bodies: 7, kinematicBindings: 1, animatedObstacles: 0, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'ea1093d6',
  },
  GRAVITY_FORGE: {
    descriptors: 60, meshes: 37, bodies: 37, kinematicBindings: 1, animatedObstacles: 3, conveyorZones: 1,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: '0f6118fe',
  },
  MAGNETIC_STORAGE: {
    descriptors: 8, meshes: 4, bodies: 4, kinematicBindings: 1, animatedObstacles: 1, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'e37a743c',
  },
  NEON_SKYLINE: {
    descriptors: 71, meshes: 70, bodies: 69, kinematicBindings: 0, animatedObstacles: 0, conveyorZones: 1,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'd3477844',
  },
  NEON_STRONGHOLD: {
    descriptors: 72, meshes: 70, bodies: 69, kinematicBindings: 1, animatedObstacles: 3, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: '8026dcee',
  },
  NEURAL_NETWORK: {
    descriptors: 139, meshes: 137, bodies: 137, kinematicBindings: 0, animatedObstacles: 1, conveyorZones: 0,
    gravityWells: 0, dampingZones: 1, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'ac9f2ded',
  },
  ORBITAL_JUNKYARD: {
    descriptors: 31, meshes: 30, bodies: 30, kinematicBindings: 0, animatedObstacles: 0, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'f5d53550',
  },
  PACHINKO_HALL: {
    descriptors: 110, meshes: 107, bodies: 109, kinematicBindings: 0, animatedObstacles: 0, conveyorZones: 2,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: true, descriptorHash: '6131d1f0',
  },
  POLYCHROME_VOID: {
    descriptors: 82, meshes: 81, bodies: 78, kinematicBindings: 0, animatedObstacles: 0, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 3, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: '865df121',
  },
  PRISM_PATHWAY: {
    descriptors: 103, meshes: 103, bodies: 102, kinematicBindings: 0, animatedObstacles: 3, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: 'e23bc4d5',
  },
  SYNTHWAVE_SURF: {
    descriptors: 174, meshes: 173, bodies: 173, kinematicBindings: 0, animatedObstacles: 20, conveyorZones: 0,
    gravityWells: 0, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: '096f30a1',
  },
  TESLA_TOWER: {
    descriptors: 123, meshes: 101, bodies: 100, kinematicBindings: 3, animatedObstacles: 3, conveyorZones: 20,
    gravityWells: 2, dampingZones: 0, chromaGates: 0, resetSensors: 0, hasGoalSensor: true,
    hasPortal: false, descriptorHash: '177e8dfe',
  },
}

const tsManifests = getAllTrackManifests().filter((m) => m.buildKind === 'ts')

describe('TS track footprints', () => {
  it('covers every TS track and nothing else', () => {
    expect(tsManifests.map((m) => m.id).sort()).toEqual(Object.keys(GOLDEN).sort())
  })

  for (const manifest of tsManifests) {
    it(`${manifest.id} builds its pinned footprint`, async () => {
      if (manifest.buildKind !== 'ts') return
      const fn = await manifest.loadBuilder()
      const a = getManifestStartAnchor(manifest.id)
      const footprint = new TsTrackHarnessBuilder().buildTs(
        fn,
        new Vector3(a.x, a.y, a.z),
        TRACK_CATALOG[manifest.id] ?? null,
      )
      expect(footprint).toEqual(GOLDEN[manifest.id])
    })
  }
})
