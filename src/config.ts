import { Vector3 } from '@babylonjs/core'

export const GameConfig = {
  physics: {
    ballRestitution: 0.7,
    ballFriction: 0.1,
    bumperRestitution: 1.5,
    flipperPower: 100000,
    gravity: new Vector3(0, -9.81, -5.0)
  },
  gameplay: {
    maxBalls: 3,
    targetRespawnTime: 5.0,
    bumperPoints: 100,
    targetPoints: 500,
    slingshotPoints: 50
  },
  visuals: {
    enableParticles: true,
    enableTrails: true,
    particleIntensity: 1.0
  },
  ball: {
    spawnMain: new Vector3(10.5, 0.5, -9),
    spawnPachinko: new Vector3(0, 5, -10),
    radius: 0.5,
    friction: 0.1,
    restitution: 0.7
  },
  table: {
    width: 28,
    height: 36,
    wallHeight: 4,
    flipperStrength: 100000
  }
}

export type GameConfigType = typeof GameConfig
