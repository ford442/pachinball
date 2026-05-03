/**
 * Game HUD Controller — HUD updates, combo tracking, gold ball display, leaderboard.
 */

import type { BallManager } from '../game-elements/ball-manager'
import type { BallStackVisual } from '../game-elements/ball-stack-visual'
import type { EffectsSystem } from '../effects'
import type { GameUIManager } from './game-ui'
import type { AdventureState } from '../game-elements/adventure-state'
import type { LeaderboardSystem } from '../game-elements/leaderboard-system'
import type { NameEntryDialog } from '../game-elements/name-entry-dialog'
import type { TableMapManager } from './game-maps'
import { BallType } from '../config'

export interface HUDHost {
  readonly ballManager: BallManager | null
  readonly ballStackVisual: BallStackVisual | null
  readonly effects: EffectsSystem | null
  readonly uiManager: GameUIManager | null
  readonly adventureState: AdventureState
  readonly leaderboardSystem: LeaderboardSystem
  readonly nameEntryDialog: NameEntryDialog
  readonly mapManager: TableMapManager | null

  score: number
  lives: number
  comboCount: number
  comboTimer: number
  bestScore: number
  goldBallStack: Array<{ type: BallType; timestamp: number }>
  sessionGoldBalls: number

  updateHUD(): void
}

export class GameHUD {
  private readonly host: HUDHost

  constructor(host: HUDHost) {
    this.host = host
  }

  updateHUD(): void {
    const { uiManager, score, lives, comboCount, bestScore } = this.host
    uiManager?.updateHUD({ score, lives, combo: comboCount, bestScore })
    this.host.adventureState.setGoalProgress('reach-score', score)
    this.updateAdventureHUD()
  }

  private updateAdventureHUD(): void {
    const { uiManager, adventureState } = this.host
    const level = adventureState.getCurrentLevel()
    if (!level) {
      uiManager?.hideAdventureHUD()
      return
    }
    uiManager?.updateAdventureHUD(
      {
        name: level.name,
        goals: level.goals.map(g => ({
          description: g.description,
          current: g.current,
          target: g.target,
        })),
      },
      adventureState.getOverallCompletionPercent()
    )
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
    if (this.host.score < 1000) {
      console.log('[Leaderboard] Score too low for submission')
      return
    }
    this.host.leaderboardSystem.setContext(this.host.mapManager?.getCurrentMap() || 'neon-helix')
    const rank = await this.host.leaderboardSystem.checkRank(this.host.score)
    if (rank === null || rank > 100) {
      console.log('[Leaderboard] Score not in top 100')
      return
    }
    const result = await this.host.nameEntryDialog.show(this.host.score, rank)
    if (result.submitted && result.name) {
      const submitResult = await this.host.leaderboardSystem.submitScore({
        name: result.name,
        score: this.host.score,
        map_id: this.host.mapManager?.getCurrentMap() || 'neon-helix',
        balls: 1,
        combo_max: this.host.comboCount,
      })
      if (submitResult.success) {
        console.log(`[Leaderboard] Score submitted! Rank #${submitResult.rank}`)
        this.host.leaderboardSystem.show()
      }
    }
  }
}
