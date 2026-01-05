// src/config.ts

// Pure config - no Babylon.js dependencies
export const GameConfig = {
  // --- Existing Sections (Preserved & Adapted to Plain Objects) ---
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
  visuals: {
    enableParticles: true,
    enableTrails: true,
    particleIntensity: 1.0
  },
  physics: { // Keeping for backward compatibility if needed by things not covered
    ballRestitution: 0.7,
    ballFriction: 0.1,
    bumperRestitution: 1.5,
    flipperPower: 100000,
    gravity: { x: 0, y: -9.81, z: -5.0 }
  },
  gameplay: {
    maxBalls: 3,
    targetRespawnTime: 5.0,
    bumperPoints: 100,
    targetPoints: 500,
    slingshotPoints: 50
  },

  // --- NEW / UPDATED SECTIONS ---
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

    flipperStrength: 100000 // Copied from original table config to keep it consistent
  },

  ball: {
    radius: 0.5,
    mass: 1.0,
    friction: 0.1,    // Low friction is critical for the "steel ball" feel
    restitution: 0.7, // Bounciness
    // Plain Objects for Spawn Points
    spawnMain: { x: 10.5, y: 0.5, z: -9 },
    spawnPachinko: { x: 0, y: 5, z: -10 }, // Ported from original
    spawnDrop: { x: 0, y: 5, z: 8 },
  },

  plunger: {
    impulse: 22,
  },

  flipper: {
    strength: 10000,
    damping: 1000,
  }
}

export type GameConfigType = typeof GameConfig
