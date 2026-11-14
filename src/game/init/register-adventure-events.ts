/**
 * Init stage `scene_optional`, part 3: the adventure and portal event wiring.
 *
 * `AdventureMode`'s event listener (START / END / ZONE_ENTER / PORTAL_*), the `portal:open` handler,
 * and the EventBus listeners for track completion, adventure end and game over.
 *
 * Split out of `game-systems-init.ts`. The portal lifecycle itself (register / entry / unregister of
 * the sensor) lives in `portal-sensor-lifecycle.ts`; the PORTAL_DEACTIVATED case here MUST call
 * `unregisterClosedPortal()`.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DisplayState } from '../../display/display-types'
import { getScoringBreakdownManager } from '../../game-elements'
import { AdventureTrackType, isAdventureTrackType } from '../../adventure'
import { registerOpenPortal, unregisterClosedPortal, type ClosedPortal } from '../portal-sensor-lifecycle'
import type { Game } from '../../game'
import type { PachinballEventMap } from '../../core/event-bus'
import type { CampaignRewardsManager } from '../../adventure/campaign-rewards-manager'

interface PortalActivatedEventData {
  trackId: AdventureTrackType
  kind: 'success' | 'timeout'
  mode: 'STATIONARY_TABLE' | 'EXTENDED_MAP'
}

interface PortalEnteredEventData {
  id: string
  trackId: AdventureTrackType
  kind: 'success' | 'timeout'
  position: Vector3
}

type PortalDeactivatedEventData = ClosedPortal

export function registerAdventureEvents(game: Game, campaignRewards: CampaignRewardsManager): void {
  // Integration plan:
  // 1) Supervisor emits `portal:open` with track + result kind.
  // 2) AdventureMode activates a dormant physical portal sensor/mesh.
  // 3) On entry, AdventureMode teleports + switchZone and emits `portal:entered`.
  game.adventureMode?.setEventListener((event, data) => {
    console.log(`Adventure Event: ${event}`)
    switch (event) {
      case 'START': {
        const currentTrack = game.adventureTrackProgression?.getCurrentTrack()
        const fallbackTrackType = currentTrack && isAdventureTrackType(currentTrack) ? currentTrack : undefined
        const trackType = (data as AdventureTrackType | undefined) ?? fallbackTrackType
        game.adventureManager?.startAdventure(trackType)
        game.eventBus.emit('adventure:start')
        game.eventBus.emit('display:set', DisplayState.ADVENTURE)
        const trackName = (trackType ? game.slotAdventure?.getTrackDisplayName(trackType) : undefined) ?? 'UNKNOWN SECTOR'
        game.display?.setTrackInfo(trackName)
        game.display?.setStoryText(`ENTERING: ${trackName}`)
        game.effects?.setLightingMode('reach', 0.5)
        game.effects?.setAtmosphereState('ADVENTURE')
        if (trackType) {
          game.adventureTrackProgression?.setCurrentTrack(trackType)
          game.adventureGoalTracker?.initializeTrack(trackType)
          game.adventureProgressionSupervisor?.startTrack(trackType, game.score)
        }
        break
      }
      case 'END':
        game.adventureManager?.endAdventure()
        game.eventBus.emit('adventure:end')
        game.eventBus.emit('display:set', DisplayState.IDLE)
        game.effects?.setLightingMode('normal', 1.0)
        game.effects?.setAtmosphereState('IDLE')
        game.adventureProgressionSupervisor?.reset()
        break
      case 'ZONE_ENTER': {
        const zoneData = data as {
          zone: AdventureTrackType
          previousZone: AdventureTrackType | null
          isMajor: boolean
          ballPosition?: Vector3
        }
        game.scenarioManager?.handleZoneTransition(zoneData.zone, zoneData.previousZone, zoneData.isMajor)
        break
      }
      case 'PORTAL_ACTIVATED': {
        const portalData = data as PortalActivatedEventData
        const shouldUseFlashes = shouldUseFlashEffects(game)
        game.display?.setStoryText(
          portalData.kind === 'success'
            ? `EXIT PORTAL ONLINE: ${portalData.trackId.replace(/_/g, ' ')}`
            : `EMERGENCY EXIT ONLINE: ${portalData.trackId.replace(/_/g, ' ')}`
        )
        game.eventBus.emit('effect:bloom', {
          intensity: portalData.kind === 'success' ? 1.35 : 1.05,
          duration: 0.65,
        })
        if (shouldUseFlashes) {
          game.eventBus.emit('effect:flash', {
            color: portalData.kind === 'success' ? '#00d9ff' : '#ff4400',
            intensity: portalData.kind === 'success' ? 0.9 : 0.7,
            duration: 0.45,
          })
        }
        game.eventBus.emit('sound:play', {
          soundKey: portalData.kind === 'success' ? 'portal-open-success' : 'portal-open-timeout',
        })
        break
      }
      case 'PORTAL_ENTERED': {
        const portalData = data as PortalEnteredEventData
        game.display?.setStoryText(`WORMHOLE JUMP: ${portalData.trackId.replace(/_/g, ' ')}`)
        game.eventBus.emit('sound:play', { soundKey: 'portal-enter' })
        // Finalize the completed track through the supervisor.
        // The supervisor's onTrackAdvanced callback (wired above) will drive
        // teardown of the old track, build of the new track, cinematic start,
        // and UI reset via slotAdventure.switchToTrack().
        //
        // Portal sensor unregistration is handled by the PORTAL_DEACTIVATED
        // case below.  During the onPortalEntered() call chain, switchToTrack()
        // → adventureMode.switchToTrack() → deactivateExitPortal() fires
        // PORTAL_DEACTIVATED with the valid handle.  Calling getPortalSensorHandle()
        // here would already return -1 (portal nulled mid-chain), so a second
        // unregisterPortalSensor call would always be a no-op.
        game.adventureProgressionSupervisor?.onPortalEntered(
          game.score,
          game.sessionGoldBalls,
          {
            id: portalData.id,
            position: portalData.position,
          },
        )
        break
      }
      case 'PORTAL_DEACTIVATED': {
        // Every teardown path (entry, replacement, switchZone, switchToTrack, end)
        // lands here with the handle read from the payload: getPortalSensorHandle()
        // is already -1 by now.
        unregisterClosedPortal(game, data as PortalDeactivatedEventData)
        break
      }
    }
  })

  game.eventBus.on('portal:open', (payload) => handlePortalOpen(game, payload))

  // Note: 'track:completed' is emitted by the supervisor inside onPortalEntered().
  // The old subscription that re-emitted 'portal:open' here was removed because
  // the supervisor already emits 'portal:open' via resolveOutcome() when the score
  // goal is hit — reactivating the portal after entry would be incorrect.
  game.eventBus.on('track:completed', ({ totalReward }) => {
    const scoringBreakdown = getScoringBreakdownManager()
    const rewardResult = campaignRewards.applyTrackReward(totalReward)
    game.uiManager?.showRewardToast(
      totalReward,
      rewardResult.totalShards,
      rewardResult.newlyUnlocked.map((reward) => reward.name),
    )
    const bestDelta = Math.max(0, game.score - game.bestScore)
    game.uiManager?.showScoringBreakdown(scoringBreakdown.getSnapshot(), {
      finalScore: game.score,
      bestScore: game.bestScore,
      bestDelta,
      rewardShards: totalReward,
      autoDismissMs: 6000,
    })
    scoringBreakdown.reset()
  })

  // Hide countdown when adventure ends cleanly (END event resets supervisor)
  game.eventBus.on('adventure:end', () => {
    game.uiManager?.hideCountdownTimer()
    game.uiManager?.hidePortalOverlay()
  })

  // Reset the supervisor on game over so the timer cannot keep running in the
  // background and stale track state cannot leak into the next game session.
  game.eventBus.on('game:over', () => {
    game.adventureProgressionSupervisor?.reset()
    game.uiManager?.hideCountdownTimer()
    game.uiManager?.hidePortalOverlay()
  })
}

/**
 * Handles the `portal:open` event: activates the exit portal sensor and
 * drives the portal overlay/display state. If `AdventureMode.activateExitPortal()`
 * fails (e.g. adventure mode is no longer active), no sensor is registered and
 * no portal UI/display change occurs — `portal:activation-failed` is emitted
 * so the supervisor can re-attempt on the next tick.
 */
export function handlePortalOpen(game: Game, { trackId, kind, mode }: PachinballEventMap['portal:open']): void {
  const resolvedTrack = resolvePortalTrack(game, trackId)
  const resolvedMode = mode || (game.gameMode === 'dynamic' ? 'EXTENDED_MAP' : 'STATIONARY_TABLE')
  const shouldUseFlashes = shouldUseFlashEffects(game)
  const ok = game.adventureMode?.activateExitPortal(resolvedTrack, kind, resolvedMode) ?? false
  if (!ok) {
    console.warn('[portal:open] activation failed', { trackId, kind, mode })
    game.uiManager?.showMessage('Portal failed — retrying...', 2000)
    game.eventBus.emit('portal:activation-failed', { trackId, kind, mode })
    return
  }
  // Register the portal's sensor as a zone: the engine reports a ball's begin
  // contact (swept over the substep) and the zone system fires onPortalContact,
  // which completes the portal. PORTAL_DEACTIVATED unregisters both.
  registerOpenPortal(game, kind)
  // Show the portal overlay on the HUD
  game.uiManager?.showPortalOverlay(kind, trackId)
  // The countdown timer is no longer needed once the portal is open
  game.uiManager?.hideCountdownTimer()
  // Backbox display: dramatic portal announcement + state switch
  if (kind === 'success') {
    game.display?.setStoryText('PORTAL OPEN\nSHOOT TO ADVANCE')
    game.eventBus.emit('display:set', DisplayState.PORTAL_OPEN)
    game.uiManager?.showMessage('Portal open — advance now!', 2000)
  } else {
    game.display?.setStoryText('TIME OUT — EMERGENCY ESCAPE\nREWARD PENALTY ACTIVE')
    game.eventBus.emit('display:set', DisplayState.ESCAPE)
    game.uiManager?.showMessage('Time out! Enter the portal to continue (reduced rewards).', 2400)
  }
  if (shouldUseFlashes) {
    game.display?.triggerCRTFlash()
  }
}

function resolvePortalTrack(game: Game, trackId: string): AdventureTrackType {
  if (isAdventureTrackType(trackId)) {
    return trackId
  }

  const activeZone = game.adventureMode?.getCurrentZone()
  if (activeZone && isAdventureTrackType(activeZone)) {
    return activeZone
  }

  return AdventureTrackType.NEON_HELIX
}

function shouldUseFlashEffects(game: Game): boolean {
  // Gate rapid flash effects behind both reduced-motion and safety threshold
  // preferences so portal transitions stay accessible.
  return !game.accessibility.reducedMotion && game.accessibility.flashFrequencyMax > 1
}
