/**
 * Init step between `scene_optional` and `scene_critical`: install the static-scene machinery (gate,
 * frozen sets, watchers) and hand the gate to the subsystems that thaw it.
 *
 * Split out of `game-systems-init.ts`. The machinery is its own chunk, kept out of the entry chunk's
 * budget: `initAll` starts the dynamic import first thing and this step awaits it just before the
 * critical scene is built, so the cabinet load and the main ball are seen by the gate.
 */

import { GameConfig } from '../../config'
import type { Game } from '../../game'
import type { InitContext } from './init-context'

export type StaticSceneChunk = Promise<typeof import('../static-scene-install')>

/**
 * Resolves `false` when the Game was disposed while the chunk loaded (`initAll` stops there), `true`
 * otherwise — including when the chunk failed, which only leaves the scene unfrozen.
 */
export async function registerStaticScene(game: Game, { scene }: InitContext, staticSceneChunk: StaticSceneChunk): Promise<boolean> {
  try {
    const { installStaticScene } = await staticSceneChunk
    if (game.signal.aborted) return false
    const renderer = game.renderer?.getStaticSceneInputs()
    const install = installStaticScene({
      scene,
      eventBus: game.eventBus,
      search: window.location.search,
      userAgent: navigator.userAgent,
      skyboxSize: GameConfig.visuals.skyboxSize,
      frozenMaterials: renderer?.frozenMaterials ?? [],
      clampLights: renderer?.clampLights,
      staticShadows: renderer?.staticShadows,
    })
    game.staticScene = install
    game.staticSceneGate = install.gate
    game.ballManager?.setStaticSceneGate(install.gate)
    game.adventureMode?.setStaticSceneGate(install.gate)
    game.display?.setStaticSceneGate(install.gate)
  } catch (error) {
    // An optimisation, not a dependency: without it nothing is frozen and the game runs as before.
    console.warn('[Game] Static-scene chunk unavailable; the scene stays unfrozen', error)
  }
  return true
}
