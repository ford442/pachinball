/**
 * Shared PhysicsHost mock pieces for GamePhysicsController unit tests.
 * Keeps the gameObjects contract in sync with production (incl. getLaneSensors).
 */

import { vi } from 'vitest'

import { EventBus } from '../../src/game/event-bus'
import type { PhysicsHost } from '../../src/game/game-physics-controller'
import { QualityTier } from '../../src/game-elements/visual-language'

export type GameObjectsStubOverrides = {
  getBumperBodies?: ReturnType<typeof vi.fn>
  getBumperVisuals?: ReturnType<typeof vi.fn>
  getLaneSensors?: ReturnType<typeof vi.fn>
  getTargetBodies?: ReturnType<typeof vi.fn>
  getBindings?: ReturnType<typeof vi.fn>
  getAllFlippers?: ReturnType<typeof vi.fn>
  getDeathZoneBody?: ReturnType<typeof vi.fn>
  updateBumpers?: ReturnType<typeof vi.fn>
  updateTargets?: ReturnType<typeof vi.fn>
  activateBumperHit?: ReturnType<typeof vi.fn>
}

/** Minimal gameObjects mock matching methods CollisionDispatcher.rebuildHandleCaches reads. */
export function makeGameObjectsStub(overrides: GameObjectsStubOverrides = {}) {
  return {
    getBindings: overrides.getBindings ?? vi.fn(() => []),
    getBumperBodies: overrides.getBumperBodies ?? vi.fn(() => []),
    getBumperVisuals: overrides.getBumperVisuals ?? vi.fn(() => []),
    getTargetBodies: overrides.getTargetBodies ?? vi.fn(() => []),
    getLaneSensors: overrides.getLaneSensors ?? vi.fn(() => []),
    getAllFlippers: overrides.getAllFlippers ?? vi.fn(() => new Map()),
    getDeathZoneBody: overrides.getDeathZoneBody ?? vi.fn(() => null),
    updateBumpers: overrides.updateBumpers ?? vi.fn(),
    updateTargets: overrides.updateTargets ?? vi.fn(),
    activateBumperHit: overrides.activateBumperHit ?? vi.fn(),
  }
}

export type BallManagerStubOverrides = {
  getBallBodies?: ReturnType<typeof vi.fn>
  getBallBody?: ReturnType<typeof vi.fn>
  getBindings?: ReturnType<typeof vi.fn>
  getBallType?: ReturnType<typeof vi.fn>
  getChainStats?: ReturnType<typeof vi.fn>
}

export function makeBallManagerStub(overrides: BallManagerStubOverrides = {}) {
  return {
    getBallBodies: overrides.getBallBodies ?? vi.fn(() => []),
    getBallBody: overrides.getBallBody ?? vi.fn(() => null),
    getBindings: overrides.getBindings ?? vi.fn(() => []),
    getBallType: overrides.getBallType ?? vi.fn(() => 'standard'),
    getChainStats: overrides.getChainStats ?? vi.fn(() => ({ scoreMultiplier: 1 })),
    updateCaughtBalls: vi.fn(),
    updateTrailEffects: vi.fn(),
    updateGoldBallGlow: vi.fn(),
    updateStuckDetection: vi.fn(() => []),
    updateSmallGoldBallLifetimes: vi.fn(),
  }
}

export type PhysicsHostShellOpts = {
  physics: unknown
  eventBus?: EventBus
  ballManager: unknown
  gameObjects: unknown
  /** Extra accessibility fields (wasm parity adds maxCameraShakeIntensity). */
  accessibility?: Record<string, unknown>
}

/** Common PhysicsHost field bag shared by handle-space / wasm / lane-sensor tests. */
export function makePhysicsHostShell(opts: PhysicsHostShellOpts): PhysicsHost {
  const eventBus = opts.eventBus ?? new EventBus()
  return {
    engine: { getDeltaTime: vi.fn(() => 16.6667) },
    physics: opts.physics,
    stateManager: { isPlaying: vi.fn(() => true) },
    eventBus,
    ballManager: opts.ballManager,
    gameObjects: opts.gameObjects,
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
    accessibility: {
      reducedMotion: false,
      photosensitiveMode: false,
      hapticsEnabled: true,
      ...opts.accessibility,
    },
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
}
