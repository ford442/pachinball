import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameState } from './types'
import type { InputFrame, PendingInputFrame, PlungerChargeState, LatencyMetrics, LatencyReport } from './types'
import type { GamepadConfig, GamepadState } from './gamepad'
import { GamepadManager } from './gamepad'

export type { InputFrame, PendingInputFrame, LatencyReport }

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
  
  // Plunger charge state tracking
  private plungerChargeState: PlungerChargeState = {
    isHeld: false,
    chargeStartTime: 0,
    chargeLevel: 0,
    maxChargeTime: 1500,
    minImpulse: 10,
    maxImpulse: 35
  }
  
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
  private rapier: typeof RAPIER | null = null
  
  // Gamepad support
  private gamepadManager: GamepadManager | null = null
  private lastGamepadState: GamepadState | null = null

  // Latency tracking for input-to-response timing
  private latencyMetrics: LatencyMetrics = {
    samples: [],
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
    },
    rapier: typeof RAPIER | null
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
    this.rapier = rapier
    
    // Initialize plunger charge callbacks (with no-ops as defaults)
    this.onPlungerChargeStart = handlers.onPlungerChargeStart || (() => {})
    this.onPlungerChargeRelease = handlers.onPlungerChargeRelease || (() => {})
    this.onPlungerChargeUpdate = handlers.onPlungerChargeUpdate || (() => {})
  }

  setRapier(rapier: typeof RAPIER): void {
    this.rapier = rapier
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
    if (gameState === GameState.MENU && state.plunger && (!prevState || !prevState.plunger)) {
      this.onStart()
      return
    }
    
    if (gameState !== GameState.PLAYING) return
    
    // Check tilt before processing flipper inputs
    const tiltActive = this.getTiltActive()
    
    // Left flipper with edge detection and haptic feedback
    if (state.leftFlipper !== (prevState?.leftFlipper ?? false)) {
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
    if (state.rightFlipper !== (prevState?.rightFlipper ?? false)) {
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
    if (state.plunger !== (prevState?.plunger ?? false)) {
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
   * Enable or disable latency tracking
   */
  enableLatencyTracking(enabled: boolean): void {
    this.latencyMetrics.enabled = enabled
    if (!enabled) {
      this.latencyMetrics.samples = []
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
   * Record input timestamp when input is first received
   */
  private recordInputTimestamp(): number {
    return performance.now()
  }

  /**
   * Mark input as processed and record latency
   */
  private markInputProcessed(inputTimestamp: number): void {
    if (!this.latencyMetrics.enabled) return

    const now = performance.now()
    const latency = now - inputTimestamp

    this.latencyMetrics.samples.push(latency)

    // Keep max samples
    if (this.latencyMetrics.samples.length > this.latencyMetrics.maxSamples) {
      this.latencyMetrics.samples.shift()
    }

    // Report every 5 seconds
    if (now - this.latencyMetrics.lastReportTime > 5000) {
      this.reportLatency()
    }
  }

  /**
   * Get current latency report
   */
  getLatencyReport(): LatencyReport | null {
    if (this.latencyMetrics.samples.length === 0) return null

    const samples = [...this.latencyMetrics.samples].sort((a, b) => a - b)
    const sum = samples.reduce((a, b) => a + b, 0)
    const avg = sum / samples.length
    const min = samples[0]
    const max = samples[samples.length - 1]
    const p95Index = Math.floor(samples.length * 0.95)
    const p95 = samples[Math.min(p95Index, samples.length - 1)]

    return { avg, min, max, p95, sampleCount: samples.length }
  }

  /**
   * Reset latency metrics
   */
  resetLatencyMetrics(): void {
    this.latencyMetrics.samples = []
    this.latencyMetrics.lastReportTime = 0
  }

  /**
   * Report latency statistics to console
   */
  private reportLatency(): void {
    const report = this.getLatencyReport()
    if (!report) return

    console.log(
      `[Input Latency] Avg: ${report.avg.toFixed(2)}ms, ` +
      `Min: ${report.min.toFixed(2)}ms, ` +
      `Max: ${report.max.toFixed(2)}ms, ` +
      `P95: ${report.p95.toFixed(2)}ms ` +
      `(n=${report.sampleCount})`
    )

    this.latencyMetrics.lastReportTime = performance.now()
  }

  /**
   * Queue an input for frame-aligned processing
   * This replaces immediate processing to eliminate jitter
   */
  private queueInput<T extends keyof PendingInputFrame>(type: T, value: PendingInputFrame[T]): void {
    // Record timestamp on first input in a frame
    if (!this.pendingInputs.timestamp) {
      this.pendingInputs.timestamp = this.recordInputTimestamp()
    }
    this.pendingInputs[type] = value
  }

  /**
   * Process all buffered inputs and return a single InputFrame
   * Called from game.ts stepPhysics() at the start of each physics frame
   */
  processBufferedInputs(): InputFrame {
    const now = performance.now()

    // Build the input frame from pending inputs
    const frame: InputFrame = {
      flipperLeft: this.pendingInputs.flipperLeft ?? null,
      flipperRight: this.pendingInputs.flipperRight ?? null,
      plunger: this.pendingInputs.plunger ?? false,
      nudge: this.pendingInputs.nudge ?? null,
      timestamp: this.pendingInputs.timestamp ?? now,
      nudgeSource: this.pendingInputs.nudgeSource
    }

    // Track latency from first input event
    if (this.pendingInputs.timestamp) {
      this.markInputProcessed(this.pendingInputs.timestamp)
    }

    // Reset for next frame
    this.pendingInputs = {}
    this.lastProcessedFrame = frame

    return frame
  }
  
  /**
   * Update plunger charge (call each frame while held)
   */
  updatePlungerCharge(): void {
    if (!this.plungerChargeState.isHeld) return
    
    const now = performance.now()
    const heldTime = now - this.plungerChargeState.chargeStartTime
    const newChargeLevel = Math.min(
      heldTime / this.plungerChargeState.maxChargeTime,
      1.0
    )
    
    // Only update if charge level changed
    if (newChargeLevel !== this.plungerChargeState.chargeLevel) {
      this.plungerChargeState.chargeLevel = newChargeLevel
      this.onPlungerChargeUpdate(newChargeLevel)
    }
  }
  
  /**
   * Start plunger charge
   */
  private startPlungerCharge(): void {
    this.plungerChargeState.isHeld = true
    this.plungerChargeState.chargeStartTime = performance.now()
    this.plungerChargeState.chargeLevel = 0
    this.onPlungerChargeStart()
  }
  
  /**
   * Release plunger and return the charge level
   */
  private releasePlungerCharge(): number {
    const finalChargeLevel = this.plungerChargeState.chargeLevel
    this.plungerChargeState.isHeld = false
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

  handleKeyDown = (event: KeyboardEvent): void => {
    // console.log('Key down:', event.code, event.key, this.getState())
    if (!this.rapier) return

    if (event.code === 'KeyP') {
      this.onPause()
      return
    }

    if (event.code === 'KeyR' && this.getState() === GameState.PLAYING) {
      this.onReset()
      return
    }

    if ((event.code === 'Space' || event.code === 'Enter') && this.getState() === GameState.MENU) {
      this.onStart()
      return
    }

    if (this.getState() !== GameState.PLAYING) return

    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
      if (this.getTiltActive()) return
      this.queueInput('flipperLeft', true)
    }

    if (event.code === 'ArrowRight' || event.code === 'Slash') {
      if (this.getTiltActive()) return
      this.queueInput('flipperRight', true)
    }

    if (event.code === 'Space' || event.code === 'Enter') {
      // Start plunger charge on key down
      if (!this.plungerChargeState.isHeld) {
        this.startPlungerCharge()
      }
    }

    if (event.code === 'KeyQ') {
      this.queueInput('nudge', { x: -0.6, y: 0, z: 0.3 })
    }

    if (event.code === 'KeyE') {
      this.queueInput('nudge', { x: 0.6, y: 0, z: 0.3 })
    }

    if (event.code === 'KeyW') {
      this.queueInput('nudge', { x: 0, y: 0, z: 0.8 })
    }

    if (event.code === 'KeyH') {
      this.onAdventureToggle()
    }

    if (event.code === 'BracketRight' && this.onTrackNext) {
      this.onTrackNext()
    }

    if (event.code === 'BracketLeft' && this.onTrackPrev) {
      this.onTrackPrev()
    }

    if (event.code === 'KeyJ' && this.onJackpotTrigger) {
      this.onJackpotTrigger()
    }
  }

  handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.rapier || this.getState() !== GameState.PLAYING) return

    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
      this.queueInput('flipperLeft', false)
    }

    if (event.code === 'ArrowRight' || event.code === 'Slash') {
      this.queueInput('flipperRight', false)
    }
    
    if (event.code === 'Space' || event.code === 'Enter') {
      // Release plunger on key up
      if (this.plungerChargeState.isHeld) {
        this.releasePlungerCharge()
        this.queueInput('plunger', true)
      }
    }
  }

  setupTouchControls(
    leftBtn: HTMLElement | null,
    rightBtn: HTMLElement | null,
    plungerBtn: HTMLElement | null,
    nudgeBtn: HTMLElement | null
  ): void {
    if (!this.rapier) return

    // Left flipper touch
    leftBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (this.getTiltActive()) return
      this.queueInput('flipperLeft', true)
    }, { passive: false })

    leftBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      this.queueInput('flipperLeft', false)
    }, { passive: false })

    leftBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      this.queueInput('flipperLeft', false)
    }, { passive: false })

    // Right flipper touch
    rightBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (this.getTiltActive()) return
      this.queueInput('flipperRight', true)
    }, { passive: false })

    rightBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      this.queueInput('flipperRight', false)
    }, { passive: false })

    rightBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      this.queueInput('flipperRight', false)
    }, { passive: false })

    // Plunger touch with charge support
    plungerBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (!this.plungerChargeState.isHeld) {
        this.startPlungerCharge()
      }
    }, { passive: false })

    plungerBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      if (this.plungerChargeState.isHeld) {
        this.releasePlungerCharge()
        this.queueInput('plunger', true)
      }
    }, { passive: false })

    plungerBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      if (this.plungerChargeState.isHeld) {
        // Cancel charge without firing on touch cancel
        this.plungerChargeState.isHeld = false
        this.plungerChargeState.chargeLevel = 0
      }
    }, { passive: false })

    // Nudge touch (trigger action - queues once per press)
    nudgeBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this.queueInput('nudge', { x: 0, y: 0, z: 1 })
    }, { passive: false })

    nudgeBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
    }, { passive: false })

    nudgeBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
    }, { passive: false })
  }
}
