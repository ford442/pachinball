import { describe, expect, it, vi } from 'vitest'
import { Quaternion, Vector3 } from '@babylonjs/core'

import { GamePhysicsController, type PhysicsHost } from '../src/game/game-physics-controller'
import { EventBus } from '../src/game/event-bus'
import { QualityTier } from '../src/game-elements/visual-language'

type BindingBody = {
  handle: number
  translation: () => { x: number; y: number; z: number }
  rotation: () => { x: number; y: number; z: number; w: number }
  isFixed: () => boolean
  isSleeping: () => boolean
}

type BindingMesh = {
  position: Vector3
  rotationQuaternion: Quaternion | null
}

function makeBody(opts?: {
  position?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number; w: number }
  sleeping?: boolean
}) {
  const state = {
    position: opts?.position ?? { x: 0, y: 0, z: 0 },
    rotation: opts?.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    sleeping: opts?.sleeping ?? false,
  }

  const body: BindingBody = {
    handle: 1,
    translation: () => state.position,
    rotation: () => state.rotation,
    isFixed: () => false,
    isSleeping: () => state.sleeping,
  }

  return { body, state }
}

function makeHost(opts: {
  qualityTier?: QualityTier
  bindings: Array<{ rigidBody: BindingBody; mesh: BindingMesh }>
  stepImpl?: () => number
}) {
  const eventBus = new EventBus()
  const physics = {
    step: vi.fn(() => opts.stepImpl?.() ?? 1),
    getWorld: vi.fn(() => null),
  }

  const host = {
    engine: { getDeltaTime: vi.fn(() => 16.6667) },
    physics,
    stateManager: { isPlaying: vi.fn(() => true) },
    eventBus,
    ballManager: null,
    gameObjects: {
      getBindings: vi.fn(() => opts.bindings),
      getBumperBodies: vi.fn(() => []),
      getBumperVisuals: vi.fn(() => []),
      getTargetBodies: vi.fn(() => []),
      getPachinkoTargetBodies: vi.fn(() => []),
      getBallBodies: vi.fn(() => []),
      getAllFlippers: vi.fn(() => new Map()),
      getDeathZoneBody: vi.fn(() => null),
      updateBumpers: vi.fn(),
      updateTargets: vi.fn(),
    },
    effects: null,
    display: null,
    ballAnimator: null,
    hapticManager: null,
    soundSystem: { playBeep: vi.fn(), playGoldBallCollect: vi.fn() },
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
    qualityTier: opts.qualityTier ?? QualityTier.HIGH,
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

  return { host, physics }
}

describe('GamePhysicsController mesh interpolation', () => {
  it('interpolates between previous and current pose when alpha is below 1', () => {
    const { body, state } = makeBody({ position: { x: 0, y: 0, z: 0 } })
    const mesh: BindingMesh = {
      position: new Vector3(),
      rotationQuaternion: new Quaternion(),
    }
    const { host } = makeHost({ bindings: [{ rigidBody: body, mesh }] })
    const controller = new GamePhysicsController(host)

    ;(controller as unknown as { syncMeshes: (alpha: number) => void }).syncMeshes(1)
    state.position = { x: 10, y: 4, z: -2 }
    state.rotation = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) }

    ;(controller as unknown as { syncMeshes: (alpha: number) => void }).syncMeshes(0.5)

    expect(mesh.position.x).toBeCloseTo(5)
    expect(mesh.position.y).toBeCloseTo(2)
    expect(mesh.position.z).toBeCloseTo(-1)
    expect(mesh.rotationQuaternion?.y).toBeGreaterThan(0)
    expect(mesh.rotationQuaternion?.y).toBeLessThan(state.rotation.y)
  })

  it('renders the raw current pose when the body is sleeping even if alpha is below 1', () => {
    const { body, state } = makeBody({ position: { x: 1, y: 2, z: 3 }, sleeping: true })
    const mesh: BindingMesh = {
      position: new Vector3(),
      rotationQuaternion: new Quaternion(),
    }
    const { host } = makeHost({ bindings: [{ rigidBody: body, mesh }] })
    const controller = new GamePhysicsController(host)

    ;(controller as unknown as { syncMeshes: (alpha: number) => void }).syncMeshes(1)
    state.position = { x: -6, y: 8, z: 12 }

    ;(controller as unknown as { syncMeshes: (alpha: number) => void }).syncMeshes(0.25)

    expect(mesh.position.x).toBe(-6)
    expect(mesh.position.y).toBe(8)
    expect(mesh.position.z).toBe(12)
  })

  it('forces raw post-step poses on LOW quality tier even when physics returns alpha below 1', () => {
    const { body, state } = makeBody({ position: { x: 0, y: 0, z: 0 } })
    const mesh: BindingMesh = {
      position: new Vector3(),
      rotationQuaternion: new Quaternion(),
    }
    const { host, physics } = makeHost({
      qualityTier: QualityTier.LOW,
      bindings: [{ rigidBody: body, mesh }],
      stepImpl: () => {
        state.position = { x: 7, y: -3, z: 5 }
        return 0.5
      },
    })
    const controller = new GamePhysicsController(host)

    controller.stepPhysics(null, null)

    expect(physics.step).toHaveBeenCalled()
    expect(mesh.position.x).toBe(7)
    expect(mesh.position.y).toBe(-3)
    expect(mesh.position.z).toBe(5)
  })
})
