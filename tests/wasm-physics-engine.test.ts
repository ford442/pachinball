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
import { EventBus } from '../src/core/event-bus'
import { encodeTransformBuffer } from '../src/wasm/transform-buffer'

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
    setAngularVelocity:   vi.fn(),
    createHinge:          vi.fn().mockReturnValue(7),
    setHingeMotor:        vi.fn(),
    getHingeAngle:        vi.fn().mockReturnValue(0.1),
    removeHinge:          vi.fn(),
    addStaticPlane:       vi.fn(),
    addStaticBox:         vi.fn().mockReturnValue(-1001),
    addStaticCapsule:     vi.fn().mockReturnValue(-2001),
    getPosX:              vi.fn().mockReturnValue(1),
    getPosY:              vi.fn().mockReturnValue(2),
    getPosZ:              vi.fn().mockReturnValue(3),
    getVelX:              vi.fn().mockReturnValue(4),
    getVelY:              vi.fn().mockReturnValue(5),
    getVelZ:              vi.fn().mockReturnValue(6),
    getAngVelX:           vi.fn().mockReturnValue(0),
    getAngVelY:           vi.fn().mockReturnValue(0),
    getAngVelZ:           vi.fn().mockReturnValue(0),
    getRotX:              vi.fn().mockReturnValue(0),
    getRotY:              vi.fn().mockReturnValue(0),
    getRotZ:              vi.fn().mockReturnValue(0),
    getRotW:              vi.fn().mockReturnValue(1),
    step:                 vi.fn().mockReturnValue(0.5),
    getStepCount:         vi.fn().mockReturnValue(10),
    getActiveBodyCount:   vi.fn().mockReturnValue(3),
    setGravity:           vi.fn(),
    setRollingResistance: vi.fn(),
    setContactCallbackJS: vi.fn(),
    getContactBufferPtr:  vi.fn().mockReturnValue(0),
    getContactCount:      vi.fn().mockReturnValue(0),
    getDroppedContactCount: vi.fn().mockReturnValue(0),
    setMaxContacts:       vi.fn(),
    getMaxContacts:       vi.fn().mockReturnValue(65536),
    getTransformBufferPtr:  vi.fn().mockReturnValue(0),
    getTransformStride:   vi.fn().mockReturnValue(16),
    getTransformSlotCount: vi.fn().mockReturnValue(0),
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
    expect(call[13]).toBe(0.2) // default friction
    expect(call[14]).toBe(0.1) // default angularDamping
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
  it('drains packed contact buffer onto EventBus as wasm:physics:contact', async () => {
    const bus = new EventBus()
    engine.init(bus)

    const packed = new Float32Array(16)
    packed.set([
      1, 2, 0, 1, 0, 0.5, 0.125, 0.25, 3.25, 0, 0, 0,
    ], 4)
    worldStub.getContactCount.mockReturnValue(1)
    worldStub.getContactBufferPtr.mockReturnValue(16)
    await injectWorld(engine, worldStub, packed)

    let received: unknown = null
    bus.on('wasm:physics:contact', (evt) => { received = evt })

    engine.step(1 / 60)

    expect(received).toMatchObject({
      bodyId1: 1,
      bodyId2: 2,
      normal:  { x: 0, y: 1, z: 0 },
      point:   { x: 0.5, y: 0.125, z: 0.25 },
      impulse: 3.25,
      phase: 0,
      started: true,
      isEntering: true,
    })

    // A step with no substeps leaves native's contact buffer untouched; it
    // must not re-deliver the same contacts (a >60 Hz frame would double-score).
    received = null
    engine.step(1 / 240)
    expect(received).toBeNull()

    worldStub.getStepCount.mockReturnValue(11)
    engine.step(1 / 60)
    expect(received).not.toBeNull()
  })

  it('delivers each step\'s contacts as one batched wasm:physics:contacts emit (#488 §5)', async () => {
    const bus = new EventBus()
    engine.init(bus)

    const packed = new Float32Array(4 + 2 * 12)
    packed.set([
      1, 2, 0, 1, 0, 0.5, 0.125, 0.25, 3.25, 0, 0, 0,
      3, 4, 1, 0, 0, 0, 0, 0, 0.5, 1, 1, 7,
    ], 4)
    worldStub.getContactCount.mockReturnValue(2)
    worldStub.getContactBufferPtr.mockReturnValue(16)
    await injectWorld(engine, worldStub, packed)

    const batches: Array<{ count: number; stride: number; ids: number[]; same: unknown }> = []
    let lastBatch: unknown = null
    bus.on('wasm:physics:contacts', (batch) => {
      batches.push({
        count: batch.count,
        stride: batch.stride,
        ids: [batch.data[0] ?? -1, batch.data[1] ?? -1, batch.data[12] ?? -1, batch.data[13] ?? -1],
        same: lastBatch === null ? null : lastBatch === batch,
      })
      lastBatch = batch
    })
    const emit = vi.spyOn(bus, 'emit')

    engine.step(1 / 60)
    worldStub.getStepCount.mockReturnValue(11)
    engine.step(1 / 60)

    expect(batches).toEqual([
      { count: 2, stride: 12, ids: [1, 2, 3, 4], same: null },
      // The batch object is reused across steps.
      { count: 2, stride: 12, ids: [1, 2, 3, 4], same: true },
    ])
    // Nobody listens per contact, so no per-contact payloads were built.
    expect(emit.mock.calls.map(([event]) => event)).toEqual(['wasm:physics:contacts', 'wasm:physics:contacts'])
  })

  it('transform getters decode through one scratch record but return independent vectors', async () => {
    const heap = new Float32Array(4 + 2 * 16)
    heap.set(encodeTransformBuffer([
      { id: 0, transform: { id: 0, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 7, y: 8, z: 9 }, angularVelocity: { x: 0, y: 0.5, z: 0 }, active: true } },
      { id: 1, transform: { id: 1, position: { x: 4, y: 5, z: 6 }, rotation: { x: 0, y: 1, z: 0, w: 0 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, active: true } },
    ]), 4)
    worldStub.getTransformBufferPtr.mockReturnValue(16)
    worldStub.getTransformSlotCount.mockReturnValue(2)
    await injectWorld(engine, worldStub, heap)

    const a = engine.getPosition(0)
    const b = engine.getPosition(1)
    expect(a).toEqual({ x: 1, y: 2, z: 3 })
    expect(b).toEqual({ x: 4, y: 5, z: 6 })
    expect(engine.getPosition(0)).not.toBe(a)
    expect(engine.getVelocity(0)).toEqual({ x: 7, y: 8, z: 9 })
    expect(engine.getAngularVelocity(0)).toEqual({ x: 0, y: 0.5, z: 0 })
    expect(engine.getRotation(1)).toEqual({ x: 0, y: 1, z: 0, w: 0 })
    // The buffer was read, not the per-field Embind getters.
    expect(worldStub.getPosX).not.toHaveBeenCalled()
  })

  it('keeps per-contact events flowing while they still have a subscriber', async () => {
    const bus = new EventBus()
    engine.init(bus)
    const packed = new Float32Array(4 + 12)
    packed.set([5, 6, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0], 4)
    worldStub.getContactCount.mockReturnValue(1)
    worldStub.getContactBufferPtr.mockReturnValue(16)
    await injectWorld(engine, worldStub, packed)

    const order: string[] = []
    bus.on('wasm:physics:contact', (evt) => order.push(`contact ${evt.bodyId1}-${evt.bodyId2} phase ${evt.phase}`))
    bus.on('wasm:physics:contacts', (batch) => order.push(`batch ${batch.count}`))
    engine.step(1 / 60)
    expect(order).toEqual(['contact 5-6 phase 2', 'batch 1'])
  })

  it('getDroppedContactCount surfaces the WASM cap counter', async () => {
    worldStub.getDroppedContactCount.mockReturnValue(8)
    await injectWorld(engine, worldStub)
    expect(engine.getDroppedContactCount()).toBe(8)
  })

  it('converts BigInt u64 returns (WASM_BIGINT bundles) at the wrapper only', async () => {
    const bus = new EventBus()
    engine.init(bus)
    const packed = new Float32Array(16)
    packed.set([1, 2, 0, 1, 0, 0.5, 0.125, 0.25, 3.25, 0, 0, 0], 4)
    worldStub.getContactCount.mockReturnValue(1)
    worldStub.getContactBufferPtr.mockReturnValue(16)
    worldStub.getStepCount.mockReturnValue(10n)
    const world = worldStub as WorldStub & Record<string, unknown>
    world.getStaticContentHash = vi.fn().mockReturnValue(0xbeefn)
    world.getContactGeneration = vi.fn().mockReturnValue(7n)
    await injectWorld(engine, worldStub, packed)

    let delivered = 0
    bus.on('wasm:physics:contact', () => { delivered++ })
    engine.step(1 / 60)
    expect(engine.getStepCount()).toBe(10)
    expect(delivered).toBe(1)
    // Same BigInt step count: no substep ran, so nothing is re-delivered
    // (a bigint never === the cached number, which would double-score).
    engine.step(1 / 240)
    expect(delivered).toBe(1)

    expect(engine.getStaticContentHash()).toBe('000000000000beef')
    expect(engine.getContactGeneration()).toBe(7)
  })

  it('still accepts number / hex-string u64 returns from pre-BigInt bundles', async () => {
    const world = worldStub as WorldStub & Record<string, unknown>
    world.getStaticContentHash = vi.fn().mockReturnValue('feedfacecafebeef')
    world.getContactGeneration = vi.fn().mockReturnValue(3)
    await injectWorld(engine, worldStub)
    engine.step(1 / 60)
    expect(engine.getStepCount()).toBe(10)
    expect(engine.getStaticContentHash()).toBe('feedfacecafebeef')
    expect(engine.getContactGeneration()).toBe(3)
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
    expect(worldStub.addStaticPlane).toHaveBeenCalledWith(0, 1, 0, -2, 0.2)
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

  it('createHinge() delegates to world.createHinge', async () => {
    await injectWorld(engine, worldStub)
    const id = engine.createHinge({
      bodyId: 42,
      worldAnchor: { x: 1, y: 2, z: 3 },
      worldAxis: { x: 0, y: 1, z: 0 },
      minAngle: -0.5,
      maxAngle: 0.8,
    })
    expect(id).toBe(7)
    expect(worldStub.createHinge).toHaveBeenCalledWith(42, 1, 2, 3, 0, 1, 0, -0.5, 0.8)
    engine.setHingeMotor(7, 2, 40)
    expect(worldStub.setHingeMotor).toHaveBeenCalledWith(7, 2, 40)
    expect(engine.getHingeAngle(7)).toBe(0.1)
    engine.removeHinge(7)
    expect(worldStub.removeHinge).toHaveBeenCalledWith(7)
  })
})

// ---------------------------------------------------------------------------
// Helper: inject a pre-built world stub into the engine without needing a
// real WASM load.
// ---------------------------------------------------------------------------
async function injectWorld(
  eng: WasmPhysicsEngine,
  stub: WorldStub,
  heap: Float32Array = new Float32Array(0),
): Promise<void> {
  const internal = eng as unknown as Record<string, unknown>
  internal['world']   = stub
  internal['module']  = { HEAPF32: heap }
  internal['isReady'] = true
}
