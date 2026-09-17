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
import { describe, expect, it } from 'vitest'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'

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
  addStaticTriangleMesh: '#414 — worker adventure commands',
  createBoxBody: '#414 — worker adventure commands',
  addForceField: '#414 — worker adventure commands',
  setForceFieldEnabled: '#414 — worker adventure commands',
  setForceFieldVector: '#414 — worker adventure commands',
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
