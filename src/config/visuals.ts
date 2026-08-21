/**
 * Effects Configuration - Feature flags and performance settings
 * for visual effect enhancements. All new effects are opt-in and
 * can be disabled for performance or compatibility.
 */
export const EffectsConfig = {
  // Master toggle - disable all enhanced effects
  enableEnhancedEffects: true,

  // Force simple fallback rendering (disables all new effects)
  enableFallbackMode: false,

  // Tier 1 Enhancements - High impact, low risk
  enableEnhancedBumperImpact: true,
  enableFeverTrail: true,
  enableStateTransitionFlashes: true,

  // Tier 2 Enhancements - Medium impact (future)
  enableEnvironmentalPulse: false,
  enableCollisionSparkVariants: false,
  enableJackpotCrescendo: false,

  // Screen shake settings
  screenShake: {
    enabled: true,
    intensity: {
      light: 0.01,
      medium: 0.025,
      heavy: 0.05
    },
    decay: 0.9,
    maxDuration: 0.5
  },

  // Bumper impact settings
  bumperImpact: {
    bloomEnergy: {
      light: 1.5,
      medium: 2.5,
      heavy: 4.0
    },
    rippleRingCount: 3,
    particleCount: 12
  },

  // Fever trail settings
  feverTrail: {
    spawnRate: 0.05,      // seconds between particles
    lifetime: 0.5,        // seconds per particle
    maxParticlesPerBall: 50,
    color: '#ffd700',     // PALETTE.GOLD
    intensity: 1.5        // INTENSITY.HIGH
  },

  // State transition flash settings
  transitionFlash: {
    duration: 0.3,
    maxOpacity: 0.6
  },

  // Performance limits and auto-optimization
  performance: {
    maxParticlesPerEffect: 30,
    maxConcurrentEffects: 15,
    enableLOD: true,
    lowFpsThreshold: 55,
    autoDisableOnLowFps: true,
    fpsCheckInterval: 2.0  // seconds
  }
} as const
