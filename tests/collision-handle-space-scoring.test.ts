/**
 * Regression test for issue #266: zero-score regression caused by mixing
 * Rapier collider handles and rigid-body handles in the collision dispatcher.
 *
 * The dispatcher receives collider handles from drainCollisionEvents but the
 * scoring lookup tables (bumperHandleSet, ballHandleSet, etc.) are keyed by
 * rigid-body handles. Bumpers have multiple colliders per body, so the two
 * index spaces diverge and no dispatch branch matched before the fix.
 */

import { describe, it, expect, vi } from 'vitest'
import { Vector3 } from '@babylonjs/core'

import { GamePhysicsController } from '../src/game/game-physics-controller'
import { EventBus } from '../src/game/event-bus'
import type { BumperVisual } from '../src/game-elements/types'
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

function makeHost(opts: {
  bumperBodyHandle: number
  ballBodyHandle: number
  bumperColliderHandle: number
  ballColliderHandle: number
}) {
  const eventBus = new EventBus()

  const bumperBody = makeBody(opts.bumperBodyHandle, { x: 0, y: 0.5, z: 0 })
  const ballBody = makeBody(opts.ballBodyHandle, { x: 0.5, y: 0.5, z: 0 })

  const colliders = new Map<number, ReturnType<typeof makeCollider>>([
    [opts.bumperColliderHandle, makeCollider(opts.bumperColliderHandle, bumperBody)],
    [opts.ballColliderHandle, makeCollider(opts.ballColliderHandle, ballBody)],
  ])

  const bodies = new Map<number, typeof bumperBody>([
    [opts.bumperBodyHandle, bumperBody],
    [opts.ballBodyHandle, ballBody],
  ])

  const bumperVisual: BumperVisual = {
    body: bumperBody as unknown as BumperVisual['body'],
    mesh: { position: new Vector3(0, 0.5, 0) } as unknown as BumperVisual['mesh'],
    hitTime: 0,
    sweep: 0,
  }

  const world = {
    getCollider: (handle: number) => colliders.get(handle) ?? null,
    getRigidBody: (handle: number) => bodies.get(handle) ?? null,
  }

  const physics = {
    step: vi.fn((_dt: number, callback: (h1: number, h2: number, started: boolean) => void) => {
      callback(opts.bumperColliderHandle, opts.ballColliderHandle, true)
      return 1
    }),
    getWorld: vi.fn(() => world),
    getRapier: vi.fn(() => null),
  }

  const ballManager = makeBallManagerStub({
    getBallBodies: vi.fn(() => [ballBody]),
  })

  const gameObjects = makeGameObjectsStub({
    getBumperBodies: vi.fn(() => [bumperBody]),
    getBumperVisuals: vi.fn(() => [bumperVisual]),
  })

  const host = makePhysicsHostShell({ physics, eventBus, ballManager, gameObjects })

  return { host, bumperBody, ballBody, physics, gameObjects }
}

describe('Collision handle-space scoring regression (#266)', () => {
  it('awards points when collider handles differ from body handles (multi-collider bumper)', () => {
    const { host, physics, gameObjects } = makeHost({
      bumperBodyHandle: 100,
      ballBodyHandle: 1,
      bumperColliderHandle: 200,
      ballColliderHandle: 50,
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)

    expect(physics.step).toHaveBeenCalled()
    expect(gameObjects.activateBumperHit).toHaveBeenCalled()
    expect(controller.getBumperMatches()).toBe(1)
    expect(controller.getAwardScoreCalls()).toBe(1)
    expect(controller.getKnownObstacleMatches()).toBe(1)
    expect(host.score).toBeGreaterThan(0)
  })

  it('does not award points when the event supplies body handles instead of collider handles', () => {
    const { host, physics, gameObjects } = makeHost({
      bumperBodyHandle: 100,
      ballBodyHandle: 1,
      bumperColliderHandle: 200,
      ballColliderHandle: 50,
    })

    // Override the physics step to pass body handles directly, simulating the
    // old broken assumption that drainCollisionEvents returns body handles.
    physics.step = vi.fn((_dt: number, callback: (h1: number, h2: number, started: boolean) => void) => {
      callback(100, 1, true)
      return 1
    })

    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()
    controller.stepPhysics(null, null)

    expect(gameObjects.activateBumperHit).not.toHaveBeenCalled()
    expect(controller.getBumperMatches()).toBe(0)
    expect(controller.getAwardScoreCalls()).toBe(0)
    expect(host.score).toBe(0)
  })
})
