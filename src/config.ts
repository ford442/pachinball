// src/config.ts

import { SlotActivationMode, SlotSymbol, type SlotMachineConfig } from './display/slot-types'

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
 * Slot Machine Configuration
 * 3 reels, 6 symbols, weighted spawns, config-driven payouts.
 * Used by the backbox slot mini-game activated on REACH / FEVER.
 */
export const SLOT_MACHINE_CONFIG: SlotMachineConfig = {
  activationMode: SlotActivationMode.HYBRID,
  chancePercent: 0.3,
  scoreThreshold: 10000,
  minSpinDuration: 1.0,
  maxSpinDuration: 3.0,
  reels: [
    { baseSpeed: 8, speedVariance: 2, stopDelay: 0 },
    { baseSpeed: 10, speedVariance: 3, stopDelay: 0.2 },
    { baseSpeed: 6, speedVariance: 1.5, stopDelay: 0.4 },
  ],
  symbols: [
    SlotSymbol.SEVEN,
    SlotSymbol.DIAMOND,
    SlotSymbol.BELL,
    SlotSymbol.CHERRY,
    SlotSymbol.GRAPE,
    SlotSymbol.STAR,
  ],
  symbolWeights: {
    [SlotSymbol.SEVEN]: 0.06,
    [SlotSymbol.DIAMOND]: 0.12,
    [SlotSymbol.BELL]: 0.18,
    [SlotSymbol.CHERRY]: 0.22,
    [SlotSymbol.GRAPE]: 0.21,
    [SlotSymbol.STAR]: 0.21,
  },
  winCombinations: [
    {
      name: 'Triple Seven',
      symbol: SlotSymbol.SEVEN,
      matchCount: 3,
      multiplier: 10,
      points: 100000,
      isJackpot: true,
    },
    {
      name: 'Diamond Rush',
      symbol: SlotSymbol.DIAMOND,
      matchCount: 3,
      multiplier: 5,
      points: 500,
      isJackpot: false,
    },
    {
      name: 'Lucky Bells',
      symbol: SlotSymbol.BELL,
      matchCount: 3,
      multiplier: 3,
      points: 300,
      isJackpot: false,
    },
    {
      name: 'Cherry Pick',
      symbol: SlotSymbol.CHERRY,
      matchCount: 3,
      multiplier: 2,
      points: 200,
      isJackpot: false,
    },
    {
      name: 'Double Seven',
      symbol: SlotSymbol.SEVEN,
      matchCount: 2,
      multiplier: 2,
      points: 200,
      isJackpot: false,
    },
  ],
  basePoints: 100,
  jackpotPoints: 100000,
  cooldownSeconds: 4.0,
  enableSounds: true,
  enableLightEffects: true,
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
  obstacle: {
    spinnerHitBase: number
    trapCatchBase: number
    trapReleaseBase: number
    trapTimeoutReleaseBase: number
    launcherFireBase: number
    launcherTriggerBase: number
    gateOpenBase: number
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
  /**
   * Gold ball streak bonus.  Consecutive collections within `windowSeconds`
   * earn an escalating multiplier on top of each ball's base points.
   * See GoldBallStreakSystem for implementation.
   */
  goldBall: {
    streakWindowSeconds: number
    streakPerBallBonus: number
    streakMaxMultiplier: number
  }
}

export const GAME_TUNING = {
  scoring: {
    // 100 pts per bumper hit at 1× combo.  At ~3 hits/sec average, the player
    // earns ~300 pts/sec base — climbing to ~900 pts/sec at 3× combo.  This
    // puts NEON_HELIX's 50 000-point goal comfortably within its 120-second
    // window while still requiring consistent play.  Adjust this value first
    // if tracks feel too easy or too hard.
    bumperHitBase: 100,
    targetHitBase: 500,
    jackpotBonus: 100000,
    adventureEndBonus: 5000,
  },
  obstacle: {
    spinnerHitBase: 150,
    trapCatchBase: 75,
    trapReleaseBase: 200,
    trapTimeoutReleaseBase: 120,
    launcherFireBase: 60,
    launcherTriggerBase: 90,
    gateOpenBase: 35,
  },
  combo: {
    feverThreshold: 12,
    expirySeconds: 2.0,
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
    nudgeCooldownMs: 450,
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
    comboWindowSeconds: 2.8,
    comboHitsPerMultiplier: 2,
    comboMaxMultiplier: 6,
    ballSaveGraceSeconds: 7,
    bonusTallyComboPeakBase: 250,
    bonusTallyAnimationMs: 1500,
  },
  goldBall: {
    // Second consecutive gold ball within 5 s earns 1.5×, third 2×, etc., capped at 5×.
    streakWindowSeconds: 5.5,
    streakPerBallBonus: 0.55,
    streakMaxMultiplier: 5,
  },
} as const satisfies GameTuning

/**
 * Behavioral tunables for all five table feeders.
 * Single source of truth — GameConfig aliases these for backward compatibility.
 * Algorithmic constants (2π, deg↔rad) stay inline in feeder implementations.
 */
export const FEEDER_TUNABLES = Object.freeze({
  'mag-spin': {
    // Upper-right wall — between pachinko field (x≈7) and wall (x≈11.5)
    feederPosition: { x: 9.25, y: 0.5, z: 12 },
    catchRadius: 1.5,
    spinDuration: 1.2,
    cooldown: 3.0,
    releaseForce: 25.0,
    releaseAngleVariance: 0.25,
    /** Launch direction target — center playfield bumpers */
    releaseTarget: { x: 0, y: 0, z: 5 },
    catchLerpSpeed: 6,
    catchArrivalDistance: 0.15,
    holdYOffset: 0.5,
    maxCaptureHeightY: 2.0,
    spinAngularSpeed: 32,
    releaseUpwardBias: 0.08,
    animation: {
      ringSpeedSpin: 24,
      ringSpeedIdle: 1,
      ringSpeedDefault: 4,
      ringLerpSpin: 2.5,
      ringLerpDefault: 0.5,
      shakeDecay: 0.88,
      idlePulseFrequency: 1.8,
      idleLightBase: 0.35,
      idleLightPulseAmplitude: 0.35,
      idleEmissiveBase: 0.6,
      idleEmissivePulseAmplitude: 0.4,
      spinChargeLightBase: 1.2,
      spinChargeLightScale: 1.5,
      releaseShakeInitial: 0.6,
      stateLightIdle: 0.5,
      stateLightCatch: 1.0,
      stateLightSpin: 1.5,
      stateLightCooldown: 0.2,
    },
    physicsExtras: {
      releaseSpinVarianceXZ: 8,
      releaseSpinBaseY: 12,
      spinAxisMultiplierY: 1.3,
      spinAxisMultiplierZ: 0.7,
    },
  },
  'nano-loom': {
    loomPosition: { x: -13.0, y: 4.0, z: 2.0 },
    intakePosition: { x: -12.0, y: 0.5, z: 2.0 },
    width: 2.0,
    height: 6.0,
    depth: 1.0,
    pinRows: 8,
    pinCols: 4,
    pinSpacing: 0.6,
    pinBounciness: 0.8,
    liftDuration: 1.5,
    intakeRadius: 1.5,
    liftSpeed: 10.0,
    liftAlignLerpSpeed: 5,
    weaveNudgeImpulse: 0.1,
    ejectImpulse: { x: 8.0, y: 2.0, z: 0.0 },
    ejectCooldown: 1.0,
    animation: {
      liftTopYOffset: 0.5,
      pinActivationRowRadius: 2,
      pinActivationScaleBoost: 0.5,
      pinActivationEmissiveBase: 0.5,
      weaveExitMarginY: 0.5,
      stateLightIdle: 0.2,
      stateLightLift: 1.0,
    },
  },
  'prism-core': {
    prismPosition: { x: 0.0, y: 0.5, z: 12.0 },
    captureRadius: 1.2,
    ejectForce: 20.0,
    ejectSpread: 45,
    lockCapacity: 3,
    postReleaseCooldown: 2.0,
    animation: {
      rotationSpeedIdle: 0.5,
      rotationSpeedLocked1: 2.0,
      rotationSpeedLocked2: 5.0,
      rotationSpeedOverload: 15.0,
      rotationLerpRate: 2,
      outerRotationRatio: 0.5,
      breathPhaseMultiplier: 2,
      breathAmplitudeBase: 0.05,
      bloomDecay: 0.9,
      bloomScaleMultiplier: 3.0,
      bloomAlphaScale: 0.5,
      bloomCutoff: 0.01,
    },
  },
  'gauss-cannon': {
    gaussPosition: { x: -12.0, y: 0.5, z: -8.0 },
    intakeRadius: 1.0,
    muzzleVelocity: 30.0,
    minAngle: 30,
    maxAngle: 60,
    sweepSpeed: 1.0,
    cooldown: 2.0,
    aimDuration: 2.0,
    loadLerpSpeed: 5,
    loadArrivalDistance: 0.2,
    breechYOffset: 1.0,
    idleSweepRate: 2.0,
    aimSweepMultiplier: 20,
    animation: {
      coilPulseRate: 10,
      coilStretchAmplitude: 0.15,
      recoilSpringStrength: 20.0,
      recoilDamping: 0.7,
      fireRecoilImpulse: 0.5,
      aimVibrationIntensity: 0.02,
      fireVibrationIntensity: 0.3,
      vibrationDecay: 0.95,
      idleSweepScale: 10,
      stateLightLoad: 0.5,
      stateLightAim: 1.0,
      stateLightCooldown: 0.2,
      fireLightFlashIntensity: 5.0,
      fireLightFadeIntensity: 0.2,
    },
  },
  'quantum-tunnel': {
    inputPosition: { x: 11.5, y: 0.5, z: 0.0 },
    outputPosition: { x: -11.5, y: 0.5, z: 0.0 },
    inputRadius: 1.2,
    ejectImpulse: 25.0,
    transportDelay: 0.5,
    cooldown: 2.0,
    capturePullDuration: 0.5,
    capturePullLerpSpeed: 10,
    ejectImpulseVarianceZ: 5.0,
    ejectRecoilDistance: 0.5,
    transportHideY: -100,
    cooldownFadeDuration: 1.0,
    portalSpinIdle: 1.0,
    portalSpinCapture: 5.0,
    portalSpinTransport: 8.0,
    portalSpinEject: 10.0,
    animation: {
      portalSpinLerpRate: 5.0,
      outputSpinRatio: 0.8,
      portalStretchAmplitude: 0.3,
      portalStretchSideFactor: 0.3,
      ejectRecoilDecay: 0.8,
      ejectRecoilThreshold: 0.01,
      idlePulseRate: 0.002,
      idlePulseBase: 0.5,
      idlePulseAmplitude: 0.2,
      discEmissiveScale: 0.8,
    },
  },
} as const)

export type FeederTunables = typeof FEEDER_TUNABLES
export type FeederId = keyof FeederTunables

export const GameConfig = {
  magSpin: FEEDER_TUNABLES['mag-spin'],
  nanoLoom: FEEDER_TUNABLES['nano-loom'],
  prismCore: FEEDER_TUNABLES['prism-core'],
  gaussCannon: FEEDER_TUNABLES['gauss-cannon'],
  quantumTunnel: FEEDER_TUNABLES['quantum-tunnel'],
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
    ballRestitution: 0.76,
    ballFriction: 0.14,
    bumperRestitution: 0.94,
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
    flipperStrength: 32000
  },

  ball: {
    radius: 0.25,
    mass: 1.0,
    friction: 0.14,
    restitution: 0.76,
    linearDamping: 0.10,
    angularDamping: 0.18,
    // Plain Objects for Spawn Points
    spawnMain: { x: 10.5, y: 0.5, z: -9 },
    spawnPachinko: { x: 0, y: 5, z: -10 }, // Ported from original
    spawnDrop: { x: 0, y: 5, z: 8 },
  },

  smallGoldBalls: {
    // Economy policy:
    // - Each swarm member is a real collectible and counts toward sessionGoldBalls
    //   and gold-threshold multiball progression individually.
    // - Scoring stack is: member base -> streak -> fever -> quick-collect bonus
    //   -> combo/multiball. Quick-collect receives fever, but not streak.
    // - swarmSize=5 and basePoints=300: one gold-plated swarm is 1500 base before bonuses.
    enabled: true,
    swarmSize: 5,
    sizeMultiplier: 0.48,
    massMultiplier: 0.32,
    restitution: 0.94,
    friction: 0.07,
    linearDamping: 0.06,
    angularDamping: 0.09,
    spawnVelocityMin: 4.0,
    spawnVelocityMax: 9.5,
    lifetime: 12.0,
    maxConcurrentBalls: 24,
    basePoints: 300,
    quickCollectBonusWindow: 4.0,
    quickCollectMultiplier: 2.0,
  },

  plunger: {
    /** @deprecated Use minImpulse/maxImpulse for analog charge instead */
    impulse: 22,
    /** Max charge time in milliseconds to reach full power */
    maxChargeTime: 1500,
    /** Minimum impulse magnitude (instant tap) */
    minImpulse: 14,
    /** Maximum impulse magnitude (full charge) */
    maxImpulse: 36,
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
    force: 0.72,
    verticalBoost: 0.22,
    maxTiltWarnings: 3,   // Warnings before tilt
    tiltDecayTime: 2000,  // Milliseconds to decay warning
    tiltPenaltyTime: 3000, // Milliseconds tilt stays active
  },

  flipper: {
    restAngle: Math.PI / 4,
    activeAngle: Math.PI / 8,
    kickVariation: 0.12,
    damping: 850,
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
    restitution: 0.76,
    friction: 0.14,
    linearDamping: 0.10,
    angularDamping: 0.18,
    resetImpulse: { x: 0, y: 0, z: 2.5 },
  },
  flipper: {
    stiffness: 32000,
    damping: 850,
    restAngleRad: Math.PI / 4,
    activeAngleRad: Math.PI / 8,
    kickVariation: 0.12,
    holdTimeDivisor: 0.28,
    kickImpulseScale: 2.8,
    leftLimits: [-Math.PI / 6, Math.PI / 4] as [number, number],
    rightLimits: [-Math.PI / 4, Math.PI / 6] as [number, number],
    restitution: 0.90,
    friction: 0.08,
  },
  bumper: {
    restitution: 0.94,
  },
  spinner: {
    targetSpeed: 18,
    acceleration: 32,
    deceleration: 9,
    hitFlashSeconds: 0.22,
  },
  trap: {
    holdDuration: 1.5,
    releaseBoost: 18,
    catchRestitution: 0.55,
  },
  plunger: {
    minImpulse: 14,
    maxImpulse: 36,
    maxChargeTimeMs: 1500,
    chargeCurveExponent: 1.25,
  },
  nudge: {
    force: 0.72,
    verticalBoost: 0.22,
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

/**
 * WASM Physics Engine feature flag configuration.
 * Reads from localStorage at runtime; defaults to Rapier.
 */
export const WASM_PHYSICS = {
  flagKey: 'pachinball:physics-engine',
  /** Rapier-only until wasm-owner is explicitly enabled. */
  defaultEngine: 'rapier',
  /**
   * Engine modes:
   *  - `rapier`       — Rapier only (production default)
   *  - `wasm-mirror`  — WASM mirrors ball+bumper subset; Rapier bodies remain handles
   *  - `wasm-owner`   — WASM owns ball + static table geometry; Rapier kept for joints
   * Legacy `wasm` is treated as `wasm-mirror`.
   */
  allowedEngines: ['rapier', 'wasm', 'wasm-mirror', 'wasm-owner'] as const,
  bundleUrl: './wasm/PhysicsModule.js',
  enabled: true,
  tunables: {
    fixedTimestep: 1 / 60,
    maxSubsteps: 8,
    solverIterations: 4,
    groundPlane: { normal: { x: 0, y: 1, z: 0 }, distance: 0 },
  },
} as const

export type WasmPhysicsEnginePreference = (typeof WASM_PHYSICS.allowedEngines)[number]

/** Resolved runtime mode after normalising legacy flag values. */
export type WasmPhysicsRuntimeMode = 'rapier' | 'wasm-mirror' | 'wasm-owner'

export function getPhysicsEnginePreference(): WasmPhysicsEnginePreference {
  try {
    const v = localStorage.getItem(WASM_PHYSICS.flagKey)
    if (v === 'wasm' || v === 'wasm-mirror') return 'wasm-mirror'
    if (v === 'wasm-owner') return 'wasm-owner'
  } catch {
    // ignore localStorage errors (e.g. disabled storage)
  }
  return WASM_PHYSICS.defaultEngine as WasmPhysicsEnginePreference
}

/** Normalise localStorage values to the three documented runtime modes. */
export function getWasmPhysicsRuntimeMode(): WasmPhysicsRuntimeMode {
  const pref = getPhysicsEnginePreference()
  if (pref === 'wasm-mirror' || pref === 'wasm') return 'wasm-mirror'
  if (pref === 'wasm-owner') return 'wasm-owner'
  return 'rapier'
}
