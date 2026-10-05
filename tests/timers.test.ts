import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTimerScope, type TimerBase } from '../src/core/timers'

describe('createTimerScope', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('runs timeouts like the platform and forgets them once fired', () => {
    const scope = createTimerScope()
    const fn = vi.fn()
    scope.setTimeout(fn, 100)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('clear() cancels timeouts, intervals and frames that have not fired', () => {
    const scope = createTimerScope()
    const timeout = vi.fn()
    const interval = vi.fn()
    const frame = vi.fn()
    scope.setTimeout(timeout, 50)
    scope.setInterval(interval, 10)
    scope.requestAnimationFrame(frame)

    scope.clear()
    vi.advanceTimersByTime(1000)

    expect(timeout).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(frame).not.toHaveBeenCalled()
  })

  it('stays usable after clear()', () => {
    const scope = createTimerScope()
    scope.clear()
    const fn = vi.fn()
    scope.setTimeout(fn, 10)
    vi.advanceTimersByTime(10)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('dispose() cancels pending work and refuses new work', () => {
    const scope = createTimerScope()
    const pending = vi.fn()
    const late = vi.fn()
    scope.setTimeout(pending, 10)

    scope.dispose()
    expect(scope.setTimeout(late, 10)).toBe(0)
    expect(scope.setInterval(late, 10)).toBe(0)
    expect(scope.requestAnimationFrame(late)).toBe(0)
    vi.advanceTimersByTime(1000)

    expect(pending).not.toHaveBeenCalled()
    expect(late).not.toHaveBeenCalled()
  })

  it('cancels one handle without touching the rest', () => {
    const scope = createTimerScope()
    const a = vi.fn()
    const b = vi.fn()
    const handle = scope.setTimeout(a, 10)
    scope.setTimeout(b, 10)
    scope.clearTimeout(handle)
    vi.advanceTimersByTime(10)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('cancels an interval that already ticked', () => {
    const scope = createTimerScope()
    const fn = vi.fn()
    const handle = scope.setInterval(fn, 10)
    vi.advanceTimersByTime(25)
    expect(fn).toHaveBeenCalledTimes(2)
    scope.clearInterval(handle)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('falls back to a ~16 ms timeout where requestAnimationFrame is missing', () => {
    const scope = createTimerScope()
    const fn = vi.fn()
    scope.requestAnimationFrame(fn)
    vi.advanceTimersByTime(15)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses the injected platform and cancels frames through cancelAnimationFrame', () => {
    const cancelAnimationFrame = vi.fn()
    const base: TimerBase = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 2),
      clearInterval: vi.fn(),
      requestAnimationFrame: vi.fn(() => 42),
      cancelAnimationFrame,
    }
    const scope = createTimerScope(base)
    scope.requestAnimationFrame(() => {})
    scope.clear()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
  })
})
