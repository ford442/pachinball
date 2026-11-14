/**
 * What every init stage needs from the boot that is not on `Game` itself: the scene and the physics
 * world / authoring API `GameSystemsInitializer.initAll` resolved once, up front. Passing the same
 * objects to every stage (rather than asking `Game` again) keeps them identical across stages.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { PhysicsApi, PhysicsWorldSink } from '../../core/physics-api'

export interface InitContext {
  scene: Scene
  /** The C++ owner's table world + descriptor API, or Rapier on the explicit/degrade path. */
  world: PhysicsWorldSink
  rapier: PhysicsApi
}
