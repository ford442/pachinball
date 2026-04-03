// src/config.ts

// Pure config - no Babylon.js dependencies

/**
 * API Configuration - Backend storage manager URL
 * Uses production URL in production builds, localhost in development
 */
export const API_BASE = import.meta.env.PROD 
  ? 'https://test.1ink.us:8000/api'
  : 'http://localhost:8000/api'

/**
 * Helper to make API calls with automatic fallback handling
 */
export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  try {
    const url = `${API_BASE}${endpoint}`
    const response = await fetch(url, options)
    if (!response.ok) {
      console.warn(`[API] ${endpoint} returned ${response.status}`)
      return null
    }
    return await response.json() as T
  } catch (err) {
    console.warn(`[API] Failed to fetch ${endpoint}:`, err)
    return null
  }
}

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

export const GameConfig = {
  magSpin: {
    // Moved to Upper Right (between Pachinko Field and Wall)
    // Pachinko ends at x=7, Wall at x=11.5. Center at 9.25 fits a 3.5 diameter unit.
    feederPosition: { x: 9.25, y: 0.5, z: 12 },
    catchRadius: 1.5,
    spinDuration: 1.2,
    cooldown: 3.0,
    releaseForce: 25.0,
    releaseAngleVariance: 0.25
  },
  nanoLoom: {
    loomPosition: { x: -13.0, y: 4.0, z: 2.0 },
    intakePosition: { x: -12.0, y: 0.5, z: 2.0 },
    width: 2.0,
    height: 6.0,
    depth: 1.0,
    pinRows: 8,
    pinCols: 4,
    pinSpacing: 0.6,
    pinBounciness: 0.8,
    liftDuration: 1.5
  },
  prismCore: {
    prismPosition: { x: 0.0, y: 0.5, z: 12.0 },
    captureRadius: 1.2,
    ejectForce: 20.0,
    ejectSpread: 45 // degrees
  },
  gaussCannon: {
    gaussPosition: { x: -12.0, y: 0.5, z: -8.0 },
    intakeRadius: 1.0,
    muzzleVelocity: 30.0,
    minAngle: 30, // degrees
    maxAngle: 60, // degrees
    sweepSpeed: 1.0, // radians/sec
    cooldown: 2.0 // seconds
  },
  quantumTunnel: {
    inputPosition: { x: 11.5, y: 0.5, z: 0.0 },
    outputPosition: { x: -11.5, y: 0.5, z: 0.0 },
    inputRadius: 1.2,
    ejectImpulse: 25.0,
    transportDelay: 0.5,
    cooldown: 2.0
  },
  visuals: {
    enableParticles: true,
    enableTrails: true,
    particleIntensity: 1.0
  },
  physics: {
    ballRestitution: 0.78,
    ballFriction: 0.12,
    bumperRestitution: 0.85,
    // REMOVED: flipperPower (Legacy/Unused)
    gravity: { x: 0, y: -9.81, z: -5.0 }
  },
  gameplay: {
    maxBalls: 3,
    targetRespawnTime: 5.0,
    bumperPoints: 100,
    targetPoints: 500,
    slingshotPoints: 50
  },

  table: {
    width: 28,
    height: 36,
    wallHeight: 4,
    wallThickness: 2,
    // The inner wall that guides the ball from the plunger
    // Shortened to 20 to ensure ball exits before hitting the top corner wedge
    laneGuideLength: 20,
    laneGuideZ: -1,

    // Wedge Parameters
    wedgeSize: 8,
    wedgeThickness: 0.5,

    // THE SOURCE OF TRUTH:
    flipperStrength: 25000
  },

  ball: {
    radius: 0.25,
    mass: 1.0,
    friction: 0.12,        // Slightly higher friction for better control
    restitution: 0.78,     // Balanced bounciness (0.75-0.85 range)
    linearDamping: 0.08,   // Natural roll decay for realistic ball motion
    angularDamping: 0.15,  // Spin decay for realistic ball rotation
    // Plain Objects for Spawn Points
    spawnMain: { x: 10.5, y: 0.5, z: -9 },
    spawnPachinko: { x: 0, y: 5, z: -10 }, // Ported from original
    spawnDrop: { x: 0, y: 5, z: 8 },
  },

  plunger: {
    /** @deprecated Use minImpulse/maxImpulse for analog charge instead */
    impulse: 22,
    /** Max charge time in milliseconds to reach full power */
    maxChargeTime: 1500,
    /** Minimum impulse magnitude (instant tap) */
    minImpulse: 10,
    /** Maximum impulse magnitude (full charge) */
    maxImpulse: 35,
    /** Visual pullback distance for plunger animation */
    maxPullbackDistance: 2.0,
  },

  nudge: {
    force: 0.6,           // Base nudge force
    verticalBoost: 0.3,   // Slight upward component
    maxTiltWarnings: 3,   // Warnings before tilt
    tiltDecayTime: 2000,  // Milliseconds to decay warning
    tiltPenaltyTime: 3000, // Milliseconds tilt stays active
  },

  flipper: {
    // REMOVED: strength (Legacy/Unused) - We use table.flipperStrength now
    damping: 1000,
  },

  camera: {
    shakeIntensity: 0.08,
    reducedMotion: false,
    maxShakeIntensity: 0.10, // Hard safety limit
    safeFlashFrequency: 3,   // Hz
  },

  accessibility: {
    photosensitiveMode: false, // Disables all flashing
    highContrast: false,
    largeText: false
  },

  // Backbox display configuration
  backbox: {
    // PATH PRIORITY: Video > Image > Reels (procedural)
    // If video is configured and loads, it takes precedence
    // If video fails, falls back to image
    // If image fails or not configured, falls back to reels
    
    // Path to looped attract video (relative to public/)
    // Set to '' to disable video and use image or reels
    // Example: '/backbox/attract.mp4' loads public/backbox/attract.mp4
    // Supported formats: mp4, webm (mp4 recommended for compatibility)
    attractVideoPath: './backbox/attract.mp4',
    
    // If true, video replaces reels completely (reels hidden when video plays)
    // If false, video overlays reels (reels visible behind video)
    videoReplacesReels: true,
    
    // Path to static attract image (relative to public/)
    // Used as fallback if video fails or isn't configured
    // Set to '' to disable image and use reels only
    attractImagePath: './backbox/attract.png',
    
    // Opacity of the image layer (0.0 = invisible, 1.0 = fully opaque)
    // Lower values let the animated grid/reels show through
    imageOpacity: 0.85,
    
    // Blend mode for image: 'normal' | 'additive' | 'multiply'
    // 'normal' - standard alpha blending
    // 'additive' - brightens, good for neon/dark images  
    // 'multiply' - darkens, good for light images
    imageBlendMode: 'normal' as const,

    // State-specific video clips that play on game events
    // Set to '' to disable state-specific video and use attract/default
    jackpotVideoPath: './backbox/jackpot.mp4',
    feverVideoPath: './backbox/fever.mp4',
    reachVideoPath: './backbox/reach.mp4',
    adventureVideoPath: './backbox/adventure.mp4',

    // State-specific image fallbacks
    jackpotImagePath: './backbox/jackpot.png',
    feverImagePath: './backbox/fever.png',
    reachImagePath: './backbox/reach.png',
    adventureImagePath: './backbox/adventure.png',
  }
}

export type GameConfigType = typeof GameConfig
