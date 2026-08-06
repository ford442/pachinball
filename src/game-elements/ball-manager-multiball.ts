import type { Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GAME_TUNING, GameConfig } from '../config'
import { nowMs, type BallManagerHost } from './ball-manager-context'

function getDynamicScoreMultiplier(host: BallManagerHost): number {
  if (!host.chainMultiball.isActive) return 1
  const extraBalls = Math.max(0, host.ballBodies.length - 1)
  return 1 + (extraBalls * GAME_TUNING.multiball.multiplierPerExtraBall)
}

export function getScoreMultiplier(host: BallManagerHost): number {
  return getDynamicScoreMultiplier(host)
}

export function canSaveDrain(host: BallManagerHost, currentMs: number = nowMs()): boolean {
  return host.chainMultiball.isActive
    && !host.chainMultiball.ballSaveUsed
    && currentMs <= host.chainMultiball.ballSaveExpiresAtMs
}

export function startMultiball(host: BallManagerHost, totalBalls: number, ballSaveMs: number = GAME_TUNING.multiball.drainGraceMs): {
  started: boolean
  spawnedBalls: number
  scoreMultiplier: number
  ballsInPlay: number
  chainLevel: number
  ballSaveRemainingMs: number
} {
  const clampedTotal = Math.max(2, Math.min(totalBalls, GAME_TUNING.multiball.maxChainBalls))
  const currentBallCount = host.ballBodies.length
  const needed = Math.max(0, clampedTotal - currentBallCount)
  const wasActive = host.chainMultiball.isActive
  const current = nowMs()

  for (let i = 0; i < needed; i++) {
    const spawn = GameConfig.ball.spawnPachinko
    const jitteredSpawn = {
      x: spawn.x + (Math.random() - 0.5) * 1.25,
      y: spawn.y + (i * 0.75),
      z: spawn.z + (Math.random() - 0.5) * 0.8,
    } as Vector3
    host.spawnRandomBall(jitteredSpawn)
  }

  if (host.ballBodies.length > 0 && (!host.ballBody || !host.ballBodies.includes(host.ballBody))) {
    host.ballBody = host.ballBodies[0]
  }

  if (!wasActive) {
    host.chainMultiball.chainLevel = 1
  } else if (needed > 0) {
    host.chainMultiball.chainLevel++
  }

  host.chainMultiball.isActive = true
  host.chainMultiball.ballSaveUsed = false
  host.chainMultiball.ballSaveExpiresAtMs = current + Math.max(0, ballSaveMs)

  return {
    started: !wasActive || needed > 0,
    spawnedBalls: needed,
    scoreMultiplier: getDynamicScoreMultiplier(host),
    ballsInPlay: host.ballBodies.length,
    chainLevel: host.chainMultiball.chainLevel,
    ballSaveRemainingMs: Math.max(0, host.chainMultiball.ballSaveExpiresAtMs - current),
  }
}

export function triggerForcedMultiball(host: BallManagerHost, totalBalls: number, _reason: string): {
  started: boolean
  spawnedBalls: number
  scoreMultiplier: number
  ballsInPlay: number
  chainLevel: number
  ballSaveRemainingMs: number
} {
  return startMultiball(host, totalBalls, GAME_TUNING.multiball.drainGraceMs)
}

export function registerDrain(host: BallManagerHost, _drainedBody: RAPIER.RigidBody): {
  ballSaved: boolean
  multiballEnded: boolean
  scoreMultiplier: number
  ballsInPlay: number
  ballSaveRemainingMs: number
} {
  if (!host.chainMultiball.isActive) {
    return {
      ballSaved: false,
      multiballEnded: false,
      scoreMultiplier: 1,
      ballsInPlay: host.ballBodies.length,
      ballSaveRemainingMs: 0,
    }
  }

  const current = nowMs()
  let ballSaved = false
  if (canSaveDrain(host, current)) {
    const spawn = GameConfig.ball.spawnMain
    const savedBody = host.spawnRandomBall({ x: spawn.x, y: spawn.y, z: spawn.z } as Vector3)
    if (!host.ballBody || !host.ballBodies.includes(host.ballBody)) {
      host.ballBody = savedBody
    }
    host.chainMultiball.ballSaveUsed = true
    ballSaved = true
  }

  let multiballEnded = false
  if (host.chainMultiball.isActive && host.ballBodies.length <= 1) {
    endMultiball(host)
    multiballEnded = true
  }

  return {
    ballSaved,
    multiballEnded,
    scoreMultiplier: getDynamicScoreMultiplier(host),
    ballsInPlay: host.ballBodies.length,
    ballSaveRemainingMs: Math.max(0, host.chainMultiball.ballSaveExpiresAtMs - current),
  }
}

export function endMultiball(host: BallManagerHost): void {
  host.chainMultiball.isActive = false
  host.chainMultiball.chainLevel = 0
  host.chainMultiball.ballSaveUsed = false
  host.chainMultiball.ballSaveExpiresAtMs = 0
}

export function getChainStats(host: BallManagerHost): {
  isActive: boolean
  chainLevel: number
  ballsInPlay: number
  scoreMultiplier: number
  ballSaveAvailable: boolean
  ballSaveRemainingMs: number
} {
  const current = nowMs()
  return {
    isActive: host.chainMultiball.isActive,
    chainLevel: host.chainMultiball.chainLevel,
    ballsInPlay: host.ballBodies.length,
    scoreMultiplier: getDynamicScoreMultiplier(host),
    ballSaveAvailable: canSaveDrain(host, current),
    ballSaveRemainingMs: Math.max(0, host.chainMultiball.ballSaveExpiresAtMs - current),
  }
}
