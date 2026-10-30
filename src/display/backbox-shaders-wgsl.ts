/**
 * WGSL sources of the backbox shaders, registered in `ShaderStore.ShadersStoreWGSL` (#488).
 *
 * On WebGPU Babylon fetches its GLSL → WGSL translator (glslang + twgsl, ~2.7 MB from
 * cdn.babylonjs.com) the first time any GLSL effect compiles. Every shader the backbox compiles
 * therefore has a WGSL twin here, under the same store name as its GLSL source in
 * `Effect.ShadersStore`. display-shader.ts loads this module lazily, and only on WebGPU, through
 * Babylon's `extraInitializationsAsync` hook, so the sources stay out of the entry chunk.
 */

import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { crtEffectFragmentWGSL } from '../shaders/wgsl/crt-effect'
import { cyberGridFragmentWGSL, cyberGridVertexWGSL } from '../shaders/wgsl/cyber-grid'
import { jackpotOverlayFragmentWGSL } from '../shaders/wgsl/jackpot-overlay'

/** Store key → WGSL source. The keys match the GLSL registrations in display-shader.ts. */
export const BACKBOX_WGSL_SHADERS: Readonly<Record<string, string>> = {
  crtEffectFragmentShader: crtEffectFragmentWGSL,
  jackpotOverlayFragmentShader: jackpotOverlayFragmentWGSL,
  cyberGridVertexShader: cyberGridVertexWGSL,
  cyberGridFragmentShader: cyberGridFragmentWGSL,
}

/** Idempotent: the store is global and a second registration writes the same strings. */
export function registerBackboxWgslShaders(): void {
  for (const [key, source] of Object.entries(BACKBOX_WGSL_SHADERS)) {
    ShaderStore.ShadersStoreWGSL[key] = source
  }
}
