/**
 * Post-init stage `managers_postinit`: the managers that need the ball, effects and display up —
 * the adventure manager, the table-map manager, the level loader, track theming and the cabinet
 * manager — and the feeder event handlers that need the adventure manager.
 *
 * Split out of `game-systems-init.ts`; runs from `postInitManagers`, after `initAll`.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { GAME_TUNING } from '../../config'
import { getMaterialLibrary } from '../../materials'
import { getScoringBreakdownManager } from '../../game-elements'
import { initializeTrackThemingSystem } from '../../adventure/track-theming-system'
import { AdventureManager } from '../game-adventure'
import { TableMapManager } from '../game-maps'
import { CabinetManager } from '../game-cabinet'
import type { Game } from '../../game'

/** Caller-owned out-vector for `getBallPosition`; consumers clone what they keep. */
const scratchBallPos = new Vector3()

export function registerManagers(game: Game): void {
  game.adventureManager = new AdventureManager(
    game.scene!,
    game.physics,
    game.stateManager,
    game.uiManager!,
    {
      effects: game.effects,
      display: game.display,
      ballManager: game.ballManager,
      soundSystem: game.soundSystem,
    },
    {
      onZoneEnter: (_zone, config, isMajor) => {
        game.effects?.updateEnvironmentColor?.(config.primaryColor)
        if (isMajor && game.hapticManager) {
          game.hapticManager.jackpot()
        }
      },
      onScoreAward: (points, reason) => {
        game.score += points
        getScoringBreakdownManager().recordScore(points, 'adventure-goal-award')
        game.updateHUD()
        game.uiManager?.showMessage(`${reason}: +${points}`, 1000)
        const pos = game.physicsController?.getBallPosition(scratchBallPos)
        if (pos) game.effects?.spawnFloatingNumber(points, pos)
      },
      onReachTriggered: () => game.tryActivateSlotMachine(),
      onAdventureEnd: () => {
        game.score += GAME_TUNING.scoring.adventureEndBonus
        getScoringBreakdownManager().recordScore(GAME_TUNING.scoring.adventureEndBonus, 'adventure-end-bonus')
        game.updateHUD()
        game.effects?.startJackpotSequence()
        const pos = game.physicsController?.getBallPosition(scratchBallPos)
        if (pos) game.effects?.spawnFloatingNumber(GAME_TUNING.scoring.adventureEndBonus, pos)
      },
    }
  )

  game.mapManager = new TableMapManager(game.scene!, {
    onMapChange: (_type, config) => {
      game.ballManager?.updateBallMaterialColor(config.baseColor)
      const matLib = getMaterialLibrary(game.scene!)
      matLib.updateFlipperMaterialEmissive(config.baseColor)
      matLib.updatePinMaterialEmissive(config.baseColor)
      matLib.updateBrushedMetalMaterialEmissive(config.baseColor)
      matLib.updateChromeMaterialEmissive(config.baseColor)
      game.gameObjects?.updateBumperColors(config.baseColor)
      game.effects?.setCabinetColor(config.baseColor)
      game.cabinetBuilder?.updateCabinetLightingForMap()
    },
    onPopupShow: (name, color) => game.mapCabinet?.showMapNamePopup(name, color),
    onMapSelectorUpdate: () => game.settingsUI?.updateMapSelectorUI(),
  })
  game.mapManager.setBloomPipeline()

  game.levelLoader = game.createLevelLoader()

  const trackThemingSystem = initializeTrackThemingSystem({
    gameObjects: game.gameObjects,
    ballManager: game.ballManager,
    spinnerVisuals: game.spinnerVisuals,
    gateStates: game.gateStates,
    cabinetNeonLights: game.cabinetNeonLights,
    display: game.display,
    effects: game.effects,
    mapManager: game.mapManager,
    qualityTier: game.qualityTier,
    scene: game.scene!,
    adventureMode: game.adventureMode,
  })
  game.scene?.onBeforeRenderObservable.add(() => {
    const activeTrack = game.adventureMode?.getCurrentZone() ?? null
    trackThemingSystem.update(activeTrack)
  })

  game.cabinetManager = new CabinetManager(game.scene!, {
    onPopupShow: (name) => game.mapCabinet?.showCabinetPopup(name),
    onUISelect: () => game.mapCabinet?.updateCabinetSelectorUI(),
    initialType: game.machine?.cabinet,
  })

  game.wireFeederEventHandlers()
}
