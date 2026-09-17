/**
 * TrackColliderEmitter.retireBody (#383 cutover): a body removed mid-track —
 * an exit portal closing — must leave the C++ export too, without shifting any
 * other descriptor's index.
 */

import { describe, expect, it, vi } from 'vitest'

import { TrackColliderEmitter } from '../src/adventure/track-collider-emitter'
import { boxDesc, cylinderDesc } from '../src/adventure/track-collider-descriptors'
import { collectUnsupported, exportAdventureCollidersToWasm } from '../src/game/physics/wasm-adventure-export'
import type { WasmSimEngine } from '../src/wasm/wasm-sim-engine'

function fakeRapier() {
  const chain = () => {
    const desc: Record<string, unknown> = {}
    for (const m of ['setTranslation', 'setRotation', 'setFriction', 'setRestitution', 'setCollisionGroups', 'setSensor', 'setActiveEvents', 'setDensity']) {
      desc[m] = () => desc
    }
    return desc
  }
  let nextHandle = 0
  const world = {
    createRigidBody: vi.fn(() => ({ handle: nextHandle++, setAngvel: vi.fn() })),
    createCollider: vi.fn(),
  }
  const rapier = {
    RigidBodyDesc: { fixed: chain, kinematicPositionBased: chain, kinematicVelocityBased: chain, dynamic: chain },
    ColliderDesc: { cuboid: chain, cylinder: chain, ball: chain, convexHull: chain },
    ActiveEvents: { COLLISION_EVENTS: 1 },
  }
  return { world, rapier }
}

function countingEngine() {
  let next = -1000
  const handle = vi.fn(() => next--)
  return {
    engine: {
      addStaticBox: handle,
      addStaticCylinder: handle,
      addSensorVolume: handle,
      setCollisionGroups: vi.fn(),
    } as unknown as WasmSimEngine,
    handle,
  }
}

describe('TrackColliderEmitter.retireBody', () => {
  it('drops a removed portal sensor from the export but keeps every index stable', () => {
    const { world, rapier } = fakeRapier()
    const emitter = new TrackColliderEmitter(world as never, rapier as never)

    const floor = emitter.emit(boxDesc({ x: 0, y: 0, z: 0 }, { x: 5, y: 0.25, z: 5 }))
    const portal = emitter.emit(cylinderDesc({ x: 0, y: 2, z: 4 }, 0.8, 1.9, { sensor: true, label: 'exitPortalSensor' }))
    const bumper = emitter.emit(boxDesc({ x: 2, y: 1, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }))

    expect(emitter.retireBody(portal.body)).toBe(true)

    const list = emitter.list()
    expect(list).toHaveLength(3)
    expect(list[1].removed).toBe(true)
    expect(emitter.bodyForDescriptor(1)).toBeNull()
    expect(emitter.bodyForDescriptor(0)).toBe(floor.body)
    expect(emitter.bodyForDescriptor(2)).toBe(bumper.body)

    const { engine, handle } = countingEngine()
    const result = exportAdventureCollidersToWasm(list, engine)
    expect(handle).toHaveBeenCalledTimes(2)
    expect([...result.handles.keys()]).toEqual([0, 2])
    expect(result.unsupported).toEqual([])
    expect(collectUnsupported(list)).toEqual([])
  })

  it('retires colliders attached to the removed body along with it', () => {
    const { world, rapier } = fakeRapier()
    const emitter = new TrackColliderEmitter(world as never, rapier as never)

    const parent = emitter.emit(boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))
    emitter.attach(parent, boxDesc({ x: 0, y: 1, z: 0 }, { x: 0.2, y: 0.2, z: 0.2 }))

    emitter.retireBody(parent.body)
    expect(emitter.list().map((d) => d.removed)).toEqual([true, true])
  })

  it('reports nothing retired for a body it never emitted', () => {
    const { world, rapier } = fakeRapier()
    const emitter = new TrackColliderEmitter(world as never, rapier as never)
    expect(emitter.retireBody({ handle: 42 } as never)).toBe(false)
  })
})
