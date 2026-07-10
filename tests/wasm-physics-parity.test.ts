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

import { GamePhysicsController, type PhysicsHost } from '../src/game/game-physics-controller'
import { EventBus } from '../src/game/event-bus'
import { QualityTier } from '../src/game-elements/visual-language'
import type { BumperVisual } from '../src/game-elements/types'
import type { WasmContactEvent } from '../src/wasm/wasm-types'

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
    getWasmEngine: vi.fn(() => opts.wasmEngine),
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

  const ballManager = {
    getBallBodies: vi.fn(() => [opts.ballBody]),
    getBallBody: vi.fn(() => opts.ballBody),
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
    getBumperBodies: vi.fn(() => [opts.bumperBody]),
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
    accessibility: { reducedMotion: false, photosensitiveMode: false, hapticsEnabled: true, maxCameraShakeIntensity: 0.1 },
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
  it('keeps ball+bumper divergence within documented epsilon', async () => {
    const [{ WasmPhysicsEngine }, rapier] = await Promise.all([
      import('../src/wasm'),
      import('@dimforge/rapier3d-compat'),
    ])

    await (rapier.init as unknown as () => Promise<void>)()

    const gravity = { x: 0, y: -9.81, z: -5.0 }
    const fixedDt = 1 / 60
    const steps = 120

    // --- Rapier world ---
    const rapierWorld = new rapier.World(gravity)
    const ballRadius = 0.25
    const ballMass = 1.0
    const bumperRadius = 0.4

    const rapierBall = rapierWorld.createRigidBody(
      rapier.RigidBodyDesc.dynamic().setTranslation(0, 2, 0).setLinearDamping(0.1)
    )
    rapierWorld.createCollider(
      rapier.ColliderDesc.ball(ballRadius)
        .setRestitution(0.76)
        .setDensity(ballMass / ((4 / 3) * Math.PI * ballRadius ** 3)),
      rapierBall
    )

    const rapierBumper = rapierWorld.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(0, 0.5, 0)
    )
    rapierWorld.createCollider(
      rapier.ColliderDesc.ball(bumperRadius).setRestitution(0.94),
      rapierBumper
    )

    // --- WASM world ---
    const wasmEngine = new WasmPhysicsEngine()
    await wasmEngine.load('./wasm/PhysicsModule.js')
    if (!wasmEngine.isReady) {
      throw new Error('WASM bundle did not load; cannot run real-engine parity test')
    }
    wasmEngine.setGravity(gravity.x, gravity.y, gravity.z)
    wasmEngine.addStaticPlane({ x: 0, y: 1, z: 0 }, 0)

    const wasmBall = wasmEngine.createBody({
      position: { x: 0, y: 2, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mass: ballMass,
      radius: ballRadius,
      restitution: 0.76,
      linearDamping: 0.1,
      bodyType: 0,
    })
    wasmEngine.createBody({
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mass: 0,
      radius: bumperRadius,
      restitution: 0.94,
      linearDamping: 0,
      bodyType: 1,
    })

    let rapierContactStep = -1
    let wasmContactStep = -1

    const contacts: WasmContactEvent[] = []
    // The wrapper emits on its own EventBus only if one is wired, so collect
    // contacts through the C++ callback directly via a temporary bus.
    const bus = new EventBus()
    wasmEngine.init(bus)
    bus.on('wasm:physics:contact', (evt) => { contacts.push(evt) })

    for (let i = 0; i < steps; i++) {
      rapierWorld.timestep = fixedDt
      rapierWorld.step()

      // Track first Rapier contact between ball and bumper
      if (rapierContactStep < 0) {
        // @ts-expect-error Rapier exposes contact pairs through an internal-ish API
        for (const pair of rapierWorld.contactsWith(rapierBall.collider(0))) {
          if (pair.collider2() === rapierBumper.collider(0) || pair.collider1() === rapierBumper.collider(0)) {
            rapierContactStep = i
            break
          }
        }
      }

      wasmEngine.step(fixedDt)
      if (wasmContactStep < 0 && contacts.length > 0) {
        wasmContactStep = i
        contacts.length = 0
      }
    }

    const rapierPos = rapierBall.translation()
    const rapierVel = rapierBall.linvel()
    const wasmPos = wasmEngine.getPosition(wasmBall)
    const wasmVel = wasmEngine.getVelocity(wasmBall)

    const positionDivergence = Math.sqrt(
      (rapierPos.x - wasmPos.x) ** 2 +
      (rapierPos.y - wasmPos.y) ** 2 +
      (rapierPos.z - wasmPos.z) ** 2
    )
    const velocityDivergence = Math.sqrt(
      (rapierVel.x - wasmVel.x) ** 2 +
      (rapierVel.y - wasmVel.y) ** 2 +
      (rapierVel.z - wasmVel.z) ** 2
    )

    // Epsilon rationale: the WASM solver is a simplified sequential-impulse
    // sphere solver with no friction/rolling/CCD, while Rapier uses a full
    // constraint solver with contact skin. The slice is considered visually
    // matched if the ball stays within ~5 cm and velocity within ~0.5 m/s.
    expect(positionDivergence).toBeLessThanOrEqual(0.05)
    expect(velocityDivergence).toBeLessThanOrEqual(0.5)

    expect(rapierContactStep).toBeGreaterThanOrEqual(0)
    expect(wasmContactStep).toBeGreaterThanOrEqual(0)
    expect(Math.abs(rapierContactStep - wasmContactStep)).toBeLessThanOrEqual(2)

    wasmEngine.dispose()
  })
})
