/**
 * FresnelRimMaterialPlugin
 *
 * Adds a view-dependent rim glow to an existing PBRMaterial without replacing it.
 * Injects a fresnel term into the emissive accumulation at
 * CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION, adding to `finalEmissive`
 * (which is subsequently added to finalColor by pbrBlockFinalColorComposition).
 *
 * Supports both GLSL (WebGL) and WGSL (WebGPU) shader paths.
 *
 * Usage:
 *   const plugin = new FresnelRimMaterialPlugin(pbrMaterial)
 *   plugin.isEnabled = true
 *   // Each frame (via EffectsSystem.update):
 *   plugin.rimIntensity = someValue
 */

import { MaterialPluginBase, PBRMaterial, Color3, ShaderLanguage } from '@babylonjs/core'
import type { UniformBuffer, MaterialDefines } from '@babylonjs/core'

/** Phase frequency for the rim pulse (radians per second). 3.5 Hz — deliberately offset from BackboxBorderGlow's 4 Hz to produce a gradual shimmer beat rather than a synchronised pulse. */
export const FRESNEL_RIM_PHASE_FREQ = Math.PI * 7

export class FresnelRimMaterialPlugin extends MaterialPluginBase {
  /** Pre-allocated rim colour (mutate r/g/b in-place; no per-frame allocation). */
  rimColor: Color3 = new Color3(1, 0.843, 0)

  /** Current rim intensity (0 = off). Written every frame by EffectsSystem. */
  rimIntensity = 0

  private _isEnabled = false

  constructor(material: PBRMaterial) {
    super(material, 'FresnelRim', 200, { FRESNEL_RIM: false })
    // Plugin is serialised separately; skip it to keep scene export clean.
    this.doNotSerialize = true
  }

  /** Override: support both GLSL (WebGL) and WGSL (WebGPU). */
  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL || shaderLanguage === ShaderLanguage.WGSL
  }

  get isEnabled(): boolean {
    return this._isEnabled
  }

  set isEnabled(value: boolean) {
    if (this._isEnabled === value) return
    this._isEnabled = value
    this.markAllDefinesAsDirty()
    this._enable(value)
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['FRESNEL_RIM'] = this._isEnabled
  }

  override getUniforms(): {
    ubo?: Array<{ name: string; size: number; type: string }>
    fragment?: string
  } {
    return {
      ubo: [
        { name: 'rimColor', size: 3, type: 'vec3' },
        { name: 'rimIntensity', size: 1, type: 'float' },
      ],
      // Fallback inline declarations for engines without UBO support.
      fragment: 'uniform vec3 rimColor;\nuniform float rimIntensity;',
    }
  }

  /**
   * Write per-frame uniform values.
   * Called by the engine every render; NO markAllDefinesAsDirty here — only uniform writes.
   */
  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat3('rimColor', this.rimColor.r, this.rimColor.g, this.rimColor.b)
    uniformBuffer.updateFloat('rimIntensity', this.rimIntensity)
  }

  /**
   * Inject GLSL or WGSL code at CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION.
   *
   * At this hook, `finalEmissive` (vec3 / var finalEmissive: vec3f) is in scope
   * and has NOT yet been added to finalColor — so adding to it here feeds directly
   * into the final composition without double-counting.
   *
   * `viewDirectionW` and `normalW` are also in scope (set by pbrBlockNormalGeometric
   * and pbrBlockNormalFinal, both included earlier in the PBR shader).
   */
  override getCustomCode(
    shaderType: string,
    shaderLanguage: ShaderLanguage,
  ): Record<string, string> | null {
    if (shaderType !== 'fragment') return null

    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef FRESNEL_RIM
{
  let rimFresnel: f32 = pow(1.0 - clamp(dot(viewDirectionW, normalW), 0.0, 1.0), 2.5);
  finalEmissive = finalEmissive + uniforms.rimColor * rimFresnel * uniforms.rimIntensity;
}
#endif
`,
      }
    }

    // GLSL (WebGL) — `saturate` is defined as clamp(x,0,1) in helperFunctions.glsl
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef FRESNEL_RIM
{
  float rimFresnel = pow(1.0 - saturate(dot(viewDirectionW, normalW)), 2.5);
  finalEmissive += rimColor * rimFresnel * rimIntensity;
}
#endif
`,
    }
  }
}
