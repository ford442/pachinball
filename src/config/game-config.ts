import { resolveBackboxAssetPath } from './api'
import { FEEDER_TUNABLES } from './feeders'
import type { LaneSensorConfig } from './gameplay'

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
    flipperStrength: 32000,

    /** Thin Rapier sensor cuboids for lane rollover scoring (Phase 2). */
    laneSensors: [
      { id: 'launch-mid', kind: 'launch', position: { x: 10.5, y: 0.5, z: -4 }, halfExtents: { x: 0.15, y: 0.4, z: 1.2 } },
      { id: 'launch-upper', kind: 'launch', position: { x: 10.5, y: 0.5, z: 3 }, halfExtents: { x: 0.15, y: 0.4, z: 1.2 } },
      { id: 'inlane-left', kind: 'inlane', position: { x: -5.5, y: 0.5, z: -8 }, halfExtents: { x: 0.8, y: 0.4, z: 0.12 } },
      { id: 'inlane-right', kind: 'inlane', position: { x: 6.5, y: 0.5, z: -8 }, halfExtents: { x: 0.8, y: 0.4, z: 0.12 } },
      { id: 'outlane-left', kind: 'outlane', position: { x: -8.5, y: 0.5, z: -5 }, halfExtents: { x: 0.12, y: 0.4, z: 1.0 } },
      { id: 'outlane-right', kind: 'outlane', position: { x: 9.5, y: 0.5, z: -5 }, halfExtents: { x: 0.12, y: 0.4, z: 1.0 } },
      { id: 'drain-approach', kind: 'drainApproach', position: { x: 0, y: 0.5, z: -12 }, halfExtents: { x: 4, y: 0.4, z: 0.15 } },
    ] satisfies LaneSensorConfig[],
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

  audio: {
    /** Ducks worklet/synth impacts; defaults from settings.reducedAudio / reducedMotion. */
    reducedAudio: false,
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
      return resolveBackboxAssetPath('attract', 'mp4')
    },

    // If true, video replaces reels completely (reels hidden when video plays)
    // If false, video overlays reels (reels visible behind video)
    videoReplacesReels: true,

    // Path to static attract image (can be relative or absolute URL)
    // Used as fallback if video fails or isn't configured
    // Set to '' to disable image and use reels only
    get attractImagePath(): string {
      return resolveBackboxAssetPath('attract', 'png')
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
      return resolveBackboxAssetPath('jackpot', 'mp4')
    },
    get feverVideoPath(): string {
      return resolveBackboxAssetPath('fever', 'mp4')
    },
    get reachVideoPath(): string {
      return resolveBackboxAssetPath('reach', 'mp4')
    },
    get adventureVideoPath(): string {
      return resolveBackboxAssetPath('adventure', 'mp4')
    },

    // State-specific image fallbacks
    get jackpotImagePath(): string {
      return resolveBackboxAssetPath('jackpot', 'png')
    },
    get feverImagePath(): string {
      return resolveBackboxAssetPath('fever', 'png')
    },
    get reachImagePath(): string {
      return resolveBackboxAssetPath('reach', 'png')
    },
    get adventureImagePath(): string {
      return resolveBackboxAssetPath('adventure', 'png')
    },

    /** Nexus character-pack posters (LCD walk-by if these fail to load). */
    get idleCharacterPath(): string {
      return resolveBackboxAssetPath('idle', 'png', 'nexus')
    },
    get reachCharacterPath(): string {
      return resolveBackboxAssetPath('reach', 'png', 'nexus')
    },
    get feverCharacterPath(): string {
      return resolveBackboxAssetPath('fever', 'png', 'nexus')
    },
    get jackpotCharacterPath(): string {
      return resolveBackboxAssetPath('jackpot', 'png', 'nexus')
    },
  }
}

export type GameConfigType = typeof GameConfig
