import { describe, expect, it, vi } from 'vitest'
import { GamePhysicsController, type PhysicsHost } from '../src/game/game-physics-controller'
import { EventBus } from '../src/core/event-bus'
import { QualityTier } from '../src/game-elements/visual-language'

function makeHost(adventureActive: boolean) {
  const setOwnerSkipRapierStep = vi.fn()
  const eventBus = new EventBus()
  const physics = {
    step: vi.fn(() => 1),
    getWorld: vi.fn(() => null),
    isWasmActive: vi.fn(() => true),
    isWasmOwnerMode: vi.fn(() => true),
    setOwnerSkipRapierStep,
    getWasmEngine: vi.fn(() => null),
    getRapier: vi.fn(() => null),
    setMirrorOverheadMs: vi.fn(),
    getLastMirrorOverheadMs: vi.fn(() => 0),
    getWasmMode: vi.fn(() => 'wasm-owner' as const),
  }

  const host = {
    engine: { getDeltaTime: vi.fn(() => 16.6667) },
    physics,
    stateManager: { isPlaying: vi.fn(() => true) },
    eventBus,
    ballManager: new Proxy({}, { get: () => vi.fn() }),
    gameObjects: {
      getBindings: vi.fn(() => []),
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
    adventureMode: { isActive: () => adventureActive, update: vi.fn() },
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

  return { host, setOwnerSkipRapierStep }
}

describe('wasm-owner adventure still steps Rapier', () => {
  it('skips Rapier on the table path when adventure is inactive', () => {
    const { host, setOwnerSkipRapierStep } = makeHost(false)
    const controller = new GamePhysicsController(host)
    controller.stepPhysics(null, null)
    expect(setOwnerSkipRapierStep).toHaveBeenCalledWith(true)
  })

  it('keeps Rapier stepping for ADVENTURE_GROUP when adventure is active', () => {
    const { host, setOwnerSkipRapierStep } = makeHost(true)
    const controller = new GamePhysicsController(host)
    controller.stepPhysics(null, null)
    expect(setOwnerSkipRapierStep).toHaveBeenCalledWith(false)
  })
})
