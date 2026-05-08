/**
 * Camera easing utilities for cinematic adventure mode transitions
 */

/**
 * Easing function collection for smooth camera transitions
 */
export const CameraEasing = {
  /**
   * Linear interpolation (no easing)
   */
  linear: (t: number): number => t,

  /**
   * Ease-in-out cubic: slow at start and end, fast in middle
   * Great for general camera movements
   */
  easeInOutCubic: (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  },

  /**
   * Ease-out cubic: quick start, slow end
   * Perfect for entry transitions
   */
  easeOutCubic: (t: number): number => {
    return 1 - Math.pow(1 - t, 3)
  },

  /**
   * Ease-in cubic: slow start, quick end
   * Good for exit transitions
   */
  easeInCubic: (t: number): number => {
    return t * t * t
  },

  /**
   * Ease-out quad: quick start, moderate slow end
   * Good for responsive camera tracking
   */
  easeOutQuad: (t: number): number => {
    return 1 - (1 - t) * (1 - t)
  },

  /**
   * Ease-in-out elastic: bouncy, cinematic feel
   * For dramatic zone transitions
   */
  easeInOutElastic: (t: number): number => {
    const c5 = (2 * Math.PI) / 4.5
    return t === 0
      ? 0
      : t === 1
      ? 1
      : t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((t * 40 - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((t * 40 - 11.125) * c5)) / 2 + 1
  },

  /**
   * Ease-out back: slight overshoot at end
   * For snappy, responsive transitions
   */
  easeOutBack: (t: number): number => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
}

/**
 * Smooth camera value with easing
 * @param current Current value
 * @param target Target value
 * @param speed Speed factor (0-1, where 1 = instant)
 * @param easing Easing function to use
 * @returns Interpolated value
 */
export function lerpWithEasing(
  current: number,
  target: number,
  speed: number,
  easing: (t: number) => number = CameraEasing.easeInOutCubic
): number {
  const clamped = Math.min(1, Math.max(0, speed))
  const easedSpeed = easing(clamped)
  return current + (target - current) * easedSpeed
}

/**
 * Smooth camera value with exponential decay (traditional game camera feel)
 * @param current Current value
 * @param target Target value
 * @param decay Decay rate (0-1, where 0 = no change, 1 = instant)
 * @returns Interpolated value
 */
export function lerpExponential(current: number, target: number, decay: number): number {
  return current + (target - current) * Math.min(1, decay)
}
