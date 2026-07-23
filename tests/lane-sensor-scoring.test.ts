/**
 * Lane rollover sensor scoring — handle-space dispatch, registration, and debounce.
 */

import { describe, it, expect, vi } from 'vitest'

import { GamePhysicsController } from '../src/game/game-physics-controller'
import { EventBus } from '../src/game/event-bus'
import { GAME_TUNING } from '../src/config'
import type { LaneSensorDef } from '../src/objects/object-lane-sensors'
import {
  makeBallManagerStub,
  makeGameObjectsStub,
  makePhysicsHostShell,
} from './helpers/make-physics-host'

function makeBody(handle: number, pos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const velocity = { x: 0, y: 0, z: 0 }
  return {
    handle,
    translation: () => pos,
    linvel: () => velocity,
    isFixed: () => false,
    isSleeping: () => false,
  }
}

function makeCollider(colliderHandle: number, body: ReturnType<typeof makeBody>) {
  return {
    handle: colliderHandle,
    parent: () => body,
  }
}

function makeLaneSensor(bodyHandle: number): LaneSensorDef {
  return {
    id: 'launch-mid',
    kind: 'launch',
    body: makeBody(bodyHandle) as unknown as LaneSensorDef['body'],
    position: { x: 10.5, y: 0.5, z: -4 },
  }
}

function makeHost(opts: {
  laneBodyHandle: number
  ballBodyHandle: number
  laneColliderHandle: number
  ballColliderHandle: number
}) {
  const eventBus = new EventBus()

  const laneBody = makeBody(opts.laneBodyHandle, { x: 10.5, y: 0.5, z: -4 })
  const ballBody = makeBody(opts.ballBodyHandle, { x: 10.5, y: 0.5, z: -4 })

  const colliders = new Map<number, ReturnType<typeof makeCollider>>([
    [opts.laneColliderHandle, makeCollider(opts.laneColliderHandle, laneBody)],
    [opts.ballColliderHandle, makeCollider(opts.ballColliderHandle, ballBody)],
  ])

  const bodies = new Map<number, typeof laneBody>([
    [opts.laneBodyHandle, laneBody],
    [opts.ballBodyHandle, ballBody],
  ])

  const laneSensor = makeLaneSensor(opts.laneBodyHandle)

  const world = {
    getCollider: (handle: number) => colliders.get(handle) ?? null,
    getRigidBody: (handle: number) => bodies.get(handle) ?? null,
  }

  const physics = {
    step: vi.fn((_dt: number, callback: (h1: number, h2: number, started: boolean) => void) => {
      callback(opts.laneColliderHandle, opts.ballColliderHandle, true)
      return 1
    }),
    getWorld: vi.fn(() => world),
    getRapier: vi.fn(() => null),
  }

  const ballManager = makeBallManagerStub({
    getBallBodies: vi.fn(() => [ballBody]),
    getBallBody: vi.fn(() => ballBody),
  })

  const gameObjects = makeGameObjectsStub({
    getLaneSensors: vi.fn(() => [laneSensor]),
  })

  const host = makePhysicsHostShell({ physics, eventBus, ballManager, gameObjects })

  return { host, laneBody, ballBody, physics, gameObjects, eventBus }
}

describe('Lane rollover sensor scoring', () => {
  it('registers lane sensor body handles in rebuildHandleCaches', () => {
    const { host } = makeHost({
      laneBodyHandle: 200,
      ballBodyHandle: 1,
      laneColliderHandle: 300,
      ballColliderHandle: 50,
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()

    expect(controller.getLaneSensorHandleMapSize()).toBe(1)
  })

  it('awards points when collider handles differ from body handles', () => {
    const { host, physics } = makeHost({
      laneBodyHandle: 200,
      ballBodyHandle: 1,
      laneColliderHandle: 300,
      ballColliderHandle: 50,
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)

    expect(physics.step).toHaveBeenCalled()
    expect(controller.getKnownObstacleMatches()).toBe(1)
    expect(controller.getAwardScoreCalls()).toBe(1)
    expect(host.score).toBe(GAME_TUNING.scoring.laneRollover.launch)
    expect(controller.getLastLaneHit()).toBe('launch-mid')
  })

  it('does not award when event supplies body handles instead of collider handles', () => {
    const { host, physics } = makeHost({
      laneBodyHandle: 200,
      ballBodyHandle: 1,
      laneColliderHandle: 300,
      ballColliderHandle: 50,
    })

    physics.step = vi.fn((_dt: number, callback: (h1: number, h2: number, started: boolean) => void) => {
      callback(200, 1, true)
      return 1
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)

    expect(controller.getAwardScoreCalls()).toBe(0)
    expect(host.score).toBe(0)
  })

  it('debounces duplicate awards for the same ball and sensor', () => {
    const laneColliderHandle = 300
    const ballColliderHandle = 50
    const { host, physics } = makeHost({
      laneBodyHandle: 200,
      ballBodyHandle: 1,
      laneColliderHandle,
      ballColliderHandle,
    })

    physics.step = vi.fn((_dt: number, callback: (h1: number, h2: number, started: boolean) => void) => {
      callback(laneColliderHandle, ballColliderHandle, true)
      callback(laneColliderHandle, ballColliderHandle, true)
      return 2
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)

    expect(controller.getAwardScoreCalls()).toBe(1)
    expect(host.score).toBe(GAME_TUNING.scoring.laneRollover.launch)
  })

  it('clears per-ball debounce on ball:launched', () => {
    const { host, eventBus } = makeHost({
      laneBodyHandle: 200,
      ballBodyHandle: 1,
      laneColliderHandle: 300,
      ballColliderHandle: 50,
    })

    // Pair debounce uses performance.now(); advance past COLLISION_DEBOUNCE_MS (16)
    // so a post-launch re-hit is not blocked by the general collider/body pair gates.
    let now = 1_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)
    expect(controller.getAwardScoreCalls()).toBe(1)
    expect(host.score).toBe(GAME_TUNING.scoring.laneRollover.launch)

    // Without clearing laneRolloverAwardedKeys, a later hit would still be suppressed.
    // ball:launched clears that set; ScoringBridge also resets per-ball awardScoreCalls to 0.
    eventBus.emit('ball:launched')
    expect(controller.getAwardScoreCalls()).toBe(0)

    now += 20
    controller.stepPhysics(null, null)

    // Fresh per-ball counter after reset + one new award; cumulative score doubled.
    expect(controller.getAwardScoreCalls()).toBe(1)
    expect(host.score).toBe(GAME_TUNING.scoring.laneRollover.launch * 2)

    nowSpy.mockRestore()
  })

  it('emits lane:rollover on the EventBus', () => {
    const { host, eventBus } = makeHost({
      laneBodyHandle: 200,
      ballBodyHandle: 1,
      laneColliderHandle: 300,
      ballColliderHandle: 50,
    })

    const events: Array<{ laneId: string; points: number }> = []
    eventBus.on('lane:rollover', (data) => {
      events.push({ laneId: data.laneId, points: data.points })
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)

    expect(events).toEqual([
      { laneId: 'launch-mid', points: GAME_TUNING.scoring.laneRollover.launch },
    ])
  })
})
