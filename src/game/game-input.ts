import { InputHandler, type InputFrame } from '../game-elements/input'
import type { PhysicsSystem } from '../game-elements/physics'
import type { Scene } from '@babylonjs/core'

export interface InputConfig {
  onFlipperLeft?: (pressed: boolean) => void
  onFlipperRight?: (pressed: boolean) => void
  onPlunger?: () => void
  onPlungerChargeStart?: () => void
  onPlungerChargeRelease?: (chargeLevel: number) => void
  onPlungerChargeUpdate?: (chargeLevel: number) => void
  onNudge?: (direction: { x: number; y: number; z: number }) => void
  onPause?: () => void
  onReset?: () => void
  onStart?: () => void
  onAdventureToggle?: () => void
  onTrackNext?: () => void
  onTrackPrev?: () => void
  onJackpotTrigger?: () => void
  onDebugHUD?: () => void
  onMapSwitch?: (mapIndex: number) => void
  onMapCycle?: () => void
  onCabinetCycle?: () => void
  onLevelSelectToggle?: () => void
  onLeaderboardToggle?: () => void
  onDynamicModeToggle?: () => void
  onScenarioCycle?: () => void
  getState?: () => import('../game-elements/types').GameState
  getTiltActive?: () => boolean
}

export interface GamepadConfig {
  deadZone?: number
  vibrationEnabled?: boolean
}

/**
 * GameInputManager - Centralized input handling for the game
 * 
 * Wraps InputHandler and adds additional game-level keyboard shortcuts
 * that are not directly related to physics input (e.g., map switching,
 * cabinet cycling, UI toggles).
 */
export class GameInputManager {
  private inputHandler: InputHandler
  private config: InputConfig

  // Track additional keyboard state for game-level shortcuts
  private gameKeysPressed = new Set<string>()

  constructor(_scene: Scene, physics: PhysicsSystem, config: InputConfig = {}) {
    this.config = config

    // Initialize the core InputHandler with all callbacks
    this.inputHandler = new InputHandler(
      {
        onFlipperLeft: (pressed) => this.config.onFlipperLeft?.(pressed),
        onFlipperRight: (pressed) => this.config.onFlipperRight?.(pressed),
        onPlunger: () => this.config.onPlunger?.(),
        onPlungerChargeStart: () => this.config.onPlungerChargeStart?.(),
        onPlungerChargeRelease: (chargeLevel) => this.config.onPlungerChargeRelease?.(chargeLevel),
        onPlungerChargeUpdate: (chargeLevel) => this.config.onPlungerChargeUpdate?.(chargeLevel),
        onNudge: (direction) => this.config.onNudge?.(direction),
        onPause: () => this.config.onPause?.(),
        onReset: () => this.config.onReset?.(),
        onStart: () => this.config.onStart?.(),
        onAdventureToggle: () => this.config.onAdventureToggle?.(),
        onTrackNext: () => this.config.onTrackNext?.(),
        onTrackPrev: () => this.config.onTrackPrev?.(),
        onJackpotTrigger: () => this.config.onJackpotTrigger?.(),
        getState: () => this.config.getState?.() ?? 0,
        getTiltActive: () => this.config.getTiltActive?.() ?? false,
      },
      physics.getRapier()
    )

    // Setup additional keyboard listeners for game-level shortcuts
    this.setupGameKeyboardShortcuts()

    // Register core gameplay keyboard input (flippers, plunger, nudge)
    window.addEventListener('keydown', this.inputHandler.handleKeyDown)
    window.addEventListener('keyup', this.inputHandler.handleKeyUp)
  }

  /**
   * Setup additional keyboard shortcuts that are game-level features
   * (not directly physics-related inputs)
   */
  private setupGameKeyboardShortcuts(): void {
    window.addEventListener('keydown', this.handleGameKeyDown)
  }

  private handleGameKeyDown = (e: KeyboardEvent): void => {
    // Prevent duplicate handling for held keys
    if (this.gameKeysPressed.has(e.code)) return
    this.gameKeysPressed.add(e.code)

    // Get state from config for state-dependent shortcuts
    const gameState = this.config.getState?.()
    const isPlaying = gameState === 1 // GameState.PLAYING = 1

    // Dynamic map switching (Digit1-9)
    if (e.code.startsWith('Digit') && isPlaying) {
      const index = parseInt(e.code.replace('Digit', ''), 10) - 1
      if (index >= 0) {
        e.preventDefault()
        this.config.onMapSwitch?.(index)
      }
      return
    }

    // 'M' key to cycle maps
    if (e.code === 'KeyM' && isPlaying) {
      e.preventDefault()
      this.config.onMapCycle?.()
      return
    }

    // 'C' key to cycle cabinet presets
    if (e.code === 'KeyC') {
      e.preventDefault()
      this.config.onCabinetCycle?.()
      return
    }

    // 'L' key to toggle level select screen
    if (e.code === 'KeyL') {
      e.preventDefault()
      this.config.onLevelSelectToggle?.()
      return
    }

    // 'B' key to toggle leaderboard
    if (e.code === 'KeyB') {
      e.preventDefault()
      this.config.onLeaderboardToggle?.()
      return
    }

    // 'D' key to toggle Dynamic/Fixed mode
    if (e.code === 'KeyD') {
      e.preventDefault()
      this.config.onDynamicModeToggle?.()
      return
    }

    // 'S' key to cycle scenarios in Dynamic Mode
    if (e.code === 'KeyS') {
      e.preventDefault()
      this.config.onScenarioCycle?.()
      return
    }

    // '`' key to toggle debug HUD
    if (e.code === 'Backquote') {
      e.preventDefault()
      this.config.onDebugHUD?.()
      return
    }
  }

  private handleGameKeyUp = (e: KeyboardEvent): void => {
    this.gameKeysPressed.delete(e.code)
  }

  /**
   * Setup gamepad support with configuration
   */
  setupGamepad(config?: GamepadConfig): void {
    this.inputHandler.setupGamepad({
      deadZone: config?.deadZone ?? 0.15,
      vibrationEnabled: config?.vibrationEnabled ?? true,
    })
  }

  /**
   * Get the gamepad manager from the input handler
   */
  getGamepadManager() {
    return this.inputHandler.getGamepadManager()
  }

  /**
   * Setup touch controls with DOM elements
   */
  setupTouchControls(
    leftBtn: HTMLElement | null,
    rightBtn: HTMLElement | null,
    plungerBtn: HTMLElement | null,
    nudgeBtn: HTMLElement | null
  ): void {
    this.inputHandler.setupTouchControls(leftBtn, rightBtn, plungerBtn, nudgeBtn)
  }

  /**
   * Configure plunger charge parameters
   */
  configurePlungerCharge(config: {
    maxChargeTime?: number
    minImpulse?: number
    maxImpulse?: number
  }): void {
    this.inputHandler.configurePlungerCharge(config)
  }

  /**
   * Enable or disable latency tracking
   */
  enableLatencyTracking(enabled: boolean): void {
    this.inputHandler.enableLatencyTracking(enabled)
  }

  /**
   * Update input state - called each frame
   */
  update(): void {
    // Poll gamepad input
    this.inputHandler.pollGamepad()

    // Update plunger charge if held
    this.inputHandler.updatePlungerCharge()

    // Cleanup key up handlers (since we don't have keyup for game shortcuts)
    window.addEventListener('keyup', this.handleGameKeyUp, { once: true })
  }

  /**
   * Process buffered inputs - called from physics step
   */
  processBufferedInputs(): InputFrame {
    return this.inputHandler.processBufferedInputs()
  }

  /**
   * Get the underlying InputHandler for advanced use
   */
  getInputHandler(): InputHandler {
    return this.inputHandler
  }

  /**
   * Get latency report from input handler
   */
  getLatencyReport() {
    return this.inputHandler.getLatencyReport()
  }

  /**
   * Get last processed input frame
   */
  getLastProcessedFrame(): InputFrame {
    return this.inputHandler.getLastProcessedFrame()
  }

  /**
   * Check if plunger is currently being held/charged
   */
  isPlungerHeld(): boolean {
    return this.inputHandler.isPlungerHeld()
  }

  /**
   * Get current plunger charge state
   */
  getPlungerChargeState() {
    return this.inputHandler.getPlungerChargeState()
  }

  /**
   * Dispose all input handlers and clean up
   */
  dispose(): void {
    // Remove game-level keyboard listeners
    window.removeEventListener('keydown', this.handleGameKeyDown)
    window.removeEventListener('keyup', this.handleGameKeyUp)

    // Remove core gameplay keyboard listeners
    window.removeEventListener('keydown', this.inputHandler.handleKeyDown)
    window.removeEventListener('keyup', this.inputHandler.handleKeyUp)
  }
}
