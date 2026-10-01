/**
 * Lock test: Embind surface → in-process engine → worker protocol.
 *
 * `physics-worker-protocol.ts` is a hand-maintained subset of `bindings.cpp`.
 * Slice B added cylinder / mesh / sensor / mover / field to C++ and
 * `PhysicsModule.ts` without updating the worker union; this test makes that
 * class of drift a red build instead of a comment. No WASM bundle required.
 *
 * Adding a mutating Embind function (say `addStaticCone`) fails here until it
 * is wrapped on `WasmPhysicsEngine`, carried by a `PhysicsWorkerCommand`,
 * handled by `applyPhysicsCommand`, and implemented on `PhysicsWorkerClient` —
 * or until it is added to one of the explicit allowlists below with a reason.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'
import {
  PIN_FIELD_ID_BASE,
  STATIC_HANDLE_CAPACITY,
  STATIC_HANDLE_OVERFLOW,
  WasmIdShadow,
  type PhysicsWorkerCommand,
  type PhysicsWorkerToWorker,
} from '../src/wasm/physics-worker-protocol'
import { applyPhysicsCommand, createWorkerRuntimeState } from '../src/wasm/physics-worker-runtime'
import { pachinkoPinFieldSpec } from '../src/objects/pachinko-pin-field'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'

const root = resolve(__dirname, '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

/** Queries, loading and wiring — never sent to the worker as commands. */
const isNonMutating = (name: string) =>
  /^(get|has|copy|is)[A-Z]/.test(name) || name === 'load' || name === 'init' || name === 'constructor'

/**
 * Mutating engine methods the worker does not carry yet. Every entry must still
 * be missing from the protocol — once a command lands, delete its entry here
 * (the "allowlist is not stale" case enforces that).
 */
const KNOWN_WORKER_GAPS: Record<string, string> = {
  setMaxContacts: 'owner/mirror tuning only; the worker keeps the C++ default',
}

/** Embind functions exposed under a different wrapper name. */
const EMBIND_ALIASES: Record<string, string> = {
  createRigidBody: 'createBody',
  createRigidBodyDesc: 'createBody',
  removeRigidBody: 'removeBody',
  addKinematicMoverShaped: 'addKinematicMover',
  addSensorVolumeShaped: 'addSensorVolume',
}

/** Embind functions deliberately not wrapped. */
const EMBIND_UNWRAPPED: Record<string, string> = {
  setContactCallbackJS: 'legacy per-contact callback; the packed contact buffer replaced it',
}

function prototypeMethods(ctor: { prototype: object }): Set<string> {
  return new Set(
    Object.getOwnPropertyNames(ctor.prototype).filter(
      (name) => typeof (ctor.prototype as Record<string, unknown>)[name] === 'function',
    ),
  )
}

function embindFunctions(): string[] {
  return [...read('native/src/bindings.cpp').matchAll(/\.function\("(\w+)"/g)].map((m) => m[1])
}

function workerCommandTypes(): Set<string> {
  const src = read('src/wasm/physics-worker-protocol.ts')
  const start = src.indexOf('export type PhysicsWorkerCommand =')
  const end = src.indexOf('export type PhysicsWorkerToWorker')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return new Set([...src.slice(start, end).matchAll(/type: '(\w+)'/g)].map((m) => m[1]))
}

function runtimeCases(): Set<string> {
  const src = read('src/wasm/physics-worker-runtime.ts')
  return new Set([...src.matchAll(/case '(\w+)':/g)].map((m) => m[1]))
}

// Public, instance-level methods only (private helpers are underscore- or
// TS-private; TS-private members still land on the prototype, so name them).
const ENGINE_PRIVATE = new Set([
  'readTransformFromBuffer',
  'refreshTransformView',
  'drainContactBuffer',
  'getHeapF32',
  '_handleContact',
])

const engineMutating = [...prototypeMethods(WasmPhysicsEngine)]
  .filter((name) => !ENGINE_PRIVATE.has(name) && !isNonMutating(name))
  .sort()

describe('WASM worker / engine / Embind API parity', () => {
  it('parses a non-trivial surface from every source', () => {
    expect(embindFunctions().length).toBeGreaterThan(30)
    expect(workerCommandTypes().size).toBeGreaterThan(20)
    expect(engineMutating.length).toBeGreaterThan(20)
  })

  it('every mutating Embind function is wrapped on WasmPhysicsEngine', () => {
    const engine = prototypeMethods(WasmPhysicsEngine)
    const unwrapped = embindFunctions()
      .filter((name) => !isNonMutating(name) && !(name in EMBIND_UNWRAPPED))
      .filter((name) => !engine.has(EMBIND_ALIASES[name] ?? name))
    expect(unwrapped).toEqual([])
  })

  it('every mutating WasmPhysicsEngine method has a worker command (or a tracked gap)', () => {
    const commands = workerCommandTypes()
    const missing = engineMutating.filter((name) => !commands.has(name) && !(name in KNOWN_WORKER_GAPS))
    expect(missing).toEqual([])
  })

  it('the known-gap allowlist is not stale', () => {
    const commands = workerCommandTypes()
    const engine = new Set(engineMutating)
    const stale = Object.keys(KNOWN_WORKER_GAPS).filter((name) => commands.has(name) || !engine.has(name))
    expect(stale).toEqual([])
  })

  it('every worker command maps to an engine method, a runtime case and a client method', () => {
    const engine = prototypeMethods(WasmPhysicsEngine)
    const client = prototypeMethods(PhysicsWorkerClient)
    const cases = runtimeCases()
    for (const type of workerCommandTypes()) {
      expect(engine.has(type), `WasmPhysicsEngine.${type}`).toBe(true)
      expect(cases.has(type), `applyPhysicsCommand case '${type}'`).toBe(true)
      expect(client.has(type), `PhysicsWorkerClient.${type}`).toBe(true)
    }
  })
})

/**
 * Pin fields (#421): a lattice crosses the worker boundary as ONE command with
 * its occupancy mask transferred — never as 130 `addStaticCylinder` commands.
 */
describe('pin field over the worker boundary', () => {
  function clientWithFakeWorker() {
    const client = new PhysicsWorkerClient({ sharedTransport: false })
    const posts: { msg: PhysicsWorkerToWorker; transfer: Transferable[] }[] = []
    const worker = { postMessage: (msg: PhysicsWorkerToWorker, transfer: Transferable[] = []) => posts.push({ msg, transfer }) }
    Object.assign(client as unknown as { worker: unknown; isReady: boolean }, { worker, isReady: true })
    return { client, posts }
  }

  it('is one addPinField command whose mask buffer is transferred', () => {
    const layout = generateTableLayout({ seed: 430, seedId: 'parity' })
    const spec = pachinkoPinFieldSpec({ x: 0, z: 6 }, 24, 22, layout.pins, layout.pinLattice)!
    const { client, posts } = clientWithFakeWorker()

    expect(client.addPinField(spec)).toBe(PIN_FIELD_ID_BASE)
    client.step(1 / 60)

    expect(posts).toHaveLength(1)
    const batch = posts[0]!.msg as Extract<PhysicsWorkerToWorker, { type: 'batch' }>
    expect(batch.commands.map((c) => c.type)).toEqual(['addPinField', 'step'])
    const cmd = batch.commands[0] as Extract<PhysicsWorkerCommand, { type: 'addPinField' }>
    // A copy, so the caller's mask survives the transfer.
    expect(cmd.desc.occupancy).not.toBe(spec.occupancy)
    expect(cmd.desc.occupancy).toEqual(spec.occupancy)
    expect(posts[0]!.transfer).toEqual([cmd.desc.occupancy!.buffer])
  })

  it('the worker runtime hands the descriptor straight to the engine', () => {
    const spec = pachinkoPinFieldSpec({ x: 0, z: 6 }, 24, 22)!
    const engine = { addPinField: vi.fn(() => PIN_FIELD_ID_BASE) }
    const id = applyPhysicsCommand(engine as never, { type: 'addPinField', desc: spec }, createWorkerRuntimeState())
    expect(id).toBe(PIN_FIELD_ID_BASE)
    expect(engine.addPinField).toHaveBeenCalledWith(spec)
  })

  it('shadows pin-field handles like native: own family, one slot per field, capacity, reset', () => {
    const ids = new WasmIdShadow()
    expect(ids.allocPinField()).toBe(PIN_FIELD_ID_BASE)
    expect(ids.allocStaticCone()).toBe(-9000)
    expect(ids.allocPinField()).toBe(PIN_FIELD_ID_BASE - 1)
    for (let i = 2; i < STATIC_HANDLE_CAPACITY; i++) ids.allocPinField()
    expect(ids.allocPinField()).toBe(STATIC_HANDLE_OVERFLOW)
    ids.resetStaticHandles()
    expect(ids.allocPinField()).toBe(PIN_FIELD_ID_BASE)
  })
})

