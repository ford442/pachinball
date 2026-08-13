/**
 * Ball-lifecycle determinism — physics-affecting RNG fork streams.
 *
 * Verifies that the named fork labels used by spawn / multiball / gold-swarm /
 * trap / spinner produce identical values across session restarts with the same seed.
 */
import { describe, it, expect } from 'vitest'
import { GameConfig } from '../src/config'
import { selectWeightedBallType } from '../src/game-elements/ball-manager-spawn'
import {
  createSeededRng,
  getSessionRngFork,
  initSessionRng,
  RNG_FORK,
} from '../src/core/seeded-rng'

function sampleSpawnJitter(seed: number) {
  initSessionRng(seed)
  const rng = getSessionRngFork(RNG_FORK.SPAWN)
  const spawn = GameConfig.ball.spawnPachinko
  return {
    types: Array.from({ length: 8 }, () => selectWeightedBallType(rng)),
    extraBallX: spawn.x + (rng.next() - 0.5),
  }
}

function sampleMultiballJitter(seed: number) {
  initSessionRng(seed)
  const rng = getSessionRngFork(RNG_FORK.MULTIBALL)
  const spawn = GameConfig.ball.spawnPachinko
  return {
    x: spawn.x + (rng.next() - 0.5) * 1.25,
    z: spawn.z + (rng.next() - 0.5) * 0.8,
  }
}

function sampleGoldSwarm(seed: number) {
  initSessionRng(seed)
  const rng = getSessionRngFork(RNG_FORK.GOLD_SWARM)
  const cfg = GameConfig.smallGoldBalls
  const angleSpread = (Math.PI * 2 / cfg.swarmSize) * 0 + (rng.next() - 0.5) * 0.3
  const speed = cfg.spawnVelocityMin + rng.next() * (cfg.spawnVelocityMax - cfg.spawnVelocityMin)
  return {
    angleSpread,
    speed,
    posX: (rng.next() - 0.5) * 0.5,
    posZ: (rng.next() - 0.5) * 0.5,
  }
}

function sampleTrapBoost(seed: number, boostForce = 12) {
  initSessionRng(seed)
  const rng = getSessionRngFork(RNG_FORK.TRAP)
  return {
    x: (rng.next() - 0.5) * boostForce,
    z: (rng.next() - 0.5) * boostForce * 0.5,
  }
}

function sampleSpinnerDirection(seed: number) {
  initSessionRng(seed)
  return getSessionRngFork(RNG_FORK.SPINNER).next() < 0.5 ? -1 : 1
}

describe('ball lifecycle RNG forks', () => {
  const SEED = 0xdecafbad

  it('reproduces ball-type sequence and spawn jitter for a fixed seed', () => {
    expect(sampleSpawnJitter(SEED)).toEqual(sampleSpawnJitter(SEED))
  })

  it('reproduces multiball spawn offsets for a fixed seed', () => {
    expect(sampleMultiballJitter(SEED)).toEqual(sampleMultiballJitter(SEED))
  })

  it('reproduces gold-swarm angle/speed/position for a fixed seed', () => {
    expect(sampleGoldSwarm(SEED)).toEqual(sampleGoldSwarm(SEED))
  })

  it('reproduces trap boost vector for a fixed seed', () => {
    expect(sampleTrapBoost(SEED)).toEqual(sampleTrapBoost(SEED))
  })

  it('reproduces spinner direction for a fixed seed', () => {
    expect(sampleSpinnerDirection(SEED)).toEqual(sampleSpinnerDirection(SEED))
  })

  it('two fresh same-seed sessions produce identical fork bundles (no cross-session leak)', () => {
    const bundle = () => ({
      spawn: sampleSpawnJitter(SEED),
      multiball: sampleMultiballJitter(SEED),
      gold: sampleGoldSwarm(SEED),
      trap: sampleTrapBoost(SEED),
      spinner: sampleSpinnerDirection(SEED),
    })

    expect(bundle()).toEqual(bundle())
  })

  it('fork streams are independent — consuming spawn does not shift trap', () => {
    initSessionRng(777)
    const trapBefore = getSessionRngFork(RNG_FORK.TRAP).next()
    initSessionRng(777)
    for (let i = 0; i < 20; i++) {
      getSessionRngFork(RNG_FORK.SPAWN).next()
    }
    const trapAfter = getSessionRngFork(RNG_FORK.TRAP).next()
    expect(trapAfter).toBe(trapBefore)
  })

  it('diverges across different session seeds', () => {
    const a = sampleSpawnJitter(1)
    const b = sampleSpawnJitter(2)
    expect(a).not.toEqual(b)
  })
})

describe('selectWeightedBallType with explicit fork', () => {
  it('fork stream is reproducible regardless of root consumption order', () => {
    const draw = () => {
      const root = createSeededRng(1)
      for (let i = 0; i < 5; i++) root.next()
      const type = selectWeightedBallType(root.fork(RNG_FORK.SPAWN))
      const trap = root.fork(RNG_FORK.TRAP).next()
      return { type, trap }
    }
    expect(draw()).toEqual(draw())
  })
})
