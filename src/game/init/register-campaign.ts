/**
 * Init stage `scene_optional`, part 2: the campaign — goal tracker, cinematics, celebration
 * sequencer, UI state, track progression and its supervisor, the rewards manager, the campaign loop,
 * cloud save and the reward notifier.
 *
 * Split out of `game-systems-init.ts`. Returns the rewards manager: `registerAdventureEvents` applies
 * track rewards through it.
 */


import { refreshDailyCascadeUI } from '../daily-cascade-ui'
import { AdventureGoalTracker } from '../../adventure/adventure-goal-tracker'
import { AdventureCinematicSystem } from '../../adventure/adventure-cinematic-system'
import { AdventureCinematicTriggers } from '../../adventure/adventure-cinematic-triggers'
import { AdventureUIStateManager } from '../../adventure/adventure-ui-state'
import { AdventureTrackProgression } from '../../adventure/adventure-track-progression'
import { AdventureProgressionSupervisor } from '../../adventure/adventure-progression-supervisor'
import { initializeCampaignRewardsManager } from '../../adventure/campaign-rewards-manager'
import { CelebrationSequencer } from '../../effects/celebration-sequencer'
import { CampaignRewardNotifier } from '../../adventure/campaign-reward-notifier'
import { wireCampaignLoop } from '../campaign-loop-controller'
import type { Game } from '../../game'
import type { CampaignRewardsManager } from '../../adventure/campaign-rewards-manager'

export function registerCampaign(game: Game): CampaignRewardsManager {
  game.adventureGoalTracker = new AdventureGoalTracker()
  game.adventureGoalTracker.setEventBus(game.eventBus)

  game.adventureCinematicSystem = new AdventureCinematicSystem()
  game.adventureCinematicTriggers = new AdventureCinematicTriggers(game.adventureCinematicSystem)
  game.adventureCinematicTriggers.setEventBus(game.eventBus)
  game.adventureCinematicTriggers.setGoalTracker(game.adventureGoalTracker)

  game.celebrationSequencer = new CelebrationSequencer(
    game.eventBus,
    game.display,
    game.cabinetLighting,
    game.adventureCinematicTriggers
  )

  game.adventureUIStateManager = new AdventureUIStateManager()
  game.adventureUIStateManager.setEventBus(game.eventBus)

  game.adventureTrackProgression = new AdventureTrackProgression()
  refreshDailyCascadeUI()
  game.adventureProgressionSupervisor = new AdventureProgressionSupervisor(
    game.eventBus,
    game.adventureTrackProgression,
    {
      // Pause the supervisor when the game is paused or over so phantom
      // timeouts cannot fire while the game is not in the PLAYING state.
      isAdventureModeActive: () =>
        (game.adventureMode?.isActive() ?? false) &&
        game.stateManager.isPlaying(),
      // When the campaign advances to the next track, tear down the old
      // playfield and build the new one via the slot-adventure orchestrator.
      // switchToTrack() calls rebuildHandleCaches() internally; do NOT call
      // it again here — a double rebuild mid-frame corrupts handle ordering.
      onTrackAdvanced: (nextTrackId) => {
        if (nextTrackId) {
          void game.slotAdventure?.switchToTrack(nextTrackId)
        }
      },
    },
  )
  const campaignRewards = initializeCampaignRewardsManager(game.adventureTrackProgression, game.eventBus)
  campaignRewards.configureAppliers({
    applyBallSkin: (skinId) => game.ballManager?.applyBallSkin(skinId),
    applyCabinetTheme: (themeId) => game.cabinetBuilder?.applyCampaignCabinetTheme(themeId),
    applyBackboxTint: (_tintId) => {
      // Future-proof hook for a dedicated backbox tint pipeline.
    },
  })
  campaignRewards.applyEquippedRewards()

  wireCampaignLoop(game, game.eventBus, campaignRewards)
  // Cloud save, device link codes and export / import (#444 Slice D), off the boot path.
  void import('../campaign-save-ui').then((m) => m.startCampaignSave(campaignRewards, {
    signal: game.signal,
    showMessage: (msg, ms) => game.showMessage(msg, ms),
    onDispose: (reset) => game.addDisposeHook(reset),
  }))

  const notifier = new CampaignRewardNotifier(game.eventBus)
  notifier.flushUnseen()

  return campaignRewards
}
