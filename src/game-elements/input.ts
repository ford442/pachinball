import type * as RAPIER from '@dimforge/rapier3d-compat'
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

export type { InputFrame, PendingInputFrame, LatencyReport, InputLatencySource }

export class InputHandler {
  private static readonly PLUNGER_KEYS = new Set(['Enter', 'NumpadEnter', 'Space'])

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
  private rapier: typeof RAPIER | null = null
  
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
    this.getAdventureActive = handlers.getAdventureActive || (() => false)
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
    
    if (gameState === GameState.PAUSED) {
      if (state.leftFlipper && !prevState?.leftFlipper) {
        this.onPause()
      } else if (state.rightFlipper && !prevState?.rightFlipper) {
        this.onPause()
      }
      return
    }

    if (gameState !== GameState.PLAYING) return
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
    this.plungerChargeState.isHeld = false
    this.plungerChargeState.chargeStartTime = 0
    this.plungerChargeState.chargeLevel = 0
    this.pendingInputs.plunger = false
    this.onPlungerChargeUpdate(0)
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
    if (!this.plungerChargeState.isHeld) return
    const newChargeLevel = this.calculatePlungerChargeLevel()
    
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
    const finalChargeLevel = this.calculatePlungerChargeLevel()
    this.plungerChargeState.chargeLevel = finalChargeLevel
    this.plungerChargeState.isHeld = false
    this.onPlungerChargeRelease(finalChargeLevel)
    return finalChargeLevel
  }

  private calculatePlungerChargeLevel(): number {
    if (!this.plungerChargeState.isHeld) return this.plungerChargeState.chargeLevel
    const heldTime = performance.now() - this.plungerChargeState.chargeStartTime
    return Math.min(
      Math.max(heldTime / this.plungerChargeState.maxChargeTime, 0),
      1.0
    )
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

    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault()
      this.onPause()
      return
    }

    if (event.code === 'KeyR' && this.getState() === GameState.PLAYING) {
      this.onReset()
      return
    }

    if ((event.code === 'Space' || InputHandler.PLUNGER_KEYS.has(event.code)) && this.getState() === GameState.MENU) {
      event.preventDefault()
      this.onStart()
      return
    }

    if (this.getState() !== GameState.PLAYING) return
    const adventureActive = this.getAdventureActive()
    if (adventureActive) {
      this.cancelPlungerCharge()
    }

    if (!adventureActive && event.code === 'Digit1') {
      if (this.getTiltActive()) return
      this.flipperLeftHeld = true
      this.queueInput('flipperLeft', true)
    }

    if (!adventureActive && event.code === 'Digit0') {
      if (this.getTiltActive()) return
      this.flipperRightHeld = true
      this.queueInput('flipperRight', true)
    }

    if (!adventureActive && InputHandler.PLUNGER_KEYS.has(event.code)) {
      // Start plunger charge on key down
      event.preventDefault()
      if (!this.plungerChargeState.isHeld) {
        this.startPlungerCharge()
      }
    }

    if (event.code === 'KeyZ') {
      this.queueInput('nudge', { x: -0.6, y: 0, z: 0.3 })
    }

    if (event.code === 'Slash') {
      this.queueInput('nudge', { x: 0.6, y: 0, z: 0.3 })
    }

    if (event.code === 'KeyW') {
      event.preventDefault()
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
    const adventureActive = this.getAdventureActive()
    if (adventureActive) {
      this.cancelPlungerCharge()
    }

    if (!adventureActive && event.code === 'Digit1') {
      this.flipperLeftHeld = false
      this.queueInput('flipperLeft', false)
    }

    if (!adventureActive && event.code === 'Digit0') {
      this.flipperRightHeld = false
      this.queueInput('flipperRight', false)
    }

    if (!adventureActive && InputHandler.PLUNGER_KEYS.has(event.code)) {
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

    // Helper to add/remove active class for visual feedback
    const setActive = (btn: HTMLElement | null, active: boolean) => {
      if (btn) {
        if (active) {
          btn.classList.add('active')
        } else {
          btn.classList.remove('active')
        }
      }
    }

    // Left flipper touch
    leftBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (this.getAdventureActive()) return
      if (this.getTiltActive()) return
      setActive(leftBtn, true)
      this.queueInput('flipperLeft', true, { source: 'touch', eventTimestamp: e.timeStamp })
    }, { passive: false })

    leftBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      setActive(leftBtn, false)
      this.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
    }, { passive: false })

    leftBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      setActive(leftBtn, false)
      this.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
    }, { passive: false })

    // Also handle mouse events for desktop testing of touch controls
    leftBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (this.getAdventureActive()) return
      if (this.getTiltActive()) return
      setActive(leftBtn, true)
      this.queueInput('flipperLeft', true, { source: 'touch', eventTimestamp: e.timeStamp })
    })

    leftBtn?.addEventListener('mouseup', (e) => {
      e.preventDefault()
      setActive(leftBtn, false)
      this.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
    })

    leftBtn?.addEventListener('mouseleave', () => {
      setActive(leftBtn, false)
      this.queueInput('flipperLeft', false, { source: 'touch' })
    })

    // Right flipper touch
    rightBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (this.getAdventureActive()) return
      if (this.getTiltActive()) return
      setActive(rightBtn, true)
      this.queueInput('flipperRight', true, { source: 'touch', eventTimestamp: e.timeStamp })
    }, { passive: false })

    rightBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      setActive(rightBtn, false)
      this.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
    }, { passive: false })

    rightBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      setActive(rightBtn, false)
      this.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
    }, { passive: false })

    // Mouse events for right flipper
    rightBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (this.getAdventureActive()) return
      if (this.getTiltActive()) return
      setActive(rightBtn, true)
      this.queueInput('flipperRight', true, { source: 'touch', eventTimestamp: e.timeStamp })
    })

    rightBtn?.addEventListener('mouseup', (e) => {
      e.preventDefault()
      setActive(rightBtn, false)
      this.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
    })

    rightBtn?.addEventListener('mouseleave', () => {
      setActive(rightBtn, false)
      this.queueInput('flipperRight', false, { source: 'touch' })
    })

    // Plunger touch with charge support — MENU starts the game (audio unlock)
    plungerBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (this.getState() === GameState.MENU) {
        this.onStart()
        return
      }
      if (this.getAdventureActive()) return
      setActive(plungerBtn, true)
      if (!this.plungerChargeState.isHeld) {
        this.startPlungerCharge()
      }
    }, { passive: false })

    plungerBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      setActive(plungerBtn, false)
      if (this.getAdventureActive()) {
        this.cancelPlungerCharge()
        return
      }
      if (this.plungerChargeState.isHeld) {
        this.releasePlungerCharge()
        this.queueInput('plunger', true, { source: 'touch', eventTimestamp: e.timeStamp })
      }
    }, { passive: false })

    plungerBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      setActive(plungerBtn, false)
      if (this.getAdventureActive()) {
        this.cancelPlungerCharge()
        return
      }
      if (this.plungerChargeState.isHeld) {
        // Cancel charge without firing on touch cancel
        this.plungerChargeState.isHeld = false
        this.plungerChargeState.chargeLevel = 0
      }
    }, { passive: false })

    // Mouse events for plunger
    plungerBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (this.getState() === GameState.MENU) {
        this.onStart()
        return
      }
      if (this.getAdventureActive()) return
      setActive(plungerBtn, true)
      if (!this.plungerChargeState.isHeld) {
        this.startPlungerCharge()
      }
    })

    plungerBtn?.addEventListener('mouseup', (e) => {
      e.preventDefault()
      setActive(plungerBtn, false)
      if (this.getAdventureActive()) {
        this.cancelPlungerCharge()
        return
      }
      if (this.plungerChargeState.isHeld) {
        this.releasePlungerCharge()
        this.queueInput('plunger', true, { source: 'touch', eventTimestamp: e.timeStamp })
      }
    })

    plungerBtn?.addEventListener('mouseleave', () => {
      setActive(plungerBtn, false)
      if (this.getAdventureActive()) {
        this.cancelPlungerCharge()
        return
      }
      if (this.plungerChargeState.isHeld) {
        this.plungerChargeState.isHeld = false
        this.plungerChargeState.chargeLevel = 0
      }
    })

    // Nudge touch (trigger action - queues once per press)
    nudgeBtn?.addEventListener('touchstart', (e) => {
      e.preventDefault()
      setActive(nudgeBtn, true)
      this.queueInput('nudge', { x: 0, y: 0, z: 1 }, { source: 'touch', eventTimestamp: e.timeStamp })
      // Auto-remove active class after short delay for nudge
      setTimeout(() => setActive(nudgeBtn, false), 150)
    }, { passive: false })

    nudgeBtn?.addEventListener('touchend', (e) => {
      e.preventDefault()
      setActive(nudgeBtn, false)
    }, { passive: false })

    nudgeBtn?.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      setActive(nudgeBtn, false)
    }, { passive: false })

    // Mouse events for nudge
    nudgeBtn?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      setActive(nudgeBtn, true)
      this.queueInput('nudge', { x: 0, y: 0, z: 1 }, { source: 'touch', eventTimestamp: e.timeStamp })
      setTimeout(() => setActive(nudgeBtn, false), 150)
    })

    nudgeBtn?.addEventListener('mouseup', (e) => {
      e.preventDefault()
      setActive(nudgeBtn, false)
    })

    nudgeBtn?.addEventListener('mouseleave', () => {
      setActive(nudgeBtn, false)
    })
  }
}
