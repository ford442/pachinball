/**
 * Wires up everything that treats the scene as static: the gate, the frozen material allowlist,
 * the frozen active-mesh list, the fog watchers and the skybox colour-clear skip.
 *
 * This module is the root of its own chunk. `GameSystemsInitializer` starts the dynamic import at
 * the top of `initAll` and awaits it just before the critical scene is built, so none of this
 * (about 3 KB gzipped) is in the entry chunk, which has a budget. Everything that calls into it
 * from the entry chunk (BallManager, CabinetBuilder, AdventureMode, GameRenderer) holds only a
 * type-only reference to the gate and does nothing until `Game.staticSceneGate` is set, so a
 * spawn or a tier change before this chunk arrives is simply not recorded: nothing is frozen yet
 * either, and `install` ends with an invalidation that starts the first freeze cycle.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { EventBus } from '../core/event-bus'
import { StaticSceneGate } from '../core/static-scene-gate'
import { isMobileUserAgent } from '../engine/engine-options'
import {
  FrozenActiveMeshes,
  RenderStateWatcher,
  isActiveMeshFreezeEnabled,
  type ActiveMeshesScene,
} from './frozen-active-meshes'
import { FrozenMaterialSet, type FreezableMaterial } from './frozen-material-set'
import { SkyboxAutoClear } from './skybox-auto-clear'

export interface StaticSceneInstallInputs {
  scene: Scene
  eventBus: Pick<EventBus, 'on'>
  /** `window.location.search`; `?freezeMeshes=0` turns the active-mesh freeze off. */
  search: string
  userAgent: string
  skyboxSize: number
  /** The materials the renderer allowlisted for freezing, each with the reason it is safe. */
  frozenMaterials: ReadonlyArray<readonly [FreezableMaterial, string]>
  /** WebGL2: re-clamp `maxSimultaneousLights` on these before they are frozen. */
  clampLights?: (materials: FreezableMaterial[]) => void
}

export interface StaticSceneInstall {
  readonly gate: StaticSceneGate
  readonly materials: FrozenMaterialSet
  /** Null with `?freezeMeshes=0`, or on a Babylon build without the internals it needs. */
  readonly activeMeshes: FrozenActiveMeshes | null
  dispose(): void
}

export function installStaticScene(inputs: StaticSceneInstallInputs): StaticSceneInstall {
  const { scene } = inputs
  const gate = new StaticSceneGate(scene, { eventBus: inputs.eventBus })

  const materials = new FrozenMaterialSet({ clampLights: inputs.clampLights })
  for (const [material, why] of inputs.frozenMaterials) materials.add(material, why)
  const unregister: Array<() => void> = [gate.registerTarget(materials)]

  // A frozen material never re-binds its fog uniforms or re-evaluates its fog define, and the
  // track themes lerp the scene's fog every frame (effects-atmosphere.ts), so fog is state the
  // frozen set must be told about. Quantised so a lerp that has converged to 1e-4 counts as still.
  const quantised = (value: number): number => Math.round(value * 10_000)
  const fog = { materials: true }
  unregister.push(
    gate.watchState('fog', () => (scene.fogEnabled ? 1 : 0) + scene.fogMode * 2, fog),
    gate.watchState('fog', () => quantised(scene.fogDensity), fog),
    gate.watchState('fog', () => quantised(scene.fogColor.r), fog),
    gate.watchState('fog', () => quantised(scene.fogColor.g), fog),
    gate.watchState('fog', () => quantised(scene.fogColor.b), fog),
  )

  // The active-mesh list. Off with ?freezeMeshes=0, and off if this Babylon build lacks the
  // internals the freeze uses (it then simply stays thawed).
  let activeMeshes: FrozenActiveMeshes | null = null
  if (isActiveMeshFreezeEnabled(inputs.search)) {
    const target = new FrozenActiveMeshes(scene as unknown as ActiveMeshesScene)
    if (target.isSupported) {
      activeMeshes = target
      unregister.push(gate.registerTarget(target))
      const watcher = new RenderStateWatcher(scene)
      unregister.push(gate.watchState('render-state', () => watcher.sample()))
    } else {
      console.warn('[StaticScene] Active-mesh freeze unavailable: Babylon internals not found')
    }
  }

  const skybox = scene.getMeshByName('skybox')
  const skyboxAutoClear = skybox
    ? new SkyboxAutoClear(
        scene,
        skybox,
        inputs.skyboxSize,
        isMobileUserAgent(inputs.userAgent),
      )
    : null

  // Start the first freeze cycle: the scene is built and nothing else will say so.
  gate.invalidate('install', { materials: true, shadows: true })

  return {
    gate,
    materials,
    activeMeshes,
    dispose() {
      for (const undo of unregister.splice(0)) undo()
      skyboxAutoClear?.dispose()
      gate.dispose()
      materials.clear()
    },
  }
}
