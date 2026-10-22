/**
 * The explicit allowlist of materials that are frozen while the scene is static.
 *
 * `Material.freeze()` makes Babylon skip re-evaluating a material's shader defines and re-binding
 * its uniforms every frame. That is the point, and also the hazard: a frozen material silently
 * ignores later property writes, a new light, a changed `maxSimultaneousLights` and a changed
 * shadow filter. So membership is opt-in, one `add()` per material with the reason it is safe,
 * never "everything in scene.materials".
 *
 * Never add a material that:
 *   - `applyQualityTier` or the effects' quality sync touches;
 *   - a FEVER / jackpot / cabinet-LED pulse animates (effects/**, cabinet-lighting.ts);
 *   - carries `FresnelRimMaterialPlugin` (backbox border, gold balls: they change during FEVER);
 *   - is a ball material (gold balls pulse their emissive every frame).
 *
 * It is a `StaticSceneTarget`: thawed by an invalidation that touches materials (a quality tier
 * change, a cabinet glTF load), refrozen by the gate once the scene is quiet.
 *
 * WebGL2 ordering (#427): Babylon's glTF loader raises `maxSimultaneousLights` on every scene
 * material, and `GameRenderer.installWebGLLightBudget()` clamps it back down. A frozen material
 * never recompiles to pick the clamp up, so every refreeze first re-runs the clamp over the
 * members, and the set only freezes after that has run.
 */

import type { StaticSceneInvalidation, StaticSceneTarget } from '../core/static-scene-gate'

/** The slice of `Material` this set drives. */
export interface FreezableMaterial {
  readonly name: string
  readonly isFrozen: boolean
  freeze(): void
  unfreeze(): void
  maxSimultaneousLights?: number
}

export interface FrozenMaterialSetOptions {
  /** WebGL2: re-clamp `maxSimultaneousLights` on these before they are frozen. Undefined on WebGPU. */
  clampLights?: (materials: FreezableMaterial[]) => void
}

export class FrozenMaterialSet implements StaticSceneTarget {
  readonly name = 'materials'

  private readonly members = new Map<FreezableMaterial, string>()
  private readonly clampLights: ((materials: FreezableMaterial[]) => void) | undefined
  private frozen = false

  constructor(options: FrozenMaterialSetOptions = {}) {
    this.clampLights = options.clampLights
  }

  /**
   * Allowlist `material`. `why` is the reason it is safe to freeze; it is required, and stays in
   * the set for review (`describe()`). A member added while the set is frozen is frozen at once.
   */
  add(material: FreezableMaterial, why: string): void {
    if (this.members.has(material)) return
    this.members.set(material, why)
    if (this.frozen) {
      this.clampLights?.([material])
      material.freeze()
    }
  }

  get size(): number {
    return this.members.size
  }

  get isFrozen(): boolean {
    return this.frozen
  }

  /** `[material name, why it is safe]`, for tests and review. */
  describe(): Array<[string, string]> {
    return [...this.members].map(([material, why]) => [material.name, why])
  }

  thaw(invalidation: StaticSceneInvalidation): void {
    if (!invalidation.materials || !this.frozen) return
    for (const material of this.members.keys()) material.unfreeze()
    this.frozen = false
  }

  refreeze(): void {
    if (this.frozen) return
    const materials = [...this.members.keys()]
    // Clamp first: freezing bakes in whatever light count the shaders are compiled for.
    this.clampLights?.(materials)
    for (const material of materials) material.freeze()
    this.frozen = true
  }

  /** Forget everything (Game.dispose). Teardown disposes the materials; nothing is unfrozen here. */
  clear(): void {
    this.members.clear()
    this.frozen = false
  }
}
