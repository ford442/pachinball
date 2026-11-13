/**
 * Init stages `scene_critical` and `scene_gameplay_build`: the cabinet and main ball (and the C++
 * flipper hinges that make Start safe), then the rest of the gameplay scene after one yielded frame.
 *
 * Split out of `game-systems-init.ts`.
 */

import type { Game } from '../../game'

/** Build the critical scene; fails the stage if a table that needs both C++ flipper hinges lacks them. */
export async function registerCriticalScene(game: Game): Promise<void> {
  await game.sceneBuilder?.buildCriticalScene({
    onCabinetProgress: (progress) => {
      game.uiManager?.showLoadingState(true, {
        progress,
        label: 'Loading cabinet…',
      })
    },
  })
  game.cabinetBuilder?.updateCabinetLightExclusions()

  // Owner modes (wasm-owner / wasm-worker) move the flippers only through C++ hinges, which
  // rebuildHandleCaches() realises. It used to run first in scene_gameplay_build, after Start
  // was enabled, so a flip before that stage (or every flip, if the stage failed) drove
  // nothing. Realise them here and fail the stage, like the joint check in
  // buildCriticalScene, if a table that needs them does not get both.
  game.physicsController?.rebuildHandleCaches()
  const hinges = game.physicsController?.getWasmFlipperHingeCount() ?? null
  if (hinges !== null && hinges < 2) {
    throw new Error(`Critical scene incomplete: ${hinges}/2 C++ flipper hinges`)
  }
}

export async function registerGameplayBuild(game: Game): Promise<void> {
  await game.sceneBuilder?.yieldFrame()
  // dispose() can land during the one-frame yield; the helpers below are already nulled/disposed.
  if (game.signal.aborted) return
  game.sceneBuilder?.buildGameplayScene()
  game.physicsController?.rebuildHandleCaches()
  game.uiManager?.showLoadingState(false, { phase: 'cosmetic' })
}
