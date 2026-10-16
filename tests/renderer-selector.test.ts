/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RENDERER_AUTO,
  RENDERER_WEBGL2,
  RENDERER_WEBGPU,
  STORAGE_KEY,
  attemptWebGPURenderer,
  getActiveRenderer,
  getRendererPreference,
  setRendererPreference,
  useWebGL2Renderer,
} from '../src/renderers/renderer-selector'

describe('renderer-selector', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    })
    window.history.replaceState({}, '', '/')
    delete (window as unknown as { currentRenderer?: string }).currentRenderer
    document.body.innerHTML = '<canvas id="pachinball-canvas"></canvas>'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to WebGPU-first auto when no preference is stored', () => {
    expect(getRendererPreference()).toBe(RENDERER_AUTO)
  })

  it('preserves legacy auto storage preference', () => {
    storage.set(STORAGE_KEY, RENDERER_AUTO)
    expect(getRendererPreference()).toBe(RENDERER_AUTO)
  })

  it('reads URL and stored renderer overrides', () => {
    window.history.replaceState({}, '', '/?renderer=webgpu')
    expect(getRendererPreference()).toBe(RENDERER_WEBGPU)

    window.history.replaceState({}, '', '/')
    storage.set(STORAGE_KEY, RENDERER_WEBGPU)
    expect(getRendererPreference()).toBe(RENDERER_WEBGPU)
  })

  it('reports the active renderer from bootstrap tags', () => {
    const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement
    canvas.dataset.renderer = RENDERER_WEBGPU
    expect(getActiveRenderer()).toBe(RENDERER_WEBGPU)

    canvas.dataset.renderer = RENDERER_WEBGL2
    expect(getActiveRenderer()).toBe(RENDERER_WEBGL2)
  })

  describe('reload helpers', () => {
    const assign = vi.fn()

    beforeEach(() => {
      assign.mockClear()
      vi.stubGlobal('location', { href: 'http://localhost:4174/?debug=1', assign })
    })

    it('attemptWebGPURenderer persists webgpu and reloads with ?renderer=webgpu', () => {
      attemptWebGPURenderer()
      expect(storage.get(STORAGE_KEY)).toBe(RENDERER_WEBGPU)
      expect(assign).toHaveBeenCalledWith('http://localhost:4174/?debug=1&renderer=webgpu')
    })

    it('useWebGL2Renderer stores webgl2 explicitly and reloads with ?renderer=webgl2 (#450)', () => {
      useWebGL2Renderer()
      // Removing the key would make the next boot `auto` = WebGPU-first again.
      expect(storage.get(STORAGE_KEY)).toBe(RENDERER_WEBGL2)
      expect(assign).toHaveBeenCalledWith('http://localhost:4174/?debug=1&renderer=webgl2')
    })

    it('rewrites a stale ?renderer= param instead of reloading back into it', () => {
      vi.stubGlobal('location', { href: 'http://localhost:4174/?renderer=webgl2', assign })
      attemptWebGPURenderer()
      expect(assign).toHaveBeenCalledWith('http://localhost:4174/?renderer=webgpu')
    })
  })

  it('stores an explicit webgl2 choice so the next boot is not WebGPU-first auto (#450)', () => {
    setRendererPreference(RENDERER_WEBGL2)
    expect(storage.get(STORAGE_KEY)).toBe(RENDERER_WEBGL2)
    expect(getRendererPreference()).toBe(RENDERER_WEBGL2)
  })

  it('clears storage only when returning to auto', () => {
    storage.set(STORAGE_KEY, RENDERER_WEBGPU)
    setRendererPreference(RENDERER_AUTO)
    expect(storage.has(STORAGE_KEY)).toBe(false)
    expect(getRendererPreference()).toBe(RENDERER_AUTO)
  })

  it('?renderer= outranks a stored preference', () => {
    storage.set(STORAGE_KEY, RENDERER_WEBGPU)
    window.history.replaceState({}, '', '/?renderer=webgl2')
    expect(getRendererPreference()).toBe(RENDERER_WEBGL2)
  })
})
