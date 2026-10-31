/**
 * Event Bus — lightweight typed pub/sub layer for Pachinball.
 *
 * Replaces scattered direct calls between systems with clean event-driven
 * communication. GameStateManager emits lifecycle events; DisplaySystem,
 * EffectsSystem, and audio subscribe to what they care about without game.ts
 * having to coordinate them.
 *
 * ## Why this lives in `src/core/` (#322)
 *
 * This is the kernel: the layer everything else may depend on, and which depends
 * on nothing above it. It previously sat in `src/game/`, which forced low-level
 * systems in `src/game-elements/` to reach *upward* into the high-level game
 * layer just to emit an event — an inverted dependency and a standing cycle risk
 * between the two barrels.
 *
 * Two rules keep it a kernel, both enforced by `no-restricted-imports` in
 * eslint.config.js rather than by convention:
 *
 *   1. **No Babylon.** Nothing here may import `@babylonjs/core`, so the bus can
 *      be unit-tested and reused without standing up an engine.
 *   2. **No runtime imports from upper layers.** The event-map payload types
 *      below are `import type` only — erased at compile time, so no runtime edge
 *      is created. Emitters import the concrete enums from their own layer.
 */

import type { DisplayState } from '../display/display-types'
import type { GameState, UnlockedReward } from '../game-elements/types'
import type { WasmContactBatch, WasmContactEvent } from '../wasm/wasm-types'

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

  // Display state changes
  'display:set': DisplayState

  // Rewards and Unlocks
  'reward:unlocked': UnlockedReward

  // Gameplay events
  'fever:start': void
  'fever:end': void
  'jackpot:start': void
  'jackpot:end': void
  'jackpot:phase': { phase: number }
  /** A ball hit a bumper (the table's contact path); `strength` is 0–1 impact speed. Cosmetic listeners only. */
  'bumper:contact': { strength: number }
  'reach:start': void
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
  'lane:rollover': {
    laneId: string
    kind: 'launch' | 'inlane' | 'outlane' | 'drainApproach'
    points: number
    ballHandle: number
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

  // Bonus tally events
  'bonus:tally:start': {
    totalBonus: number
    breakdown: Record<string, number>
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
  /**
   * Fired once per contact pair per physics step by the WASM engines — only while it has a
   * subscriber. Each payload is a fresh record. Prefer the batched `'wasm:physics:contacts'`
   * on hot paths: this one allocates per contact.
   */
  'wasm:physics:contact': WasmContactEvent
  /**
   * One step's contacts in a single emit (#488 §5): the packed buffer (`CONTACT_STRIDE` floats per
   * contact) as a typed-array view. The view and the batch object are reused — valid only during
   * the emit. Decode with `contactPhaseAt` / `decodeContactAt` from `src/wasm/contact-buffer`.
   */
  'wasm:physics:contacts': WasmContactBatch
}

/** Event name derived from the event map keys */
export type PachinballEventName = keyof PachinballEventMap

/** Handler type for a given event name */
export type PachinballEventHandler<K extends PachinballEventName> = (
  payload: PachinballEventMap[K]
) => void

/**
 * Handlers are stored with a `never` parameter: any `(payload: T) => void` is assignable to
 * it, so on()/off() need no casts, and emit() is the single place that supplies a payload.
 */
type StoredHandler = (payload: never) => void

/**
 * One event's handlers. `snapshot` is the array `emit` iterates: built lazily from `set` on the
 * first emit after a change and then reused, so an emit with an unchanged handler set allocates
 * nothing (#488 §5). on()/off() never touch the array in place — they drop it (`null`) — so an
 * emit already iterating the old array keeps the handler list it started with: a handler added
 * during an emit is not called by it, and one removed during an emit still is (exactly what the
 * former per-emit `Array.from(set)` clone did).
 */
interface HandlerBucket {
  set: Set<StoredHandler>
  snapshot: readonly StoredHandler[] | null
}

/**
 * Lightweight typed EventBus.
 * No external dependencies.
 */
export class EventBus {
  private listeners = new Map<PachinballEventName, HandlerBucket>()

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function that removes this handler.
   */
  on<K extends PachinballEventName>(
    event: K,
    handler: PachinballEventHandler<K>
  ): () => void {
    let bucket = this.listeners.get(event)
    if (!bucket) {
      bucket = { set: new Set(), snapshot: null }
      this.listeners.set(event, bucket)
    }
    if (!bucket.set.has(handler)) {
      bucket.set.add(handler)
      bucket.snapshot = null
    }

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
    const bucket = this.listeners.get(event)
    if (bucket?.set.delete(handler)) bucket.snapshot = null
  }

  /**
   * True when `event` has at least one handler. Emitters of high-volume events use it to skip
   * building a payload nobody would receive.
   */
  hasListeners(event: PachinballEventName): boolean {
    return (this.listeners.get(event)?.set.size ?? 0) > 0
  }

  /**
   * Emit an event with optional payload.
   */
  emit<K extends PachinballEventName>(
    event: K,
    ...args: [PachinballEventMap[K]] extends [void]
      ? []
      : [payload: PachinballEventMap[K]]
  ): void {
    const bucket = this.listeners.get(event)
    if (!bucket) return

    let handlers = bucket.snapshot
    if (!handlers) {
      handlers = Array.from(bucket.set)
      bucket.snapshot = handlers
    }
    const payload = args[0] as never
    // Iterate the local reference: on()/off() during a handler replace `bucket.snapshot`,
    // never mutate this array, so the rest of this emit is unaffected.
    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i]
      if (handler) handler(payload)
    }
  }

  /**
   * @internal Test hook: the handler array the next `emit(event)` iterates if no handler
   * changes before it (null when it will be rebuilt, undefined for an unknown event).
   */
  dispatchSnapshot(event: PachinballEventName): readonly ((payload: never) => void)[] | null | undefined {
    return this.listeners.get(event)?.snapshot
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
