import { GameState } from './types'
import type {
  InputFrame,
  PendingInputFrame,
  PlungerChargeState,
  LatencyMetrics,
  LatencyReport,
  InputLatencySource,
} from './types'
import type { GamepadConfig, GamepadState } from './gamepad'
import { GamepadManager } from './gamepad'
import {
  handleKeyDown as handleKeyDownImpl,
  handleKeyUp as handleKeyUpImpl,
  type KeyboardInputHost,
} from './input-keyboard'
import { setupTouchControls as setupTouchControlsImpl, type TouchInputHost } from './input-touch'
import {
  beginPlungerCharge,
  computePlungerChargeLevel,
  finishPlungerCharge,
  softCancelPlungerCharge,
  wipePlungerCharge,
} from './input-plunger'

export type { InputFrame, PendingInputFrame, LatencyReport, InputLatencySource }

export class InputHandler {
  // Input buffering for frame-aligned processing
  private pendingInputs: PendingInputFrame = {}
  private lastProcessedFrame: InputFrame = {
    flipperLeft: null,
    flipperRight: null,
    plunger: false,
    nudge: null,
    timestamp: 0
  }
  private pendingLatencySource: InputLatencySource = 'keyboard'

  // Plunger charge state tracking
  private plungerChargeState: PlungerChargeState = {
    isHeld: false,
    chargeStartTime: 0,
    chargeLevel: 0,
    maxChargeTime: 1500,
    minImpulse: 10,
    maxImpulse: 35
  }

  /** Space/Enter/gamepad plunger still down after MENU start — charge once PLAYING. */
  private pendingMenuPlungerHold = false

  // Callbacks for plunger charge events
  private onPlungerChargeStart: () => void
  private onPlungerChargeRelease: (chargeLevel: number) => void
  private onPlungerChargeUpdate: (chargeLevel: number) => void

  // These callbacks are invoked via applyInputFrame in game.ts
  public onFlipperLeft: (pressed: boolean) => void
  public onFlipperRight: (pressed: boolean) => void
  public onPlunger: () => void
  public onNudge: (direction: { x: number; y: number; z: number }) => void
  private onPause: () => void
  private onReset: () => void
  private onStart: () => void
  private onAdventureToggle: () => void
  private onTrackNext?: () => void
  private onTrackPrev?: () => void
  private onJackpotTrigger?: () => void
  private getState: () => GameState
  private getTiltActive: () => boolean
  private getAdventureActive: () => boolean
  /** True once the underlying physics engine has finished booting. */
  private ready = false

  // Gamepad support
  private gamepadManager: GamepadManager | null = null
  private lastGamepadState: GamepadState | null = null

  // Sustained keyboard flipper holds (re-applied each frame for motor + visuals)
  private flipperLeftHeld = false
  private flipperRightHeld = false

  // Latency tracking for input-to-response timing
  private latencyMetrics: LatencyMetrics = {
    samples: [],
    samplesBySource: { keyboard: [], touch: [], gamepad: [] },
    lastReportTime: 0,
    maxSamples: 100,
    enabled: false
  }

  constructor(
    handlers: {
      onFlipperLeft: (pressed: boolean) => void
      onFlipperRight: (pressed: boolean) => void
      onPlunger: () => void
      onPlungerChargeStart?: () => void
      onPlungerChargeRelease?: (chargeLevel: number) => void
      onPlungerChargeUpdate?: (chargeLevel: number) => void
      onNudge: (direction: { x: number; y: number; z: number }) => void
      onPause: () => void
      onReset: () => void
      onStart: () => void
      onAdventureToggle: () => void
      onTrackNext?: () => void
      onTrackPrev?: () => void
      onJackpotTrigger?: () => void
      getState: () => GameState
      getTiltActive: () => boolean
      getAdventureActive?: () => boolean
    },
    ready: boolean
  ) {
    this.onFlipperLeft = handlers.onFlipperLeft
    this.onFlipperRight = handlers.onFlipperRight
    this.onPlunger = handlers.onPlunger
    this.onNudge = handlers.onNudge
    this.onPause = handlers.onPause
    this.onReset = handlers.onReset
    this.onStart = handlers.onStart
    this.onAdventureToggle = handlers.onAdventureToggle
    this.onTrackNext = handlers.onTrackNext
    this.onTrackPrev = handlers.onTrackPrev
    this.onJackpotTrigger = handlers.onJackpotTrigger
    this.getState = handlers.getState
    this.getTiltActive = handlers.getTiltActive
    this.getAdventureActive = handlers.getAdventureActive || (() => false)
    this.ready = ready

    // Initialize plunger charge callbacks (with no-ops as defaults)
    this.onPlungerChargeStart = handlers.onPlungerChargeStart || (() => {})
    this.onPlungerChargeRelease = handlers.onPlungerChargeRelease || (() => {})
    this.onPlungerChargeUpdate = handlers.onPlungerChargeUpdate || (() => {})
  }

  /** Flip once the underlying physics engine finishes booting (if constructed before ready). */
  setReady(ready: boolean): void {
    this.ready = ready
  }

  /**
   * Setup gamepad support
   * Call this after initializing the input handler
   */
  setupGamepad(config?: GamepadConfig): void {
    this.gamepadManager = new GamepadManager(config)
    console.log('[Input] Gamepad support enabled')
  }

  /**
   * Get the gamepad manager instance (for external access to haptics)
   */
  getGamepadManager(): GamepadManager | null {
    return this.gamepadManager
  }

  /**
   * Poll gamepad state and queue inputs
   * Call this each frame from the game loop
   */
  pollGamepad(): void {
    if (!this.gamepadManager) return

    const state = this.gamepadManager.poll()

    // Store last state for change detection
    const prevState = this.lastGamepadState
    this.lastGamepadState = state

    // Skip if not connected
    if (!state.connected) return

    // Only process inputs during gameplay (except start button)
    const gameState = this.getState()

    // Handle start button (Start/Options) for menu navigation
    if (gameState === GameState.MENU) {
      if (this.pendingMenuPlungerHold && !state.plunger) {
        this.pendingMenuPlungerHold = false
      }
      if (state.plunger && (!prevState || !prevState.plunger)) {
        this.pendingMenuPlungerHold = true
        this.onStart()
      }
      return
    }

    if (gameState === GameState.PAUSED) {
      if (state.leftFlipper && !prevState?.leftFlipper) {
        this.onPause()
      } else if (state.rightFlipper && !prevState?.rightFlipper) {
        this.onPause()
      }
      return
    }

    if (gameState !== GameState.PLAYING) return
    if (this.pendingMenuPlungerHold && !state.plunger) {
      this.pendingMenuPlungerHold = false
    }
    this.tryStartChargeAfterMenuHold()
    const adventureActive = this.getAdventureActive()
    if (adventureActive) {
      this.cancelPlungerCharge()
    }

    // Check tilt before processing flipper inputs
    const tiltActive = this.getTiltActive()

    // Left flipper with edge detection and haptic feedback
    if (!adventureActive && state.leftFlipper !== (prevState?.leftFlipper ?? false)) {
      if (!tiltActive || !state.leftFlipper) {
        this.queueInput('flipperLeft', state.leftFlipper)
        if (state.leftFlipper) {
          this.gamepadManager.flipperFeedback()
        }
      } else if (tiltActive && state.leftFlipper) {
        // Tilt warning feedback
        this.gamepadManager.vibrate(100, 50, 100)
      }
    }

    // Right flipper with edge detection and haptic feedback
    if (!adventureActive && state.rightFlipper !== (prevState?.rightFlipper ?? false)) {
      if (!tiltActive || !state.rightFlipper) {
        this.queueInput('flipperRight', state.rightFlipper)
        if (state.rightFlipper) {
          this.gamepadManager.flipperFeedback()
        }
      } else if (tiltActive && state.rightFlipper) {
        // Tilt warning feedback
        this.gamepadManager.vibrate(100, 50, 100)
      }
    }

    // Plunger with charge support
    if (!adventureActive && state.plunger !== (prevState?.plunger ?? false)) {
      if (state.plunger) {
        // Start charge on press
        if (!this.plungerChargeState.isHeld) {
          this.startPlungerCharge()
        }
      } else {
        // Release on button up
        if (this.plungerChargeState.isHeld) {
          this.releasePlungerCharge()
          this.queueInput('plunger', true)
          this.gamepadManager.plungerFeedback()
        }
      }
    }

    // Analog nudge (threshold-based to avoid accidental triggers)
    const nudgeThreshold = 0.5
    if (Math.abs(state.nudgeX) > nudgeThreshold || Math.abs(state.nudgeY) > nudgeThreshold) {
      // Check if nudge state changed significantly
      const prevNudgeX = prevState?.nudgeX ?? 0
      const prevNudgeY = prevState?.nudgeY ?? 0

      if (Math.abs(state.nudgeX - prevNudgeX) > 0.2 || Math.abs(state.nudgeY - prevNudgeY) > 0.2) {
        this.queueInput('nudge', {
          x: state.nudgeX * 0.6,
          y: 0,
          z: state.nudgeY * 0.3
        })
        this.gamepadManager.nudgeFeedback()
      }
    }
  }

  /**
   * Configure plunger charge parameters
   */
  configurePlungerCharge(config: Partial<PlungerChargeState>): void {
    this.plungerChargeState = { ...this.plungerChargeState, ...config }
  }

  /**
   * Get current plunger charge state
   */
  getPlungerChargeState(): PlungerChargeState {
    return { ...this.plungerChargeState }
  }

  /**
   * Check if plunger is currently being charged
   */
  isPlungerHeld(): boolean {
    return this.plungerChargeState.isHeld
  }

  /**
   * Cancel any in-progress plunger charge and discard a queued launch.
   */
  cancelPlungerCharge(): void {
    if (!this.plungerChargeState.isHeld && !this.pendingInputs.plunger) return
    wipePlungerCharge(this.plungerChargeState)
    this.pendingInputs.plunger = false
    this.onPlungerChargeUpdate(0)
  }

  /** Touch/mouse cancel-without-firing (no callback, chargeStartTime untouched). */
  private softCancelPlungerCharge(): void {
    softCancelPlungerCharge(this.plungerChargeState)
  }

  /**
   * Enable or disable latency tracking
   */
  enableLatencyTracking(enabled: boolean): void {
    this.latencyMetrics.enabled = enabled
    if (!enabled) {
      this.latencyMetrics.samples = []
      this.latencyMetrics.samplesBySource = { keyboard: [], touch: [], gamepad: [] }
      this.latencyMetrics.lastReportTime = 0
    }
  }

  /**
   * Check if latency tracking is enabled
   */
  isLatencyTrackingEnabled(): boolean {
    return this.latencyMetrics.enabled
  }

  /**
   * Record input timestamp when input is first received.
   * Prefers native event.timeStamp when provided.
   */
  private recordInputTimestamp(eventTimestamp?: number): number {
    if (typeof eventTimestamp === 'number' && Number.isFinite(eventTimestamp) && eventTimestamp > 0) {
      return eventTimestamp
    }
    return performance.now()
  }

  /**
   * Mark input as processed and record latency
   */
  private markInputProcessed(inputTimestamp: number, source: InputLatencySource): void {
    if (!this.latencyMetrics.enabled) return

    const now = performance.now()
    const latency = now - inputTimestamp
    if (!Number.isFinite(latency) || latency < 0) return

    this.latencyMetrics.samples.push(latency)
    this.latencyMetrics.samplesBySource[source].push(latency)

    if (this.latencyMetrics.samples.length > this.latencyMetrics.maxSamples) {
      this.latencyMetrics.samples.shift()
    }
    const bySource = this.latencyMetrics.samplesBySource[source]
    if (bySource.length > this.latencyMetrics.maxSamples) {
      bySource.shift()
    }

    if (now - this.latencyMetrics.lastReportTime > 5000) {
      this.reportLatency()
    }
  }

  private computeReport(samples: number[], source?: InputLatencySource): LatencyReport | null {
    if (samples.length === 0) return null
    const sorted = [...samples].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    const avg = sum / sorted.length
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[Math.min(p95Index, sorted.length - 1)]
    return { avg, min, max, p95, sampleCount: sorted.length, source }
  }

  /**
   * Get current latency report (all sources, or a specific source).
   */
  getLatencyReport(source?: InputLatencySource): LatencyReport | null {
    if (source) {
      return this.computeReport(this.latencyMetrics.samplesBySource[source], source)
    }
    return this.computeReport(this.latencyMetrics.samples)
  }

  /**
   * Reset latency metrics
   */
  resetLatencyMetrics(): void {
    this.latencyMetrics.samples = []
    this.latencyMetrics.samplesBySource = { keyboard: [], touch: [], gamepad: [] }
    this.latencyMetrics.lastReportTime = 0
  }

  /**
   * Report latency statistics to console
   */
  private reportLatency(): void {
    const all = this.getLatencyReport()
    const touch = this.getLatencyReport('touch')
    if (!all) return

    const touchPart = touch
      ? ` | touch P95: ${touch.p95.toFixed(2)}ms (n=${touch.sampleCount})`
      : ''
    console.log(
      `[Input Latency] Avg: ${all.avg.toFixed(2)}ms, ` +
      `Min: ${all.min.toFixed(2)}ms, ` +
      `Max: ${all.max.toFixed(2)}ms, ` +
      `P95: ${all.p95.toFixed(2)}ms ` +
      `(n=${all.sampleCount})${touchPart}`
    )

    this.latencyMetrics.lastReportTime = performance.now()
  }

  /**
   * Queue an input for frame-aligned processing
   * This replaces immediate processing to eliminate jitter
   */
  private queueInput<T extends keyof PendingInputFrame>(
    type: T,
    value: PendingInputFrame[T],
    meta?: { source?: InputLatencySource; eventTimestamp?: number },
  ): void {
    const source = meta?.source ?? 'keyboard'
    if (!this.pendingInputs.timestamp) {
      this.pendingInputs.timestamp = this.recordInputTimestamp(meta?.eventTimestamp)
      this.pendingLatencySource = source
    }
    this.pendingInputs[type] = value
  }

  /**
   * Process all buffered inputs and return a single InputFrame
   * Called from game.ts stepPhysics() at the start of each physics frame
   */
  processBufferedInputs(): InputFrame {
    const now = performance.now()

    const frame: InputFrame = {
      flipperLeft: this.pendingInputs.flipperLeft ?? null,
      flipperRight: this.pendingInputs.flipperRight ?? null,
      plunger: this.pendingInputs.plunger ?? false,
      nudge: this.pendingInputs.nudge ?? null,
      timestamp: this.pendingInputs.timestamp ?? now,
      nudgeSource: this.pendingInputs.nudgeSource
    }

    if (this.pendingInputs.timestamp) {
      this.markInputProcessed(this.pendingInputs.timestamp, this.pendingLatencySource)
    }

    this.pendingInputs = {}
    this.pendingLatencySource = 'keyboard'
    this.lastProcessedFrame = frame

    return frame
  }

  /**
   * Re-queue held flipper keys each frame so joint motors stay active and
   * hold-to-charge stiffness can ramp while the key is down.
   */
  pollHeldFlipperKeys(): void {
    if (this.getState() !== GameState.PLAYING || this.getAdventureActive()) return
    if (this.getTiltActive()) return

    if (this.flipperLeftHeld) {
      this.queueInput('flipperLeft', true)
    }
    if (this.flipperRightHeld) {
      this.queueInput('flipperRight', true)
    }
  }

  /**
   * Update plunger charge (call each frame while held)
   */
  updatePlungerCharge(): void {
    this.tryStartChargeAfterMenuHold()
    if (!this.plungerChargeState.isHeld) return
    const newChargeLevel = computePlungerChargeLevel(this.plungerChargeState)

    // Only update if charge level changed
    if (newChargeLevel !== this.plungerChargeState.chargeLevel) {
      this.plungerChargeState.chargeLevel = newChargeLevel
      this.onPlungerChargeUpdate(newChargeLevel)
    }
  }

  private tryStartChargeAfterMenuHold(): void {
    if (!this.pendingMenuPlungerHold) return
    if (this.getState() !== GameState.PLAYING) return
    this.pendingMenuPlungerHold = false
    if (this.getAdventureActive()) return
    if (this.plungerChargeState.isHeld) return
    this.startPlungerCharge()
  }

  /**
   * Start plunger charge
   */
  private startPlungerCharge(): void {
    beginPlungerCharge(this.plungerChargeState)
    this.onPlungerChargeStart()
  }

  /**
   * Release plunger and return the charge level
   */
  private releasePlungerCharge(): number {
    const finalChargeLevel = finishPlungerCharge(this.plungerChargeState)
    this.onPlungerChargeRelease(finalChargeLevel)
    return finalChargeLevel
  }

  /**
   * Get the last processed input frame
   * Useful for debugging or input visualization
   */
  getLastProcessedFrame(): InputFrame {
    return { ...this.lastProcessedFrame }
  }

  private readonly keyboardHost: KeyboardInputHost = {
    isReady: () => this.ready,
    getState: () => this.getState(),
    getTiltActive: () => this.getTiltActive(),
    getAdventureActive: () => this.getAdventureActive(),
    queueInput: (type, value) => this.queueInput(type, value),
    onPause: () => this.onPause(),
    onReset: () => this.onReset(),
    onStart: () => this.onStart(),
    onAdventureToggle: () => this.onAdventureToggle(),
    onTrackNext: () => this.onTrackNext?.(),
    onTrackPrev: () => this.onTrackPrev?.(),
    onJackpotTrigger: () => this.onJackpotTrigger?.(),
    setFlipperLeftHeld: (held) => { this.flipperLeftHeld = held },
    setFlipperRightHeld: (held) => { this.flipperRightHeld = held },
    armMenuPlungerHold: () => { this.pendingMenuPlungerHold = true },
    disarmMenuPlungerHold: () => { this.pendingMenuPlungerHold = false },
    isMenuPlungerHoldPending: () => this.pendingMenuPlungerHold,
    isPlungerHeld: () => this.isPlungerHeld(),
    startPlungerCharge: () => this.startPlungerCharge(),
    releasePlungerCharge: () => this.releasePlungerCharge(),
    cancelPlungerCharge: () => this.cancelPlungerCharge(),
  }

  private readonly touchHost: TouchInputHost = {
    isReady: () => this.ready,
    getState: () => this.getState(),
    getTiltActive: () => this.getTiltActive(),
    getAdventureActive: () => this.getAdventureActive(),
    queueInput: (type, value, meta) => this.queueInput(type, value, meta),
    onStart: () => this.onStart(),
    isPlungerHeld: () => this.isPlungerHeld(),
    startPlungerCharge: () => this.startPlungerCharge(),
    releasePlungerCharge: () => this.releasePlungerCharge(),
    cancelPlungerCharge: () => this.cancelPlungerCharge(),
    softCancelPlungerCharge: () => this.softCancelPlungerCharge(),
  }

  handleKeyDown = (event: KeyboardEvent): void => {
    handleKeyDownImpl(this.keyboardHost, event)
  }

  handleKeyUp = (event: KeyboardEvent): void => {
    handleKeyUpImpl(this.keyboardHost, event)
  }

  setupTouchControls(
    leftBtn: HTMLElement | null,
    rightBtn: HTMLElement | null,
    plungerBtn: HTMLElement | null,
    nudgeBtn: HTMLElement | null
  ): void {
    setupTouchControlsImpl(this.touchHost, leftBtn, rightBtn, plungerBtn, nudgeBtn)
  }
}
