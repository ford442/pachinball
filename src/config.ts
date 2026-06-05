// src/config.ts

// Pure config - no Babylon.js dependencies

/**
 * Ball Type Enumeration
 * Defines the three tiers of collectible balls in the game
 */
export enum BallType {
  STANDARD = 'standard',
  GOLD_PLATED = 'gold_plated',
  SOLID_GOLD = 'solid_gold'
}

/**
 * Ball Spawn Configuration
 * Central configuration for ball spawning weights, points, and fever multipliers
 */
export const BALL_SPAWN_CONFIG = {
  // Spawn weights (must sum to <= 1.0)
  weights: {
    [BallType.STANDARD]: 0.75,      // 75% standard
    [BallType.GOLD_PLATED]: 0.20,   // 20% gold-plated
    [BallType.SOLID_GOLD]: 0.05     // 5% solid gold
  },
  
  // Points awarded on collection
  points: {
    [BallType.STANDARD]: 0,
    [BallType.GOLD_PLATED]: 1000,
    [BallType.SOLID_GOLD]: 5000
  },
  
  // Multipliers during fever mode
  feverMultipliers: {
    [BallType.STANDARD]: 1,
    [BallType.GOLD_PLATED]: 2,
    [BallType.SOLID_GOLD]: 5
  }
} as const

/**
 * Gold Ball Bonus Thresholds
 * Defines bonus and jackpot thresholds for collecting gold balls
 */
export const GOLD_BALL_THRESHOLDS = {
  firstBonus: 5,      // 5 gold balls = bonus
  jackpot: 10         // 10 gold balls = jackpot
}

/**
 * Ball Tier Configuration Interface
 * Complete configuration for each ball type including material and effect mapping
 */
export interface BallTierConfig {
  type: BallType
  spawnWeight: number
  basePoints: number
  bonusMultiplier: number
  materialKey: string
  trailColor: string
  collectEffect: string
}

/**
 * Ball Tiers Record
 * Complete tier configuration for all ball types
 */
export const BALL_TIERS: Record<BallType, BallTierConfig> = {
  [BallType.STANDARD]: {
    type: BallType.STANDARD,
    spawnWeight: 0.75,
    basePoints: 0,
    bonusMultiplier: 1,
    materialKey: 'enhancedChrome',
    trailColor: '#00ffff',
    collectEffect: 'standardCollect'
  },
  [BallType.GOLD_PLATED]: {
    type: BallType.GOLD_PLATED,
    spawnWeight: 0.20,
    basePoints: 1000,
    bonusMultiplier: 2,
    materialKey: 'goldPlated',
    trailColor: '#ffd700',
    collectEffect: 'goldCollect'
  },
  [BallType.SOLID_GOLD]: {
    type: BallType.SOLID_GOLD,
    spawnWeight: 0.05,
    basePoints: 5000,
    bonusMultiplier: 5,
    materialKey: 'solidGold',
    trailColor: '#ffb700',
    collectEffect: 'jackpot'
  }
}

/**
 * API Configuration - Backend storage manager URL
 * Uses storage.noahcohn.com as the canonical backend
 */
const DEV_API_BASE = 'http://localhost:8000/api'
const PROD_API_BASE = 'https://storage.noahcohn.com/api'
const DEV_ASSET_BASE = 'http://localhost:8000'
const PROD_ASSET_BASE = 'https://storage.noahcohn.com'

/**
 * API Base URL for backend API calls
 * Allow VITE_API_URL override, otherwise use prod/dev logic
 */
export const API_BASE = import.meta.env.VITE_API_URL as string | undefined
  || (import.meta.env.PROD ? PROD_API_BASE : DEV_API_BASE)

/**
 * Asset Base URL for static files (videos, images, shaders)
 * Allow VITE_ASSET_URL override, otherwise use prod/dev logic
 */
export const ASSET_BASE = import.meta.env.VITE_ASSET_URL as string | undefined
  || (import.meta.env.PROD ? PROD_ASSET_BASE : DEV_ASSET_BASE)

/**
 * Helper to make API calls with exponential backoff retry logic.
 */
export async function apiFetch<T>(
  endpoint = '',
  options: RequestInit = {}
): Promise<T | null> {
  const trimmedEndpoint = endpoint.trim()
  const resolvedUrl = /^https?:\/\//i.test(trimmedEndpoint)
    ? trimmedEndpoint
    : `${API_BASE}${trimmedEndpoint.startsWith('/') ? trimmedEndpoint : `/${trimmedEndpoint}`}`

  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(resolvedUrl, {
        headers: {
          Accept: 'application/json',
          ...(options.headers ?? {}),
        },
        ...options,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      }

      if (response.status === 204) {
        return null
      }

      return await response.json() as T
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn(`[apiFetch] Request failed for ${resolvedUrl}`, error)
        return null
      }

      const delayMs = 250 * 2 ** (attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return null
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

export interface GameTuning {
  scoring: {
    bumperHitBase: number
    targetHitBase: number
    jackpotBonus: number
    adventureEndBonus: number
  }
  combo: {
    feverThreshold: number
    expirySeconds: number
    multiplierDivisor: number
    chainWindowSeconds: number
    chainDistinctThreshold: number
    chainMultiplier: number
    chainCooldownSeconds: number
    namedChains: Array<{
      name: string
      sequence: string[]
      bonusPoints: number
      multiplierBonus: number
    }>
  }
  timing: {
    nudgeCooldownMs: number
    storyVideoWaitMs: number
    tiltBloomResetMs: number
    idleCallbackTimeoutMs: number
    cosmeticFallbackDelayMs: number
  }
  multiball: {
    maxChainBalls: number
    multiplierPerExtraBall: number
    triggerGoldThresholds: number[]
    drainGraceMs: number
  }
  feedback: {
    comboWindowSeconds: number
    comboHitsPerMultiplier: number
    comboMaxMultiplier: number
    ballSaveGraceSeconds: number
    bonusTallyComboPeakBase: number
    bonusTallyAnimationMs: number
  }
}

export const GAME_TUNING = {
  scoring: {
    bumperHitBase: 10,
    targetHitBase: 100,
    jackpotBonus: 100000,
    adventureEndBonus: 5000,
  },
  combo: {
    feverThreshold: 10,
    expirySeconds: 1.5,
    multiplierDivisor: 3,
    chainWindowSeconds: 4,
    chainDistinctThreshold: 3,
    chainMultiplier: 1.5,
    chainCooldownSeconds: 0.8,
    namedChains: [
      {
        name: 'SPIN LAUNCH SLAM',
        sequence: ['spinner', 'launcher', 'bumper'],
        bonusPoints: 250,
        multiplierBonus: 0.2,
      },
      {
        name: 'LOCK BREAKER',
        sequence: ['gate', 'trap', 'bumper'],
        bonusPoints: 180,
        multiplierBonus: 0.15,
      },
    ],
  },
  timing: {
    nudgeCooldownMs: 500,
    storyVideoWaitMs: 3000,
    tiltBloomResetMs: 1000,
    idleCallbackTimeoutMs: 500,
    cosmeticFallbackDelayMs: 100,
  },
  multiball: {
    maxChainBalls: 3,
    multiplierPerExtraBall: 0.35,
    triggerGoldThresholds: [GOLD_BALL_THRESHOLDS.jackpot, GOLD_BALL_THRESHOLDS.jackpot * 2],
    drainGraceMs: 4000,
  },
  feedback: {
    comboWindowSeconds: 2.5,
    comboHitsPerMultiplier: 2,
    comboMaxMultiplier: 5,
    ballSaveGraceSeconds: 7,
    bonusTallyComboPeakBase: 250,
    bonusTallyAnimationMs: 1500,
  },
} as const satisfies GameTuning

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
    particleIntensity: 1.0,
    cameraFollowTransitionSpeed: 3.0,
    scanlineIntensity: 0.12,
    fogDensity: 0.015,
    mirrorSizeHigh: 2048,
    mirrorSizeMedium: 1024,
    mirrorTextureLevel: 0.6,
    skyboxSize: 200.0,
    uMapBlend: 0.5,
  },
  physics: {
    ballRestitution: 0.78,
    ballFriction: 0.12,
    bumperRestitution: 0.92, // Increased for snappier bounce and "pop"
    // Surface-specific physics for advanced ball mechanics
    surfaces: {
      bumper: { restitution: 0.95, friction: 0.05 }, // High bounce, low grip
      flipper: { restitution: 0.88, friction: 0.1 },  // Controlled energy return
      wall: { restitution: 0.82, friction: 0.15 },    // Medium bounce, some grip
      playfield: { restitution: 0.72, friction: 0.18 }, // Low bounce, higher grip
      rail: { restitution: 0.85, friction: 0.08 },    // Smooth guidance
    },
    // Spin physics
    spinTransferFactor: 0.35, // How much collision applies spin (0-1)
    spinDecayFactor: 0.12,   // How quickly spin decays over time
    englishSpinAmount: 0.08, // Side spin from angled hits (radians/sec)
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

  smallGoldBalls: {
    // Enable small gold ball swarms instead of single heavy balls
    enabled: true,
    // Number of small balls to spawn per gold ball trigger
    swarmSize: 4,
    // Size multiplier for small balls (0.0–1.0 of normal ball size)
    sizeMultiplier: 0.5,
    // Mass multiplier (lighter for more chaotic behavior)
    massMultiplier: 0.35,
    // Physics for small gold balls
    restitution: 0.92,     // Bouncier than regular balls
    friction: 0.08,        // Lower friction for faster movement
    linearDamping: 0.05,   // Less damping for longer flights
    angularDamping: 0.10,  // Less spin decay
    // Spawn spread velocity range (m/s)
    spawnVelocityMin: 3.0,
    spawnVelocityMax: 8.0,
    // Lifetime before auto-despawn (seconds)
    lifetime: 15.0,
    // Maximum concurrent swarms (safety limit)
    maxConcurrentBalls: 20,
    // Points per small ball
    basePoints: 300,
    // Bonus multiplier if all collected quickly
    quickCollectBonusWindow: 5.0, // seconds
    quickCollectMultiplier: 1.5,
  },

  plunger: {
    /** @deprecated Use minImpulse/maxImpulse for analog charge instead */
    impulse: 22,
    /** Max charge time in milliseconds to reach full power */
    maxChargeTime: 1500,
    /** Minimum impulse magnitude (instant tap) */
    minImpulse: 12,
    /** Maximum impulse magnitude (full charge) */
    maxImpulse: 38,
    /** Visual pullback distance for plunger animation */
    maxPullbackDistance: 2.0,
    /** How far past rest the plunger overshoots on release (visual spring effect, world units) */
    launchForwardDistance: 0.5,
    /** Duration of plunger spring-forward animation in seconds */
    launchAnimDuration: 0.07,
    /** Duration of plunger return-to-rest animation in seconds */
    returnAnimDuration: 0.18,
  },

  nudge: {
    force: 0.6,           // Base nudge force
    verticalBoost: 0.3,   // Slight upward component
    maxTiltWarnings: 3,   // Warnings before tilt
    tiltDecayTime: 2000,  // Milliseconds to decay warning
    tiltPenaltyTime: 3000, // Milliseconds tilt stays active
  },

  flipper: {
// Flipper physics tuning — extracted from game-input-actions.ts
    // Motor angles (radians)
    restAngle: Math.PI / 4,        // 45° — flipper at rest
    activeAngle: Math.PI / 8,      // 22.5° — flipper raised
    // Impulse variation on hit
    kickVariation: 0.15,
    // Damping for motor control
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
    
    // Path to looped attract video (can be relative or absolute URL)
    // Set to '' to disable video and use image or reels
    // Supported formats: mp4, webm (mp4 recommended for compatibility)
    // Uses ASSET_BASE for remote assets or local paths for bundled files
    get attractVideoPath(): string {
      return `${ASSET_BASE}/pachinball/backbox/attract.mp4`
    },
    
    // If true, video replaces reels completely (reels hidden when video plays)
    // If false, video overlays reels (reels visible behind video)
    videoReplacesReels: true,
    
    // Path to static attract image (can be relative or absolute URL)
    // Used as fallback if video fails or isn't configured
    // Set to '' to disable image and use reels only
    get attractImagePath(): string {
      return `${ASSET_BASE}/pachinball/backbox/attract.png`
    },
    
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
    get jackpotVideoPath(): string {
      return `${ASSET_BASE}/pachinball/backbox/jackpot.mp4`
    },
    get feverVideoPath(): string {
      return `${ASSET_BASE}/pachinball/backbox/fever.mp4`
    },
    get reachVideoPath(): string {
      return `${ASSET_BASE}/pachinball/backbox/reach.mp4`
    },
    get adventureVideoPath(): string {
      return `${ASSET_BASE}/pachinball/backbox/adventure.mp4`
    },

    // State-specific image fallbacks
    get jackpotImagePath(): string {
      return `${ASSET_BASE}/pachinball/backbox/jackpot.png`
    },
    get feverImagePath(): string {
      return `${ASSET_BASE}/pachinball/backbox/fever.png`
    },
    get reachImagePath(): string {
      return `${ASSET_BASE}/pachinball/backbox/reach.png`
    },
    get adventureImagePath(): string {
      return `${ASSET_BASE}/pachinball/backbox/adventure.png`
    },
  }
}

export type GameConfigType = typeof GameConfig

/**
 * PhysicsConfig — Centralized physics tunables extracted from game.ts monolith
 * All scalar values; Vector3 construction stays in implementation files
 */
export const PhysicsConfig = {
  global: {
    gravity: { x: 0, y: -9.81, z: -5.0 },
    spinTransferFactor: 0.35,
    spinDecayFactor: 0.12,
    englishSpinAmount: 0.08,
  },
  ball: {
    radius: 0.25,
    mass: 1.0,
    restitution: 0.78,
    friction: 0.12,
    linearDamping: 0.08,
    angularDamping: 0.15,
    resetImpulse: { x: 0, y: 0, z: 2.5 },
  },
  flipper: {
    stiffness: 25000,
    damping: 1000,
    restAngleRad: Math.PI / 4,
    activeAngleRad: Math.PI / 8,
    kickVariation: 0.15,
    holdTimeDivisor: 0.3,
    leftLimits: [-Math.PI / 6, Math.PI / 4] as [number, number],
    rightLimits: [-Math.PI / 4, Math.PI / 6] as [number, number],
    restitution: 0.88,
    friction: 0.1,
  },
  bumper: {
    restitution: 0.92,
  },
  plunger: {
    minImpulse: 10,
    maxImpulse: 35,
    maxChargeTimeMs: 1500,
  },
  nudge: {
    force: 0.6,
    verticalBoost: 0.3,
    vectorLeft: { x: -0.6, y: 0, z: 0.3 },
    vectorRight: { x: 0.6, y: 0, z: 0.3 },
    vectorForward: { x: 0, y: 0, z: 0.8 },
  },
  input: {
    gamepadDeadZone: 0.15,
    nudgeThreshold: 0.5,
    nudgeDeltaThreshold: 0.2,
  },
  toys: {
    gateAmplitude: 2.0,
    gateSpeed: 1.5,
  },
} as const

export type PhysicsConfigType = typeof PhysicsConfig
