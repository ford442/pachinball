/**
 * Game HUD Controller — HUD updates, combo tracking, gold ball display, leaderboard.
 */

import type { BallManager } from '../game-elements/ball-manager'
import type { BallStackVisual } from '../game-elements/ball-stack-visual'
import type { EffectsSystem } from '../effects'
import type { GameUIManager } from './game-ui'
import type { LeaderboardSystem } from '../game-elements/leaderboard-system'
import type { NameEntryDialog } from '../game-elements/name-entry-dialog'
import type { TableMapManager } from './game-maps'
import type { AdventureGoalTracker } from '../adventure/adventure-goal-tracker'
import type { AdventureTrackProgression } from '../adventure/adventure-track-progression'
import type { AdventureProgressionSupervisor } from '../adventure/adventure-progression-supervisor'
import type { AdventureMode } from '../adventure'
import { getCampaignRewardsManager } from '../adventure/campaign-rewards-manager'
import { getDailyCascadeState } from '../cascade/daily-cascade-state'
import { getChallengeSystem } from '../replay/challenge-system'
import type { ReplayPayload } from '../replay/replay-recorder'
import { BallType } from '../config'

export interface HUDHost {
  /** Aborted by Game.dispose(); listeners on the static HUD buttons ride it. */
  readonly signal: AbortSignal
  readonly ballManager: BallManager | null
  readonly ballStackVisual: BallStackVisual | null
  readonly effects: EffectsSystem | null
  readonly uiManager: GameUIManager | null
  ensureOverlaySystems(): Promise<void>
  readonly leaderboardSystem: LeaderboardSystem
  readonly nameEntryDialog: NameEntryDialog
  readonly mapManager: TableMapManager | null
  readonly adventureMode: AdventureMode | null
  readonly adventureGoalTracker: AdventureGoalTracker | null
  readonly adventureTrackProgression: AdventureTrackProgression | null
  readonly adventureProgressionSupervisor: AdventureProgressionSupervisor | null

  score: number
  lives: number
  comboCount: number
  comboTimer: number
  comboMultiplier: number
  bestScore: number
  goldBallStack: Array<{ type: BallType; timestamp: number }>
  sessionGoldBalls: number

  updateHUD(): void
  readonly replayRecorder?: import('../game-elements').ReplayRecorder
}

/** A finished game, kept for submission and "Challenge friends". */
export interface FinishedRun {
  payload: ReplayPayload | null
  score: number
  /** The leaderboard it goes to. */
  board: string
  tableMapId: string
  name?: string
  replayId?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class GameHUD {
  private readonly host: HUDHost
  private lastRun: FinishedRun | null = null

  constructor(host: HUDHost) {
    this.host = host
    this.setupChallengeButton()
  }

  private setupChallengeButton(): void {
    const challengeBtn = document.getElementById('challenge-share-btn')
    if (challengeBtn) {
      // Challenges v2 (#444 Slice D), loaded on click. A listener (not `onclick =`) so Game.dispose() removes it with the rest.
      challengeBtn.addEventListener('click', () => {
        void import('../replay/challenge-v2').then((m) =>
          m.challengeFriends(this.lastRun, this.host, (run, rank) => this.submitRun(run, rank)))
      }, { signal: this.host.signal })
    }
  }

  updateHUD(): void {
    const { uiManager, score, lives, comboCount, bestScore } = this.host
    const multiballMultiplier = this.host.ballManager?.getChainStats().scoreMultiplier ?? 1
    uiManager?.updateHUD({
      score,
      lives,
      ballsInPlay: this.host.ballManager?.getBallBodies().length ?? 0,
      combo: comboCount,
      scoreMultiplier: multiballMultiplier * this.host.comboMultiplier,
      bestScore,
    })
    this.updateAdventureHUD()
  }

  private updateAdventureHUD(): void {
    const {
      uiManager,
      adventureMode,
      adventureTrackProgression,
      adventureGoalTracker,
      adventureProgressionSupervisor,
      score,
    } = this.host

    if (!adventureMode?.isActive() || !adventureTrackProgression) {
      uiManager?.hideAdventureHUD()
      return
    }

    const trackInfo = adventureTrackProgression.getCurrentTrackInfo()
    if (!trackInfo) {
      uiManager?.hideAdventureHUD()
      return
    }

    const scoreDelta = adventureProgressionSupervisor?.getScoreDelta(score) ?? 0
    const nextId = adventureTrackProgression.getNextTrackId()
    const nextInfo = nextId ? adventureTrackProgression.getTrackInfo(nextId) : null
    const campaignRewards = getCampaignRewardsManager()
    const goals = adventureGoalTracker?.getGoals() ?? []

    uiManager?.updateCampaignHUD({
      trackName: trackInfo.name,
      modeLabel: trackInfo.modeType === 'EXTENDED_MAP' ? 'EXTENDED MAP' : 'ARENA',
      scoreCurrent: scoreDelta,
      scoreTarget: trackInfo.recommendedScore,
      timeRemaining: adventureProgressionSupervisor?.getTimeRemaining() ?? trackInfo.timeLimitSeconds,
      timeLimit: trackInfo.timeLimitSeconds,
      nextTrackName: nextInfo?.name ?? null,
      nextTrackGoal: nextInfo?.recommendedScore ?? null,
      goals: goals.map((g) => ({
        description: g.title,
        current: g.current,
        target: g.target,
        completed: g.completed,
      })),
      shardTotal: campaignRewards?.getTotalShards() ?? 0,
      campaignPercent: adventureTrackProgression.getCompletionPercentage(),
    })
  }

  updateCombo(dt: number): void {
    if (this.host.comboTimer > 0) {
      this.host.comboTimer -= dt
      if (this.host.comboTimer <= 0) {
        this.host.comboCount = 0
        this.updateHUD()
      }
    }
  }

  updateGoldBallDisplay(): void {
    const goldPlated = this.host.goldBallStack.filter(b => b.type === BallType.GOLD_PLATED).length
    const solidGold = this.host.goldBallStack.filter(b => b.type === BallType.SOLID_GOLD).length
    this.host.uiManager?.updateGoldBallDisplay(goldPlated, solidGold)

    let sessionBadge = document.getElementById('gold-session-badge')
    if (!sessionBadge) {
      sessionBadge = document.createElement('div')
      sessionBadge.id = 'gold-session-badge'
      sessionBadge.style.cssText = `
        position: absolute;
        top: 60px;
        right: 110px;
        background: rgba(0,0,0,0.6);
        border: 1px solid #ffb700;
        border-radius: 4px;
        padding: 4px 8px;
        font-family: 'Orbitron', sans-serif;
        color: #ffb700;
        font-size: 12px;
        z-index: 50;
      `
      document.getElementById('game-cabinet')?.appendChild(sessionBadge)
    }
    sessionBadge.textContent = `SESSION: ${this.host.sessionGoldBalls}`
  }

  async handleGameOverLeaderboard(): Promise<void> {
    // Game over already stopped the recorder; the HUD submits what it recorded.
    const recorder = this.host.replayRecorder
    recorder?.stop(this.host.score)
    const tableMapId = this.host.mapManager?.getCurrentMap() || 'neon-helix'
    const challenge = getChallengeSystem().getActiveChallenge()
    // A weekly run has the week's own board (#444 Slice D).
    const board = challenge?.kind === 'weekly' && challenge.board
      ? challenge.board
      : getDailyCascadeState().getLeaderboardMapId(tableMapId)
    const run: FinishedRun = { payload: recorder?.getLastPayload() ?? null, score: this.host.score, board, tableMapId }
    this.lastRun = run

    if (this.host.score < 1000) {
      console.log('[Leaderboard] Score too low for submission')
      return
    }
    await this.host.ensureOverlaySystems()
    if (this.host.signal.aborted) return
    const leaderboard = this.host.leaderboardSystem
    void leaderboard.flushQueue()
    leaderboard.setContext(board)
    const rank = await leaderboard.checkRank(this.host.score)
    // Offline the rank is unknown: take the name anyway, the run waits for the network.
    const offline = rank === null && typeof navigator !== 'undefined' && navigator.onLine === false
    if (!offline && (rank === null || rank > 100)) {
      console.log('[Leaderboard] Score not in top 100')
      return
    }
    await this.submitRun(run, rank)
  }

  /** Name entry, then the run (replay first, then the score citing it). */
  async submitRun(run: FinishedRun, rank: number | null): Promise<void> {
    const result = await this.host.nameEntryDialog.show(run.score, rank ?? 0)
    if (!result.submitted || !result.name) return
    run.name = result.name
    const replayJson = run.payload ? (await import('../game-elements')).ReplayRecorder.toJSON(run.payload, true) : undefined
    const challengeId = getChallengeSystem().getActiveChallenge()?.id
    const submitResult = await this.host.leaderboardSystem.submitScore({
      name: result.name,
      score: run.score,
      map_id: run.board,
      balls: 1,
      combo_max: this.host.comboCount,
      // Only a v2 challenge (a row on the service) has an id the service knows.
      ...(challengeId && UUID.test(challengeId) ? { challenge_id: challengeId } : {}),
    }, replayJson)
    if (submitResult.success) {
      run.replayId = submitResult.replay_id
      console.log(`[Leaderboard] Score submitted! Rank #${submitResult.rank}`)
      this.host.leaderboardSystem.show()
    } else if (submitResult.queued) {
      this.host.uiManager?.showMessage(submitResult.message ?? 'Score saved; it will be sent when you reconnect', 4000)
    }
  }
}
