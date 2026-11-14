/**
 * Init stage `scene_optional`, part 1: the zone sensors and the advanced obstacle builders (spinner,
 * ball trap, launcher, moving gate), their first instances, and their shadow casters.
 *
 * Split out of `game-systems-init.ts`; runs first in the optional stage, because the zone system's
 * sensors must exist before the builders register their footprints.
 */


import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { ZoneTriggerSystem, ZoneSensors } from '../../game-elements'
import { wirePortalEntry } from '../portal-sensor-lifecycle'
import { SpinnerBumperBuilder, BallTrapBuilder, LauncherBuilder, MovingGateBuilder } from '../../objects'
import type { Game } from '../../game'
import type { InitContext } from './init-context'

export function registerObstacles(game: Game, { scene, world, rapier }: InitContext): void {
  if (!game.zoneTriggerSystem) {
    game.zoneTriggerSystem = new ZoneTriggerSystem(game.debugHUDQueryEnabled)
  }
  // Every zone is a ball-filtered sensor volume in the physics world; the engine
  // reports begin/end contacts and CollisionDispatcher feeds them to the zone system.
  // Wired before the obstacle builders below register their footprints.
  game.zoneTriggerSystem.setSensors(new ZoneSensors(world, rapier))
  // Exit-portal entry outlives any scenario's setCallback(): complete the portal on contact.
  wirePortalEntry(game)

  const effectIntensity = game.accessibility?.effectIntensity ?? 1.0

  game.spinnerBuilder = new SpinnerBumperBuilder(scene, world, rapier, game.qualityTier)
  game.spinnerBuilder.setEventBus(game.eventBus)
  game.spinnerBuilder.setZoneTriggerSystem(game.zoneTriggerSystem)
  game.spinnerBuilder.setEffectIntensity(effectIntensity)

  game.ballTrapBuilder = new BallTrapBuilder(scene, world, rapier, game.qualityTier)
  game.ballTrapBuilder.setEventBus(game.eventBus)
  game.ballTrapBuilder.setZoneTriggerSystem(game.zoneTriggerSystem)
  game.ballTrapBuilder.setEffectIntensity(effectIntensity)

  game.launcherBuilder = new LauncherBuilder(scene, world, rapier, game.qualityTier)
  game.launcherBuilder.setEventBus(game.eventBus)
  game.launcherBuilder.setZoneTriggerSystem(game.zoneTriggerSystem)
  game.launcherBuilder.setEffectIntensity(effectIntensity)

  game.movingGateBuilder = new MovingGateBuilder(scene, world, rapier, game.qualityTier)
  game.movingGateBuilder.setEventBus(game.eventBus)
  game.movingGateBuilder.setZoneTriggerSystem(game.zoneTriggerSystem)
  game.movingGateBuilder.setEffectIntensity(effectIntensity)

  const spinner = game.spinnerBuilder.createSpinnerBumper(5, 10, '#00ffff', 1.0)
  game.spinnerVisuals.push(spinner.visual)

  const trap = game.ballTrapBuilder.createBallTrap(-5, 10, '#ff00ff', 1.0)
  game.trapStates.push(trap.state)

  const launcher = game.launcherBuilder.createLauncher(2, 16, '#00ff88', 1.0)
  game.launcherStates.push(launcher.state)

  const gate = game.movingGateBuilder.createMovingGate(-2, 16, '#ffaa00', 1.0, 'slide', 2.0, 1.5)
  game.gateStates.push(gate.state)

  // Reparent advanced obstacle visuals into the tilted playfield group so they
  // sit flush with the inclined cabinet face and cast accurate shadows.
  const playfieldGroup = game.playfieldGroup
  const obstacleMeshes = [
    ...spinner.bindings.map(b => b.mesh),
    ...trap.bindings.map(b => b.mesh),
    ...launcher.bindings.map(b => b.mesh),
    ...gate.bindings.map(b => b.mesh),
  ]

  if (playfieldGroup) {
    for (const mesh of obstacleMeshes) {
      if (mesh && !mesh.parent) mesh.parent = playfieldGroup
    }
  }

  // Spinners, traps, launchers and gates all move.
  const shadowRig = game.shadowRig
  if (shadowRig) {
    for (const root of obstacleMeshes) {
      if (!root) continue
      if (root instanceof AbstractMesh) {
        shadowRig.addDynamicCaster(root, true)
      } else {
        for (const child of root.getChildMeshes()) shadowRig.addDynamicCaster(child, false)
      }
    }
  }
}
