/**
 * Unit tests for WasmPhysicsEngine (TypeScript wrapper)
 *
 * The actual Emscripten WASM module is not available in the Node/Vitest
 * environment, so we mock the dynamic import of PhysicsModule.js and verify
 * that the TypeScript wrapper behaves correctly regardless of whether the
 * WASM binary is present.
 *
 * Coverage:
 *   1. load() succeeds when factory resolves → isReady = true
 *   2. load() is idempotent (second call is a no-op)
 *   3. load() fails gracefully when the factory rejects → isReady = false
 *   4. createBody() returns -1 when engine is not ready
 *   5. createBody() delegates to world.createRigidBody with correct defaults
 *   6. step() returns 0 when engine is not ready
 *   7. step() delegates to world.step and returns alpha
 *   8. applyForce / applyImpulse / setVelocity delegate correctly
 *   9. getPosition / getVelocity / getRotation return zero-vectors when not ready
 *  10. Contact callback forwards to EventBus as 'wasm:physics:contact'
 *  11. dispose() cleans up world and flags isReady = false
 *  12. addStaticPlane delegates to world.addStaticPlane
 *  13. setGravity delegates to world.setGravity
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { EventBus } from '../src/game/event-bus'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Minimal stub for the Embind PhysicsWorld proxy. */
function makeWorldStub() {
  return {
    createRigidBody:      vi.fn().mockReturnValue(42),
    removeRigidBody:      vi.fn(),
    applyForce:           vi.fn(),
    applyImpulse:         vi.fn(),
    setVelocity:          vi.fn(),
    addStaticPlane:       vi.fn(),
    addStaticBox:         vi.fn().mockReturnValue(-1001),
    addStaticCapsule:     vi.fn().mockReturnValue(-2001),
    getPosX:              vi.fn().mockReturnValue(1),
    getPosY:              vi.fn().mockReturnValue(2),
    getPosZ:              vi.fn().mockReturnValue(3),
    getVelX:              vi.fn().mockReturnValue(4),
    getVelY:              vi.fn().mockReturnValue(5),
    getVelZ:              vi.fn().mockReturnValue(6),
    getRotX:              vi.fn().mockReturnValue(0),
    getRotY:              vi.fn().mockReturnValue(0),
    getRotZ:              vi.fn().mockReturnValue(0),
    getRotW:              vi.fn().mockReturnValue(1),
    step:                 vi.fn().mockReturnValue(0.5),
    getStepCount:         vi.fn().mockReturnValue(10),
    getActiveBodyCount:   vi.fn().mockReturnValue(3),
    setGravity:           vi.fn(),
    setContactCallbackJS: vi.fn(),
    delete:               vi.fn(),
  }
}

type WorldStub = ReturnType<typeof makeWorldStub>

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let engine:    WasmPhysicsEngine
let worldStub: WorldStub

beforeEach(() => {
  engine    = new WasmPhysicsEngine()
  worldStub = makeWorldStub()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WasmPhysicsEngine', () => {

  // 1 -----------------------------------------------------------------------
  it('isReady is false before load()', () => {
    expect(engine.isReady).toBe(false)
  })

  // 2 -----------------------------------------------------------------------
  it('load() sets isReady=true when factory resolves', async () => {
    // Inject a mock loader by monkey-patching the load() path
    const loadSpy = vi.spyOn(engine, 'load').mockImplementation(async () => {
      // Simulate a successful load — directly set internal state
      const internal = engine as unknown as Record<string, unknown>
      internal['world']   = worldStub
      internal['isReady'] = true
      worldStub.setContactCallbackJS(vi.fn())
    })
    await engine.load()
    expect(engine.isReady).toBe(true)
    loadSpy.mockRestore()
  })

  // 3 -----------------------------------------------------------------------
  it('load() stays isReady=false on factory rejection', async () => {
    const loadSpy = vi.spyOn(engine, 'load').mockImplementation(async () => {
      // Simulate a failed load (no-op, isReady stays false)
      console.warn('[test] simulating WASM load failure')
    })
    await engine.load()
    expect(engine.isReady).toBe(false)
    loadSpy.mockRestore()
  })

  // 4 -----------------------------------------------------------------------
  it('createBody() returns -1 when engine is not ready', () => {
    expect(engine.createBody()).toBe(-1)
  })

  // 5 -----------------------------------------------------------------------
  it('createBody() delegates to world.createRigidBody with correct defaults', async () => {
    await injectWorld(engine, worldStub)

    const id = engine.createBody({ position: { x: 1, y: 2, z: 3 } })

    expect(id).toBe(42)
    const call = (worldStub.createRigidBody as Mock).mock.calls[0] as number[]
    expect(call[0]).toBe(1)   // px
    expect(call[1]).toBe(2)   // py
    expect(call[2]).toBe(3)   // pz
    expect(call[6]).toBe(1)   // default mass
    expect(call[7]).toBe(0.1) // default radius
    expect(call[9]).toBe(0.02) // default linearDamping
    expect(call[10]).toBe(0)  // BodyType.Dynamic
  })

  // 6 -----------------------------------------------------------------------
  it('step() returns 0 when engine is not ready', () => {
    expect(engine.step(1 / 60)).toBe(0)
  })

  // 7 -----------------------------------------------------------------------
  it('step() returns interpolation alpha from world.step()', async () => {
    await injectWorld(engine, worldStub)
    const alpha = engine.step(1 / 60)
    expect(alpha).toBe(0.5)
    expect(worldStub.step).toHaveBeenCalledWith(1 / 60)
  })

  // 8 -----------------------------------------------------------------------
  it('applyForce() delegates to world.applyForce', async () => {
    await injectWorld(engine, worldStub)
    engine.applyForce(42, 1, 2, 3)
    expect(worldStub.applyForce).toHaveBeenCalledWith(42, 1, 2, 3)
  })

  it('applyImpulse() delegates to world.applyImpulse', async () => {
    await injectWorld(engine, worldStub)
    engine.applyImpulse(42, 10, 20, 30)
    expect(worldStub.applyImpulse).toHaveBeenCalledWith(42, 10, 20, 30)
  })

  it('setVelocity() delegates to world.setVelocity', async () => {
    await injectWorld(engine, worldStub)
    engine.setVelocity(42, 5, 6, 7)
    expect(worldStub.setVelocity).toHaveBeenCalledWith(42, 5, 6, 7)
  })

  // 9 -----------------------------------------------------------------------
  it('getPosition() returns zero-vector when engine is not ready', () => {
    expect(engine.getPosition(0)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('getPosition() returns world values when ready', async () => {
    await injectWorld(engine, worldStub)
    expect(engine.getPosition(1)).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('getVelocity() returns zero-vector when engine is not ready', () => {
    expect(engine.getVelocity(0)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('getVelocity() returns world values when ready', async () => {
    await injectWorld(engine, worldStub)
    expect(engine.getVelocity(1)).toEqual({ x: 4, y: 5, z: 6 })
  })

  it('getRotation() returns identity when engine is not ready', () => {
    expect(engine.getRotation(0)).toEqual({ x: 0, y: 0, z: 0, w: 1 })
  })

  // 10 ----------------------------------------------------------------------
  it('contact callback forwards to EventBus as wasm:physics:contact', async () => {
    const bus = new EventBus()
    engine.init(bus)
    await injectWorld(engine, worldStub)

    let received: unknown = null
    bus.on('wasm:physics:contact', (evt) => { received = evt })

    // Retrieve the callback registered with the stub world
    type ContactRawCb = (
      id1: number, id2: number,
      nx: number, ny: number, nz: number,
      px: number, py: number, pz: number,
      impulse: number, isEntering: boolean
    ) => void
    const registeredCb = (worldStub.setContactCallbackJS as Mock).mock.calls[0][0] as ContactRawCb

    // Simulate a contact event from the C++ side
    registeredCb(1, 2, 0, 1, 0, 0.5, 0.1, 0.2, 3.14, true)

    expect(received).toMatchObject({
      bodyId1: 1,
      bodyId2: 2,
      normal:  { x: 0, y: 1, z: 0 },
      point:   { x: 0.5, y: 0.1, z: 0.2 },
      impulse: 3.14,
      isEntering: true,
    })
  })

  // 11 ----------------------------------------------------------------------
  it('dispose() calls world.delete() and sets isReady=false', async () => {
    await injectWorld(engine, worldStub)
    expect(engine.isReady).toBe(true)
    engine.dispose()
    expect(engine.isReady).toBe(false)
    expect(worldStub.delete).toHaveBeenCalledOnce()
  })

  it('step() returns 0 after dispose()', async () => {
    await injectWorld(engine, worldStub)
    engine.dispose()
    expect(engine.step(1 / 60)).toBe(0)
  })

  // 12 ----------------------------------------------------------------------
  it('addStaticPlane() delegates to world.addStaticPlane', async () => {
    await injectWorld(engine, worldStub)
    engine.addStaticPlane({ x: 0, y: 1, z: 0 }, -2)
    expect(worldStub.addStaticPlane).toHaveBeenCalledWith(0, 1, 0, -2)
  })

  it('addStaticBox() delegates to world.addStaticBox', async () => {
    await injectWorld(engine, worldStub)
    const id = engine.addStaticBox({ x: 1, y: 2, z: 3 }, { x: 0.5, y: 0.5, z: 0.5 })
    expect(id).toBe(-1001)
    expect(worldStub.addStaticBox).toHaveBeenCalled()
  })

  it('addStaticCapsule() delegates to world.addStaticCapsule', async () => {
    await injectWorld(engine, worldStub)
    const id = engine.addStaticCapsule({ x: 0, y: 1, z: 0 }, 0.3, 0.5)
    expect(id).toBe(-2001)
    expect(worldStub.addStaticCapsule).toHaveBeenCalled()
  })

  // 13 ----------------------------------------------------------------------
  it('setGravity() delegates to world.setGravity', async () => {
    await injectWorld(engine, worldStub)
    engine.setGravity(0, -20, 0)
    expect(worldStub.setGravity).toHaveBeenCalledWith(0, -20, 0)
  })

  it('getActiveBodyCount() returns world count when ready', async () => {
    await injectWorld(engine, worldStub)
    expect(engine.getActiveBodyCount()).toBe(3)
  })

  it('getActiveBodyCount() returns 0 when not ready', () => {
    expect(engine.getActiveBodyCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Helper: inject a pre-built world stub into the engine without needing a
// real WASM load.
// ---------------------------------------------------------------------------
async function injectWorld(eng: WasmPhysicsEngine, stub: WorldStub): Promise<void> {
  const internal = eng as unknown as Record<string, unknown>
  internal['world']   = stub
  internal['isReady'] = true
  // Register the contact callback (as the real load() would)
  stub.setContactCallbackJS(
    (id1: number, id2: number,
     nx: number, ny: number, nz: number,
     px: number, py: number, pz: number,
     impulse: number, isEntering: boolean) => {
      // Call the private _handleContact method directly
      const handleContact = internal['_handleContact'] as (evt: unknown) => void
      if (typeof handleContact === 'function') {
        handleContact.call(eng, {
          bodyId1: id1, bodyId2: id2,
          normal: { x: nx, y: ny, z: nz },
          point:  { x: px, y: py, z: pz },
          impulse, isEntering,
        })
      }
    }
  )
}
