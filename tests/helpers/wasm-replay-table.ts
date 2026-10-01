/**
 * The small owner table the replay ↔ snapshot tests run on (#422, #441),
 * authored the way the builders author the real one, plus its input tapes.
 *
 * `engine: 'worker'` builds the same table on a `PhysicsWorkerClient` whose
 * worker is an in-process loopback: commands are structured-cloned through
 * the real `applyPhysicsCommand`, replies and step results come back through
 * `receiveWorkerMessage` synchronously (no frame of lag — what a test can pin
 * down; a real Worker adds one).
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, vi } from 'vitest'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { EventBus } from '../../src/core/event-bus'
import { GamePhysicsController } from '../../src/game/game-physics-controller'
import { COLLISION_GROUP_PRESETS } from '../../src/game-elements/physics'
import type { BumperVisual, InputFrame } from '../../src/game-elements/types'
import { ReplayRecorder, type ReplayPayload } from '../../src/replay/replay-recorder'
import { ReplayRunner } from '../../src/replay/replay-runner'
import { WasmPhysicsEngine } from '../../src/wasm/PhysicsModule'
import { PhysicsWorkerClient } from '../../src/wasm/physics-worker-client'
import {
  applyPhysicsCommand,
  createWorkerRuntimeState,
  postSnapshotReplies,
  WorkerSnapshotPublisher,
} from '../../src/wasm/physics-worker-runtime'
import { WASM_PHYSICS_API as api } from '../../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../../src/wasm/wasm-table-world'
import type { WasmBody } from '../../src/wasm/wasm-body'
import type { WasmPhysicsModule } from '../../src/wasm/wasm-types'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './make-physics-host'

const bundle = resolve(__dirname, '..', '..', process.env.WASM_MODULE_PATH ?? 'public/wasm/PhysicsModule.js')
export const RUN = process.env.RUN_WASM_PARITY === '1' && existsSync(bundle)

export const WARMUP_FRAMES = 48
export const RECORD_FRAMES = 240

export async function loadModule(): Promise<WasmPhysicsModule> {
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
export type TableOptions = {
  extraBumper?: boolean
  /** In-process owner (default) or a worker client over a loopback worker. */
  engine?: 'owner' | 'worker'
}

/** A `PhysicsWorkerClient` whose worker is `applyPhysicsCommand` on a second in-process engine. */
export async function loopbackWorkerClient(module: WasmPhysicsModule) {
  const workerEngine = new WasmPhysicsEngine()
  await workerEngine.load(undefined, module)
  const runtime = createWorkerRuntimeState()
  const client = new PhysicsWorkerClient({ sharedTransport: false })
  const deliver = (msg: Parameters<PhysicsWorkerClient['receiveWorkerMessage']>[0]) => client.receiveWorkerMessage(msg)
  const publisher = new WorkerSnapshotPublisher(deliver, false)
  client.attachLoopback((commands) => {
    let alpha = 0
    let stepped = false
    for (const cmd of structuredClone(commands)) {
      const result = applyPhysicsCommand(workerEngine, cmd, runtime)
      if (cmd.type === 'step') {
        alpha = result
        stepped = true
      }
    }
    postSnapshotReplies(runtime, deliver)
    if (stepped) publisher.publish(workerEngine, runtime, alpha, 0)
  })
  return { client, workerEngine, runtime }
}

export async function makeTable(module: WasmPhysicsModule, opts: TableOptions = {}) {
  let engine: WasmPhysicsEngine | PhysicsWorkerClient
  let workerEngine: WasmPhysicsEngine | null = null
  if (opts.engine === 'worker') {
    const loop = await loopbackWorkerClient(module)
    engine = loop.client
    workerEngine = loop.workerEngine
  } else {
    engine = new WasmPhysicsEngine()
    await engine.load(undefined, module)
  }
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
  return { engine, workerEngine, world, host, controller, ball }
}

export type Table = Awaited<ReturnType<typeof makeTable>>

/** Fixed flipper tape: the input is a pure function of the frame index. */
export function tapeFrame(frame: number): InputFrame {
  const left = frame % 50 >= 10 && frame % 50 < 22
  const right = (frame + 25) % 50 >= 10 && (frame + 25) % 50 < 22
  return { flipperLeft: left, flipperRight: right, plungerCharge: null, plunger: false, nudge: null, timestamp: frame * (1000 / 60) }
}

/** Frame the launch tape fires the plunger on, and the charge it fires with. */
export const LAUNCH_FRAME = WARMUP_FRAMES + 30
export const LAUNCH_CHARGE = 0.8

export function launchTapeFrame(frame: number): InputFrame {
  const f = tapeFrame(frame)
  return frame === LAUNCH_FRAME ? { ...f, plungerCharge: LAUNCH_CHARGE, plunger: true } : f
}

export function tapeInput(from: number, tape: (frame: number) => InputFrame = tapeFrame) {
  let frame = from
  return { update: () => {}, processBufferedInputs: () => tape(frame++) }
}

/**
 * Input actions whose launch behaves like `GameInputActions.handlePlunger`:
 * an impulse scaled by the charge it is handed, falling back to the host's
 * live charge only when none is passed.
 */
export function launchActions(t: { host: { plungerChargeLevel: number }; ball: WasmBody }) {
  return {
    handleFlipperLeft: () => {},
    handleFlipperRight: () => {},
    handlePlunger: (charge?: number | null) => {
      t.ball.applyImpulse({ x: 0.4, y: 0, z: -(0.2 + 1.6 * (charge ?? t.host.plungerChargeLevel)) }, true)
      return true
    },
  }
}

export function ballPose(t: Table) {
  const id = t.ball.wasmId!
  const p = t.engine.getPosition(id)
  const v = t.engine.getVelocity(id)
  return { id, p, v }
}

export async function recordLiveRun(module: WasmPhysicsModule, opts: { launch?: boolean } = {}) {
  const live = await makeTable(module)
  const tape = opts.launch ? launchTapeFrame : tapeFrame
  // The recorder's own charge is the one it launched with.
  live.host.plungerChargeLevel = opts.launch ? LAUNCH_CHARGE : 0
  const actions = launchActions(live)
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
  const input = tapeInput(WARMUP_FRAMES, tape)
  for (let f = 0; f < RECORD_FRAMES; f++) live.controller.stepPhysics(input, actions, null, recorder)
  const payload = recorder.stop(live.host.score)!
  return { live, payload }
}

export async function replay(module: WasmPhysicsModule, payload: ReplayPayload, opts: TableOptions = {}) {
  const client = await makeTable(module, opts)
  // The spectator's own live charge is idle — replay must not read it.
  client.host.plungerChargeLevel = 0
  const actions = launchActions(client)
  const runner = new ReplayRunner()
  runner.load(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload)))
  for (let f = 0; f < payload.frames.length; f++) client.controller.stepPhysics(null, actions, runner, null)
  return client
}
