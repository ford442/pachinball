/**
 * Init stage `scene_rendering`: the skybox, effects, backbox display, cabinet lighting, debug tooling
 * and the dynamic world — everything that draws before any gameplay object exists.
 *
 * One of the `register*` stages `GameSystemsInitializer.initAll` runs in order; split out of
 * `game-systems-init.ts` with no change to the order of what it builds.
 */

import type { InitContext } from './init-context'
import { createStandardMaterial } from '../../materials/material-basic'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { GameConfig } from '../../config'
import { adaptLegacyConfig, type DisplayConfig } from '../../display/display-types'
import { machineBackboxConfig } from '../../machine/machine-backbox'
import { PALETTE, INTENSITY, emissive, getDynamicWorld, SettingsManager } from '../../game-elements'
import { DisplaySystem } from '../../display'
import { EffectsSystem } from '../../effects'
import { BallStackVisual } from '../../game-elements/ball-stack-visual'
import { CabinetLighting } from '../../effects/cabinet-lighting'
import type { Game } from '../../game'

/** The `?debug=1` / DEV-only tooling, split into its own chunk (see initAll). */
export interface DebugTools {
  DebugHUD: typeof import('../../game-elements/debug-hud').DebugHUD
  GameDebug: typeof import('../game-debug').GameDebug
}

export async function loadDebugTools(): Promise<DebugTools> {
  const [{ DebugHUD }, { GameDebug }] = await Promise.all([
    import('../../game-elements/debug-hud'),
    import('../game-debug'),
  ])
  return { DebugHUD, GameDebug }
}

export function registerRendering(game: Game, { scene }: InitContext, debugTools: DebugTools | null): void {
  const skybox = MeshBuilder.CreateBox('skybox', { size: GameConfig.visuals.skyboxSize }, scene)
  const skyboxMaterial = createStandardMaterial(scene, 'skyBox')
  skyboxMaterial.backFaceCulling = false
  skyboxMaterial.diffuseColor = Color3.Black()
  skyboxMaterial.specularColor = Color3.Black()
  skyboxMaterial.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
  skybox.material = skyboxMaterial

  game.effects = new EffectsSystem(scene, game.bloomPipeline, game.accessibility)
  if (game.keyLight && game.rimLight && game.bounceLight) {
    game.effects.registerSceneLights(game.keyLight, game.rimLight, game.bounceLight)
  }
  const displayConfig: DisplayConfig = adaptLegacyConfig(machineBackboxConfig(GameConfig.backbox, game.machine))
  game.display = new DisplaySystem(scene, game.engine, displayConfig, game.qualityTier, game.accessibility, {
    noPostProcess: new URLSearchParams(window.location.search).has('nopp'),
  })
  game.display.subscribeToEvents(game.eventBus)
  game.display.setSlotScoreProvider(() => game.score)
  game.display.setEffectsSystem(game.effects)
  // Apply persisted scanline settings now that the display system exists
  const initialSettings = SettingsManager.load()
  game.display.setPlayerScanlineEnabled(initialSettings.scanlineEnabled)
  game.display.setScanlineIntensityMultiplier(initialSettings.scanlineIntensityMultiplier)

  game.cabinetLighting = new CabinetLighting(scene, {
    enableEdgeLighting: true,
    enableUnderCabinetGlow: true,
    enableScreenBorder: true,
    // Read live: toggling photosensitive mode or reduced motion applies to the strip at once.
    screenBorder: {
      width: displayConfig.width,
      height: displayConfig.height,
      getAccessibility: () => game.accessibility,
    },
    qualityTier: game.qualityTier,
  })
  game.cabinetLighting.subscribeToEvents(game.eventBus)

  if (game.isDebugHUDAvailable()) {
    game.eventBusLog.wire(game.eventBus)
  }
  game.performanceMonitor.setRendererBackend(
    window.currentRenderer ?? (game.engine.isWebGPU ? 'webgpu' : 'webgl2'),
  )

  if (debugTools) {
    game.debugHelper = new debugTools.GameDebug(game)
    game.debugHUD = new debugTools.DebugHUD({
      onVisibilityChange: (visible) => game.handleDebugHUDVisibilityChange(visible),
    })
    game.debugHUD.setUpdateCadenceHz(4)
    if (game.debugHUDEnabledInSettings) {
      game.debugHUD.show()
    }
  }

  game.dynamicWorld = getDynamicWorld(scene, game.tableCam!, game.display, game.soundSystem)
  game.ballStackVisual = new BallStackVisual(scene)

  game.slotAdventure?.setupSlotMachineCallbacks()
  game.checkpointDebug.registerToggleHandler('scene_cosmetic', (enabled) => {
    if (!enabled || game.cosmeticSceneBuilt) return
    game.scheduleCosmeticSceneBuild()
  })
}
