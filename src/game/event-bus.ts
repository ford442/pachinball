/**
 * Event Bus - Lightweight typed pub/sub layer for Pachinball
 *
 * Replaces scattered direct calls between systems with clean event-driven communication.
 * GameStateManager emits lifecycle events; DisplaySystem, EffectsSystem, and audio
 * subscribe to the events they care about without game.ts needing to coordinate them.
 */

import type { DisplayState } from '../game-elements/display-config'
import type { GameState, UnlockedReward } from '../game-elements/types'
import type { WasmContactEvent } from '../wasm/wasm-types'

/**
 * Typed event map for all Pachinball game events.
 * Each key is the event name; the value is the payload type (use void for no payload).
 */
export interface PachinballEventMap {
  // Game state transitions
  'game:start': void
  'game:over': void
  'game:pause': void
  'game:resume': void
  'menu:enter': void
  'menu:exit': void

  // Display state changes
  'display:set': DisplayState

  // Rewards and Unlocks
  'reward:unlocked': UnlockedReward

  // Gameplay events
  'fever:start': void
  'fever:end': void
  'jackpot:start': void
  'jackpot:end': void
  'reach:start': void
  'reach:end': void
  'adventure:start': void
  'adventure:end': void
  /**
   * Fired when a campaign exit portal becomes active (either flawless success or timeout escape).
   * Consumers (AdventureMode, HUD, display) react to this to show the portal and overlay.
   */
  'portal:open': {
    trackId: string
    kind: 'success' | 'timeout'
    /** modeType of the track that just opened the portal. */
    mode?: 'STATIONARY_TABLE' | 'EXTENDED_MAP'
    /** Reward multiplier for the portal transition (1+ on success, <1 on timeout). */
    multiplier?: number
    /** Seconds remaining on the track timer when the portal opened. */
    timeRemaining?: number
  }
  /**
   * Fired when `portal:open` is received but `AdventureMode.activateExitPortal()`
   * returns false (e.g. adventure mode is no longer active). No sensor is
   * registered and no portal UI/display change occurs; the supervisor can
   * re-attempt on the next tick if the goal is still met.
   */
  'portal:activation-failed': {
    trackId: string
    kind: 'success' | 'timeout'
    mode?: 'STATIONARY_TABLE' | 'EXTENDED_MAP'
  }
  /**
   * Fired when the ball physically enters an exit portal.
   * Spatial fields (id, position) come from AdventureMode.
   * Reward fields (finalScore, goldBalls, multiplier, totalReward) come from the supervisor.
   */
  'portal:entered': {
    kind: 'success' | 'timeout'
    trackId: string
    /** Unique portal instance id (set by AdventureMode). */
    id?: string
    /** World position of the portal (set by AdventureMode). */
    position?: { x: number; y: number; z: number }
    /** Player's score at the moment of entry (set by supervisor). */
    finalScore?: number
    /** Gold balls collected during the track (set by supervisor). */
    goldBalls?: number
    /** Effective reward multiplier (set by supervisor). */
    multiplier?: number
    /** Total reward after applying multiplier (set by supervisor). */
    totalReward?: number
  }

  // Generic state change (for backward-compat logging / instrumentation)
  'state:change': { oldState: GameState; newState: GameState }

  // Spinner Bumper events
  'bumper:spinner:hit': {
    spinnerId: string
    position: { x: number; y: number; z: number }
    force: number
  }
  'bumper:spinner:rotation': {
    spinnerId: string
    rotationSpeed: number
    progress: number
  }
  'bumper:spinner:full-rotation': {
    spinnerId: string
    completions: number
  }

  // Ball Trap events
  'trap:ball:captured': {
    trapId: string
    ballId: string
    position: { x: number; y: number; z: number }
  }
  'trap:ball:released': {
    trapId: string
    ballId: string
    exitVelocity: { x: number; y: number; z: number }
  }

  // Launcher events
  'launcher:charged': {
    launcherId: string
    chargeLevel: number
  }
  'launcher:fired': {
    launcherId: string
    ballId: string
    force: { x: number; y: number; z: number }
    chargeRatio: number
  }
  'launcher:triggered': {
    launcherId: string
    ballId: string
  }

  // Moving Gate events
  'gate:triggered': {
    gateId: string
    position: { x: number; y: number; z: number }
  }
  'gate:opened': {
    gateId: string
    duration: number
  }
  'gate:closed': {
    gateId: string
  }
  'gate:state-changed': {
    gateId: string
    isOpen: boolean
  }

  // Drop Target events
  'drop-target:hit': {
    targetId: string
    bankId: string
    position: { x: number; y: number; z: number }
  }
  'drop-target:bank-complete': {
    bankId: string
    targetCount: number
  }
  'drop-target:bank-reset': {
    bankId: string
  }

  // Adventure Goal events
  'goal:progress': {
    goalId: string
    trackId: string
    current: number
    target: number
    progress: number
    title: string
  }
  'goal:completed': {
    goalId: string
    trackId: string
    title: string
    reward: number
  }
  'track:progress': {
    trackId: string
    completedGoals: number
    totalGoals: number
    progress: number
  }
  'track:completed': {
    trackId: string
    totalReward: number
    duration: number
  }
  'track:goal-reached': {
    trackId: string
    scoreDelta: number
    recommendedScore: number
    timeRemaining: number
  }
  'track:timeout': {
    trackId: string
    multiplier: number
    timeLimitSeconds: number
    elapsedSeconds: number
  }
  'track:unlocked': {
    trackId: string
    name: string
  }

  // Cinematic events
  'cinematic:started': {
    cinematicType: 'track-start' | 'goal-complete' | 'track-complete' | 'jackpot' | 'special-moment'
    duration: number
  }
  'cinematic:finished': {
    cinematicType: string
  }

  // Score and feedback events
  'points:awarded': {
    amount: number
    source: string
    position?: { x: number; y: number; z: number }
    multiplier?: number
  }
  'combo:started': {
    comboCount: number
    chainLength?: number
    lastType?: 'bumper' | 'spinner' | 'gate' | 'trap' | 'launcher'
  }
  'combo:extended': {
    comboCount: number
    chainLength?: number
    lastType?: 'bumper' | 'spinner' | 'gate' | 'trap' | 'launcher'
  }
  'combo:chain': {
    comboCount: number
    chainLength: number
    lastType: 'bumper' | 'spinner' | 'gate' | 'trap' | 'launcher'
    chainName?: string
    bonusPoints: number
    multiplier: number
  }
  'combo:broken': {
    finalComboCount: number
    chainLength?: number
    lastType?: 'bumper' | 'spinner' | 'gate' | 'trap' | 'launcher'
  }
  'multiball:start': {
    reason: 'jackpot' | 'gold-threshold'
    ballsInPlay: number
    scoreMultiplier: number
    chainLevel: number
  }
  'multiball:end': {
    ballsInPlay: number
  }
  'multiball:save': {
    remainingMs: number
  }
  'score:multiplier': {
    basePoints: number
    awardedPoints: number
    multiplier: number
    source: string
  }

  // Combo multiplier events
  'combo:multiplier:changed': {
    multiplier: number
    comboCount: number
  }

  // Gold ball streak events
  'gold-ball:streak': {
    /** Running count of consecutive gold balls collected in this streak (≥ 2). */
    streakCount: number
    /** Streak multiplier applied to this ball's base points. */
    multiplier: number
    /** Final points awarded after applying the streak multiplier. */
    bonusPoints: number
    /** Ball type that triggered the streak update. */
    ballType: string
  }

  // Ball save events
  'ball:launched': void
  'ball:save:triggered': {
    reason: 'grace-window' | 'multiball'
  }
  'ball:save:expired': void

  // Bonus tally events
  'bonus:tally:start': {
    totalBonus: number
    breakdown: Record<string, number>
  }
  'bonus:tally:tick': {
    currentDisplay: number
    totalBonus: number
  }
  'bonus:tally:complete': {
    totalBonus: number
  }

  // Lighting and effects events
  'effect:flash': {
    color?: string
    intensity: number
    duration: number
  }
  'effect:bloom': {
    intensity: number
    duration?: number
  }
  'effect:shake': {
    amount: number
    duration?: number
  }
  'effect:slot:lighting': {
    mode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'
  }

  // Slot machine mini-game events
  'slot:spin:start': {
    duration: number
    reelSpeeds: number[]
    stopDelays: number[]
  }
  'slot:reel:stop': {
    reelIndex: number
    symbol: string
  }
  'slot:win': {
    combination: string
    multiplier: number
    points: number
    symbols: string[]
  }
  'slot:jackpot': {
    points: number
    symbols: string[]
  }
  'slot:nearmiss': {
    symbols: string[]
  }

  // Sound and audio events
  'sound:play': {
    soundKey: string
    volume?: number
    pitch?: number
  }
  'music:intensity': {
    intensity: number
    duration?: number
  }
  'music:transition': {
    fromIntensity: number
    toIntensity: number
    duration: number
  }

  // C++ WASM physics engine events
  /** Fired once per contact pair per physics step by WasmPhysicsEngine. */
  'wasm:physics:contact': WasmContactEvent
  /** Fired when the WasmPhysicsEngine WASM module has loaded and the world is ready. */
  'wasm:physics:ready': void
  /** Fired when the WasmPhysicsEngine encounters a fatal load error. */
  'wasm:physics:error': { message: string }
}

/** Event name derived from the event map keys */
export type PachinballEventName = keyof PachinballEventMap

/** Handler type for a given event name */
export type PachinballEventHandler<K extends PachinballEventName> = (
  payload: PachinballEventMap[K]
) => void

/**
 * Lightweight typed EventBus.
 * No external dependencies. Uses Map<string, Set<Function>> internally.
 */
export class EventBus {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function that removes this handler.
   */
  on<K extends PachinballEventName>(
    event: K,
    handler: PachinballEventHandler<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void)

    return () => {
      this.off(event, handler)
    }
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends PachinballEventName>(
    event: K,
    handler: PachinballEventHandler<K>
  ): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void)
  }

  /**
   * Emit an event with optional payload.
   */
  emit<K extends PachinballEventName>(
    event: K,
    ...args: PachinballEventMap[K] extends void
      ? []
      : [payload: PachinballEventMap[K]]
  ): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return

    // Clone the set so that a handler calling off() during emit doesn't break iteration
    const snapshot = Array.from(handlers)
    for (const handler of snapshot) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      ;(handler as Function)(...(args as unknown[]))
    }
  }

  /**
   * Remove all listeners for a given event, or all events if no event is specified.
   */
  clear(event?: PachinballEventName): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }
}
