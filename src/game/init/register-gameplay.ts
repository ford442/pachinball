/**
 * Init stage `scene_gameplay`: the table's objects, the ball manager and adventure mode — the
 * gameplay objects that sit on the physics world.
 *
 * Split out of `game-systems-init.ts`; runs after `registerRendering`.
 */


import { GameConfig } from '../../config'
import { BallManager } from '../../game-elements'
import { GameObjects } from '../../objects'
import { AdventureMode } from '../../adventure'
import type { Game } from '../../game'
import type { InitContext } from './init-context'

export function registerGameplay(game: Game, { scene, world, rapier }: InitContext): void {
  game.gameObjects = new GameObjects(scene, world, rapier, GameConfig)
  game.ballManager = new BallManager(scene, world, rapier, game.gameObjects.getBindings())
  game.ballManager.setOnGoldBallCollected((type, points) => {
    console.log(`[Game] Gold ball collected: ${type}, points: ${points}`)
  })
  // Wire fresnel rim event subscriptions (fever:start / fever:end → gold ball rims)
  if (game.effects) {
    game.effects.setEventBus(game.eventBus)
    game.effects.setBallMeshProvider(game.ballManager)
  }
  game.adventureMode = new AdventureMode(scene, world, rapier)
  game.adventureMode.setAccessibilityConfig(game.accessibility)

  game.setupFeederEventHandlers()
}
