/**
 * SceneOptimizer option stack that is safe for gameplay meshes.
 *
 * Babylon's ModerateDegradationAllowed includes MergeMeshesOptimization,
 * which merges same-material meshes (flipper blades/pivots, bumpers, balls)
 * into static `_merged` meshes and detaches them from physics-driven parents.
 * That makes flippers appear frozen while joints still actuate.
 */
import {
  SceneOptimizerOptions,
  ShadowsOptimization,
  LensFlaresOptimization,
  PostProcessesOptimization,
  ParticlesOptimization,
  TextureOptimization,
  RenderTargetsOptimization,
  HardwareScalingOptimization,
} from '@babylonjs/core/Misc/sceneOptimizer'

export function createSafeSceneOptimizerOptions(targetFrameRate = 55): SceneOptimizerOptions {
  const options = new SceneOptimizerOptions(targetFrameRate)
  let priority = 0
  options.addOptimization(new ShadowsOptimization(priority))
  options.addOptimization(new LensFlaresOptimization(priority))

  priority++
  options.addOptimization(new PostProcessesOptimization(priority))
  options.addOptimization(new ParticlesOptimization(priority))

  priority++
  options.addOptimization(new TextureOptimization(priority, 512))

  priority++
  options.addOptimization(new RenderTargetsOptimization(priority))

  priority++
  options.addOptimization(new HardwareScalingOptimization(priority, 2))

  return options
}
