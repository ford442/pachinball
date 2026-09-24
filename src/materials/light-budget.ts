/**
 * WebGL2 per-material light budget.
 *
 * Babylon binds every light as its own uniform block, next to the Scene,
 * Material and Mesh blocks. WebGL2 caps uniform blocks per shader stage
 * (GL_MAX_VERTEX/FRAGMENT_UNIFORM_BLOCKS, spec minimum 12; SwiftShader 14).
 *
 * Babylon 7's glTF loader raises `maxSimultaneousLights` on EVERY scene
 * material to `scene.lights.length` once a glTF finishes loading. With the
 * cabinet's 14–26 lights that exceeds the block limit and every material
 * fails to compile on WebGL2 ("Error compiling effect"). The game renderer
 * clamps materials to this budget on WebGL; WebGPU is left untouched.
 *
 * Pure helpers — no Babylon imports — so they unit-test without mocks.
 */

/** Scene + Material + Mesh blocks, plus one spare for plugins/extensions. */
export const RESERVED_UNIFORM_BLOCKS = 4

/** Babylon's own default for StandardMaterial / PBRMaterial. */
export const DEFAULT_LIGHT_BUDGET = 4

/**
 * Lights a material may bind given the per-stage uniform-block limits.
 * Never drops below Babylon's default of 4 (every WebGL2 device reports >= 12).
 */
export function computeWebGLLightBudget(maxVertexUniformBlocks: number, maxFragmentUniformBlocks: number): number {
  const blocks = Math.min(maxVertexUniformBlocks, maxFragmentUniformBlocks)
  if (!Number.isFinite(blocks) || blocks <= 0) return DEFAULT_LIGHT_BUDGET
  return Math.max(DEFAULT_LIGHT_BUDGET, Math.floor(blocks) - RESERVED_UNIFORM_BLOCKS)
}

export interface LightCappedMaterial {
  maxSimultaneousLights?: number
}

/**
 * Lower `maxSimultaneousLights` to `budget` where it is higher. Materials at
 * or below the budget (and materials without the property) are untouched.
 * Returns how many materials were clamped.
 */
export function clampMaterialLights(materials: Iterable<LightCappedMaterial>, budget: number): number {
  let clamped = 0
  for (const material of materials) {
    const current = material.maxSimultaneousLights
    if (current !== undefined && current > budget) {
      material.maxSimultaneousLights = budget
      clamped++
    }
  }
  return clamped
}
