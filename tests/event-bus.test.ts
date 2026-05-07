/**
 * Unit tests for EventBus
 *
 * EventBus is a pure TypeScript class with zero external dependencies — no
 * Babylon.js, no Rapier, no DOM, no async I/O. No vi.mock() calls are needed.
 * All tests run entirely in the plain Node environment provided by Vitest.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from '../src/game/event-bus'
import { DisplayState, GameState } from '../src/game-elements/types'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  // ---------------------------------------------------------------------------
  // on() + emit()
  // ---------------------------------------------------------------------------

  describe('on() + emit()', () => {
    it('delivers the correct typed payload to a listener', () => {
      let received: DisplayState | undefined
      bus.on('display:set', (state) => { received = state })
      bus.emit('display:set', DisplayState.FEVER)
      expect(received).toBe(DisplayState.FEVER)
    })

    it('fires all listeners registered for the same event', () => {
      const calls: number[] = []
      bus.on('game:start', () => calls.push(1))
      bus.on('game:start', () => calls.push(2))
      bus.emit('game:start')
      expect(calls).toEqual([1, 2])
    })

    it('void events work without a second argument', () => {
      let fired = false
      bus.on('game:over', () => { fired = true })
      bus.emit('game:over')
      expect(fired).toBe(true)
    })

    it('does not call a handler registered for a different event', () => {
      let called = false
      bus.on('game:start', () => { called = true })
      bus.emit('game:over')
      expect(called).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // off() / unsubscribe function
  // ---------------------------------------------------------------------------

  describe('off() / unsubscribe function', () => {
    it('returned unsubscribe function removes the listener', () => {
      let count = 0
      const unsub = bus.on('game:pause', () => { count++ })
      bus.emit('game:pause')
      expect(count).toBe(1)
      unsub()
      bus.emit('game:pause')
      expect(count).toBe(1)
    })

    it('bus.off(event, handler) removes the listener', () => {
      let count = 0
      const handler = () => { count++ }
      bus.on('game:pause', handler)
      bus.emit('game:pause')
      expect(count).toBe(1)
      bus.off('game:pause', handler)
      bus.emit('game:pause')
      expect(count).toBe(1)
    })

    it('removing one listener does not affect other listeners on the same event', () => {
      const results: string[] = []
      const h1 = () => results.push('h1')
      const h2 = () => results.push('h2')
      bus.on('game:resume', h1)
      bus.on('game:resume', h2)
      bus.off('game:resume', h1)
      bus.emit('game:resume')
      expect(results).toEqual(['h2'])
    })
  })

  // ---------------------------------------------------------------------------
  // clear(event)
  // ---------------------------------------------------------------------------

  describe('clear(event)', () => {
    it('removes only the listeners for the specified event', () => {
      let startCalled = false
      let overCalled = false
      bus.on('game:start', () => { startCalled = true })
      bus.on('game:over', () => { overCalled = true })
      bus.clear('game:start')
      bus.emit('game:start')
      bus.emit('game:over')
      expect(startCalled).toBe(false)
      expect(overCalled).toBe(true)
    })

    it('does not throw when the event has no listeners', () => {
      expect(() => bus.clear('game:start')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // clear() — no argument
  // ---------------------------------------------------------------------------

  describe('clear() (no arg)', () => {
    it('removes all listeners across all events', () => {
      let startCalled = false
      let overCalled = false
      bus.on('game:start', () => { startCalled = true })
      bus.on('game:over', () => { overCalled = true })
      bus.clear()
      bus.emit('game:start')
      bus.emit('game:over')
      expect(startCalled).toBe(false)
      expect(overCalled).toBe(false)
    })

    it('does not throw on an empty bus', () => {
      expect(() => bus.clear()).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Emit-during-iteration safety
  // ---------------------------------------------------------------------------

  describe('emit-during-iteration safety', () => {
    it('listener calling off() on itself does not skip remaining listeners in the same emit', () => {
      const results: string[] = []
      let unsub!: () => void
      unsub = bus.on('menu:enter', () => {
        unsub()
        results.push('first')
      })
      bus.on('menu:enter', () => results.push('second'))
      bus.emit('menu:enter')
      expect(results).toEqual(['first', 'second'])
    })

    it('listener calling on() during emit does not fire the new handler in the same emit cycle', () => {
      let newHandlerCalled = false
      bus.on('menu:exit', () => {
        bus.on('menu:exit', () => { newHandlerCalled = true })
      })
      bus.emit('menu:exit')
      expect(newHandlerCalled).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Typed payload
  // ---------------------------------------------------------------------------

  describe('typed payload', () => {
    it('display:set delivers a DisplayState string value', () => {
      let received: DisplayState | undefined
      bus.on('display:set', (state) => { received = state })
      bus.emit('display:set', DisplayState.JACKPOT)
      expect(received).toBe('jackpot')
    })

    it('state:change delivers { oldState, newState }', () => {
      let received: { oldState: GameState; newState: GameState } | undefined
      bus.on('state:change', (payload) => { received = payload })
      bus.emit('state:change', { oldState: GameState.MENU, newState: GameState.PLAYING })
      expect(received).toEqual({ oldState: GameState.MENU, newState: GameState.PLAYING })
    })
  })
})
