import { Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { BumperVisual } from '../../game-elements/types'
import { ComboSystem, getScoringBreakdownManager, type ComboHitType } from '../../game-elements'
import { ComboMultiplierSystem } from '../../game-elements/combo-multiplier-system'
import { BonusTallySystem } from '../../game-elements/bonus-tally-system'
import { GoldBallStreakSystem } from '../../game-elements/gold-ball-streak-system'
import { BallType, GAME_TUNING, GameConfig } from '../../config'
import { DisplayState } from '../../game-elements'
import { TABLE_MAPS } from '../../shaders/lcd-table'
import { PALETTE } from '../../game-elements'
import type { PhysicsHost } from './types'
import { getFeverScoreMultiplier, applyFeverGoldMultiplier } from './scoring-multipliers'

/**
 * ScoringBridge — owns combo/fever/tally/streak state, score awards, and the
 * ball-loss scoring path. Wired into GamePhysicsController so the collision
 * dispatchers can call scoring hooks without owning scoring state.
 */
export class ScoringBridge {
  private readonly host: PhysicsHost
  private readonly comboSystem: ComboSystem
  private readonly comboMultiplierSystem: ComboMultiplierSystem
  private readonly bonusTallySystem: BonusTallySystem
  private readonly goldBallStreakSystem: GoldBallStreakSystem
  private readonly scoringBreakdown = getScoringBreakdownManager()

  // Per-ball scoring coverage instrumentation (reset on launch; for debug/audit)
  private bumperHitsThisBall = 0
  private pointsThisBall = 0
  private zoneEntriesThisBall = 0
  private awardScoreCalls = 0

  private eventBusUnsubscribers: Array<() => void> = []

  constructor(host: PhysicsHost) {
    this.host = host
    this.goldBallStreakSystem = new GoldBallStreakSystem({
      windowSeconds: GAME_TUNING.goldBall.streakWindowSeconds,
      perBallBonus: GAME_TUNING.goldBall.streakPerBallBonus,
      maxMultiplier: GAME_TUNING.goldBall.streakMaxMultiplier,
    })
    this.comboSystem = new ComboSystem({
      expirySeconds: GAME_TUNING.combo.expirySeconds,
      chainWindowSeconds: GAME_TUNING.combo.chainWindowSeconds,
      chainDistinctThreshold: GAME_TUNING.combo.chainDistinctThreshold,
      chainMultiplier: GAME_TUNING.combo.chainMultiplier,
      chainCooldownSeconds: GAME_TUNING.combo.chainCooldownSeconds,
      namedChains: GAME_TUNING.combo.namedChains.map((chain) => ({
        ...chain,
        sequence: chain.sequence as ComboHitType[],
      })),
    })
    this.comboMultiplierSystem = new ComboMultiplierSystem({
      windowSeconds: GAME_TUNING.feedback.comboWindowSeconds,
      hitsPerMultiplier: GAME_TUNING.feedback.comboHitsPerMultiplier,
      maxMultiplier: GAME_TUNING.feedback.comboMaxMultiplier,
    })
    this.bonusTallySystem = new BonusTallySystem({
      comboPeakBase: GAME_TUNING.feedback.bonusTallyComboPeakBase,
    })

    // Subscribe to 'points:awarded' from new obstacle builders so their scores
    // are reflected in the game score alongside legacy direct mutations.
    this.eventBusUnsubscribers.push(
      host.eventBus.on('points:awarded', (data) => {
        const comboMultiplier = this.comboMultiplierSystem.getState().multiplier
        const effectiveMultiplier = (data.multiplier ?? 1) * this.getActiveScoreMultiplier() * comboMultiplier
        const awardedPoints = Math.round(data.amount * effectiveMultiplier)
        this.host.score += awardedPoints
        this.scoringBreakdown.recordScore(awardedPoints, data.source)
        // Also track in per-ball instrumentation (covers slot etc that emit points:awarded directly)
        this.pointsThisBall += awardedPoints
        if (data.source?.includes('bumper')) {
          this.bumperHitsThisBall++
        }
        if (effectiveMultiplier > 1) {
          this.host.eventBus.emit('score:multiplier', {
            basePoints: data.amount,
            awardedPoints,
            multiplier: effectiveMultiplier,
            source: data.source,
          })
        }
        if (data.position) {
          const pos = new Vector3(data.position.x, data.position.y, data.position.z)
          this.host.effects?.spawnFloatingNumber(awardedPoints, pos)
          if (data.source?.includes('spinner')) {
            this.host.effects?.spawnBumperSpark(pos, PALETTE.CYAN)
            this.host.effects?.triggerImpactFlash(pos, 0.8, PALETTE.MAGENTA)
          } else if (data.source?.includes('trap')) {
            this.host.effects?.triggerImpactFlash(pos, 0.7, PALETTE.MAGENTA)
            this.host.effects?.addCameraShake(0.12)
          }
        }
        this.host.updateHUD()
      })
    )

    this.eventBusUnsubscribers.push(
      host.eventBus.on('jackpot:start', () => {
        if (!this.host.stateManager.isPlaying()) return
        this.startChainMultiball('jackpot', 3)
      })
    )

    // Reset per-ball scoring counters on launch (instrumentation for coverage audit)
    this.eventBusUnsubscribers.push(
      host.eventBus.on('ball:launched', () => {
        this.resetBallScoreCounters()
      })
    )
  }

  dispose(): void {
    for (const unsub of this.eventBusUnsubscribers) {
      unsub()
    }
    this.eventBusUnsubscribers = []
  }

  // Instrumentation getters for scoring audit
  getBumperHitsThisBall(): number {
    return this.bumperHitsThisBall
  }
  getPointsThisBall(): number {
    return this.pointsThisBall
  }
  getZoneEntriesThisBall(): number {
    return this.zoneEntriesThisBall
  }
  getAwardScoreCalls(): number {
    return this.awardScoreCalls
  }
  resetBallScoreCounters(): void {
    this.bumperHitsThisBall = 0
    this.pointsThisBall = 0
    this.zoneEntriesThisBall = 0
    this.awardScoreCalls = 0
    this.host.zoneTriggerSystem?.resetBallCounters?.()
  }

  awardScore(basePoints: number, source: string, position?: Vector3): number {
    this.awardScoreCalls++
    const multiballMultiplier = this.getActiveScoreMultiplier()
    const comboMultiplier = this.comboMultiplierSystem.getState().multiplier
    const totalMultiplier = multiballMultiplier * comboMultiplier
    const awardedPoints = Math.round(basePoints * totalMultiplier)
    this.host.score += awardedPoints
    this.scoringBreakdown.recordScore(awardedPoints, source)
    // Instrumentation: track per-ball awards
    this.pointsThisBall += awardedPoints
    if (source.includes('bumper')) {
      this.bumperHitsThisBall++
    }
    if (position) {
      this.host.effects?.spawnFloatingNumber(awardedPoints, position)
    }
    if (totalMultiplier > 1) {
      this.host.eventBus.emit('score:multiplier', {
        basePoints,
        awardedPoints,
        multiplier: totalMultiplier,
        source,
      })
    }
    return awardedPoints
  }

  sweepBonusTally(): void {
    const comboState = this.comboMultiplierSystem.reset()
    this.bonusTallySystem.recordComboPeak(comboState.peakCombo)
    const { total, breakdown } = this.bonusTallySystem.sweep()
    if (total > 0) {
      this.host.score += total
      this.host.eventBus.emit('bonus:tally:start', { totalBonus: total, breakdown })
      this.host.eventBus.emit('bonus:tally:complete', { totalBonus: total })
      this.host.effects?.setBloomEnergy(2.0)
      setTimeout(() => this.host.effects?.setBloomEnergy(1.0), GAME_TUNING.timing.tiltBloomResetMs)
    }
  }

  startChainMultiball(reason: 'jackpot' | 'gold-threshold', targetBalls: number): void {
    const result = this.host.ballManager?.triggerForcedMultiball(targetBalls, reason)
    if (!result?.started) return

    this.host.eventBus.emit('multiball:start', {
      reason,
      ballsInPlay: result.ballsInPlay,
      scoreMultiplier: result.scoreMultiplier,
      chainLevel: result.chainLevel,
    })
    this.host.showMessage(`MULTIBALL x${Number(result.scoreMultiplier.toFixed(2)).toString()}`, 1800)

    if (!this.host.accessibility.reducedMotion) {
      this.host.effects?.addCameraShake(0.05)
    }

    this.host.updateHUD()
    this.host.rebuildHandleCaches()
  }

  activateHologramCatch(ball: RAPIER.RigidBody, bumper: RAPIER.RigidBody, bumperVisualMap: Map<number, BumperVisual>): void {
    const visual = bumperVisualMap.get(bumper.handle)
    if (!visual || !visual.hologram) return
    this.host.ballManager?.activateHologramCatch(ball, visual.hologram.position, 4.0)
    this.host.effects?.playBeep(880)
    this.host.eventBus.emit('reach:start')
    this.host.eventBus.emit('display:set', DisplayState.REACH)
    this.host.effects?.setLightingMode('reach', 4.0)
  }

  handleBallLoss(body: RAPIER.RigidBody): void {
    if (!this.host.stateManager.isPlaying()) return
    if (this.host.adventureMode?.isActive()) {
      const ballBodies = this.host.ballManager?.getBallBodies() || []
      const ballIndex = Math.max(0, ballBodies.indexOf(body))
      this.host.adventureMode.respawnBallAtStart(body, ballIndex)
      return
    }

    const wasPrimaryBall = body === this.host.ballManager?.getBallBody()
    const drainVel = body.linvel()
    const drainSpeed = Math.sqrt(drainVel.x ** 2 + drainVel.y ** 2 + drainVel.z ** 2)

    const comboBreak = this.comboSystem.breakCombo()
    if (comboBreak) {
      this.host.eventBus.emit('combo:broken', {
        finalComboCount: comboBreak.finalComboCount,
        chainLength: comboBreak.chainLength,
        lastType: comboBreak.lastType ?? undefined,
      })
      this.host.uiManager?.updateComboChainMeter(0, GAME_TUNING.combo.chainDistinctThreshold, false)
    }
    this.syncComboSnapshot()
    const wasFeverActive = this.host.display?.getDisplayState() === DisplayState.FEVER
    if (wasFeverActive) {
      this.host.eventBus.emit('fever:end')
      this.host.eventBus.emit('display:set', DisplayState.IDLE)
      this.host.effects?.setLightingMode('normal', 0)
    }

    const collected = this.host.ballManager?.collectBall(body)
    if (collected && collected.type !== BallType.STANDARD) {
      this.host.soundSystem.playGoldBallCollect(collected.type)
      // Ball stack visual updated by caller
      this.host.goldBallStack.push({ type: collected.type, timestamp: performance.now() })
      this.host.sessionGoldBalls++
      const collectPos = new Vector3(body.translation().x, body.translation().y, body.translation().z)

      // Apply the gold ball streak multiplier before scoring so the point
      // total already reflects it when spawnFloatingNumber() shows the value.
      const streak = this.goldBallStreakSystem.registerCollect(this.nowSeconds())
      const streakAdjustedBase = Math.round(collected.points * streak.multiplier)
      // Stacking: base → streak → fever → combo/multiball (awardScore)
      const feverDisplayState = wasFeverActive ? DisplayState.FEVER : DisplayState.IDLE
      const feverMultiplier = getFeverScoreMultiplier(feverDisplayState, collected.type)
      const feverAdjustedBase = applyFeverGoldMultiplier(feverDisplayState, collected.type, streakAdjustedBase)
      if (feverMultiplier > 1) {
        this.host.eventBus.emit('score:multiplier', {
          basePoints: streakAdjustedBase,
          awardedPoints: feverAdjustedBase,
          multiplier: feverMultiplier,
          source: 'gold-ball-collect',
        })
      }
      const awardedPoints = this.awardScore(feverAdjustedBase, 'gold-ball-collect', collectPos)
      this.bonusTallySystem.recordScore('gold-ball', feverAdjustedBase)

      if (streak.isStreak) {
        this.host.eventBus.emit('gold-ball:streak', {
          streakCount: streak.streakCount,
          multiplier: streak.multiplier,
          bonusPoints: awardedPoints,
          ballType: collected.type,
        })
        this.host.showMessage(`STREAK x${streak.multiplier.toFixed(1)} +${awardedPoints}`, 1800)
      } else {
        this.host.showMessage(`+${awardedPoints}`, 1500)
      }

      if (collected.quickCollectBonus) {
        // Swarm quick-collect follows the same economy stack as regular gold
        // collection: base/streak member scoring is already handled above,
        // then quick-collect bonus receives fever before combo/multiball.
        const quickCollectAdjustedBase = applyFeverGoldMultiplier(
          feverDisplayState,
          collected.type,
          collected.quickCollectBonus.totalPoints,
        )
        const bonusAwarded = this.awardScore(
          quickCollectAdjustedBase,
          'gold-ball-quick-collect',
          collectPos,
        )
        this.bonusTallySystem.recordScore('gold-ball', quickCollectAdjustedBase)
        this.host.eventBus.emit('score:multiplier', {
          basePoints: collected.quickCollectBonus.totalPoints,
          awardedPoints: quickCollectAdjustedBase,
          multiplier: collected.quickCollectBonus.multiplier * feverMultiplier,
          source: 'gold-ball-quick-collect',
        })
        this.host.showMessage(`QUICK COLLECT x${collected.quickCollectBonus.multiplier.toFixed(1)} +${bonusAwarded}`, 1800)
      }

      if (GAME_TUNING.multiball.triggerGoldThresholds.includes(this.host.sessionGoldBalls)) {
        this.startChainMultiball('gold-threshold', 2)
      }

      if (collected.jackpotEligible) {
        this.host.effects?.startSolidGoldPulse()
        this.host.eventBus.emit('jackpot:start')
        this.host.eventBus.emit('display:set', DisplayState.JACKPOT)
        this.host.hapticManager?.jackpot()
      } else {
        this.host.effects?.setBloomEnergy(1.5)
      }
      this.host.updateGoldBallDisplay()
    }

    this.host.ballManager?.removeBall(body)
    const multiballDrainResult = this.host.ballManager?.registerDrain(body)
    if (multiballDrainResult?.ballSaved) {
      this.host.eventBus.emit('multiball:save', { remainingMs: multiballDrainResult.ballSaveRemainingMs })
      this.host.showMessage('BALL SAVED', 1200)
      this.host.rebuildHandleCaches()
    }
    if (multiballDrainResult?.multiballEnded) {
      this.host.eventBus.emit('multiball:end', { ballsInPlay: multiballDrainResult.ballsInPlay })
      this.host.showMessage('MULTIBALL ENDED', 1400)
    }
    this.host.hapticManager?.ballLost()
    this.host.soundSystem.playImpact('drain', drainSpeed)
    this.host.display?.triggerDrainReaction()

    if (wasPrimaryBall) {
      const ballBodies = this.host.ballManager?.getBallBodies() || []
      if (ballBodies.length > 0) {
        this.host.ballManager?.setBallBody(ballBodies[0])
      } else {
        if (this.host.handlePrimaryBallDrain()) {
          // Free-map test mode fully handles the drain by loading the next layout
          // and respawning a fresh launch-ready ball, so no life loss applies here.
          this.host.updateHUD()
        } else {
          // Check grace-window ball-save before life loss
          const nowMs = performance.now()
          if (this.host.ballManager?.ballSaveSystem.canSave(nowMs)) {
            this.host.ballManager.ballSaveSystem.consumeSave()
            this.host.eventBus.emit('ball:save:triggered', { reason: 'grace-window' })
            this.host.showMessage('BALL SAVED', 1500)
            this.host.eventBus.emit('sound:play', { soundKey: 'ball-save', volume: 1.0 })
            // Reset combo multiplier but keep bonus tally for same ball continuation
            this.comboMultiplierSystem.reset()
            this.goldBallStreakSystem.reset()
            this.host.resetBall()
          } else {
            // Genuine drain — sweep bonus tally and reset all per-ball accumulators
            this.sweepBonusTally()
            this.goldBallStreakSystem.reset()
            this.host.lives--
            if (this.host.lives > 0) {
              this.host.resetBall()
              this.bonusTallySystem.reset()
              this.comboMultiplierSystem.reset()
            } else {
              this.host.setGameState(3) // GameState.GAME_OVER
            }
          }
        }
      }
    }
    this.host.updateHUD()
  }

  registerComboObstacleHit(type: ComboHitType): void {
    const result = this.comboSystem.registerChainHit(type, this.nowSeconds())
    this.syncComboSnapshot()
    this.emitComboProgressEvent(result.event)
    this.emitComboChainEvent(result.chain)
    if (!GameConfig.accessibility.photosensitiveMode && this.host.effects?.getRuntimePerformanceTier() !== 'low' && result.chain.chainLength >= 2) {
      const mapColor = TABLE_MAPS[this.host.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || PALETTE.CYAN
      this.host.effects?.triggerCabinetShake(result.chain.chainLength >= 4 ? 'heavy' : 'medium', mapColor)
    }
    this.host.updateHUD()
  }

  registerComboMultiplierHit(): void {
    const result = this.comboMultiplierSystem.registerHit()
    this.host.comboMultiplier = result.multiplier
    if (result.changed) {
      this.host.eventBus.emit('combo:multiplier:changed', {
        multiplier: result.multiplier,
        comboCount: result.comboCount,
      })
    }
  }

  registerBumperHit(): ReturnType<ComboSystem['registerBumperHit']> {
    return this.comboSystem.registerBumperHit(this.nowSeconds())
  }

  recordChainBonus(points: number): void {
    this.bonusTallySystem.recordScore('chain-bonus', points)
  }

  getComboImpactTier(): 'light' | 'medium' | 'heavy' {
    if (this.host.accessibility.reducedMotion || GameConfig.accessibility.photosensitiveMode) {
      return 'light'
    }
    const chainLength = this.comboSystem.getSnapshot().chainProgress
    if (chainLength >= 4) return 'heavy'
    if (chainLength >= 2) return 'medium'
    return 'light'
  }

  getActiveScoreMultiplier(): number {
    return this.host.ballManager?.getChainStats().scoreMultiplier ?? 1
  }

  updateCombo(dt: number): void {
    const broken = this.comboSystem.update(dt)
    this.syncComboSnapshot()
    if (broken) {
      this.host.eventBus.emit('combo:broken', {
        finalComboCount: broken.finalComboCount,
        chainLength: broken.chainLength,
        lastType: broken.lastType ?? undefined,
      })
      this.host.uiManager?.updateComboChainMeter(0, GAME_TUNING.combo.chainDistinctThreshold, false)
      this.host.updateHUD()
      if (this.host.display?.getDisplayState() === DisplayState.FEVER) {
        this.host.eventBus.emit('fever:end')
        this.host.eventBus.emit('display:set', DisplayState.IDLE)
        this.host.effects?.setLightingMode('normal', 0)
      }
    }

    const expired = this.comboMultiplierSystem.update(dt)
    if (expired) {
      this.bonusTallySystem.recordComboPeak(expired.peakCombo)
      if (expired.peakCombo > 0) {
        this.host.showMessage(`PEAK COMBO x${expired.peakCombo}`, 1200)
      }
    }
  }

  syncComboSnapshot(): void {
    const snapshot = this.comboSystem.getSnapshot()
    this.host.comboCount = snapshot.comboCount
    this.host.comboTimer = snapshot.comboTimer
    this.host.uiManager?.updateComboChainMeter(snapshot.chainProgress, snapshot.chainTarget, false)
  }

  emitComboProgressEvent(event: 'started' | 'extended' | null): void {
    if (!event) return
    const snapshot = this.comboSystem.getSnapshot()
    const payload = {
      comboCount: snapshot.comboCount,
      chainLength: snapshot.chainProgress,
      lastType: snapshot.lastType ?? undefined,
    }
    if (event === 'started') {
      this.host.eventBus.emit('combo:started', payload)
      return
    }
    this.host.eventBus.emit('combo:extended', payload)
  }

  emitComboChainEvent(chain: {
    triggered: boolean
    chainLength: number
    chainMultiplier: number
    namedChain: { name: string } | null
    bonusPoints: number
  }): void {
    if (!chain.triggered) return
    const snapshot = this.comboSystem.getSnapshot()
    const lastType = snapshot.lastType
    if (!lastType) return
    this.host.eventBus.emit('combo:chain', {
      comboCount: snapshot.comboCount,
      chainLength: chain.chainLength,
      lastType,
      chainName: chain.namedChain?.name,
      bonusPoints: chain.bonusPoints,
      multiplier: chain.chainMultiplier,
    })
    this.host.uiManager?.updateComboChainMeter(snapshot.chainProgress, snapshot.chainTarget, true)
    const chainLabel = chain.namedChain?.name ?? `CHAIN x${chain.chainLength}`
    this.host.showMessage(chain.bonusPoints > 0 ? `${chainLabel} +${chain.bonusPoints}` : chainLabel, 1600)
  }

  private nowSeconds(): number {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
  }
}
