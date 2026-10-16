/**
 * Timer scope — tracks every timeout / interval / animation frame a system schedules so
 * its dispose() can cancel them all (#441). A bare `setTimeout` in a long-lived class
 * outlives dispose(): the callback later touches a torn-down scene, DOM node or field.
 *
 * Handles are the scope's own numbers, so callers never depend on whether the
 * underlying platform returns a number (browsers) or an object (Node). `base` is
 * injectable so tests can drive the scope with fake timers.
 */

export interface TimerBase {
  setTimeout(fn: () => void, ms?: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(fn: () => void, ms?: number): unknown
  clearInterval(handle: unknown): void
  requestAnimationFrame?(fn: (time: number) => void): unknown
  cancelAnimationFrame?(handle: unknown): void
}

export interface TimerScope {
  /** Returns 0 (and schedules nothing) once the scope is disposed. */
  setTimeout(fn: () => void, ms?: number): number
  clearTimeout(handle: number): void
  setInterval(fn: () => void, ms?: number): number
  clearInterval(handle: number): void
  requestAnimationFrame(fn: (time: number) => void): number
  cancelAnimationFrame(handle: number): void
  /** Cancel everything pending. The scope stays usable. */
  clear(): void
  /** `clear()`, then refuse new work. Call from the owner's dispose(). */
  dispose(): void
}

export function createTimerScope(base: TimerBase = globalThis as unknown as TimerBase): TimerScope {
  let nextId = 1
  let closed = false
  // id -> how to cancel it on the underlying platform
  const pending = new Map<number, () => void>()

  const track = (cancel: () => void): number => {
    const id = nextId++
    pending.set(id, cancel)
    return id
  }
  const forget = (id: number): void => { pending.delete(id) }
  const cancel = (id: number): void => {
    const cancelFn = pending.get(id)
    if (!cancelFn) return
    pending.delete(id)
    cancelFn()
  }

  const scope: TimerScope = {
    setTimeout(fn, ms) {
      if (closed) return 0
      const id = track(() => base.clearTimeout(handle))
      const handle = base.setTimeout(() => { forget(id); fn() }, ms)
      return id
    },
    setInterval(fn, ms) {
      if (closed) return 0
      const id = track(() => base.clearInterval(handle))
      const handle = base.setInterval(fn, ms)
      return id
    },
    requestAnimationFrame(fn) {
      if (closed) return 0
      const id = track(() => (base.cancelAnimationFrame ? base.cancelAnimationFrame(handle) : base.clearTimeout(handle)))
      const run = (time: number): void => { forget(id); fn(time) }
      // Headless/Node environments have no rAF; ~60 Hz timeout keeps callers working.
      const handle = base.requestAnimationFrame ? base.requestAnimationFrame(run) : base.setTimeout(() => run(0), 16)
      return id
    },
    clearTimeout: cancel,
    clearInterval: cancel,
    cancelAnimationFrame: cancel,
    clear() {
      for (const cancelFn of [...pending.values()]) cancelFn()
      pending.clear()
    },
    dispose() {
      closed = true
      scope.clear()
    },
  }
  return scope
}
