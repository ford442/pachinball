/**
 * Game Systems Initializer — the staged subsystem wiring, as a sequence of `registerX(game)` calls.
 *
 * Extracted from game.ts to decouple initialization orchestration from the main Game class. Each
 * stage's body lives in `src/game/init/` (one `register*` per subsystem); this file keeps only the
 * order, the checkpoint stages they run under, and the loading-screen bookkeeping around them.
 */

import type { Game } from '../game'
import type { InitContext } from './init/init-context'
import { loadDebugTools, registerRendering } from './init/register-rendering'
import { registerGameplay } from './init/register-gameplay'
import { registerObstacles } from './init/register-obstacles'
import { registerCampaign } from './init/register-campaign'
import { registerAdventureEvents } from './init/register-adventure-events'
import { registerStaticScene } from './init/register-static-scene'
import { registerCriticalScene, registerGameplayBuild } from './init/register-scene-build'
import { registerManagers } from './init/register-managers'

export class GameSystemsInitializer {
  constructor(private game: Game) {}

  public async initAll(): Promise<void> {
    const { game } = this
    if (!game.scene) throw new Error('Scene not ready')
    if (!game.physics.isReady()) throw new Error('Physics not ready')
    const ctx: InitContext = {
      scene: game.scene,
      // The C++ owner's table world + descriptor API, or Rapier on the explicit/degrade path.
      world: game.physics.getWorld(),
      rapier: game.physics.getPhysicsApi(),
    }

    game.uiManager?.showLoadingState(true, { label: 'LOADING...', progress: 0 })
    game.uiManager?.setStartButtonEnabled(false)
    // Debug tooling is only reachable with `?debug=1` (or in DEV builds), so it stays out of the
    // entry chunk. Load it before the sync stage below so the stage itself never awaits.
    const debugTools = game.isDebugHUDAvailable() ? await loadDebugTools() : null
    if (game.signal.aborted) return
    // The static-scene machinery (gate, frozen sets, watchers) is its own chunk, kept out of the
    // entry chunk's budget. Start loading it now; it is awaited and installed just before the
    // critical scene is built, so the cabinet load and the main ball are seen by the gate.
    const staticSceneChunk = import('./static-scene-install')
    staticSceneChunk.catch(() => undefined) // reported where it is awaited
    await game.runCheckpointStage('scene_rendering', () => registerRendering(game, ctx, debugTools))
    await game.runCheckpointStage('scene_gameplay', () => registerGameplay(game, ctx))
    await game.runCheckpointStage('scene_optional', () => {
      registerObstacles(game, ctx)
      const campaignRewards = registerCampaign(game)
      registerAdventureEvents(game, campaignRewards)
    }, true)

    if (!(await registerStaticScene(game, ctx, staticSceneChunk))) return

    await game.runCheckpointStage('scene_critical', () => registerCriticalScene(game))
    game.ready = true
    game.uiManager?.setStartButtonEnabled(true)
    game.uiManager?.showLoadingState(false, { phase: 'gameplay' })

    await game.runCheckpointStage('scene_gameplay_build', () => registerGameplayBuild(game))
    game.scheduleCosmeticSceneBuild()
  }

  public async postInitManagers(): Promise<void> {
    await this.game.runCheckpointStage('managers_postinit', () => registerManagers(this.game), true)
  }
}
