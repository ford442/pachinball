/**
 * Key-light shadows as two generators: a static one for the cabinet, rendered once per
 * StaticSceneGate refreeze, and a small dynamic one for everything that moves.
 *
 * Babylon binds one shadow generator per light (per camera), so two generators on the key light
 * would silently replace each other. The rig therefore puts them on two twins of the key light and
 * splits the key light's intensity between the twins (see `DYNAMIC_LIGHT_SHARE`). The twins light
 * only the shadow *receivers*, and the key light skips them, so a receiver gets the key light's full
 * intensity as before and nothing else in the scene pays for a second light or a shadow sampler.
 * The receivers are the playfield (`ground`) and the flipper glow strip: no other mesh sets
 * `receiveShadows`.
 *
 * Staticness is the gate's call, not the rig's: the rig is a `StaticSceneTarget`. A `shadows`
 * invalidation (cabinet load, track build, quality tier) puts the static map back on every frame;
 * the refreeze, once the static casters' shaders are compiled, renders it once more and stops.
 * Without a gate (its chunk not loaded yet) the static map simply renders every frame, as the single
 * generator did.
 */

import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { StaticSceneInvalidation, StaticSceneTarget } from '../core/static-scene-gate'
import type { QualityTier } from '../game-elements/visual-language'
import {
  applyShadowSettings,
  resolveDynamicShadowSettings,
  resolveStaticShadowSettings,
  splitKeyIntensity,
  type ShadowSettings,
} from './shadow-config'

/** `RenderTargetTexture.refreshRate`: 0 renders once (until the counter is reset), 1 every frame. */
const RENDER_ONCE = 0
const RENDER_EVERY_FRAME = 1

/** A material that can cap how many lights it binds (StandardMaterial, PBRMaterial). */
interface LightCapped {
  maxSimultaneousLights?: number
}

export class ShadowRig implements StaticSceneTarget {
  readonly name = 'static-shadow-map'
  /** Cabinet casters; renders once per refreeze. Also exposed as `Game.shadowGenerator`. */
  readonly staticGenerator: ShadowGenerator
  /** Balls, flippers, bumpers and the moving obstacles; renders every frame. */
  readonly dynamicGenerator: ShadowGenerator

  private readonly scene: Scene
  private readonly keyLight: DirectionalLight
  private readonly staticLight: DirectionalLight
  private readonly dynamicLight: DirectionalLight
  private readonly receivers: AbstractMesh[] = []
  /** Materials already given the extra light slot, so a shared material is bumped once. */
  private readonly bumped = new WeakSet<object>()
  private staticSettings: ShadowSettings
  private dynamicSettings: ShadowSettings
  private staticLive = true
  private readonly syncObserver: unknown
  private disposed = false

  constructor(scene: Scene, keyLight: DirectionalLight, tier: QualityTier) {
    this.scene = scene
    this.keyLight = keyLight
    this.staticSettings = resolveStaticShadowSettings(tier)
    this.dynamicSettings = resolveDynamicShadowSettings(tier)

    // Created next to the key light so they keep its place in the scene's light order, which
    // decides which lights a material with a light cap binds.
    this.staticLight = this.createTwin('keyLightStatic')
    this.dynamicLight = this.createTwin('keyLightDynamic')

    this.staticGenerator = new ShadowGenerator(this.staticSettings.mapSize, this.staticLight)
    applyShadowSettings(this.staticGenerator, this.staticSettings)
    this.dynamicGenerator = new ShadowGenerator(this.dynamicSettings.mapSize, this.dynamicLight)
    applyShadowSettings(this.dynamicGenerator, this.dynamicSettings)

    this.syncObserver = scene.onBeforeRenderObservable.add(() => this.sync())
  }

  private createTwin(name: string): DirectionalLight {
    const twin = new DirectionalLight(name, this.keyLight.direction.clone(), this.scene)
    twin.position = this.keyLight.position.clone()
    // Off until a receiver exists: a light with no `includedOnlyMeshes` lights every mesh.
    twin.setEnabled(false)
    return twin
  }

  /** The dynamic twin's share of the key light follows the key light, which the track themes animate. */
  private sync(): void {
    if (this.receivers.length === 0) return
    const intensity = splitKeyIntensity(this.keyLight.intensity)
    for (const [twin, share] of [
      [this.staticLight, intensity.static],
      [this.dynamicLight, intensity.dynamic],
    ] as const) {
      twin.intensity = share
      twin.diffuse.copyFrom(this.keyLight.diffuse)
      twin.specular.copyFrom(this.keyLight.specular)
      twin.direction.copyFrom(this.keyLight.direction)
      twin.position.copyFrom(this.keyLight.position)
    }
  }

  // ---- Receivers ---------------------------------------------------------------------------

  /** `mesh` receives both generators' shadows. The key light stops lighting it; the twins take over. */
  addReceiver(mesh: AbstractMesh): void {
    if (this.disposed || this.receivers.includes(mesh)) return
    mesh.receiveShadows = true
    this.receivers.push(mesh)
    this.syncReceiverLists()
    mesh.onDisposeObservable.addOnce(() => this.removeReceiver(mesh))

    // The twins replace one light on this mesh (the key light) with two, so a material capped to
    // N lights would drop its Nth light (the bounce light, on a default cap of 4).
    const material = mesh.material as (LightCapped & object) | null
    if (material && material.maxSimultaneousLights !== undefined && !this.bumped.has(material)) {
      this.bumped.add(material)
      material.maxSimultaneousLights += 1
    }
  }

  private removeReceiver(mesh: AbstractMesh): void {
    const index = this.receivers.indexOf(mesh)
    if (index === -1) return
    this.receivers.splice(index, 1)
    if (!this.disposed) this.syncReceiverLists()
  }

  private syncReceiverLists(): void {
    const receivers = [...this.receivers]
    this.staticLight.includedOnlyMeshes = receivers
    this.dynamicLight.includedOnlyMeshes = [...receivers]
    this.keyLight.excludedMeshes = [...receivers]
    const active = receivers.length > 0
    this.staticLight.setEnabled(active)
    this.dynamicLight.setEnabled(active)
    if (active) this.sync()
  }

  getReceivers(): readonly AbstractMesh[] {
    return this.receivers
  }

  // ---- Casters -----------------------------------------------------------------------------

  /** Cabinet-like geometry that never moves while the static map is frozen. */
  addStaticCaster(mesh: AbstractMesh, includeDescendants = false): void {
    this.staticGenerator.addShadowCaster(mesh, includeDescendants)
  }

  /** Anything that moves, scales or spins: balls, flippers, bumpers, obstacle assemblies. */
  addDynamicCaster(mesh: AbstractMesh, includeDescendants = false): void {
    this.dynamicGenerator.addShadowCaster(mesh, includeDescendants)
  }

  // ---- Quality tier ------------------------------------------------------------------------

  /**
   * Re-point both generators at `tier`. Switching a filter marks every receiving material
   * light-dirty, so it recompiles on the next frame; a tier that maps to the settings already
   * running changes nothing. The caller has already raised a `shadows` invalidation.
   */
  applyTier(tier: QualityTier): void {
    const staticNext = resolveStaticShadowSettings(tier)
    const staticCurrent = this.staticSettings
    if (staticNext.technique !== staticCurrent.technique || staticNext.mapSize !== staticCurrent.mapSize) {
      applyShadowSettings(this.staticGenerator, staticNext)
      if (staticNext.mapSize !== staticCurrent.mapSize) this.staticGenerator.mapSize = staticNext.mapSize
      this.staticSettings = staticNext
    }
    const dynamicNext = resolveDynamicShadowSettings(tier)
    if (dynamicNext.pcfQuality !== this.dynamicSettings.pcfQuality) {
      applyShadowSettings(this.dynamicGenerator, dynamicNext)
      this.dynamicSettings = dynamicNext
    }
  }

  // ---- StaticSceneTarget -------------------------------------------------------------------

  thaw(invalidation: StaticSceneInvalidation): void {
    if (invalidation.shadows) this.setStaticLive(true)
  }

  refreeze(): void {
    this.setStaticLive(false)
  }

  /**
   * False until every static caster can draw into the shadow map. A once-rendered map built while a
   * caster's depth shader is still compiling leaves that caster out until the next refresh.
   */
  canRefreeze(): boolean {
    const map = this.staticGenerator.getShadowMap()
    const ready = map?.customIsReadyFunction
    if (!map || !ready) return true
    return (map.renderList ?? []).every((mesh) => !mesh.isEnabled() || ready(mesh, RENDER_ONCE, true))
  }

  /** Whether the static map renders every frame right now (before the first refreeze, or after a thaw). */
  isStaticLive(): boolean {
    return this.staticLive
  }

  private setStaticLive(live: boolean): void {
    const map = this.staticGenerator.getShadowMap()
    if (!map) return
    if (live) {
      if (this.staticLive) return
      this.staticLive = true
      map.refreshRate = RENDER_EVERY_FRAME
    } else {
      if (!this.staticLive) return
      this.staticLive = false
      // Setting the rate resets Babylon's counter, so the map renders once more, then stops.
      map.refreshRate = RENDER_ONCE
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.onBeforeRenderObservable.remove(this.syncObserver as never)
    this.keyLight.excludedMeshes = this.keyLight.excludedMeshes.filter((m) => !this.receivers.includes(m))
    this.receivers.length = 0
    this.staticGenerator.dispose()
    this.dynamicGenerator.dispose()
    this.staticLight.dispose()
    this.dynamicLight.dispose()
  }
}
