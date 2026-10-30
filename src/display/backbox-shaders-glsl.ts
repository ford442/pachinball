/**
 * GLSL sources of the backbox shaders, registered in `Effect.ShadersStore` (#488) — the WebGL2
 * half of `backbox-shaders-wgsl.ts`, under the same store keys.
 *
 * A lazy chunk, like the WGSL one: display-shader.ts loads it through Babylon's
 * `extraInitializationsAsync` hook (which Babylon awaits before it reads the store), and only on
 * WebGL2. Neither backend's sources sit in the entry chunk, and each backend loads only its own.
 */

import { Effect } from '@babylonjs/core/Materials/effect'
import { crtEffectShader } from '../shaders/crt-effect'
import { cyberGridShader } from '../shaders/cyber-grid'
import { jackpotOverlayPostProcessFragment } from '../shaders/jackpotOverlay'

/** Store key → GLSL source. The keys match the WGSL registrations in backbox-shaders-wgsl.ts. */
export const BACKBOX_GLSL_SHADERS: Readonly<Record<string, string>> = {
  crtEffectFragmentShader: crtEffectShader.fragment,
  jackpotOverlayFragmentShader: jackpotOverlayPostProcessFragment,
  [`${cyberGridShader.name}VertexShader`]: cyberGridShader.vertex,
  [`${cyberGridShader.name}FragmentShader`]: cyberGridShader.fragment,
}

/** Idempotent: the store is global and a second registration writes the same strings. */
export function registerBackboxGlslShaders(): void {
  for (const [key, source] of Object.entries(BACKBOX_GLSL_SHADERS)) {
    Effect.ShadersStore[key] = source
  }
}
