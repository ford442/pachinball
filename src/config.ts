// src/config.ts

// Pure config - no Babylon.js dependencies
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
    ballRestitution: 0.7,
    ballFriction: 0.1,
    bumperRestitution: 1.5,
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
    // REMOVED: strength (Legacy/Unused) - We use table.flipperStrength now
    damping: 1000,
  }
}

export type GameConfigType = typeof GameConfig
