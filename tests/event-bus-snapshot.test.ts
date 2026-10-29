/**
 * EventBus dispatch-snapshot semantics (#488 §5, zero-allocation hot path).
 *
 * `emit` iterates a cached handler array that is rebuilt only after on()/off()/clear() changed
 * the set, instead of cloning the set on every emit. These tests pin the observable behaviour
 * the old `Array.from(handlers)` clone had, so the cache cannot change who gets called:
 *
 *   - a handler added during an emit is not called in that emit (but is in the next one);
 *   - a handler removed during an emit is still called in that emit (the emit iterates the
 *     handlers as they were when it started), and not in the next one;
 *   - a throwing handler aborts the rest of that emit (no error isolation, as before) and
 *     leaves the bus usable;
 *   - re-entrant emits of the same event see the handler set as of their own start.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from '../src/core/event-bus'

describe('EventBus dispatch snapshot', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  it('does not call a handler added during an emit until the next emit', () => {
    const calls: string[] = []
    const late = () => calls.push('late')
    bus.on('game:start', () => {
      calls.push('first')
      bus.on('game:start', late)
    })
    bus.on('game:start', () => calls.push('second'))

    bus.emit('game:start')
    expect(calls).toEqual(['first', 'second'])

    calls.length = 0
    bus.emit('game:start')
    // `late` is a Set member now; re-adding it from `first` is a no-op.
    expect(calls).toEqual(['first', 'second', 'late'])
  })

  it('still calls a handler removed by an earlier handler during the same emit', () => {
    const calls: string[] = []
    const victim = () => calls.push('victim')
    bus.on('game:start', () => {
      calls.push('remover')
      bus.off('game:start', victim)
    })
    bus.on('game:start', victim)

    bus.emit('game:start')
    expect(calls).toEqual(['remover', 'victim'])

    calls.length = 0
    bus.emit('game:start')
    expect(calls).toEqual(['remover'])
  })

  it('lets a handler unsubscribe itself mid-emit without skipping the next handler', () => {
    const calls: string[] = []
    const unsub = bus.on('game:start', () => {
      calls.push('once')
      unsub()
    })
    bus.on('game:start', () => calls.push('after'))

    bus.emit('game:start')
    bus.emit('game:start')
    expect(calls).toEqual(['once', 'after', 'after'])
  })

  it('still calls the remaining handlers of an emit during which clear() ran', () => {
    const calls: string[] = []
    bus.on('game:start', () => {
      calls.push('clearer')
      bus.clear()
    })
    bus.on('game:start', () => calls.push('second'))

    bus.emit('game:start')
    expect(calls).toEqual(['clearer', 'second'])

    calls.length = 0
    bus.emit('game:start')
    expect(calls).toEqual([])
  })

  it('a throwing handler aborts the rest of that emit and the bus keeps working', () => {
    const calls: string[] = []
    let shouldThrow = true
    bus.on('game:start', () => {
      calls.push('a')
      if (shouldThrow) throw new Error('boom')
    })
    bus.on('game:start', () => calls.push('b'))

    expect(() => bus.emit('game:start')).toThrow('boom')
    expect(calls).toEqual(['a'])

    shouldThrow = false
    calls.length = 0
    bus.emit('game:start')
    expect(calls).toEqual(['a', 'b'])
  })

  it('a re-entrant emit sees handlers added by the outer emit; the outer emit does not', () => {
    const calls: string[] = []
    let depth = 0
    const added = () => calls.push(`added@${depth}`)
    bus.on('game:start', () => {
      depth++
      calls.push(`outer@${depth}`)
      if (depth === 1) {
        bus.on('game:start', added)
        bus.emit('game:start')
      }
      depth--
    })

    bus.emit('game:start')
    // Inner emit (depth 2) runs `added`; the outer emit (depth 1) began before it existed.
    expect(calls).toEqual(['outer@1', 'outer@2', 'added@1'])
  })

  it('reuses one snapshot array across emits while the handler set is unchanged', () => {
    const a = () => {}
    const b = () => {}
    bus.on('game:start', a)
    bus.on('game:start', b)

    bus.emit('game:start')
    const first = bus.dispatchSnapshot('game:start')
    expect(first).toEqual([a, b])
    bus.emit('game:start')
    bus.emit('game:start')
    expect(bus.dispatchSnapshot('game:start')).toBe(first)
  })

  it('rebuilds the snapshot only after the handler set changes', () => {
    const a = () => {}
    const b = () => {}
    bus.on('game:start', a)
    bus.emit('game:start')
    const first = bus.dispatchSnapshot('game:start')

    // Re-adding a member and removing a non-member do not change the set: keep the snapshot.
    bus.on('game:start', a)
    bus.off('game:start', b)
    bus.emit('game:start')
    expect(bus.dispatchSnapshot('game:start')).toBe(first)

    bus.on('game:start', b)
    bus.emit('game:start')
    const second = bus.dispatchSnapshot('game:start')
    expect(second).not.toBe(first)
    expect(second).toEqual([a, b])
    // The array an in-flight emit holds is never mutated in place.
    expect(first).toEqual([a])

    bus.off('game:start', a)
    bus.emit('game:start')
    expect(bus.dispatchSnapshot('game:start')).toEqual([b])
  })

  it('hasListeners reports whether an emit would reach anyone', () => {
    expect(bus.hasListeners('wasm:physics:contact')).toBe(false)
    const unsub = bus.on('wasm:physics:contact', () => {})
    expect(bus.hasListeners('wasm:physics:contact')).toBe(true)
    unsub()
    expect(bus.hasListeners('wasm:physics:contact')).toBe(false)
  })
})
