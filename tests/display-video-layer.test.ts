// @vitest-environment happy-dom
/**
 * DisplayVideoLayer load lifecycle: a failed or timed-out load releases only
 * the video, so the plane survives for the next load; stale timers never kill
 * a newer load.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DisplayVideoLayer } from '../src/display/display-video'
import { DEFAULT_DISPLAY_CONFIG } from '../src/game-elements/display-config'

function makeLayer(loadTimeout = 5000) {
  const config = { ...DEFAULT_DISPLAY_CONFIG, videoSettings: { loadTimeout } }
  const layer = new DisplayVideoLayer({} as never, config)
  layer.createLayer({} as never, config)
  const mesh = (layer as unknown as { mesh: { dispose: ReturnType<typeof vi.fn>; material: unknown } }).mesh
  return { layer, mesh }
}

const videos = () => Array.from(document.querySelectorAll('video'))

describe('DisplayVideoLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the plane after a load error and binds the next load to it', () => {
    const { layer, mesh } = makeLayer()
    const onError = vi.fn()
    layer.loadVideo('/missing.webm', { onError })
    videos()[0].onerror!(new Event('error'))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mesh.dispose).not.toHaveBeenCalled()

    const onReady = vi.fn()
    layer.loadVideo('/ok.webm', { onReady })
    const v = videos().at(-1)!
    v.play = vi.fn(() => Promise.resolve())
    v.onloadeddata!(new Event('loadeddata'))
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(mesh.material).not.toBeNull()
  })

  it('times out with the configured timeout and keeps the plane', () => {
    const { layer, mesh } = makeLayer(1200)
    const onError = vi.fn()
    layer.loadVideo('/slow.webm', { onError })
    vi.advanceTimersByTime(1199)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(mesh.dispose).not.toHaveBeenCalled()
  })

  it("an earlier load's timer cannot fail a newer load", () => {
    const { layer } = makeLayer(1000)
    const firstError = vi.fn()
    layer.loadVideo('/first.webm', { onError: firstError })
    vi.advanceTimersByTime(600)
    const secondError = vi.fn()
    layer.loadVideo('/second.webm', { onError: secondError })
    vi.advanceTimersByTime(600)
    expect(firstError).not.toHaveBeenCalled()
    expect(secondError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(secondError).toHaveBeenCalledTimes(1)
  })

  it('reuses one material across loads', () => {
    const { layer, mesh } = makeLayer()
    const bind = (url: string) => {
      layer.loadVideo(url)
      const v = videos().at(-1)!
      v.play = vi.fn(() => Promise.resolve())
      v.onloadeddata!(new Event('loadeddata'))
      return mesh.material
    }
    expect(bind('/a.webm')).toBe(bind('/b.webm'))
  })
})
