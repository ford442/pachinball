/**
 * Accessibility Configuration
 * 
 * CRITICAL SAFETY FIXES:
 * - Seizure prevention: Flash frequency capped at 2Hz (was 60Hz)
 * - Motion sickness prevention: Camera shake capped at 0.08 (was 0.15)
 * - Reduced motion: Auto-detects prefers-reduced-motion media query
 */

export interface AccessibilityConfig {
  /** Whether reduced motion mode is active */
  reducedMotion: boolean
  /** Whether camera shake effects are enabled */
  cameraShakeEnabled: boolean
  /** Maximum flash frequency in Hz (safety cap at 2Hz for seizure prevention) */
  flashFrequencyMax: number
  /** Scanline effect intensity (0-1) */
  scanlineIntensity: number
  /** General effect intensity multiplier (0-1) */
  effectIntensity: number
  /** Maximum camera shake intensity (safety cap at 0.08) */
  maxCameraShakeIntensity: number
  /** Whether haptic feedback is enabled */
  hapticsEnabled: boolean
  /** Haptic intensity multiplier (0.0 to 2.0) */
  hapticIntensity: number
}

/** Default accessibility settings for typical users */
export const DEFAULT_ACCESSIBILITY: AccessibilityConfig = {
  reducedMotion: false,
  cameraShakeEnabled: true,
  flashFrequencyMax: 2,  // CRITICAL: Capped at 2Hz for seizure safety
  scanlineIntensity: 0.25,
  effectIntensity: 1.0,
  maxCameraShakeIntensity: 0.08,  // CRITICAL: Capped at 0.08 for motion safety
  hapticsEnabled: true,
  hapticIntensity: 1.0
}

/** Accessibility settings for users who prefer reduced motion */
export const REDUCED_MOTION_CONFIG: AccessibilityConfig = {
  reducedMotion: true,
  cameraShakeEnabled: false,
  flashFrequencyMax: 1,  // Even slower flashes in reduced motion mode
  scanlineIntensity: 0.0,  // Disable scanlines
  effectIntensity: 0.3,   // Reduce all effects
  maxCameraShakeIntensity: 0.0,  // Disable shake entirely
  hapticsEnabled: false,  // Disabled for reduced motion
  hapticIntensity: 0.5
}

/**
 * Auto-detect accessibility preferences from system settings
 * Uses prefers-reduced-motion media query
 */
export function detectAccessibility(): AccessibilityConfig {
  if (typeof window === 'undefined') return DEFAULT_ACCESSIBILITY
  
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return prefersReducedMotion ? REDUCED_MOTION_CONFIG : DEFAULT_ACCESSIBILITY
}

/**
 * Merge user settings with accessibility config
 * Ensures safety caps are always enforced
 */
export function mergeAccessibilityConfig(
  userSettings: Partial<AccessibilityConfig>
): AccessibilityConfig {
  const base = userSettings.reducedMotion ? REDUCED_MOTION_CONFIG : DEFAULT_ACCESSIBILITY
  
  return {
    ...base,
    ...userSettings,
    // CRITICAL: Always enforce safety caps regardless of user settings
    flashFrequencyMax: Math.min(userSettings.flashFrequencyMax ?? base.flashFrequencyMax, 2),
    maxCameraShakeIntensity: Math.min(userSettings.maxCameraShakeIntensity ?? base.maxCameraShakeIntensity, 0.08)
  }
}
