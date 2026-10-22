import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/materials', () => ({
  getMaterialLibrary: () => ({
    getCabinetMaterial: () => ({}),
    getSidePanelMaterial: () => ({}),
    getChromeMaterial: () => ({}),
    getNeonBumperMaterial: () => ({}),
  }),
}))

import { GameCabinetBuilder, type CabinetBuilderHost } from '../src/game/game-cabinet-builder'
import { QualityTier } from '../src/game-elements/visual-language'

function makeHost(mirror: { renderList: unknown[] }): CabinetBuilderHost {
  return {
    scene: {},
    qualityTier: QualityTier.MEDIUM,
    shadowGenerator: { addShadowCaster: vi.fn() },
    mirrorTexture: mirror,
    gameObjects: null,
    mapManager: null,
    cabinetNeonLights: [],
    roomMeshes: [],
    ambientRoomLight: null,
    effects: null,
  } as unknown as CabinetBuilderHost
}

describe('GameCabinetBuilder.createEnhancedCabinet mirror upkeep', () => {
  it('keeps the mirror list at one build’s worth of meshes across rebuilds', () => {
    const ball = { name: 'ball' }
    const mirror = { renderList: [ball] as unknown[] }
    const builder = new GameCabinetBuilder(makeHost(mirror))

    builder.createEnhancedCabinet()
    const perBuild = mirror.renderList.length - 1
    expect(perBuild).toBe(16)

    const firstBuild = mirror.renderList.slice(1)
    builder.createEnhancedCabinet()
    builder.createEnhancedCabinet()

    expect(mirror.renderList).toHaveLength(1 + perBuild)
    // The ball was not touched, and no mesh from the first build is still listed.
    expect(mirror.renderList[0]).toBe(ball)
    expect(mirror.renderList.some((m) => firstBuild.includes(m))).toBe(false)
  })
})
