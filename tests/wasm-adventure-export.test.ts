/**
 * Unit tests for the adventure collider descriptors and their C++ exporter
 * (#383 Slice B). No Babylon, no Rapier, no WASM — the descriptor list is
 * plain data and the exporter is a pure function over a recording engine.
 */

import { describe, it, expect } from 'vitest'

import {
  boxDesc,
  cylinderDesc,
  sphereDesc,
  descCollisionGroups,
  RAPIER_DEFAULT_FRICTION,
  RAPIER_DEFAULT_RESTITUTION,
  ADVENTURE_MEMBERSHIP,
  ADVENTURE_FILTER,
  type AdventureColliderDesc,
} from '../src/adventure/track-collider-descriptors'
import {
  exportAdventureCollidersToWasm,
  isFullyExportable,
  collectUnsupported,
} from '../src/game/physics/wasm-adventure-export'
import { ADVENTURE_GROUP, CollisionGroups, makeCollisionGroups } from '../src/game-elements/physics'
import type { WasmSimEngine } from '../src/wasm/wasm-sim-engine'

type Call = { fn: string; args: unknown[] }

/** Records every C++ call and hands back the real negative handle ranges. */
function recordingEngine() {
  const calls: Call[] = []
  let box = -1000
  let cylinder = -5000
  let sphere = -6000
  let mover = -3000
  let sensor = -4000
  const engine = {
    addStaticBox: (...args: unknown[]) => {
      calls.push({ fn: 'addStaticBox', args })
      return box--
    },
    addStaticCylinder: (...args: unknown[]) => {
      calls.push({ fn: 'addStaticCylinder', args })
      return cylinder--
    },
    addStaticSphere: (...args: unknown[]) => {
      calls.push({ fn: 'addStaticSphere', args })
      return sphere--
    },
    addKinematicMover: (...args: unknown[]) => {
      calls.push({ fn: 'addKinematicMover', args })
      return mover--
    },
    addSensorVolume: (...args: unknown[]) => {
      calls.push({ fn: 'addSensorVolume', args })
      return sensor--
    },
    setCollisionGroups: (...args: unknown[]) => {
      calls.push({ fn: 'setCollisionGroups', args })
    },
  }
  return { engine: engine as unknown as WasmSimEngine, calls }
}

const at = (calls: Call[], fn: string): Call[] => calls.filter((c) => c.fn === fn)

/** Quaternion for a rotation of `rad` about +Y. */
function yaw(rad: number) {
  return { x: 0, y: Math.sin(rad / 2), z: 0, w: Math.cos(rad / 2) }
}

describe('adventure collider descriptors', () => {
  it('defaults friction and restitution to Rapier ColliderDesc defaults', () => {
    const d = boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    expect(d.friction).toBe(RAPIER_DEFAULT_FRICTION)
    expect(d.restitution).toBe(RAPIER_DEFAULT_RESTITUTION)
    expect(d.friction).toBe(0.5)
    expect(d.restitution).toBe(0)
  })

  it('defaults the group word to the ADVENTURE preset', () => {
    const d = cylinderDesc({ x: 0, y: 0, z: 0 }, 1, 2)
    expect(d.membership).toBe(ADVENTURE_MEMBERSHIP)
    expect(d.filter).toBe(ADVENTURE_FILTER)
    expect(descCollisionGroups(d)).toBe(makeCollisionGroups(ADVENTURE_GROUP, CollisionGroups.BALL))
  })

  it('keeps a caller-supplied colour filter word (polychrome-void)', () => {
    const d = boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, {
      membership: 0x0200,
      filter: 0xffff,
    })
    expect(descCollisionGroups(d)).toBe((0x0200 << 16) | 0xffff)
  })

  it('omits optional flags it was not given', () => {
    const d = sphereDesc({ x: 0, y: 0, z: 0 }, 1)
    expect(d.sensor).toBeUndefined()
    expect(d.motion).toBeUndefined()
    expect(d.density).toBeUndefined()
  })
})

describe('exportAdventureCollidersToWasm', () => {
  it('routes each shape to its matching C++ add call', () => {
    const { engine, calls } = recordingEngine()
    const descs: AdventureColliderDesc[] = [
      boxDesc({ x: 1, y: 2, z: 3 }, { x: 0.5, y: 0.25, z: 4 }, { friction: 0.7 }),
      cylinderDesc({ x: -1, y: 0, z: 2 }, 1.5, 0.4, { restitution: 0.6 }),
      sphereDesc({ x: 0, y: 5, z: 0 }, 3),
    ]

    const result = exportAdventureCollidersToWasm(descs, engine)

    expect(result.unsupported).toEqual([])
    expect(at(calls, 'addStaticBox')).toHaveLength(1)
    expect(at(calls, 'addStaticCylinder')).toHaveLength(1)
    expect(at(calls, 'addStaticSphere')).toHaveLength(1)
    expect(result.handles.get(0)).toBe(-1000)
    expect(result.handles.get(1)).toBe(-5000)
    expect(result.handles.get(2)).toBe(-6000)
  })

  it('passes cylinder radius and halfHeight in the C++ argument order', () => {
    const { engine, calls } = recordingEngine()
    exportAdventureCollidersToWasm(
      [cylinderDesc({ x: 0, y: 0, z: 0 }, 1.5, 0.4, { restitution: 0.6, friction: 0.3 })],
      engine
    )
    // addStaticCylinder(center, radius, halfHeight, rotation, restitution, friction)
    const [center, radius, halfHeight, , restitution, friction] = at(calls, 'addStaticCylinder')[0].args
    expect(center).toEqual({ x: 0, y: 0, z: 0 })
    expect(radius).toBe(0.4)
    expect(halfHeight).toBe(1.5)
    expect(restitution).toBe(0.6)
    expect(friction).toBe(0.3)
  })

  it('sets membership/filter on every exported handle', () => {
    const { engine, calls } = recordingEngine()
    exportAdventureCollidersToWasm(
      [
        boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
        sphereDesc({ x: 0, y: 0, z: 0 }, 1, { membership: 0x0200, filter: 0xffff }),
      ],
      engine
    )
    const groups = at(calls, 'setCollisionGroups')
    expect(groups).toHaveLength(2)
    expect(groups[0].args).toEqual([-1000, ADVENTURE_GROUP, CollisionGroups.BALL])
    expect(groups[1].args).toEqual([-6000, 0x0200, 0xffff])
  })

  it('routes a box sensor to addSensorVolume and a kinematic box to addKinematicMover', () => {
    const { engine, calls } = recordingEngine()
    const result = exportAdventureCollidersToWasm(
      [
        boxDesc({ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 1 }, { sensor: true }),
        boxDesc({ x: 3, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }, { motion: 'kinematic-position' }),
      ],
      engine
    )
    expect(result.unsupported).toEqual([])
    expect(at(calls, 'addSensorVolume')).toHaveLength(1)
    expect(at(calls, 'addKinematicMover')).toHaveLength(1)
    expect(result.movers).toEqual([{ index: 1, handle: -3000 }])
  })

  it('bakes a body-local collider offset into the exported world pose', () => {
    const { engine, calls } = recordingEngine()
    // Body yawed 90° about +Y, collider 2 units out along local +X.
    exportAdventureCollidersToWasm(
      [
        boxDesc({ x: 10, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, {
          rotation: yaw(Math.PI / 2),
          localPosition: { x: 2, y: 0, z: 0 },
        }),
      ],
      engine
    )
    const [center] = at(calls, 'addStaticBox')[0].args as [{ x: number; y: number; z: number }]
    // Local +X rotated 90° about +Y lands on world -Z.
    expect(center.x).toBeCloseTo(10, 6)
    expect(center.y).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(-2, 6)
  })

  it('composes a parented collider against its fixed parent body', () => {
    const { engine, calls } = recordingEngine()
    const parent = boxDesc({ x: 0, y: 0, z: 5 }, { x: 1, y: 1, z: 1 })
    const child: AdventureColliderDesc = {
      ...boxDesc({ x: 0, y: 0, z: 3 }, { x: 0.5, y: 0.5, z: 0.5 }, { rotation: yaw(Math.PI / 2) }),
      parentIndex: 0,
    }
    exportAdventureCollidersToWasm([parent, child], engine)

    const boxes = at(calls, 'addStaticBox')
    expect(boxes).toHaveLength(2)
    const [childCenter] = boxes[1].args as [{ x: number; y: number; z: number }]
    expect(childCenter.x).toBeCloseTo(0, 6)
    expect(childCenter.z).toBeCloseTo(8, 6)
  })

  it('rejects a collider parented to a spinning platter', () => {
    const { engine } = recordingEngine()
    const platter = cylinderDesc({ x: 0, y: 0, z: 0 }, 0.25, 5, {
      motion: 'kinematic-velocity',
      angularVelocity: { x: 0, y: 1, z: 0 },
    })
    const tooth: AdventureColliderDesc = {
      ...boxDesc({ x: 4, y: 0.75, z: 0 }, { x: 0.5, y: 0.5, z: 1 }),
      parentIndex: 0,
    }
    const { unsupported } = exportAdventureCollidersToWasm([platter, tooth], engine)
    expect(unsupported.map((u) => u.index)).toEqual([0, 1])
    expect(unsupported[1].reason).toMatch(/non-fixed parent/)
  })

  it('rejects the shapes the C++ engine genuinely cannot express', () => {
    const { engine, calls } = recordingEngine()
    const descs: AdventureColliderDesc[] = [
      cylinderDesc({ x: 0, y: 0, z: 0 }, 0.5, 2, { sensor: true }),
      sphereDesc({ x: 0, y: 0, z: 0 }, 3, { sensor: true }),
      cylinderDesc({ x: 0, y: 0, z: 0 }, 1, 1, { motion: 'kinematic-position' }),
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'dynamic', density: 2 }),
      cylinderDesc({ x: 0, y: 0, z: 0 }, 0.25, 5, {
        motion: 'kinematic-velocity',
        angularVelocity: { x: 0, y: 1, z: 0 },
      }),
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, {
        motion: 'kinematic-position',
        localPosition: { x: 5, y: 0, z: 0 },
      }),
    ]

    const { unsupported, handles } = exportAdventureCollidersToWasm(descs, engine)

    expect(unsupported.map((u) => u.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(handles.size).toBe(0)
    expect(calls).toEqual([])
  })

  it('still exports the supported colliders of a partially-supported track', () => {
    const { engine, calls } = recordingEngine()
    const descs: AdventureColliderDesc[] = [
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
      boxDesc({ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'dynamic', density: 1 }),
      sphereDesc({ x: 2, y: 0, z: 0 }, 1),
    ]
    const { unsupported, handles, debug } = exportAdventureCollidersToWasm(descs, engine)
    expect(unsupported.map((u) => u.index)).toEqual([1])
    expect([...handles.keys()]).toEqual([0, 2])
    expect(debug).toHaveLength(2)
    expect(at(calls, 'addStaticBox')).toHaveLength(1)
  })

  it('reports debug geometry for every exported collider', () => {
    const { engine } = recordingEngine()
    const { debug } = exportAdventureCollidersToWasm(
      [
        boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
        cylinderDesc({ x: 0, y: 0, z: 0 }, 1, 0.5),
        sphereDesc({ x: 0, y: 0, z: 0 }, 2),
      ],
      engine
    )
    expect(debug.map((d) => d.kind)).toEqual(['box', 'capsule', 'sphere'])
  })
})

describe('isFullyExportable', () => {
  it('is true for a track of plain boxes, cylinders, spheres, sensors and movers', () => {
    expect(
      isFullyExportable([
        boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 0.25, z: 4 }, { friction: 0.5 }),
        cylinderDesc({ x: 2, y: 0, z: 0 }, 0.5, 0.2, { restitution: 0.6 }),
        sphereDesc({ x: 4, y: 0, z: 0 }, 0.5),
        boxDesc({ x: 6, y: 0, z: 0 }, { x: 2, y: 1, z: 1 }, { sensor: true, collisionEvents: true }),
        boxDesc({ x: 8, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'kinematic-position' }),
      ])
    ).toBe(true)
  })

  it('is false as soon as one collider is inexpressible', () => {
    expect(
      isFullyExportable([
        boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
        cylinderDesc({ x: 0, y: 0, z: 0 }, 0.5, 2, { sensor: true }),
      ])
    ).toBe(false)
  })

  it('is vacuously true for an empty track', () => {
    expect(isFullyExportable([])).toBe(true)
    expect(collectUnsupported([])).toEqual([])
  })

  it('agrees with a real export run', () => {
    const { engine } = recordingEngine()
    const descs = [
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
      sphereDesc({ x: 0, y: 0, z: 0 }, 1, { sensor: true }),
    ]
    expect(collectUnsupported(descs).map((u) => u.index)).toEqual(
      exportAdventureCollidersToWasm(descs, engine).unsupported.map((u) => u.index)
    )
  })
})
