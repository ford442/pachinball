import { describe, it, expect, vi } from 'vitest'
import { PerformanceMonitor } from '../src/game-elements/performance-monitor'

describe('PerformanceMonitor sustained jank', () => {
  it('fires onSustainedJank once after 2 slow seconds', () => {
    vi.useFakeTimers()
    const monitor = new PerformanceMonitor()
    const cb = vi.fn()
    monitor.setOnSustainedJank(cb)

    const slowFrame = () => {
      monitor.frameStart()
      vi.advanceTimersByTime(30)
      monitor.frameEnd()
    }

    // First second of slow frames
    for (let i = 0; i < 40; i++) slowFrame()
    expect(cb).not.toHaveBeenCalled()

    // Second second — should trip
    for (let i = 0; i < 40; i++) slowFrame()
    expect(cb).toHaveBeenCalledTimes(1)

    // Further slow frames must not re-fire
    for (let i = 0; i < 80; i++) slowFrame()
    expect(cb).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('resets slow counter when a fast second intervenes', () => {
    vi.useFakeTimers()
    const monitor = new PerformanceMonitor()
    const cb = vi.fn()
    monitor.setOnSustainedJank(cb)

    const frame = (ms: number) => {
      monitor.frameStart()
      vi.advanceTimersByTime(ms)
      monitor.frameEnd()
    }

    for (let i = 0; i < 40; i++) frame(30)
    for (let i = 0; i < 60; i++) frame(8)
    for (let i = 0; i < 40; i++) frame(30)
    expect(cb).not.toHaveBeenCalled()
    for (let i = 0; i < 40; i++) frame(30)
    expect(cb).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
