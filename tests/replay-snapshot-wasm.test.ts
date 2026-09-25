/**
 * Replay against the real compiled bundle on the wasm-owner path (#431):
 *
 *   record N frames → the frame-0 C++ snapshot rides in the replay JSON →
 *   a FRESH replay client restores it before frame 0 → replays the input
 *   tape → score and the ball's WASM-id pose match the live run bit-for-bit.
 *
 * The live run is warmed up before recording starts (ball rolling, flippers
 * mid-swing), while the replay client starts from the table's spawn state, so
 * only a correct restore can make the two agree — the control case with the
 * snapshot stripped must diverge.
 *
 * Everything between input and score is production code: WasmTableWorld,
 * GamePhysicsController (WasmOwner flippers, collision dispatch in WASM-id
 * space, ScoringBridge), ReplayRecorder / ReplayRunner JSON round trip.
 *
 * Gated like tests/wasm-physics-parity.test.ts:
 *   npm run build:wasm
 *   RUN_WASM_PARITY=1 npx vitest run tests/replay-snapshot-wasm.test.ts
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { EventBus } from '../src/core/event-bus'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { COLLISION_GROUP_PRESETS } from '../src/game-elements/physics'
import type { BumperVisual, InputFrame } from '../src/game-elements/types'
import { ReplayRecorder, type ReplayPayload } from '../src/replay/replay-recorder'
import { ReplayRunner } from '../src/replay/replay-runner'
import { readSnapshotHeader, decodeSnapshotBase64 } from '../src/replay/replay-snapshot'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import type { WasmBody } from '../src/wasm/wasm-body'
import { WASM_SNAPSHOT_VERSION, type WasmPhysicsModule } from '../src/wasm/wasm-types'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

const bundle = resolve(__dirname, '..', process.env.WASM_MODULE_PATH ?? 'public/wasm/PhysicsModule.js')
const RUN = process.env.RUN_WASM_PARITY === '1' && existsSync(bundle)

const WARMUP_FRAMES = 48
const RECORD_FRAMES = 240

async function loadModule(): Promise<WasmPhysicsModule> {
  const { default: factory } = await import(/* @vite-ignore */ pathToFileURL(bundle).href) as {
    default: () => Promise<WasmPhysicsModule>
  }
  return factory()
}

/**
 * A small table authored the way the builders author the real one: floor,
 * walls, three bumpers, two hinged flippers and one ball — all through the
 * owner's `PhysicsWorldSink`, so ids and exports are production's.
 */
async function makeTable(module: WasmPhysicsModule, opts: { extraBumper?: boolean } = {}) {
  const engine = new WasmPhysicsEngine()
  await engine.load(undefined, module)
  const eventBus = new EventBus()
  engine.init(eventBus)
  engine.setGravity(0, -9.81, -5)
  const world = new WasmTableWorld(engine, { x: 0, y: -9.81, z: -5 })

  const fixed = (x: number, y: number, z: number) => world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(x, y, z))
  world.createCollider(api.ColliderDesc.cuboid(7, 0.5, 16), fixed(0, -1, 2))
  world.createCollider(api.ColliderDesc.cuboid(0.5, 1, 16), fixed(-7, 0.5, 2))
  world.createCollider(api.ColliderDesc.cuboid(0.5, 1, 16), fixed(7, 0.5, 2))
  world.createCollider(api.ColliderDesc.cuboid(7, 1, 0.5), fixed(0, 0.5, 14))

  const bumperSpots: Array<[number, number]> = [[-2.5, 3], [2.5, 3], [0, 6], [-1, -1.5], [1.5, -3]]
  if (opts.extraBumper) bumperSpots.push([4, 9])
  const bumpers: WasmBody[] = []
  const visuals: BumperVisual[] = []
  for (const [x, z] of bumperSpots) {
    const b = fixed(x, 0, z)
    world.createCollider(api.ColliderDesc.ball(0.6).setRestitution(1.2).setCollisionGroups(COLLISION_GROUP_PRESETS.BUMPER), b)
    bumpers.push(b)
    visuals.push({ body: b, mesh: { position: new Vector3(x, 0, z) }, hitTime: 0, sweep: 0 } as unknown as BumperVisual)
  }

  const flipper = (pivotX: number) => {
    const isRight = pivotX > 0
    const body = world.createRigidBody(
      api.RigidBodyDesc.dynamic().setTranslation(pivotX, -0.25, -7).setLinearDamping(0.5).setAngularDamping(2),
    )
    world.createCollider(api.ColliderDesc.cuboid(1.55, 0.3, 0.25).setTranslation(isRight ? -1.55 : 1.55, 0, 0), body)
    return body
  }
  const flippers = new Map([['left', { body: flipper(-3.6) }], ['right', { body: flipper(3.6) }]])

  const ball = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(-2.4, 0, 10).setLinvel(0.2, 0, -1))
  world.createCollider(api.ColliderDesc.ball(0.25), ball)

  const gameObjects = makeGameObjectsStub({
    getBumperBodies: vi.fn(() => bumpers),
    getBumperVisuals: vi.fn(() => visuals),
    getAllFlippers: vi.fn(() => flippers),
    getWasmExportBodies: vi.fn(() => world.allBodies().filter((b) => b.isValid() && !b.link)),
  })
  const ballStub: Record<string | symbol, unknown> = {
    ...makeBallManagerStub({ getBallBodies: vi.fn(() => [ball]), getBallBody: vi.fn(() => ball) }),
    collectBall: vi.fn(() => null),
  }
  const ballManager = new Proxy(ballStub, {
    get: (target, key) => (key in target ? target[key] : (target[key] = vi.fn())),
  })
  const physics = {
    step: (rawDt: number) => engine.step(rawDt),
    getWorld: () => world,
    getRapier: () => null,
    isWasmActive: () => true,
    isWasmOwnerMode: () => true,
    getWasmEngine: () => engine,
    getWasmTableWorld: () => world,
    getWasmMode: () => 'wasm-owner' as const,
    setMirrorOverheadMs: vi.fn(),
    getLastMirrorOverheadMs: () => 0,
    setWasmDebugColliders: vi.fn(),
  }
  const host = makePhysicsHostShell({ physics, eventBus, ballManager, gameObjects })
  const controller = new GamePhysicsController(host)
  controller.rebuildHandleCaches()
  return { engine, world, host, controller, ball }
}

type Table = Awaited<ReturnType<typeof makeTable>>

/** Fixed flipper tape: the input is a pure function of the frame index. */
function tapeFrame(frame: number): InputFrame {
  const left = frame % 50 >= 10 && frame % 50 < 22
  const right = (frame + 25) % 50 >= 10 && (frame + 25) % 50 < 22
  return { flipperLeft: left, flipperRight: right, plunger: false, nudge: null, timestamp: frame * (1000 / 60) }
}

function tapeInput(from: number) {
  let frame = from
  return { update: () => {}, processBufferedInputs: () => tapeFrame(frame++) }
}

function ballPose(t: Table) {
  const id = t.ball.wasmId!
  const p = t.engine.getPosition(id)
  const v = t.engine.getVelocity(id)
  return { id, p, v }
}

async function recordLiveRun(module: WasmPhysicsModule) {
  const live = await makeTable(module)
  // Warm-up: the ball rolls and the flippers swing. The tape ends this window
  // with both flippers released, so the owner's TS-side flipper state (hold
  // timers) is back to its spawn value — the snapshot carries the C++ half.
  const warmup = tapeInput(0)
  for (let f = 0; f < WARMUP_FRAMES; f++) live.controller.stepPhysics(warmup, null, null, null)
  expect(tapeFrame(WARMUP_FRAMES - 1)).toMatchObject({ flipperLeft: false, flipperRight: false })
  expect(live.controller.getBumperMatches()).toBe(0)
  expect(live.host.score).toBe(0)

  const recorder = new ReplayRecorder()
  recorder.start({
    version: 1,
    buildId: 'vitest',
    mapId: 'neon-helix',
    seed: 12345,
    physicsEngine: 'wasm-owner',
    renderer: 'webgl2',
    createdAt: '2026-09-25T00:00:00.000Z',
  })
  const input = tapeInput(WARMUP_FRAMES)
  for (let f = 0; f < RECORD_FRAMES; f++) live.controller.stepPhysics(input, null, null, recorder)
  const payload = recorder.stop(live.host.score)!
  return { live, payload }
}

async function replay(module: WasmPhysicsModule, payload: ReplayPayload, opts: { extraBumper?: boolean } = {}) {
  const client = await makeTable(module, opts)
  const runner = new ReplayRunner()
  runner.load(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload)))
  for (let f = 0; f < payload.frames.length; f++) client.controller.stepPhysics(null, null, runner, null)
  return client
}

describe.skipIf(!RUN)('replay from a C++ snapshot on the compiled bundle (#431)', () => {
  it('restores frame 0 in a fresh client and replays score + ball pose bit-for-bit', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module)

    // The recording is non-trivial and carries its world.
    expect(payload.frames).toHaveLength(RECORD_FRAMES)
    expect(live.host.score).toBeGreaterThan(0)
    expect(live.controller.getBumperMatches()).toBeGreaterThan(1)
    expect(payload.snapshotVersion).toBe(WASM_SNAPSHOT_VERSION)
    expect(payload.staticHash).toBe(live.engine.getStaticContentHash())
    expect(payload.feederTunablesHash).toMatch(/^[0-9a-f]{8}$/)
    const header = readSnapshotHeader(decodeSnapshotBase64(payload.initialSnapshot!)!)!
    expect(header.staticHash).toBe(payload.staticHash)
    expect(header.bodyIds).toContain(live.ball.wasmId)

    const client = await replay(module, payload)
    expect(client.controller.getLastReplaySnapshotResult()).toMatchObject({ outcome: 'restored', message: null })
    expect(client.host.score).toBe(live.host.score)
    expect(client.controller.getBumperMatches()).toBe(live.controller.getBumperMatches())
    const a = ballPose(live)
    const b = ballPose(client)
    expect(b.id).toBe(a.id)
    // Bit-for-bit, not toBeCloseTo: same bundle, same inputs, same restored state.
    expect(b.p).toEqual(a.p)
    expect(b.v).toEqual(a.v)
    expect(client.engine.getStepCount()).toBe(live.engine.getStepCount())
    expect(client.engine.serializeSnapshot()).toEqual(live.engine.serializeSnapshot())
  })

  it('without the snapshot the same tape drifts (control)', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module)
    const client = await replay(module, { ...payload, initialSnapshot: undefined })
    expect(client.controller.getLastReplaySnapshotResult()?.outcome).toBe('no-snapshot')
    expect(ballPose(client).p).not.toEqual(ballPose(live).p)
  })

  it('refuses a snapshot recorded on a different table and says so', async () => {
    const module = await loadModule()
    const { payload } = await recordLiveRun(module)
    const client = await replay(module, payload, { extraBumper: true })
    const res = client.controller.getLastReplaySnapshotResult()
    expect(res?.outcome).toBe('table-mismatch')
    expect(res?.message).toMatch(/table differs/)
    // The world was left alone: the client's own ball never teleported to the recording's pose.
    expect(client.engine.getStepCount()).toBe(RECORD_FRAMES)
  })
})
