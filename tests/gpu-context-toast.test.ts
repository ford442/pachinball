/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  GpuContextToast,
  GPU_CONTEXT_ATTRIBUTE,
  GPU_CONTEXT_TOAST_ID,
  GPU_CONTEXT_LOST_MESSAGE,
  GPU_CONTEXT_RESTORED_MESSAGE,
  RESTORED_TOAST_MS,
  RESTORED_TOAST_MS_REDUCED_MOTION,
} from '../src/engine/gpu-context-toast'

/** Manual clock so the tests assert the delay we pass, not wall time. */
function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  return {
    pending,
    setTimeoutFn: (fn: () => void, ms: number) => {
      const id = next++
      pending.set(id, { fn, ms })
      return id
    },
    clearTimeoutFn: (handle: unknown) => {
      pending.delete(handle as number)
    },
    runAll: () => {
      const entries = [...pending.values()]
      pending.clear()
      entries.forEach((e) => e.fn())
    },
    onlyDelay: () => [...pending.values()][0]?.ms,
  }
}

function setup(reducedMotion = false) {
  document.body.removeAttribute(GPU_CONTEXT_ATTRIBUTE)
  document.body.innerHTML = `<div id="${GPU_CONTEXT_TOAST_ID}" class="toast hidden"></div>`
  const timers = fakeTimers()
  const toast = new GpuContextToast({
    doc: document,
    isReducedMotion: () => reducedMotion,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })
  const el = document.getElementById(GPU_CONTEXT_TOAST_ID) as HTMLElement
  return { toast, el, timers }
}

const contextAttr = () => document.body.getAttribute(GPU_CONTEXT_ATTRIBUTE)

beforeEach(() => {
  document.body.removeAttribute(GPU_CONTEXT_ATTRIBUTE)
})

describe('GpuContextToast', () => {
  it('publishes data-gpu-context="ok" on <body> at markReady without showing a toast', () => {
    const { toast, el } = setup()

    toast.markReady()

    expect(contextAttr()).toBe('ok')
    expect(el.classList.contains('hidden')).toBe(true)
    expect(el.textContent).toBe('')
  })

  it('flips the Playwright hook to lost and shows the restoring copy', () => {
    const { toast, el } = setup()
    toast.markReady()

    toast.onLost()

    expect(contextAttr()).toBe('lost')
    expect(toast.getState()).toBe('lost')
    expect(el.textContent).toBe(GPU_CONTEXT_LOST_MESSAGE)
    expect(el.classList.contains('show')).toBe(true)
    expect(el.classList.contains('hidden')).toBe(false)
  })

  it('leaves the lost toast up — the context is still gone', () => {
    const { toast, timers } = setup()
    toast.markReady()

    toast.onLost()

    expect(timers.pending.size).toBe(0)
  })

  it('shows the restored copy and auto-hides it', () => {
    const { toast, el, timers } = setup()
    toast.markReady()
    toast.onLost()

    toast.onRestored()

    expect(contextAttr()).toBe('ok')
    expect(el.textContent).toBe(GPU_CONTEXT_RESTORED_MESSAGE)
    expect(timers.onlyDelay()).toBe(RESTORED_TOAST_MS)

    timers.runAll()
    expect(el.classList.contains('hidden')).toBe(true)
    expect(el.classList.contains('show')).toBe(false)
  })

  it('ignores repeated loss and restore events', () => {
    const { toast, el, timers } = setup()
    toast.markReady()

    toast.onLost()
    toast.onLost()
    expect(el.textContent).toBe(GPU_CONTEXT_LOST_MESSAGE)

    toast.onRestored()
    toast.onRestored()
    // A second restore must not queue a second hide timer.
    expect(timers.pending.size).toBe(1)
  })

  it('cancels a pending hide when the context is lost again', () => {
    const { toast, el, timers } = setup()
    toast.markReady()
    toast.onLost()
    toast.onRestored()

    toast.onLost()

    expect(timers.pending.size).toBe(0)
    expect(el.textContent).toBe(GPU_CONTEXT_LOST_MESSAGE)
    expect(el.classList.contains('show')).toBe(true)
  })

  describe('reduced motion', () => {
    it('drops the toast transition so a flapping context cannot strobe', () => {
      const { toast, el } = setup(true)
      toast.markReady()

      toast.onLost()

      expect(el.style.transition).toBe('none')
    })

    it('keeps the transition in the default mode', () => {
      const { toast, el } = setup(false)
      toast.markReady()

      toast.onLost()

      expect(el.style.transition).toBe('')
    })

    it('holds the restored toast longer instead of flashing it', () => {
      const { toast, timers } = setup(true)
      toast.markReady()
      toast.onLost()

      toast.onRestored()

      expect(timers.onlyDelay()).toBe(RESTORED_TOAST_MS_REDUCED_MOTION)
      expect(RESTORED_TOAST_MS_REDUCED_MOTION).toBeGreaterThan(RESTORED_TOAST_MS)
    })
  })

  it('dispose hides the toast and drops the pending timer', () => {
    const { toast, el, timers } = setup()
    toast.markReady()
    toast.onLost()
    toast.onRestored()

    toast.dispose()

    expect(timers.pending.size).toBe(0)
    expect(el.classList.contains('hidden')).toBe(true)
  })

  it('still tracks state when #power-toast is absent', () => {
    document.body.innerHTML = ''
    const toast = new GpuContextToast({ doc: document, isReducedMotion: () => false })

    toast.markReady()
    expect(() => toast.onLost()).not.toThrow()

    expect(contextAttr()).toBe('lost')
    expect(toast.getState()).toBe('lost')
  })
})
