/**
 * Unit coverage for the adventure → WASM geometry exporter (#383 Slice B).
 *
 * Rapier is fully mocked, per the house testing rule: no engine code is
 * imported, and the `ShapeType` values are the literal numbers the real
 * enum uses (Ball 0, Cuboid 1, Capsule 2, TriMesh 6, ConvexPolyhedron 9,
 * Cylinder 10, Cone 11).
 */

import { describe, expect, it, vi } from 'vitest'

import {
  driveAdventureMovers,
  exportAdventureBodyToWasm,
  tessellateBox,
} from '../src/game/physics/wasm-adventure-export'
import { WasmVolumeShape } from '../src/wasm/PhysicsModule'

const ORIGIN = { x: 0, y: 0, z: 0 }
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeEngine(overrides: Record<string, unknown> = {}) {
  return {
    addStaticBox: vi.fn(() => -1001),
    addStaticCapsule: vi.fn(() => -2001),
    addStaticCylinder: vi.fn(() => -5001),
    addStaticTriangleMesh: vi.fn(() => -6001),
    addSensorVolume: vi.fn(() => -4001),
    addKinematicMover: vi.fn(() => -3001),
    setNextKinematicTransform: vi.fn(),
    createBoxBody: vi.fn(() => 7),
    createBody: vi.fn(() => 8),
    setCollisionGroups: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

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

    expect(engine.addStaticBox).not.toHaveBeenCalled()
    expect(engine.addStaticTriangleMesh).toHaveBeenCalledTimes(1)
    const [vertices, indices] = engine.addStaticTriangleMesh.mock.calls[0]
    expect(vertices).toHaveLength(24) // 8 corners × 3 floats
    expect(indices).toHaveLength(36) // 12 triangles
    expect(result.debug[0]).toMatchObject({ kind: 'mesh', triangleCount: 12 })
  })

  it('exports a pin-field cylinder analytically rather than as soup', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{ shapeType: 10, radius: 0.2, halfHeight: 0.5 }])

    exportAdventureBodyToWasm(body, engine)

    expect(engine.addStaticCylinder).toHaveBeenCalledTimes(1)
    expect(engine.addStaticCylinder.mock.calls[0][1]).toBe(0.2)
    expect(engine.addStaticCylinder.mock.calls[0][2]).toBe(0.5)
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
    const shapes = engine.addSensorVolume.mock.calls.map((c: unknown[]) => c[3])
    expect(shapes).toEqual([
      WasmVolumeShape.Box,
      WasmVolumeShape.Cylinder,
      WasmVolumeShape.Sphere,
    ])
    expect(result.sensors).toHaveLength(3)
    expect(result.unsupported).toEqual([])
  })

  it('exports a rotating platform as a cylinder mover, not a box', () => {
    const engine = makeEngine()
    const body = makeBody(
      'kinematic',
      [{ shapeType: 10, radius: 3, halfHeight: 0.25 }],
      { angvel: { x: 0, y: 1.5, z: 0 } }
    )

    const result = exportAdventureBodyToWasm(body, engine)

    expect(engine.addKinematicMover).toHaveBeenCalledTimes(1)
    expect(engine.addKinematicMover.mock.calls[0][5]).toBe(WasmVolumeShape.Cylinder)
    expect(result.movers).toHaveLength(1)
    expect(result.movers[0].velocityDriven).toBe(true)
  })

  it('exports a dynamic cuboid crate as a box body', () => {
    const engine = makeEngine()
    const body = makeBody(
      'dynamic',
      [{ shapeType: 1, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }],
      { translation: { x: 1, y: 2, z: 3 } }
    )

    exportAdventureBodyToWasm(body, engine)

    expect(engine.createBoxBody).toHaveBeenCalledTimes(1)
    expect(engine.createBoxBody.mock.calls[0][0]).toMatchObject({
      position: { x: 1, y: 2, z: 3 },
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    })
  })

  it('reports unsupported geometry instead of dropping it silently', () => {
    const engine = makeEngine()
    // A cone has no WASM equivalent.
    const body = makeBody('fixed', [{ shapeType: 11 }])

    const result = exportAdventureBodyToWasm(body, engine)

    expect(result.unsupported).toHaveLength(1)
    expect(result.unsupported[0].shapeType).toBe(11)
    expect(result.handles).toEqual([])
  })

  it('reports unsupported when the engine lacks the needed shape', () => {
    const engine = makeEngine({ addStaticCylinder: undefined })
    const body = makeBody('fixed', [{ shapeType: 10, radius: 0.2, halfHeight: 0.5 }])

    const result = exportAdventureBodyToWasm(body, engine)

    expect(result.unsupported).toHaveLength(1)
    expect(result.unsupported[0].reason).toMatch(/no static cylinders/)
  })

  it('stamps the requested collision groups on every exported handle', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [
      { shapeType: 1 },
      { shapeType: 10 },
    ])

    exportAdventureBodyToWasm(body, engine, { membership: 0x0100, filter: 0x0001 })

    expect(engine.setCollisionGroups).toHaveBeenCalledTimes(2)
    for (const call of engine.setCollisionGroups.mock.calls) {
      expect(call[1]).toBe(0x0100)
      expect(call[2]).toBe(0x0001)
    }
  })

  it('converts trimesh vertices from collider-local into world space', () => {
    const engine = makeEngine()
    const body = makeBody('fixed', [{
      shapeType: 6,
      translation: { x: 10, y: 0, z: 0 },
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    }])

    exportAdventureBodyToWasm(body, engine)

    const [world] = engine.addStaticTriangleMesh.mock.calls[0]
    expect(Array.from(world as Float32Array)).toEqual([10, 0, 0, 11, 0, 0, 10, 0, 1])
  })
})

describe('tessellateBox', () => {
  it('produces outward-facing triangles for every face', () => {
    const center = { x: 0, y: 0, z: 0 }
    const half = { x: 1, y: 2, z: 3 }
    const { vertices, indices } = tessellateBox(center, half, IDENTITY)

    expect(indices).toHaveLength(36)

    // Every face normal (CCW winding) must point away from the box centre.
    for (let t = 0; t < indices.length; t += 3) {
      const p = (i: number) => ({
        x: vertices[indices[i] * 3],
        y: vertices[indices[i] * 3 + 1],
        z: vertices[indices[i] * 3 + 2],
      })
      const a = p(t), b = p(t + 1), c = p(t + 2)
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      // Centroid of the triangle, which for a box face points outward.
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
    const body = makeBody(
      'kinematic',
      [{ shapeType: 10, radius: 3, halfHeight: 0.25 }],
      { angvel: { x: 0, y: 2, z: 0 } }
    )
    const { movers } = exportAdventureBodyToWasm(body, engine)

    for (let i = 0; i < 10; i++) driveAdventureMovers(movers, engine, 1 / 60)

    expect(engine.setNextKinematicTransform).toHaveBeenCalledTimes(10)
    // Rapier never stepped, yet the mover's orientation has advanced.
    const last = engine.setNextKinematicTransform.mock.calls.at(-1)
    expect(Math.abs(last[2].y)).toBeGreaterThan(0.05)
  })

  it('follows the queued kinematic target for a pose-driven piston', () => {
    const engine = makeEngine()
    const body = makeBody(
      'kinematic',
      [{ shapeType: 1, halfExtents: { x: 1, y: 0.1, z: 1 } }],
      { nextTranslation: { x: 0, y: 4, z: 0 } }
    )
    const { movers } = exportAdventureBodyToWasm(body, engine)
    expect(movers[0].velocityDriven).toBe(false)

    driveAdventureMovers(movers, engine, 1 / 60)

    const [, position] = engine.setNextKinematicTransform.mock.calls[0]
    expect(position.y).toBeCloseTo(4, 5)
  })
})
