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
