/**
 * Parity harness for the WASM physics slice.
 *
 * The harness verifies two things:
 *  1. The controller's WASM mirror keeps Rapier ball poses in sync with the WASM
 *     backend (deterministic unit layer, always runs).
 *  2. When `RUN_WASM_PARITY=1` is set and a compiled bundle exists, a real Rapier
 *     world and the real WASM engine are stepped side-by-side for the canonical
 *     "ball dropped on a bumper" scenario and divergence is quantified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Vector3 } from '@babylonjs/core'

import { GamePhysicsController } from '../src/game/game-physics-controller'
import { EventBus } from '../src/game/event-bus'
import type { BumperVisual } from '../src/game-elements/types'
import type { WasmContactEvent } from '../src/wasm/wasm-types'
import {
  makeBallManagerStub,
  makeGameObjectsStub,
  makePhysicsHostShell,
} from './helpers/make-physics-host'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeVector3(x = 0, y = 0, z = 0) {
  return new Vector3(x, y, z)
}

function makeBody(handle: number, opts: { fixed?: boolean; pos?: { x: number; y: number; z: number } } = {}) {
  const pos = opts.pos ?? { x: 0, y: 0.5, z: 0 }
  const translation = () => ({ ...pos })
  const linvel = () => ({ x: 0, y: 0, z: 0 })
  const angvel = () => ({ x: 0, y: 0, z: 0 })
  const setTranslation = vi.fn((v: { x: number; y: number; z: number }, _wake = true) => {
    pos.x = v.x; pos.y = v.y; pos.z = v.z
  })
  const setLinvel = vi.fn((v: { x: number; y: number; z: number }, _wake = true) => {
    // no-op for the stub; real Rapier would mutate velocity
  })
  const setAngvel = vi.fn((_v: { x: number; y: number; z: number }, _wake = true) => {
    // no-op for the stub
  })
  return {
    handle,
    translation,
    linvel,
    angvel,
    setTranslation,
    setLinvel,
    setAngvel,
    isFixed: () => opts.fixed ?? false,
    isSleeping: () => false,
  }
}

type BodyStub = ReturnType<typeof makeBody>

function makeWasmEngineStub() {
  let bus: EventBus | null = null
  let nextId = 0
  const bodies = new Map<number, { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number }; bodyType?: number }>()

  const stub = {
    isReady: true,
    addStaticPlane: vi.fn(),
    addStaticBox: vi.fn().mockReturnValue(-1001),
    addStaticCapsule: vi.fn().mockReturnValue(-2001),
    createBody: vi.fn((desc = {}) => {
      const id = nextId++
      bodies.set(id, {
        position: { ...(desc.position ?? { x: 0, y: 0, z: 0 }) },
        velocity: { ...(desc.velocity ?? { x: 0, y: 0, z: 0 }) },
        bodyType: desc.bodyType,
      })
      return id
    }),
    removeBody: vi.fn(),
    setBodyPosition: vi.fn((id: number, x: number, y: number, z: number) => {
      const b = bodies.get(id)
      if (b) b.position = { x, y, z }
    }),
    setBodyRotation: vi.fn(),
    setVelocity: vi.fn((id: number, x: number, y: number, z: number) => {
      const b = bodies.get(id)
      if (b) b.velocity = { x, y, z }
    }),
    getPosition: vi.fn((id: number) => bodies.get(id)?.position ?? { x: 0, y: 0, z: 0 }),
    getVelocity: vi.fn((id: number) => bodies.get(id)?.velocity ?? { x: 0, y: 0, z: 0 }),
    init: vi.fn((b: EventBus) => { bus = b }),
    step: vi.fn((_dt: number) => {
      // Deterministic one-frame drop: integrate gravity for dynamic bodies
      for (const b of bodies.values()) {
        if (b.bodyType === 0) {
          b.velocity.y += -9.81 * (1 / 60)
          b.position.y += b.velocity.y * (1 / 60)
        }
      }
      return 0
    }),
    getStepCount: vi.fn(() => 0),
    dispose: vi.fn(),
    emitContact: (id1: number, id2: number) => {
      const evt: WasmContactEvent = {
        bodyId1: id1,
        bodyId2: id2,
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 0, y: 0.5, z: 0 },
        impulse: 1,
        isEntering: true,
      }
      bus?.emit('wasm:physics:contact', evt)
    },
    _bodies: bodies,
  }

  return stub
}

type WasmEngineStub = ReturnType<typeof makeWasmEngineStub>

function makeHostForWasm(opts: { wasmEngine: WasmEngineStub; ballBody: BodyStub; bumperBody: BodyStub }) {
  const eventBus = new EventBus()

  const bumperVisual: BumperVisual = {
    body: opts.bumperBody as unknown as BumperVisual['body'],
    mesh: { position: makeVector3(0, 0.5, 0), scaling: makeVector3(1, 1, 1) } as unknown as BumperVisual['mesh'],
    hitTime: 0,
    sweep: 0,
  }

  const physics = {
    isWasmActive: vi.fn(() => true),
    isWasmOwnerMode: vi.fn(() => false),
    getWasmMode: vi.fn(() => 'wasm-mirror' as const),
    getWasmEngine: vi.fn(() => opts.wasmEngine),
    getLastMirrorOverheadMs: vi.fn(() => 0),
    setMirrorOverheadMs: vi.fn(),
    step: vi.fn((dt: number) => {
      opts.wasmEngine.step(dt)
      return 0
    }),
    getWorld: vi.fn(() => null),
    getRapier: vi.fn(() => ({
      Vector3: class {
        x: number
        y: number
        z: number
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
      },
    })),
  }

  const ballManager = makeBallManagerStub({
    getBallBodies: vi.fn(() => [opts.ballBody]),
    getBallBody: vi.fn(() => opts.ballBody),
  })

  const gameObjects = makeGameObjectsStub({
    getBumperBodies: vi.fn(() => [opts.bumperBody]),
    getBumperVisuals: vi.fn(() => [bumperVisual]),
  })

  const host = makePhysicsHostShell({
    physics,
    eventBus,
    ballManager,
    gameObjects,
    accessibility: { maxCameraShakeIntensity: 0.1 },
  })

  return { host, physics, ballManager, gameObjects, eventBus }
}

// ---------------------------------------------------------------------------
// Unit layer — deterministic mock backend, always runs
// ---------------------------------------------------------------------------

describe('WASM physics parity harness (unit layer)', () => {
  let wasmEngine: WasmEngineStub
  let ballBody: BodyStub
  let bumperBody: BodyStub
  let controller: GamePhysicsController
  let host: PhysicsHost

  beforeEach(() => {
    wasmEngine = makeWasmEngineStub()
    ballBody = makeBody(1, { pos: { x: 0, y: 2, z: 0 } })
    bumperBody = makeBody(100, { pos: { x: 0, y: 0.5, z: 0 }, fixed: true })
    const hostResult = makeHostForWasm({ wasmEngine, ballBody, bumperBody })
    host = hostResult.host
    controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
  })

  it('creates a WASM body for the ball and each bumper', () => {
    expect(wasmEngine.createBody).toHaveBeenCalledTimes(2)
    const ballCall = wasmEngine.createBody.mock.calls.find((c) => (c[0]?.bodyType ?? 0) === 0)
    const bumperCall = wasmEngine.createBody.mock.calls.find((c) => c[0]?.bodyType === 1)
    expect(ballCall).toBeDefined()
    expect(bumperCall).toBeDefined()
  })

  it('syncs Rapier ball pose into WASM before the step and back out after', () => {
    controller.stepPhysics(null, null)

    // After one deterministic integration step the stub moved the ball down.
    const wasmPos = wasmEngine.getPosition.mock.results[0]?.value ?? wasmEngine._bodies.get(0)?.position
    expect(wasmPos).toBeDefined()

    // The Rapier body should have received the WASM pose via setTranslation.
    expect(ballBody.setTranslation).toHaveBeenCalled()
    const setPos = ballBody.setTranslation.mock.calls[0][0]
    expect(setPos.y).toBeLessThan(2)
  })

  it('forwards a WASM bumper contact through the EventBus to the scoring dispatcher', () => {
    // Place the ball close enough to the bumper that the dispatcher treats it
    // as a normal bumper hit rather than a hologram catch.
    ballBody.setTranslation({ x: 0, y: 1, z: 0 }, true)

    controller.stepPhysics(null, null)

    const ballResult = wasmEngine.createBody.mock.results.find(
      (_r, i) => wasmEngine.createBody.mock.calls[i][0]?.bodyType === 0
    )
    const bumperResult = wasmEngine.createBody.mock.results.find(
      (_r, i) => wasmEngine.createBody.mock.calls[i][0]?.bodyType === 1
    )
    const ballId = ballResult?.value as number
    const bumperId = bumperResult?.value as number

    wasmEngine.emitContact(ballId, bumperId)

    expect(host.gameObjects.activateBumperHit).toHaveBeenCalled()
    expect(controller.getBumperMatches()).toBe(1)
    expect(controller.getAwardScoreCalls()).toBe(1)
    expect(host.score).toBeGreaterThan(0)
  })

  it('stays within deterministic sync divergence of zero', () => {
    // Step 60 times; the deterministic stub should always produce the same
    // trajectory, so the Rapier body pose written back should exactly match
    // the WASM pose read (no injected noise in the mock).
    const steps = 60
    for (let i = 0; i < steps; i++) {
      controller.stepPhysics(null, null)
    }

    const wasmPos = wasmEngine.getPosition.mock.results[wasmEngine.getPosition.mock.results.length - 1]?.value
    const rapierPos = ballBody.translation()

    const divergence = Math.sqrt(
      (wasmPos.x - rapierPos.x) ** 2 +
      (wasmPos.y - rapierPos.y) ** 2 +
      (wasmPos.z - rapierPos.z) ** 2
    )

    // Epsilon documents the sync layer precision (1 µm). The mock has no
    // integration drift, so divergence should be exactly zero.
    expect(divergence).toBeLessThanOrEqual(1e-6)
  })
})

// ---------------------------------------------------------------------------
// Integration layer — real Rapier vs real WASM, env-guarded
// ---------------------------------------------------------------------------

const RUN_WASM_PARITY = process.env.RUN_WASM_PARITY === '1'

describe.skipIf(!RUN_WASM_PARITY)('WASM physics parity harness (real-engine integration)', () => {
  it('keeps all Rapier vs WASM scenarios within documented epsilon', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const execFileAsync = promisify(execFile)

    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/run-wasm-parity.mjs')
    const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
      env: { ...process.env },
    })
    if (stderr) console.warn(stderr)
    expect(stdout).toContain('PASS native physics_world_test')
    expect(stdout).toContain('PASS wasm ball-on-box')
    expect(stdout).toContain('PASS wasm ball-on-capsule')
    expect(stdout).toContain('PASS wasm ball+bumper drop')
  })
})
