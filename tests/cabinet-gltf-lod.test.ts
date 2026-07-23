/**
 * Unit tests for cabinet glTF LOD selection, URL splitting, and high→simple fallback.
 * Babylon / SceneLoader are mocked — no real mesh load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const loadAssetContainerAsync = vi.fn()

vi.mock('@babylonjs/core', () => ({
  SceneLoader: {
    LoadAssetContainerAsync: (...args: unknown[]) => loadAssetContainerAsync(...args),
  },
}))

vi.mock('@babylonjs/loaders/glTF', () => ({}))

vi.mock('../src/game/game-utils', () => ({
  resolveAssetUrl: (p: string | undefined) => (p ? `/${p}` : undefined),
}))

import { QualityTier } from '../src/game-elements/visual-language'
import {
  pickCabinetGltfUrl,
  splitAssetUrl,
  loadCabinetGltfForPreset,
} from '../src/cabinet/cabinet-gltf-loader'
import type { CabinetGltfConfig } from '../src/cabinet/cabinet-types'

const GLTF: CabinetGltfConfig = {
  simpleUrl: 'models/cabinet/classic/simple.glb',
  highUrl: 'models/cabinet/classic/high.glb',
  loadTimeoutMs: 5_000,
}

function fakeContainer() {
  return {
    meshes: [],
    addAllToScene: vi.fn(),
    removeAllFromScene: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('pickCabinetGltfUrl', () => {
  it('LOW always selects simple and never high', () => {
    const picked = pickCabinetGltfUrl(GLTF, QualityTier.LOW)
    expect(picked.lod).toBe('simple')
    expect(picked.url).toBe(GLTF.simpleUrl)
    expect(picked.url).not.toContain('high.glb')
  })

  it('MEDIUM selects high', () => {
    const picked = pickCabinetGltfUrl(GLTF, QualityTier.MEDIUM)
    expect(picked.lod).toBe('high')
    expect(picked.url).toBe(GLTF.highUrl)
  })

  it('HIGH selects high', () => {
    const picked = pickCabinetGltfUrl(GLTF, QualityTier.HIGH)
    expect(picked.lod).toBe('high')
    expect(picked.url).toBe(GLTF.highUrl)
  })
})

describe('splitAssetUrl', () => {
  it('splits root and filename for SceneLoader', () => {
    expect(splitAssetUrl('/models/cabinet/classic/simple.glb')).toEqual({
      rootUrl: '/models/cabinet/classic/',
      sceneFilename: 'simple.glb',
    })
  })

  it('handles bare filename', () => {
    expect(splitAssetUrl('simple.glb')).toEqual({
      rootUrl: './',
      sceneFilename: 'simple.glb',
    })
  })
})

describe('loadCabinetGltfForPreset fallback', () => {
  beforeEach(() => {
    loadAssetContainerAsync.mockReset()
  })

  it('falls back to simple when high LOD fails on HIGH tier', async () => {
    loadAssetContainerAsync
      .mockRejectedValueOnce(new Error('high missing'))
      .mockResolvedValueOnce(fakeContainer())

    const result = await loadCabinetGltfForPreset({} as never, GLTF, QualityTier.HIGH)
    expect(result.lod).toBe('simple')
    expect(result.url).toBe(GLTF.simpleUrl)
    expect(loadAssetContainerAsync).toHaveBeenCalledTimes(2)
    const firstFile = loadAssetContainerAsync.mock.calls[0][1]
    const secondFile = loadAssetContainerAsync.mock.calls[1][1]
    expect(firstFile).toBe('high.glb')
    expect(secondFile).toBe('simple.glb')
  })

  it('does not attempt high when tier is LOW', async () => {
    loadAssetContainerAsync.mockResolvedValueOnce(fakeContainer())
    const result = await loadCabinetGltfForPreset({} as never, GLTF, QualityTier.LOW)
    expect(result.lod).toBe('simple')
    expect(loadAssetContainerAsync).toHaveBeenCalledTimes(1)
    expect(loadAssetContainerAsync.mock.calls[0][1]).toBe('simple.glb')
  })
})
