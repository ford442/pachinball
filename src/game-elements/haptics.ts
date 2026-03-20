/**
 * Haptic Feedback System
 * 
 * Web Vibration API support for tactile feedback on mobile devices.
 * Provides haptic feedback for flipper activation, bumper impacts, and plunger release.
 */

export interface HapticConfig {
  /** Whether haptic feedback is enabled */
  enabled: boolean
  /** Intensity multiplier (0.0 to 2.0) */
  intensity: number
}

export class HapticManager {
  private config: HapticConfig

  constructor(config: HapticConfig = { enabled: true, intensity: 1.0 }) {
    this.config = config
  }

  /**
   * Update the haptic configuration
   */
  setConfig(config: HapticConfig): void {
    this.config = config
  }

  /**
   * Check if haptics are supported on this device
   */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  }

  /**
   * Trigger a haptic vibration pattern
   * @param pattern - Single duration in ms, or array of on/off durations
   */
  trigger(pattern: number | number[]): void {
    if (!this.config.enabled) return
    if (!this.isSupported()) return

    // Scale pattern by intensity
    const scaled = Array.isArray(pattern)
      ? pattern.map(d => Math.max(1, Math.floor(d * this.config.intensity)))
      : Math.max(1, Math.floor(pattern * this.config.intensity))

    try {
      navigator.vibrate(scaled)
    } catch {
      // Silently fail if vibration API fails
    }
  }

  /**
   * Stop any ongoing vibration
   */
  stop(): void {
    if (!this.isSupported()) return
    try {
      navigator.vibrate(0)
    } catch {
      // Silently fail
    }
  }

  /**
   * Flipper activation - sharp 15ms tap
   */
  flipper(): void {
    this.trigger(15)
  }

  /**
   * Bumper impact - intensity based on collision force
   * @param impulseMagnitude - The collision force magnitude
   */
  bumper(impulseMagnitude: number): void {
    const maxVibration = 50
    const minVibration = 10
    const clamped = Math.min(impulseMagnitude, 30)
    const intensity = Math.floor((clamped / 30) * maxVibration) + minVibration

    // Sharp impact pattern: on, gap, decay
    this.trigger([intensity, 5, Math.floor(intensity / 2)])
  }

  /**
   * Plunger release - spring tension pattern
   */
  plunger(): void {
    // Wind-up, gap, launch
    this.trigger([30, 10, 60])
  }

  /**
   * Tilt warning - rumble pattern
   */
  tiltWarning(): void {
    this.trigger([20, 10, 20, 10, 20, 10, 20])
  }

  /**
   * Nudge feedback - directional or upward impulse
   * @param direction - Direction of the nudge
   */
  nudge(direction: 'left' | 'right' | 'up'): void {
    const pattern = direction === 'up' 
      ? [20, 5, 20]  // Quick double for up
      : [15, 8, 12]  // Asymmetric for directional
    this.trigger(pattern)
  }

  /**
   * Jackpot celebration - intense rumble pattern
   */
  jackpot(): void {
    // Strong, rhythmic celebration pattern
    this.trigger([40, 15, 40, 15, 60, 30, 40, 15, 40])
  }

  /**
   * Ball captured - subtle confirmation
   */
  ballCaptured(): void {
    this.trigger([10, 20, 10])
  }

  /**
   * Ball lost - short failure pattern
   */
  ballLost(): void {
    this.trigger([30, 30, 30])
  }
}
