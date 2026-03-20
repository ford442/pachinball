/**
 * Gamepad API Support for Pachinball
 * 
 * Provides Xbox/PlayStation controller support for pinball controls:
 * - Flippers: LB/LT/A (left), RB/RT/B (right)
 * - Plunger: X/Y buttons
 * - Nudge: Left analog stick with dead zone
 * - Haptic feedback via vibration actuators
 */

export interface GamepadConfig {
  /** Dead zone for analog sticks (0.0 to 1.0) */
  deadZone: number
  /** Enable vibration feedback */
  vibrationEnabled: boolean
}

export interface GamepadState {
  /** Left flipper button state */
  leftFlipper: boolean
  /** Right flipper button state */
  rightFlipper: boolean
  /** Plunger button state */
  plunger: boolean
  /** Nudge X axis (-1 to 1) */
  nudgeX: number
  /** Nudge Y axis (-1 to 1) */
  nudgeY: number
  /** Whether a gamepad is connected */
  connected: boolean
}

/**
 * Manages Gamepad API input for pinball controls
 */
export class GamepadManager {
  private gamepadIndex: number | null = null
  private previousState: GamepadState = {
    leftFlipper: false,
    rightFlipper: false,
    plunger: false,
    nudgeX: 0,
    nudgeY: 0,
    connected: false
  }
  private config: GamepadConfig

  // Standard button mappings (Xbox/PlayStation compatible)
  private readonly BUTTONS = {
    A: 0,      // Cross (PS)
    B: 1,      // Circle (PS)
    X: 2,      // Square (PS)
    Y: 3,      // Triangle (PS)
    LB: 4,     // L1 (PS)
    RB: 5,     // R1 (PS)
    LT: 6,     // L2 (PS)
    RT: 7,     // R2 (PS)
    Back: 8,   // Share/Select
    Start: 9,  // Options/Start
    L3: 10,    // Left stick click
    R3: 11,    // Right stick click
    DUp: 12,
    DDown: 13,
    DLeft: 14,
    DRight: 15
  }

  constructor(config: GamepadConfig = { deadZone: 0.15, vibrationEnabled: true }) {
    this.config = config

    // Listen for gamepad connection events
    window.addEventListener('gamepadconnected', (e) => {
      console.log('[Gamepad] Connected:', e.gamepad.id)
      this.gamepadIndex = e.gamepad.index
      this.previousState.connected = true
    })

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        console.log('[Gamepad] Disconnected')
        this.gamepadIndex = null
        this.previousState.connected = false
      }
    })
  }

  /**
   * Poll the current gamepad state
   * Call this each frame to get updated input state
   */
  poll(): GamepadState {
    if (this.gamepadIndex === null) {
      return { ...this.previousState, connected: false }
    }

    const gamepad = navigator.getGamepads()[this.gamepadIndex]
    if (!gamepad) {
      this.gamepadIndex = null
      return { ...this.previousState, connected: false }
    }

    // Button mappings (multiple options for each control)
    const leftFlipper = (gamepad.buttons[this.BUTTONS.LB]?.pressed ?? false) ||
                       (gamepad.buttons[this.BUTTONS.LT]?.pressed ?? false) ||
                       (gamepad.buttons[this.BUTTONS.A]?.pressed ?? false)

    const rightFlipper = (gamepad.buttons[this.BUTTONS.RB]?.pressed ?? false) ||
                        (gamepad.buttons[this.BUTTONS.RT]?.pressed ?? false) ||
                        (gamepad.buttons[this.BUTTONS.B]?.pressed ?? false)

    const plunger = (gamepad.buttons[this.BUTTONS.X]?.pressed ?? false) ||
                   (gamepad.buttons[this.BUTTONS.Y]?.pressed ?? false)

    // Analog nudge (left stick)
    let nudgeX = gamepad.axes[0] ?? 0
    let nudgeY = gamepad.axes[1] ?? 0

    // Apply dead zone
    if (Math.abs(nudgeX) < this.config.deadZone) nudgeX = 0
    if (Math.abs(nudgeY) < this.config.deadZone) nudgeY = 0

    const newState: GamepadState = {
      leftFlipper,
      rightFlipper,
      plunger,
      nudgeX,
      nudgeY,
      connected: true
    }

    this.previousState = newState
    return newState
  }

  /**
   * Get changes since last poll (for edge detection)
   * Returns only the properties that have changed significantly
   */
  getChanges(): Partial<GamepadState> {
    // Store current state before polling
    const oldState = { ...this.previousState }
    const current = this.poll()
    const changes: Partial<GamepadState> = {}

    if (current.leftFlipper !== oldState.leftFlipper) {
      changes.leftFlipper = current.leftFlipper
    }
    if (current.rightFlipper !== oldState.rightFlipper) {
      changes.rightFlipper = current.rightFlipper
    }
    if (current.plunger !== oldState.plunger) {
      changes.plunger = current.plunger
    }
    if (Math.abs(current.nudgeX - oldState.nudgeX) > 0.1) {
      changes.nudgeX = current.nudgeX
    }
    if (Math.abs(current.nudgeY - oldState.nudgeY) > 0.1) {
      changes.nudgeY = current.nudgeY
    }

    return changes
  }

  /**
   * Get current state without polling
   * Useful for checking state after getChanges()
   */
  getLastState(): GamepadState {
    return { ...this.previousState }
  }

  /**
   * Vibration feedback (if supported by gamepad)
   * @param lowFreq - Low frequency rumble strength (0-255)
   * @param highFreq - High frequency rumble strength (0-255)
   * @param duration - Duration in milliseconds
   */
  vibrate(lowFreq: number, highFreq: number, duration: number): void {
    if (!this.config.vibrationEnabled) return
    if (this.gamepadIndex === null) return

    const gamepad = navigator.getGamepads()[this.gamepadIndex]
    if (!gamepad?.vibrationActuator) return

    // Clamp values to valid range
    const weakMag = Math.max(0, Math.min(highFreq / 255, 1))
    const strongMag = Math.max(0, Math.min(lowFreq / 255, 1))

    gamepad.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: duration,
      weakMagnitude: weakMag,
      strongMagnitude: strongMag
    }).catch(() => {
      // Ignore vibration errors (some controllers don't support it well)
    })
  }

  /**
   * Haptic feedback for flipper activation
   * Short high-frequency burst
   */
  flipperFeedback(): void {
    this.vibrate(0, 180, 50)
  }

  /**
   * Haptic feedback for bumper hits
   * Low frequency thud based on intensity
   * @param intensity - Hit intensity (0-1)
   */
  bumperFeedback(intensity: number): void {
    const low = Math.min(intensity * 2 * 255, 255)
    this.vibrate(low, 50, 100)
  }

  /**
   * Haptic feedback for ball launch
   * Medium burst with mixed frequencies
   */
  plungerFeedback(): void {
    this.vibrate(150, 100, 80)
  }

  /**
   * Haptic feedback for nudge
   * Short sharp pulse
   */
  nudgeFeedback(): void {
    this.vibrate(100, 100, 40)
  }

  /**
   * Check if a gamepad is currently connected
   */
  isConnected(): boolean {
    return this.gamepadIndex !== null
  }

  /**
   * Get the connected gamepad ID (if any)
   */
  getGamepadId(): string | null {
    if (this.gamepadIndex === null) return null
    const gamepad = navigator.getGamepads()[this.gamepadIndex]
    return gamepad?.id ?? null
  }

  /**
   * Update configuration at runtime
   */
  setConfig(config: Partial<GamepadConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): GamepadConfig {
    return { ...this.config }
  }
}
