/**
 * Campaign loop — intermission rewards, celebrations, persistence, and unlock surfacing.
 */

import { DisplayState } from '../game-elements/display-config'
import { TRACK_CATALOG } from '../game-elements/adventure-track-progression'
import type { AdventureTrackProgression } from '../game-elements/adventure-track-progression'
import type { CampaignRewardsManager } from '../game-elements/campaign-rewards-manager'
import type { EventBus } from '../game/event-bus'

export interface CampaignLoopHost {
  score: number
  adventureMode: { isActive(): boolean } | null
  adventureTrackProgression: AdventureTrackProgression | null
  display: {
    setStoryText(text: string): void
    startSlotSpin(): void
    setDisplayState?(state: DisplayState): void
  } | null
  effects: {
    startJackpotSequence(): void
    setLightingMode(mode: string, intensity: number): void
  } | null
  uiManager: {
    showMessage(message: string, duration?: number): void
    showTrackUnlockToast(trackName: string, scoreGoal: number): void
    showCampaignIntermission(trackName: string): void
  } | null
  slotAdventure: { forceSlotSpin(): void } | null
}

export function wireCampaignLoop(
  host: CampaignLoopHost,
  eventBus: EventBus,
  campaignRewards: CampaignRewardsManager,
): () => void {
  const progression = host.adventureTrackProgression
  if (progression) {
    progression.onProgressChanged = () => {
      campaignRewards.persistState()
    }
  }

  const unsubscribers: Array<() => void> = []

  unsubscribers.push(
    eventBus.on('track:goal-reached', ({ trackId, scoreDelta, recommendedScore, timeRemaining }) => {
      if (!host.adventureMode?.isActive()) return
      const trackName = TRACK_CATALOG[trackId]?.name ?? trackId.replace(/_/g, ' ')
      host.display?.setStoryText(`GOAL REACHED — ${trackName.toUpperCase()}`)
      host.uiManager?.showMessage(
        `Portal online! ${scoreDelta.toLocaleString()} / ${recommendedScore.toLocaleString()} pts · ${Math.ceil(timeRemaining)}s left`,
        3200,
      )
      host.effects?.setLightingMode('reach', 0.85)
      eventBus.emit('display:set', DisplayState.REACH)
      eventBus.emit('effect:bloom', { intensity: 1.2, duration: 0.8 })
      eventBus.emit('sound:play', { soundKey: 'reach-trigger' })
    }),
  )

  unsubscribers.push(
    eventBus.on('track:completed', ({ trackId, totalReward }) => {
      const trackName = TRACK_CATALOG[trackId]?.name ?? trackId.replace(/_/g, ' ')
      const stats = progression?.getStats()
      const isCampaignComplete =
        stats != null && stats.completedTracks >= stats.totalTracks

      host.uiManager?.showCampaignIntermission(trackName)
      host.display?.setStoryText(`TRACK CLEARED — +${Math.round(totalReward).toLocaleString()} SHARDS`)

      // Between-track slot mini-game (forced spin bypasses cooldown for PoC loop).
      eventBus.emit('display:set', DisplayState.REACH)
      host.slotAdventure?.forceSlotSpin()

      const nextId = progression?.getNextTrackId() ?? null
      const nextInfo = nextId ? TRACK_CATALOG[nextId] : null
      if (nextInfo) {
        host.uiManager?.showTrackUnlockToast(nextInfo.name, nextInfo.recommendedScore)
      }

      if (isCampaignComplete) {
        host.effects?.startJackpotSequence()
        eventBus.emit('display:set', DisplayState.JACKPOT)
        host.uiManager?.showMessage('CAMPAIGN COMPLETE — Cyber-Shock Jackpot!', 5000)
      }
    }),
  )

  return () => {
    if (progression) {
      progression.onProgressChanged = null
    }
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}
