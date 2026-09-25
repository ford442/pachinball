/**
 * In-memory stand-in for the C++ engine's `WasmSimEngine` surface.
 *
 * Handle allocation follows native: dynamic bodies get monotonic public ids
 * from 0, each static family counts down from its base (box -1000, capsule
 * -2000, mover -3000, sensor -4000, cylinder -5000, sphere -8000), and
 * `clearStaticGeometry()` resets the families so a re-export hands out the
 * same ids again. Body state is stored so reads return what was written.
 *
 * Runtime body types follow native (#420, KinematicBody.cpp): a kinematic
 * body ignores impulses and does not integrate; a body target pushed with
 * `setNextKinematicTransform(id ≥ 0, …)` is committed on the next `step()`
 * with velocity = delta / dt, and a driven body with no new target rests.
 */

import { vi } from 'vitest'

import type { WasmSimEngine } from '../../src/wasm/wasm-sim-engine'

type V3 = { x: number; y: number; z: number }
type Q = { x: number; y: number; z: number; w: number }

interface FakeBody {
  position: V3
  velocity: V3
  angular: V3
  rotation: Q
  mass: number
  /** 0 Dynamic, 1 Static, 2 Kinematic (native `BodyType`). */
  type: number
  target: { position: V3; rotation: Q } | null
  driven: boolean
}

const STATIC_BASES = {
  box: -1000, capsule: -2000, mover: -3000, sensor: -4000, cylinder: -5000, sphere: -8000, cone: -9000,
}
const ZERO: V3 = { x: 0, y: 0, z: 0 }

export function makeFakeWasmEngine() {
  const bodies = new Map<number, FakeBody>()
  let nextBodyId = 0
  let stepCount = 0
  const counts = { box: 0, capsule: 0, mover: 0, sensor: 0, cylinder: 0, sphere: 0, cone: 0 }
  const nextStatic = (family: keyof typeof counts) => STATIC_BASES[family] - counts[family]++
  const body = (id: number): FakeBody | undefined => bodies.get(id)

  const engine = {
    isReady: true,
    load: vi.fn(async () => {}),
    init: vi.fn(),
    dispose: vi.fn(),
    setGravity: vi.fn(),
    setRollingResistance: vi.fn(),
    addStaticPlane: vi.fn(),
    addStaticBox: vi.fn(() => nextStatic('box')),
    addStaticCapsule: vi.fn(() => nextStatic('capsule')),
    addStaticCylinder: vi.fn(() => nextStatic('cylinder')),
    addStaticSphere: vi.fn(() => nextStatic('sphere')),
    addStaticCone: vi.fn(() => nextStatic('cone')),
    addStaticTriangleMesh: vi.fn(() => -6000),
    addKinematicMover: vi.fn(() => nextStatic('mover')),
    setNextKinematicTransform: vi.fn((id: number, position: V3, rotation: Q) => {
      const b = body(id)
      if (b) b.target = { position: { ...position }, rotation: { ...rotation } }
    }),
    addSensorVolume: vi.fn(() => nextStatic('sensor')),
    createBoxBody: vi.fn(() => nextBodyId++),
    addForceField: vi.fn(() => -7000),
    setForceFieldEnabled: vi.fn(),
    setForceFieldVector: vi.fn(),
    setCollisionGroups: vi.fn(),
    clearStaticGeometry: vi.fn(() => {
      for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0
    }),
    createBody: vi.fn((desc: { position?: V3; velocity?: V3; mass?: number; bodyType?: number } = {}) => {
      const id = nextBodyId++
      bodies.set(id, {
        position: { ...(desc.position ?? { x: 0, y: 0, z: 0 }) },
        velocity: { ...(desc.velocity ?? { x: 0, y: 0, z: 0 }) },
        angular: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        mass: desc.mass ?? 1,
        type: desc.bodyType ?? 0,
        target: null,
        driven: false,
      })
      return id
    }),
    setBodyType: vi.fn((id: number, type: number) => {
      const b = body(id)
      if (!b || b.type === type) return
      b.type = type
      if (type !== 0) {
        b.velocity = { ...ZERO }
        b.angular = { ...ZERO }
      }
    }),
    removeBody: vi.fn((id: number) => {
      bodies.delete(id)
    }),
    applyForce: vi.fn(),
    applyImpulse: vi.fn((id: number, ix: number, iy: number, iz: number) => {
      const b = body(id)
      if (!b || b.type !== 0 || b.mass <= 0) return
      b.velocity = { x: b.velocity.x + ix / b.mass, y: b.velocity.y + iy / b.mass, z: b.velocity.z + iz / b.mass }
    }),
    setVelocity: vi.fn((id: number, x: number, y: number, z: number) => {
      const b = body(id)
      if (b) b.velocity = { x, y, z }
    }),
    setAngularVelocity: vi.fn((id: number, x: number, y: number, z: number) => {
      const b = body(id)
      if (b) b.angular = { x, y, z }
    }),
    setBodyPosition: vi.fn((id: number, x: number, y: number, z: number) => {
      const b = body(id)
      if (b) b.position = { x, y, z }
    }),
    setBodyRotation: vi.fn((id: number, x: number, y: number, z: number, w: number) => {
      const b = body(id)
      if (b) b.rotation = { x, y, z, w }
    }),
    createHinge: vi.fn(() => 1),
    setHingeMotor: vi.fn(),
    getHingeAngle: vi.fn(() => 0),
    removeHinge: vi.fn(),
    getPosition: vi.fn((id: number) => ({ ...(body(id)?.position ?? { x: 0, y: 0, z: 0 }) })),
    getVelocity: vi.fn((id: number) => ({ ...(body(id)?.velocity ?? { x: 0, y: 0, z: 0 }) })),
    getAngularVelocity: vi.fn((id: number) => ({ ...(body(id)?.angular ?? { x: 0, y: 0, z: 0 }) })),
    getRotation: vi.fn((id: number) => ({ ...(body(id)?.rotation ?? { x: 0, y: 0, z: 0, w: 1 }) })),
    /**
     * Integrates dynamic positions by velocity × dt once per call (enough for
     * the tests); kinematic bodies jump to their target instead.
     */
    step: vi.fn((dt: number) => {
      stepCount++
      for (const b of bodies.values()) {
        if (b.type === 2) {
          if (b.target) {
            const p = b.target.position
            b.velocity = dt > 0
              ? { x: (p.x - b.position.x) / dt, y: (p.y - b.position.y) / dt, z: (p.z - b.position.z) / dt }
              : { ...ZERO }
            b.position = { ...p }
            b.rotation = { ...b.target.rotation }
            b.driven = true
          } else if (b.driven) {
            b.velocity = { ...ZERO }
            b.angular = { ...ZERO }
            b.driven = false
          }
          b.target = null
          continue
        }
        b.target = null
        b.driven = false
        if (b.type !== 0) continue
        b.position = {
          x: b.position.x + b.velocity.x * dt,
          y: b.position.y + b.velocity.y * dt,
          z: b.position.z + b.velocity.z * dt,
        }
      }
      return 0
    }),
    getStepCount: vi.fn(() => stepCount),
    getActiveBodyCount: vi.fn(() => bodies.size),
    hasTransformSnapshot: vi.fn(() => true),
    getLastWorkerStepMs: vi.fn(() => 0),
    /** Test-only: live C++ body ids. */
    liveBodyIds: () => [...bodies.keys()],
    /** Test-only: a body's native type (0 Dynamic, 1 Static, 2 Kinematic), or -1. */
    bodyTypeOf: (id: number) => body(id)?.type ?? -1,
  }
  return engine
}

export type FakeWasmEngine = ReturnType<typeof makeFakeWasmEngine>

export function asSimEngine(engine: FakeWasmEngine): WasmSimEngine {
  return engine as unknown as WasmSimEngine
}
