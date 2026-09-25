import { describe, expect, it } from 'vitest'
import {
  clampMaterialLights,
  computeWebGLLightBudget,
  DEFAULT_LIGHT_BUDGET,
  RESERVED_UNIFORM_BLOCKS,
} from '../src/materials/light-budget'

describe('computeWebGLLightBudget', () => {
  it('reserves Scene/Material/Mesh blocks plus a spare', () => {
    expect(RESERVED_UNIFORM_BLOCKS).toBe(4)
    expect(computeWebGLLightBudget(14, 14)).toBe(10) // SwiftShader
    expect(computeWebGLLightBudget(12, 12)).toBe(8) // WebGL2 spec minimum
    expect(computeWebGLLightBudget(16, 16)).toBe(12)
  })

  it('uses the tighter of the two stages', () => {
    expect(computeWebGLLightBudget(16, 12)).toBe(8)
    expect(computeWebGLLightBudget(12, 16)).toBe(8)
  })

  it('never goes below the Babylon default', () => {
    expect(computeWebGLLightBudget(6, 6)).toBe(DEFAULT_LIGHT_BUDGET)
    expect(computeWebGLLightBudget(0, 0)).toBe(DEFAULT_LIGHT_BUDGET)
    expect(computeWebGLLightBudget(Number.NaN, 14)).toBe(DEFAULT_LIGHT_BUDGET)
  })
})

describe('clampMaterialLights', () => {
  it('lowers only materials above the budget', () => {
    const mats = [
      { maxSimultaneousLights: 19 },
      { maxSimultaneousLights: 4 },
      { maxSimultaneousLights: 10 },
      {},
    ]
    expect(clampMaterialLights(mats, 10)).toBe(1)
    expect(mats.map((m) => m.maxSimultaneousLights)).toEqual([10, 4, 10, undefined])
  })

  it('is idempotent', () => {
    const mats = [{ maxSimultaneousLights: 26 }]
    expect(clampMaterialLights(mats, 8)).toBe(1)
    expect(clampMaterialLights(mats, 8)).toBe(0)
    expect(mats[0].maxSimultaneousLights).toBe(8)
  })
})
