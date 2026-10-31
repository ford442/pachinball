/**
 * Build a JSON track through the real `TrackBuilder.buildFromDefinition`
 * path and report what the C++ exporter could not place (#417 Slice 1).
 *
 * Babylon resolves to `tests/mocks/babylon-core.ts` (vitest alias), and the
 * Rapier world here only records nothing — the emitter still produces the
 * exact descriptor list production hands to `wasm-adventure-export.ts`.
 * Poses are meaningless under the mock quaternion; kinds, motions and sensor
 * flags are what the export contract is about, and those are real.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { TrackBuilder } from '../../src/adventure/track-builder'
import type { AdventureColliderDesc } from '../../src/adventure/track-collider-descriptors'
import type { TrackDefinition } from '../../src/adventure/track-schema'
import type { TrackInfo } from '../../src/adventure/adventure-track-progression'
import type { TrackBuilderFn } from '../../src/adventure/manifests/track-manifest-types'
import { collectUnsupported } from '../../src/game/physics/wasm-adventure-export'

/** Any chain of `desc.setX(...).setY(...)` calls on a Rapier descriptor. */
function chainable(): unknown {
  const target: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(target, {
    get: (_t, key) => (key === 'then' ? undefined : () => proxy),
  })
  return proxy
}

function fakeRapier(): typeof RAPIER {
  const factory = new Proxy({}, { get: () => () => chainable() })
  return {
    RigidBodyDesc: factory,
    ColliderDesc: factory,
    ActiveEvents: { COLLISION_EVENTS: 1 },
  } as unknown as typeof RAPIER
}

function fakeWorld(): RAPIER.World {
  let nextHandle = 0
  return {
    gravity: { x: 0, y: -9.81, z: 0 },
    createRigidBody: () => ({ handle: nextHandle++, setAngvel: () => {} }),
    createCollider: () => ({}),
  } as unknown as RAPIER.World
}

/** Concrete harness — TrackBuilder is abstract only to force a subclass. */
export class ExportHarnessBuilder extends TrackBuilder {
  constructor() {
    super({} as Scene, fakeWorld(), fakeRapier())
  }

  build(def: TrackDefinition, start = new Vector3(0, 0, 0)): readonly AdventureColliderDesc[] {
    this.resetTrackColliders()
    this.currentStartPos = start
    this.buildFromDefinition(def)
    return this.getColliderDescriptors()
  }
}

export interface TrackExportReport {
  descriptorCount: number
  /** One line per collider the C++ engine could not place. */
  problems: string[]
}

/** Every reason `builder`'s current track would not run fully on wasm-owner. */
export function exportReportFor(builder: TrackBuilder): TrackExportReport {
  const descriptors = builder.getColliderDescriptors()
  const problems = [
    ...collectUnsupported(descriptors).map(
      (u) => `descriptor #${u.index}${u.label ? ` (${u.label})` : ''}: ${u.reason}`,
    ),
    ...builder.getUnexportedColliders().map((reason) => `unexported Rapier collider: ${reason}`),
  ]
  return { descriptorCount: descriptors.length, problems }
}

/** What a TS track builder left behind, in a form stable enough to pin. */
export interface TrackFootprint {
  descriptors: number
  meshes: number
  bodies: number
  kinematicBindings: number
  animatedObstacles: number
  conveyorZones: number
  gravityWells: number
  dampingZones: number
  chromaGates: number
  resetSensors: number
  hasGoalSensor: boolean
  hasPortal: boolean
  /** FNV-1a over the descriptor list (positions rounded to 1e-4). */
  descriptorHash: string
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function roundedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v,
  )
}

/** Concrete harness for the TS track modules (`src/adventure/tracks/*`). */
export class TsTrackHarnessBuilder extends ExportHarnessBuilder {
  /** Build one TS track module the way `AdventureMode.buildTrack` does. */
  buildTs(fn: TrackBuilderFn, start: Vector3, info: TrackInfo | null): TrackFootprint {
    this.resetTrackColliders()
    this.currentStartPos = start
    this.currentTrackInfo = info
    fn(this.trackBuilderApi())
    return {
      descriptors: this.getColliderDescriptors().length,
      meshes: this.adventureTrack.length,
      bodies: this.adventureBodies.length,
      kinematicBindings: this.kinematicBindings.length,
      animatedObstacles: this.animatedObstacles.length,
      conveyorZones: this.conveyorZones.length,
      gravityWells: this.gravityWells.length,
      dampingZones: this.dampingZones.length,
      chromaGates: this.chromaGates.length,
      resetSensors: this.resetSensors.length,
      hasGoalSensor: this.adventureSensor !== null,
      hasPortal: this.portalPosition !== null,
      descriptorHash: fnv1a(roundedJson(this.getColliderDescriptors())),
    }
  }
}
