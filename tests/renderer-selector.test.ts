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

  it('defaults to WebGL2 when no preference is stored', () => {
    expect(getRendererPreference()).toBe(RENDERER_WEBGL2)
  })

  it('migrates legacy auto storage to WebGL2', () => {
    storage.set(STORAGE_KEY, RENDERER_AUTO)
    expect(getRendererPreference()).toBe(RENDERER_WEBGL2)
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

  it('reload helpers persist preference before reload', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    attemptWebGPURenderer()
    expect(storage.get(STORAGE_KEY)).toBe(RENDERER_WEBGPU)
    expect(reload).toHaveBeenCalled()

    useWebGL2Renderer()
    expect(storage.has(STORAGE_KEY)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('clears storage when selecting the default WebGL2 renderer', () => {
    storage.set(STORAGE_KEY, RENDERER_WEBGPU)
    setRendererPreference(RENDERER_WEBGL2)
    expect(storage.has(STORAGE_KEY)).toBe(false)
  })
})
