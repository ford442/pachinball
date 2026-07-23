import type { Scene } from '@babylonjs/core'
import type { ScoringBreakdownSnapshot } from '../game-elements/scoring-breakdown'
import { hideAdventureHUD, updateAdventureHUD, updateCampaignHUD } from './game-ui-adventure-hud'
import {
  bindHUDElements,
  ensurePauseButton,
  initPrefersReducedMotionListener,
  setPauseButtonHandler,
  updateComboChainMeter,
  updateGoldBallDisplay,
  updateHUD,
} from './game-ui-hud'
import {
  hideCountdownTimer,
  hidePortalOverlay,
  hideScoringBreakdown,
  showCabinetPopup,
  showCampaignIntermission,
  showLoadingState as showLoadingStatePopup,
  setStartButtonEnabled as setStartButtonEnabledPopup,
  showMapNamePopup,
  showMessage,
  showPortalOverlay,
  showRewardToast,
  showScoringBreakdown,
  showTrackUnlockToast,
  updateCountdownTimer,
} from './game-ui-popups'
import { hidePauseMenu, showPauseMenu } from './game-ui-settings'
import type {
  AdventureLevel,
  HUDData,
  PauseMenuHandlers,
  PauseMenuSettings,
  ScoringBreakdownDisplayOptions,
} from './game-ui-types'

export type {
  PopupConfig,
  HUDData,
  GoldBallCounts,
  AdventureGoal,
  AdventureLevel,
  ScoringBreakdownDisplayOptions,
  PauseMenuSettings,
  PauseMenuHandlers,
} from './game-ui-types'

export interface GameUIRuntimeState {
  activePopups: Map<string, HTMLElement>
  hudElements: Map<string, HTMLElement>
  goldBallCounter: HTMLElement | null
  loadingOverlay: HTMLElement | null
  scoreElement: HTMLElement | null
  livesElement: HTMLElement | null
  ballsElement: HTMLElement | null
  comboElement: HTMLElement | null
  bestHudElement: HTMLElement | null
  comboChainMeter: HTMLElement | null
  scoringBreakdownPanel: HTMLElement | null
  scoringBreakdownKeyHandler: ((event: KeyboardEvent) => void) | null
  pauseMenuPanel: HTMLElement | null
  pauseButton: HTMLButtonElement | null
  pauseButtonHandler: (() => void) | null
  prefersReducedMotion: boolean
}

export class GameUIManager {
  private readonly state: GameUIRuntimeState = {
    activePopups: new Map(),
    hudElements: new Map(),
    goldBallCounter: null,
    loadingOverlay: null,
    scoreElement: null,
    livesElement: null,
    ballsElement: null,
    comboElement: null,
    bestHudElement: null,
    comboChainMeter: null,
    scoringBreakdownPanel: null,
    scoringBreakdownKeyHandler: null,
    pauseMenuPanel: null,
    pauseButton: null,
    pauseButtonHandler: null,
    prefersReducedMotion: false,
  }

  constructor(scene: Scene) {
    void scene
    bindHUDElements(this.state)
    initPrefersReducedMotionListener(this.state)
    ensurePauseButton(this.state)
  }

  setPauseButtonHandler(handler: () => void): void { setPauseButtonHandler(this.state, handler) }
  showCabinetPopup(name: string): void { showCabinetPopup(this.state, name) }
  showMapNamePopup(name: string, color: string): void { showMapNamePopup(this.state, name, color) }
  showLoadingState(
    show: boolean,
    optionsOrPhase?: import('./game-ui-popups').LoadingStateOptions | 'gameplay' | 'cosmetic',
  ): void {
    showLoadingStatePopup(this.state, show, optionsOrPhase)
  }
  setStartButtonEnabled(enabled: boolean): void {
    setStartButtonEnabledPopup(enabled)
  }
  updateHUD(data: HUDData): void { updateHUD(this.state, data) }
  updateComboChainMeter(progress: number, target: number, pulseHighlight: boolean): void {
    updateComboChainMeter(this.state, progress, target, pulseHighlight)
  }
  updateGoldBallDisplay(goldPlated: number, solidGold: number): void {
    updateGoldBallDisplay(this.state, goldPlated, solidGold)
  }
  updateAdventureHUD(level: AdventureLevel | null, completionPercent: number): void { updateAdventureHUD(level, completionPercent) }
  updateCampaignHUD(state: {
    trackName: string
    modeLabel: string
    scoreCurrent: number
    scoreTarget: number
    timeRemaining: number
    timeLimit: number
    nextTrackName: string | null
    nextTrackGoal: number | null
    goals: Array<{ description: string; current: number; target: number; completed: boolean }>
    shardTotal: number
    campaignPercent: number
  }): void { updateCampaignHUD(state) }
  showTrackUnlockToast(trackName: string, scoreGoal: number): void { showTrackUnlockToast(this.state, trackName, scoreGoal) }
  showCampaignIntermission(clearedTrackName: string): void { showCampaignIntermission(this.state, clearedTrackName) }
  showMessage(message: string, duration = 2000): void { showMessage(this.state, message, duration) }
  showRewardToast(shardsEarned: number, totalShards: number, unlockedRewards: string[] = []): void {
    showRewardToast(this.state, shardsEarned, totalShards, unlockedRewards)
  }
  hideAdventureHUD(): void { hideAdventureHUD() }
  updateCountdownTimer(secondsRemaining: number, timeLimitSeconds: number): void {
    updateCountdownTimer(this.state, secondsRemaining, timeLimitSeconds)
  }
  hideCountdownTimer(): void { hideCountdownTimer() }
  showPortalOverlay(kind: 'success' | 'timeout', trackId: string, autoDismissMs = 3500): void {
    showPortalOverlay(this.state, kind, trackId, autoDismissMs)
  }
  hidePortalOverlay(): void { hidePortalOverlay(this.state) }
  showScoringBreakdown(snapshot: ScoringBreakdownSnapshot, options: ScoringBreakdownDisplayOptions = {}): void {
    showScoringBreakdown(this.state, snapshot, options)
  }
  hideScoringBreakdown(): void { hideScoringBreakdown(this.state) }
  showPauseMenu(settings: PauseMenuSettings, handlers: PauseMenuHandlers): void { showPauseMenu(this.state, settings, handlers) }
  hidePauseMenu(): void { hidePauseMenu(this.state) }

  dispose(): void {
    for (const popup of this.state.activePopups.values()) popup.remove()
    this.state.activePopups.clear()
    this.state.hudElements.clear()
    this.state.goldBallCounter?.remove()
    this.state.goldBallCounter = null
    hideCountdownTimer()
    hidePortalOverlay(this.state)
    hideScoringBreakdown(this.state)
    hidePauseMenu(this.state)
    this.state.comboChainMeter?.remove()
    this.state.comboChainMeter = null
    this.state.pauseButton?.remove()
    this.state.pauseButton = null
    if (this.state.loadingOverlay) {
      this.state.loadingOverlay.remove()
      this.state.loadingOverlay = null
    }
    this.state.scoreElement = null
    this.state.livesElement = null
    this.state.comboElement = null
    this.state.bestHudElement = null
  }
}
