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

import { GamePhysicsController, type PhysicsHost } from '../src/game/game-physics-controller'
import { EventBus } from '../src/game/event-bus'
import { QualityTier } from '../src/game-elements/visual-language'
import type { BumperVisual } from '../src/game-elements/types'

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

  const ballManager = {
    getBallBodies: vi.fn(() => [ballBody]),
    getBallBody: vi.fn(() => null),
    getBindings: vi.fn(() => []),
    getBallType: vi.fn(() => 'standard'),
    getChainStats: vi.fn(() => ({ scoreMultiplier: 1 })),
    updateCaughtBalls: vi.fn(),
    updateTrailEffects: vi.fn(),
    updateGoldBallGlow: vi.fn(),
    updateStuckDetection: vi.fn(() => []),
    updateSmallGoldBallLifetimes: vi.fn(),
  }

  const gameObjects = {
    getBindings: vi.fn(() => []),
    getBumperBodies: vi.fn(() => [bumperBody]),
    getBumperVisuals: vi.fn(() => [bumperVisual]),
    getTargetBodies: vi.fn(() => []),
    getAllFlippers: vi.fn(() => new Map()),
    getDeathZoneBody: vi.fn(() => null),
    updateBumpers: vi.fn(),
    updateTargets: vi.fn(),
    activateBumperHit: vi.fn(),
  }

  const host = {
    engine: { getDeltaTime: vi.fn(() => 16.6667) },
    physics,
    stateManager: { isPlaying: vi.fn(() => true) },
    eventBus,
    ballManager,
    gameObjects,
    effects: null,
    display: null,
    ballAnimator: null,
    hapticManager: null,
    soundSystem: { playBeep: vi.fn(), playImpact: vi.fn(), playGoldBallCollect: vi.fn() },
    mapManager: null,
    uiManager: null,
    adventureState: { updateGoal: vi.fn() },
    adventureMode: null,
    adventureManager: null,
    zoneTriggerSystem: null,
    cameraController: null,
    dynamicWorld: null,
    magSpinFeeder: null,
    nanoLoomFeeder: null,
    prismCoreFeeder: null,
    gaussCannon: null,
    quantumTunnel: null,
    tableCam: null,
    accessibility: { reducedMotion: false, photosensitiveMode: false, hapticsEnabled: true },
    qualityTier: QualityTier.HIGH,
    spinnerBuilder: null,
    ballTrapBuilder: null,
    launcherBuilder: null,
    movingGateBuilder: null,
    spinnerVisuals: [],
    trapStates: [],
    launcherStates: [],
    gateStates: [],
    score: 0,
    comboCount: 0,
    comboTimer: 0,
    comboMultiplier: 1,
    lives: 3,
    tiltActive: false,
    goldBallStack: [],
    sessionGoldBalls: 0,
    powerupActive: false,
    powerupTimer: 0,
    plungerChargeLevel: 0,
    nudgeState: { tiltWarnings: 0, lastNudgeTime: 0, tiltActive: false, tiltWarningActive: false },
    isCameraFollowMode: false,
    cameraFollowTransition: 0,
    cameraFollowTransitionSpeed: 1,
    updateHUD: vi.fn(),
    resetBall: vi.fn(),
    handlePrimaryBallDrain: vi.fn(() => false),
    triggerJackpot: vi.fn(),
    tryActivateSlotMachine: vi.fn(),
    rebuildHandleCaches: vi.fn(),
    updateGoldBallDisplay: vi.fn(),
    showMessage: vi.fn(),
    setGameState: vi.fn(),
    endAdventureMode: vi.fn(),
    getBallPosition: vi.fn(() => null),
    getCameraMode: vi.fn(() => 0),
  } as unknown as PhysicsHost

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
