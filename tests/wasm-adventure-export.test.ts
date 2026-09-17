import { describe, expect, it, vi } from 'vitest'

import {
  ADVENTURE_FILTER,
  ADVENTURE_MEMBERSHIP,
  boxDesc,
  convexMeshDesc,
  cylinderDesc,
  descCollisionGroups,
  RAPIER_DEFAULT_FRICTION,
  RAPIER_DEFAULT_RESTITUTION,
  sphereDesc,
  type AdventureColliderDesc,
} from '../src/adventure/track-collider-descriptors'
import { ADVENTURE_GROUP, CollisionGroups, makeCollisionGroups } from '../src/game-elements/physics'
import { STATIC_HANDLE_OVERFLOW } from '../src/wasm/wasm-types'
import {
  collectUnsupported,
  driveAdventureMovers,
  exportAdventureBodyToWasm,
  exportAdventureCollidersToWasm,
  isFullyExportable,
  tessellateBox,
} from '../src/game/physics/wasm-adventure-export'
import { WasmVolumeShape } from '../src/wasm/PhysicsModule'
import { triangularPrismLayout } from '../src/adventure/track-geometry'
import type { WasmSimEngine } from '../src/wasm/wasm-sim-engine'

const ORIGIN = { x: 0, y: 0, z: 0 }
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

type Call = { fn: string; args: unknown[] }

function recordingEngine() {
  const calls: Call[] = []
  let box = -1000
  let cylinder = -5000
  let sphere = -8000
  let mover = -3000
  let sensor = -4000
  let mesh = -6000
  const engine = {
    addStaticBox: (...args: unknown[]) => { calls.push({ fn: 'addStaticBox', args }); return box-- },
    addStaticCylinder: (...args: unknown[]) => { calls.push({ fn: 'addStaticCylinder', args }); return cylinder-- },
    addStaticSphere: (...args: unknown[]) => { calls.push({ fn: 'addStaticSphere', args }); return sphere-- },
    addKinematicMover: (...args: unknown[]) => { calls.push({ fn: 'addKinematicMover', args }); return mover-- },
    addSensorVolume: (...args: unknown[]) => { calls.push({ fn: 'addSensorVolume', args }); return sensor-- },
    addStaticTriangleMesh: (...args: unknown[]) => { calls.push({ fn: 'addStaticTriangleMesh', args }); return mesh-- },
    setCollisionGroups: (...args: unknown[]) => { calls.push({ fn: 'setCollisionGroups', args }) },
  }
  return { engine: engine as unknown as WasmSimEngine, calls }
}

function at(calls: Call[], fn: string): Call[] {
  return calls.filter((c) => c.fn === fn)
}

function yaw(rad: number) {
  return { x: 0, y: Math.sin(rad / 2), z: 0, w: Math.cos(rad / 2) }
}

interface ColliderSpec {
  shapeType: number
  sensor?: boolean
  translation?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number; w: number }
  halfExtents?: { x: number; y: number; z: number }
  radius?: number
  halfHeight?: number
  vertices?: Float32Array
  indices?: Uint32Array
}

function makeCollider(spec: ColliderSpec) {
  return {
    shapeType: () => spec.shapeType,
    isSensor: () => spec.sensor ?? false,
    translation: () => spec.translation ?? ORIGIN,
    rotation: () => spec.rotation ?? IDENTITY,
    halfExtents: () => spec.halfExtents ?? { x: 1, y: 1, z: 1 },
    radius: () => spec.radius ?? 0.5,
    halfHeight: () => spec.halfHeight ?? 1,
    restitution: () => 0.3,
    friction: () => 0.4,
    vertices: () => spec.vertices,
    indices: () => spec.indices,
  }
}

type BodyKind = 'fixed' | 'kinematic' | 'dynamic'

function makeBody(kind: BodyKind, colliders: ColliderSpec[], opts: {
  translation?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number; w: number }
  angvel?: { x: number; y: number; z: number }
  linvel?: { x: number; y: number; z: number }
  nextTranslation?: { x: number; y: number; z: number }
} = {}) {
  const built = colliders.map(makeCollider)
  return {
    isFixed: () => kind === 'fixed',
    isKinematic: () => kind === 'kinematic',
    numColliders: () => built.length,
    collider: (i: number) => built[i],
    translation: () => opts.translation ?? ORIGIN,
    rotation: () => opts.rotation ?? IDENTITY,
    angvel: () => opts.angvel ?? ORIGIN,
    linvel: () => opts.linvel ?? ORIGIN,
    nextTranslation: opts.nextTranslation ? () => opts.nextTranslation! : undefined,
    nextRotation: undefined,
    mass: () => 2,
  } as never
}

function makeEngine(overrides: Record<string, unknown> = {}) {
  return {
    addStaticBox: vi.fn(() => -1001),
    addStaticCapsule: vi.fn(() => -2001),
    addStaticCylinder: vi.fn(() => -5001),
    addStaticSphere: vi.fn(() => -8001),
    addStaticTriangleMesh: vi.fn(() => -6001),
    addSensorVolume: vi.fn(() => -4001),
    addKinematicMover: vi.fn(() => -3001),
    setNextKinematicTransform: vi.fn(),
    createBoxBody: vi.fn(() => 7),
    createBody: vi.fn(() => 8),
    setCollisionGroups: vi.fn(),
    ...overrides,
  } as never
}

describe('adventure collider descriptors', () => {
  it('defaults friction and restitution to Rapier ColliderDesc defaults', () => {
    const d = boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
    expect(d.friction).toBe(RAPIER_DEFAULT_FRICTION)
    expect(d.restitution).toBe(RAPIER_DEFAULT_RESTITUTION)
  })

  it('defaults the group word to the ADVENTURE preset', () => {
    const d = cylinderDesc({ x: 0, y: 0, z: 0 }, 1, 2)
    expect(d.membership).toBe(ADVENTURE_MEMBERSHIP)
    expect(d.filter).toBe(ADVENTURE_FILTER)
    expect(descCollisionGroups(d)).toBe(makeCollisionGroups(ADVENTURE_GROUP, CollisionGroups.BALL))
  })

  it('keeps a caller-supplied colour filter word', () => {
    const d = boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { membership: 0x0200, filter: 0xffff })
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
    expect(result.handles.get(2)).toBe(-8000)
  })

  it('passes cylinder radius and halfHeight in the C++ argument order', () => {
    const { engine, calls } = recordingEngine()
    exportAdventureCollidersToWasm(
      [cylinderDesc({ x: 0, y: 0, z: 0 }, 1.5, 0.4, { restitution: 0.6, friction: 0.3 })],
      engine,
    )
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
      engine,
    )
    expect(at(calls, 'setCollisionGroups')).toEqual([
      { fn: 'setCollisionGroups', args: [-1000, ADVENTURE_GROUP, CollisionGroups.BALL] },
      { fn: 'setCollisionGroups', args: [-8000, 0x0200, 0xffff] },
    ])
  })

  it('routes a box sensor to addSensorVolume and a kinematic box to addKinematicMover', () => {
    const { engine, calls } = recordingEngine()
    const result = exportAdventureCollidersToWasm(
      [
        boxDesc({ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 1 }, { sensor: true }),
        boxDesc({ x: 3, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }, { motion: 'kinematic-position' }),
      ],
      engine,
    )
    expect(result.unsupported).toEqual([])
    expect(at(calls, 'addSensorVolume')).toHaveLength(1)
    expect(at(calls, 'addKinematicMover')).toHaveLength(1)
    expect(result.movers).toEqual([{ index: 1, handle: -3000, bodyIndex: 1, local: { position: ORIGIN, rotation: IDENTITY } }])
    expect(result.kinematicBodies).toEqual([{ bodyIndex: 1, angularVelocity: null }])
  })

  it('bakes a body-local collider offset into the exported world pose', () => {
    const { engine, calls } = recordingEngine()
    exportAdventureCollidersToWasm(
      [boxDesc({ x: 10, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { rotation: yaw(Math.PI / 2), localPosition: { x: 2, y: 0, z: 0 } })],
      engine,
    )
    const [center] = at(calls, 'addStaticBox')[0].args as [{ x: number; y: number; z: number }]
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
    const [childCenter] = at(calls, 'addStaticBox')[1].args as [{ x: number; y: number; z: number }]
    expect(childCenter.x).toBeCloseTo(0, 6)
    expect(childCenter.z).toBeCloseTo(8, 6)
  })

  it('exports a spinning platter and its teeth as movers carried by the platter body', () => {
    const { engine, calls } = recordingEngine()
    const platter = cylinderDesc({ x: 0, y: 0, z: 0 }, 0.25, 5, { motion: 'kinematic-velocity', angularVelocity: { x: 0, y: 1, z: 0 } })
    const tooth: AdventureColliderDesc = {
      ...boxDesc({ x: 4, y: 0.75, z: 0 }, { x: 0.5, y: 0.5, z: 1 }),
      parentIndex: 0,
    }
    const result = exportAdventureCollidersToWasm([platter, tooth], engine)
    expect(result.unsupported).toEqual([])
    expect(result.movers.map((m) => [m.index, m.bodyIndex])).toEqual([[0, 0], [1, 0]])
    expect(result.movers[1].local.position).toEqual({ x: 4, y: 0.75, z: 0 })
    expect(result.kinematicBodies).toEqual([{ bodyIndex: 0, angularVelocity: { x: 0, y: 1, z: 0 } }])

    const shapes = at(calls, 'addKinematicMover').map((c) => c.args[5])
    expect(shapes).toEqual([WasmVolumeShape.Cylinder, WasmVolumeShape.Box])
    // Platter: (radius, halfHeight, radius), the C++ VolumeShape convention.
    expect(at(calls, 'addKinematicMover')[0].args[1]).toEqual({ x: 5, y: 0.25, z: 5 })
  })

  it('routes cylinder and sphere sensors to shaped sensor volumes', () => {
    const { engine, calls } = recordingEngine()
    const result = exportAdventureCollidersToWasm(
      [
        cylinderDesc({ x: 0, y: 0, z: 0 }, 0.5, 2, { sensor: true }),
        sphereDesc({ x: 0, y: 0, z: 0 }, 3, { sensor: true }),
      ],
      engine,
    )
    expect(result.unsupported).toEqual([])
    const sensors = at(calls, 'addSensorVolume')
    expect(sensors.map((c) => c.args[3])).toEqual([WasmVolumeShape.Cylinder, WasmVolumeShape.Sphere])
    expect(sensors[0].args[1]).toEqual({ x: 2, y: 0.5, z: 2 })
    expect(sensors[1].args[1]).toEqual({ x: 3, y: 3, z: 3 })
  })

  it('bakes a moving body\'s collider offset into the mover pose and keeps it as the local pose', () => {
    const { engine, calls } = recordingEngine()
    const result = exportAdventureCollidersToWasm(
      [boxDesc({ x: 10, y: 0, z: 0 }, { x: 2, y: 0.5, z: 0.5 }, {
        rotation: yaw(Math.PI / 2),
        motion: 'kinematic-position',
        localPosition: { x: 2, y: 0, z: 0 },
      })],
      engine,
    )
    expect(result.unsupported).toEqual([])
    const [center] = at(calls, 'addKinematicMover')[0].args as [{ x: number; y: number; z: number }]
    expect(center.x).toBeCloseTo(10, 6)
    expect(center.z).toBeCloseTo(-2, 6)
    expect(result.movers[0].local.position).toEqual({ x: 2, y: 0, z: 0 })
  })

  it('returns sensors on a moving body for analytic testing instead of creating C++ sensors', () => {
    const { engine, calls } = recordingEngine()
    const wheel = cylinderDesc({ x: 0, y: 0, z: 0 }, 0.5, 1, {
      sensor: true,
      motion: 'kinematic-velocity',
      angularVelocity: { x: 0, y: 2, z: 0 },
      localPosition: { x: 3, y: 0.5, z: 0 },
    })
    const pocket: AdventureColliderDesc = { ...cylinderDesc({ x: -3, y: 0.5, z: 0 }, 0.5, 1, { sensor: true }), parentIndex: 0 }
    const result = exportAdventureCollidersToWasm([wheel, pocket], engine)
    expect(result.unsupported).toEqual([])
    expect(at(calls, 'addSensorVolume')).toEqual([])
    expect(result.handles.size).toBe(0)
    expect(result.movingSensors.map((m) => [m.index, m.bodyIndex, m.kind])).toEqual([[0, 0, 'cylinder'], [1, 0, 'cylinder']])
    expect(result.movingSensors[1].local.position).toEqual({ x: -3, y: 0.5, z: 0 })
    expect(result.kinematicBodies).toEqual([{ bodyIndex: 0, angularVelocity: { x: 0, y: 2, z: 0 } }])
  })

  it('exports a convex mesh as a world-space, one-sided triangle mesh', () => {
    const { engine, calls } = recordingEngine()
    const prism = triangularPrismLayout(0.5, 1.5)
    const result = exportAdventureCollidersToWasm(
      [convexMeshDesc({ x: 10, y: 1, z: 0 }, prism, { rotation: yaw(Math.PI), restitution: 0.8 })],
      engine,
    )
    expect(result.unsupported).toEqual([])
    const [call] = at(calls, 'addStaticTriangleMesh')
    const [verts, indices, restitution, , doubleSided] = call.args as [Float32Array, Uint32Array, number, number, boolean]
    expect(indices).toHaveLength(24)
    expect(restitution).toBe(0.8)
    expect(doubleSided).toBe(false)
    // Vertex 0 is (0.5, -0.75, 0) locally; a half-turn yaw sends it to (-0.5, -0.75, 0).
    expect(verts[0]).toBeCloseTo(9.5, 5)
    expect(verts[1]).toBeCloseTo(0.25, 5)
    expect(verts[2]).toBeCloseTo(0, 5)
    expect(result.handles.get(0)).toBe(-6000)
  })

  it('rejects dynamic bodies and convex meshes that move or sense', () => {
    const { engine, calls } = recordingEngine()
    const prism = triangularPrismLayout(0.5, 1.5)
    const descs: AdventureColliderDesc[] = [
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'dynamic', density: 2 }),
      convexMeshDesc(ORIGIN, prism, { motion: 'kinematic-position' }),
      convexMeshDesc(ORIGIN, prism, { sensor: true }),
    ]
    const { unsupported, handles } = exportAdventureCollidersToWasm(descs, engine)
    expect(unsupported.map((u) => u.index)).toEqual([0, 1, 2])
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

  it('dry-runs exportability checks without touching an engine', () => {
    const supported = [boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })]
    const unsupported = [boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'dynamic', density: 1 })]
    expect(isFullyExportable(supported)).toBe(true)
    expect(isFullyExportable(unsupported)).toBe(false)
    expect(collectUnsupported(unsupported)).toHaveLength(1)
  })
})

describe('exportAdventureBodyToWasm', () => {
  it('exports a fixed cuboid ramp through the analytic box path by default', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 1, halfExtents: { x: 2, y: 0.25, z: 6 } }])
    const result = exportAdventureBodyToWasm(body, engine)
    expect(engine.addStaticBox).toHaveBeenCalledTimes(1)
    expect(engine.addStaticTriangleMesh).not.toHaveBeenCalled()
    expect(result.unsupported).toEqual([])
    expect(result.debug[0].kind).toBe('box')
  })

  it('tessellates cuboids into 12 triangles when asked to', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 1, halfExtents: { x: 2, y: 0.25, z: 6 } }])
    const result = exportAdventureBodyToWasm(body, engine, { tessellateCuboids: true })
    expect(engine.addStaticTriangleMesh).toHaveBeenCalledTimes(1)
    const [vertices, indices] = engine.addStaticTriangleMesh.mock.calls[0]
    expect(vertices).toHaveLength(24)
    expect(indices).toHaveLength(36)
    expect(result.debug[0]).toMatchObject({ kind: 'mesh', triangleCount: 12 })
  })

  it('exports a pin-field cylinder analytically rather than as soup', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 10, radius: 0.2, halfHeight: 0.5 }])
    exportAdventureBodyToWasm(body, engine)
    expect(engine.addStaticCylinder).toHaveBeenCalledTimes(1)
    expect(engine.addStaticTriangleMesh).not.toHaveBeenCalled()
  })

  it('maps each sensor collider shape onto the matching volume tag', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [
      { shapeType: 1, sensor: true, halfExtents: { x: 1.8, y: 0.25, z: 1.8 } },
      { shapeType: 10, sensor: true, radius: 0.5, halfHeight: 2 },
      { shapeType: 0, sensor: true, radius: 3 },
    ])
    const result = exportAdventureBodyToWasm(body, engine)
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(3)
    expect(engine.addSensorVolume.mock.calls.map((c: unknown[]) => c[3])).toEqual([
      WasmVolumeShape.Box,
      WasmVolumeShape.Cylinder,
      WasmVolumeShape.Sphere,
    ])
    expect(result.sensors).toHaveLength(3)
  })

  it('exports a rotating platform as a cylinder mover', () => {
    const engine = makeEngine()
    const body = makeBody('kinematic', [{ shapeType: 10, radius: 3, halfHeight: 0.25 }], { angvel: { x: 0, y: 1.5, z: 0 } })
    const result = exportAdventureBodyToWasm(body, engine)
    expect(engine.addKinematicMover.mock.calls[0][5]).toBe(WasmVolumeShape.Cylinder)
    expect(result.movers[0].velocityDriven).toBe(true)
  })

  it('exports a dynamic cuboid crate as a box body', () => {
    const engine = makeEngine()
    const body = makeBody('dynamic', [{ shapeType: 1, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }], { translation: { x: 1, y: 2, z: 3 } })
    exportAdventureBodyToWasm(body, engine)
    expect(engine.createBoxBody).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported geometry instead of dropping it silently', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 11 }])
    const result = exportAdventureBodyToWasm(body, engine)
    expect(result.unsupported).toHaveLength(1)
  })

  it('reports unsupported when the engine lacks the needed shape', () => {
    const engine = makeEngine({ addStaticCylinder: undefined })
    const body = makeBody('fixed', [{ shapeType: 10, radius: 0.2, halfHeight: 0.5 }])
    const result = exportAdventureBodyToWasm(body, engine)
    expect(result.unsupported[0].reason).toMatch(/no static cylinders/)
  })

  it('stamps the requested collision groups on every exported handle', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 1 }, { shapeType: 10 }])
    exportAdventureBodyToWasm(body, engine, { membership: 0x0100, filter: 0x0001 })
    for (const call of engine.setCollisionGroups.mock.calls) {
      expect(call[1]).toBe(0x0100)
      expect(call[2]).toBe(0x0001)
    }
  })

  it('converts trimesh vertices from collider-local into world space', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 6, translation: { x: 10, y: 0, z: 0 }, vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) }])
    exportAdventureBodyToWasm(body, engine)
    const [world] = engine.addStaticTriangleMesh.mock.calls[0]
    expect(Array.from(world as Float32Array)).toEqual([10, 0, 0, 11, 0, 0, 10, 0, 1])
  })
})

describe('tessellateBox', () => {
  it('produces outward-facing triangles for every face', () => {
    const { vertices, indices } = tessellateBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }, IDENTITY)
    expect(indices).toHaveLength(36)
    for (let t = 0; t < indices.length; t += 3) {
      const p = (i: number) => ({
        x: vertices[indices[i] * 3],
        y: vertices[indices[i] * 3 + 1],
        z: vertices[indices[i] * 3 + 2],
      })
      const a = p(t)
      const b = p(t + 1)
      const c = p(t + 2)
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      const cx = (a.x + b.x + c.x) / 3
      const cy = (a.y + b.y + c.y) / 3
      const cz = (a.z + b.z + c.z) / 3
      expect(nx * cx + ny * cy + nz * cz).toBeGreaterThan(0)
    }
  })
})

describe('driveAdventureMovers', () => {
  it('integrates a velocity-driven platter without Rapier stepping', () => {
    const engine = makeEngine()
    const body = makeBody('kinematic', [{ shapeType: 10, radius: 3, halfHeight: 0.25 }], { angvel: { x: 0, y: 2, z: 0 } })
    const { movers } = exportAdventureBodyToWasm(body, engine)
    for (let i = 0; i < 10; i++) driveAdventureMovers(movers, engine, 1 / 60)
    const last = engine.setNextKinematicTransform.mock.calls.at(-1)
    expect(Math.abs(last[2].y)).toBeGreaterThan(0.05)
  })

  it('follows the queued kinematic target for a pose-driven piston', () => {
    const engine = makeEngine()
    const body = makeBody('kinematic', [{ shapeType: 1, halfExtents: { x: 1, y: 0.1, z: 1 } }], { nextTranslation: { x: 0, y: 4, z: 0 } })
    const { movers } = exportAdventureBodyToWasm(body, engine)
    expect(movers[0].velocityDriven).toBe(false)
    driveAdventureMovers(movers, engine, 1 / 60)
    const [, position] = engine.setNextKinematicTransform.mock.calls[0]
    expect(position.y).toBeCloseTo(4, 5)
  })
})

describe('static handle capacity in the descriptor exporter', () => {
  it('treats STATIC_HANDLE_OVERFLOW as unsupported rather than storing it', () => {
    const calls: Call[] = []
    const engine = {
      addStaticBox: (...args: unknown[]) => { calls.push({ fn: 'addStaticBox', args }); return -1001 },
      // Native refused this one: the family is full and no collider exists.
      addStaticCylinder: (...args: unknown[]) => {
        calls.push({ fn: 'addStaticCylinder', args })
        return STATIC_HANDLE_OVERFLOW
      },
      setCollisionGroups: (...args: unknown[]) => { calls.push({ fn: 'setCollisionGroups', args }) },
    } as unknown as WasmSimEngine

    const descriptors: AdventureColliderDesc[] = [
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { label: 'floor' }),
      cylinderDesc({ x: 2, y: 0, z: 0 }, 0.5, 0.25, { label: 'post' }),
    ]

    const result = exportAdventureCollidersToWasm(descriptors, engine)

    // The box exported normally.
    expect(result.handles.get(0)).toBe(-1001)

    // The refused cylinder must leave no trace: no handle, no collision-group
    // call naming the sentinel, and no debug box for geometry that is absent.
    expect(result.handles.has(1)).toBe(false)
    expect(at(calls, 'setCollisionGroups').map((c) => c.args[0])).toEqual([-1001])
    expect(result.debug.filter((d) => d.kind === 'cylinder')).toHaveLength(0)

    // And it must be reported, so the gate cannot hand the track to C++.
    expect(result.unsupported).toHaveLength(1)
    expect(result.unsupported[0].reason).toMatch(/capacity/i)
  })
})
