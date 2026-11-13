import { describe, expect, it, vi } from 'vitest'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { GamePhysicsController } from '../src/game/physics/physics-controller'
import type { PhysicsHost } from '../src/game/physics/types'
import { EventBus } from '../src/core/event-bus'
import { freshNudgeState } from '../src/game/physics/types'
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
  /** Scripted frame delta, in ms; read on every frame. */
  deltaMs?: () => number
  ballBody?: BindingBody
}) {
  const eventBus = new EventBus()
  const physics = {
    step: vi.fn(() => opts.stepImpl?.() ?? 1),
    getWorld: vi.fn(() => null),
  }
  const ballManager = opts.ballBody
    ? {
        getBallBody: () => opts.ballBody,
        getBallBodies: () => [opts.ballBody],
        updateCaughtBalls: vi.fn(),
        updateStuckDetection: () => [],
        updateSmallGoldBallLifetimes: vi.fn(),
      }
    : null

  const host = {
    engine: { getDeltaTime: vi.fn(() => opts.deltaMs?.() ?? 16.6667) },
    physics,
    stateManager: { isPlaying: vi.fn(() => true) },
    eventBus,
    ballManager,
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
    nudgeState: freshNudgeState(),
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

  it('blends on LOW quality tier too: lerp(pose before the tick, live pose, accumulator alpha)', () => {
    const { body, state } = makeBody({ position: { x: 0, y: 0, z: 0 } })
    const mesh: BindingMesh = {
      position: new Vector3(),
      rotationQuaternion: new Quaternion(),
    }
    const { host, physics } = makeHost({
      qualityTier: QualityTier.LOW,
      bindings: [{ rigidBody: body, mesh }],
      // 25 ms = one 1/60 s tick plus half a tick left in the accumulator.
      deltaMs: () => 25,
      stepImpl: () => {
        state.position = { x: 7, y: -3, z: 5 }
        return 1
      },
    })
    const controller = new GamePhysicsController(host)

    controller.stepPhysics(null, null)

    expect(physics.step).toHaveBeenCalledTimes(1)
    expect(mesh.position.x).toBeCloseTo(3.5, 3)
    expect(mesh.position.y).toBeCloseTo(-1.5, 3)
    expect(mesh.position.z).toBeCloseTo(2.5, 3)
  })

  for (const tier of [QualityTier.LOW, QualityTier.HIGH]) {
    it(`at 144 Hz over a 60 Hz step the ball mesh moves on every frame and never jumps backward (${QualityTier[tier]})`, () => {
      const { body, state } = makeBody({ position: { x: 0, y: 0, z: 0 } })
      const mesh: BindingMesh = {
        position: new Vector3(),
        rotationQuaternion: new Quaternion(),
      }
      // The physics poses: the live pose after each step, and the pose before it.
      const STEP = 1
      let preStep = 0
      let stepsThisFrame = 0
      const { host } = makeHost({
        qualityTier: tier,
        bindings: [{ rigidBody: body, mesh }],
        ballBody: body,
        deltaMs: () => 1000 / 144,
        stepImpl: () => {
          preStep = state.position.x
          state.position = { x: preStep + STEP, y: 0, z: 0 }
          stepsThisFrame++
          return 1
        },
      })
      const controller = new GamePhysicsController(host)

      const frames: Array<{ x: number; stepped: boolean; live: number; pre: number; ballX: number }> = []
      const out = new Vector3()
      for (let i = 0; i < 60; i++) {
        stepsThisFrame = 0
        controller.stepFixed(null, null)
        const ball = controller.getBallPosition(out)
        frames.push({ x: mesh.position.x, stepped: stepsThisFrame > 0, live: state.position.x, pre: preStep, ballX: ball!.x })
      }

      // Skip the first stepping frame: before it there is no previous pose to blend from.
      const steady = frames.slice(frames.findIndex((f) => f.stepped) + 1)
      expect(steady.some((f) => !f.stepped)).toBe(true)
      for (let i = 1; i < steady.length; i++) {
        const f = steady[i]!
        const prev = steady[i - 1]!
        // Never behind the pre-step snapshot, never past the live pose.
        expect(f.x).toBeGreaterThanOrEqual(f.pre - 1e-4)
        expect(f.x).toBeLessThanOrEqual(f.live + 1e-4)
        // A frame that did not step still advances the mesh.
        if (!f.stepped) expect(f.x).toBeGreaterThan(prev.x)
        // And no frame ever moves it backward.
        expect(f.x).toBeGreaterThanOrEqual(prev.x - 1e-4)
        // The camera / ghost position is the drawn position.
        expect(f.ballX).toBeCloseTo(f.x, 3)
      }
    })
  }

  it('getBallPosition fills the caller-owned vector and returns it', () => {
    const { body } = makeBody({ position: { x: 4, y: 5, z: 6 } })
    const { host } = makeHost({ bindings: [], ballBody: body })
    const controller = new GamePhysicsController(host)
    const out = new Vector3()

    expect(controller.getBallPosition(out)).toBe(out)
    expect(out.x).toBe(4)
    expect(out.y).toBe(5)
    expect(out.z).toBe(6)
  })

  it('getBallPosition is null without a ball', () => {
    const { host } = makeHost({ bindings: [] })
    const controller = new GamePhysicsController(host)
    expect(controller.getBallPosition(new Vector3())).toBeNull()
  })
})
