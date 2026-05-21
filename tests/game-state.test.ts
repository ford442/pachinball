/**
 * @vitest-environment happy-dom
 *
 * Unit tests for GameStateManager
 *
 * GameStateManager, EventBus, GameState, and DisplayState are all pure
 * TypeScript with zero runtime engine dependencies — no Babylon.js, no Rapier,
 * no DOM, no audio. No vi.mock() calls are needed. All tests run entirely in
 * the plain Node environment provided by Vitest.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GameStateManager } from '../src/game/game-state'
import { EventBus } from '../src/game/event-bus'
import { GameState, DisplayState } from '../src/game-elements/types'

describe('GameStateManager', () => {
  let bus: EventBus
  let manager: GameStateManager

  beforeEach(() => {
    bus = new EventBus()
    manager = new GameStateManager()
    manager.setEventBus(bus)
  })

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  describe('initialization', () => {
    it('starts in MENU state', () => {
      expect(manager.getState()).toBe(GameState.MENU)
    })

    it('getPreviousState() returns MENU on a fresh instance', () => {
      expect(manager.getPreviousState()).toBe(GameState.MENU)
    })
  })

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  describe('idempotency', () => {
    it('setState() with the current state emits no events', () => {
      const emitted: string[] = []
      bus.on('state:change', () => emitted.push('state:change'))
      manager.setState(GameState.MENU)
      expect(emitted).toHaveLength(0)
    })

    it('setState() with the current state does not invoke onStateChange callback', () => {
      const onStateChange = vi.fn()
      const m = new GameStateManager({ onStateChange })
      m.setEventBus(bus)
      m.setState(GameState.MENU)
      expect(onStateChange).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // MENU → PLAYING (startGame)
  // ---------------------------------------------------------------------------

  describe('MENU → PLAYING (startGame)', () => {
    it('transitions state and previousState correctly', () => {
      manager.startGame()
      expect(manager.getState()).toBe(GameState.PLAYING)
      expect(manager.getPreviousState()).toBe(GameState.MENU)
    })

    it('emits game:start then state:change in correct order', () => {
      const emitted: Array<{ event: string; payload?: unknown }> = []
      bus.on('game:start', () => emitted.push({ event: 'game:start' }))
      bus.on('state:change', (p) => emitted.push({ event: 'state:change', payload: p }))
      manager.startGame()
      expect(emitted[0].event).toBe('game:start')
      expect(emitted[1]).toEqual({
        event: 'state:change',
        payload: { oldState: GameState.MENU, newState: GameState.PLAYING },
      })
    })

    it('fires onGameStart and onStateChange callbacks', () => {
      const onGameStart = vi.fn()
      const onStateChange = vi.fn()
      const m = new GameStateManager({ onGameStart, onStateChange })
      m.setEventBus(bus)
      m.startGame()
      expect(onGameStart).toHaveBeenCalledOnce()
      expect(onStateChange).toHaveBeenCalledWith(GameState.MENU, GameState.PLAYING)
    })
  })

  // ---------------------------------------------------------------------------
  // PLAYING → PAUSED (togglePause)
  // ---------------------------------------------------------------------------

  describe('PLAYING → PAUSED (togglePause)', () => {
    beforeEach(() => {
      manager.startGame()
    })

    it('transitions to PAUSED state', () => {
      manager.togglePause()
      expect(manager.getState()).toBe(GameState.PAUSED)
    })

    it('emits game:pause then state:change in correct order', () => {
      const emitted: Array<{ event: string; payload?: unknown }> = []
      bus.on('game:pause', () => emitted.push({ event: 'game:pause' }))
      bus.on('state:change', (p) => emitted.push({ event: 'state:change', payload: p }))
      manager.togglePause()
      expect(emitted[0].event).toBe('game:pause')
      expect(emitted[1]).toEqual({
        event: 'state:change',
        payload: { oldState: GameState.PLAYING, newState: GameState.PAUSED },
      })
    })

    it('fires onPause callback', () => {
      const onPause = vi.fn()
      const m = new GameStateManager({ onPause })
      m.setEventBus(bus)
      m.startGame()
      m.togglePause()
      expect(onPause).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // PAUSED → PLAYING (togglePause)
  // ---------------------------------------------------------------------------

  describe('PAUSED → PLAYING (togglePause)', () => {
    beforeEach(() => {
      manager.startGame()
      manager.togglePause()
    })

    it('transitions back to PLAYING state', () => {
      manager.togglePause()
      expect(manager.getState()).toBe(GameState.PLAYING)
    })

    it('emits game:resume (NOT game:start) then state:change', () => {
      const emitted: Array<{ event: string; payload?: unknown }> = []
      bus.on('game:start', () => emitted.push({ event: 'game:start' }))
      bus.on('game:resume', () => emitted.push({ event: 'game:resume' }))
      bus.on('state:change', (p) => emitted.push({ event: 'state:change', payload: p }))
      manager.togglePause()
      expect(emitted[0].event).toBe('game:resume')
      expect(emitted[1]).toEqual({
        event: 'state:change',
        payload: { oldState: GameState.PAUSED, newState: GameState.PLAYING },
      })
      expect(emitted.find((e) => e.event === 'game:start')).toBeUndefined()
    })

    it('fires onResume callback', () => {
      const onResume = vi.fn()
      const m = new GameStateManager({ onResume })
      m.setEventBus(bus)
      m.startGame()
      m.togglePause()
      m.togglePause()
      expect(onResume).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // PLAYING → GAME_OVER (gameOver)
  // ---------------------------------------------------------------------------

  describe('PLAYING → GAME_OVER (gameOver)', () => {
    beforeEach(() => {
      manager.startGame()
    })

    it('transitions to GAME_OVER state', () => {
      manager.gameOver()
      expect(manager.getState()).toBe(GameState.GAME_OVER)
    })

    it('emits game:over, display:set(idle), state:change in correct order', () => {
      const emitted: Array<{ event: string; payload?: unknown }> = []
      bus.on('game:over', () => emitted.push({ event: 'game:over' }))
      bus.on('display:set', (p) => emitted.push({ event: 'display:set', payload: p }))
      bus.on('state:change', (p) => emitted.push({ event: 'state:change', payload: p }))
      manager.gameOver()
      expect(emitted[0].event).toBe('game:over')
      expect(emitted[1]).toEqual({ event: 'display:set', payload: DisplayState.IDLE })
      expect(emitted[2]).toEqual({
        event: 'state:change',
        payload: { oldState: GameState.PLAYING, newState: GameState.GAME_OVER },
      })
    })

    it('fires onGameOver callback', () => {
      const onGameOver = vi.fn()
      const m = new GameStateManager({ onGameOver })
      m.setEventBus(bus)
      m.startGame()
      m.gameOver()
      expect(onGameOver).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // GAME_OVER → MENU (returnToMenu)
  // ---------------------------------------------------------------------------

  describe('GAME_OVER → MENU (returnToMenu)', () => {
    beforeEach(() => {
      manager.startGame()
      manager.gameOver()
    })

    it('transitions to MENU state', () => {
      manager.returnToMenu()
      expect(manager.getState()).toBe(GameState.MENU)
    })

    it('emits menu:enter, display:set(idle), state:change in correct order', () => {
      const emitted: Array<{ event: string; payload?: unknown }> = []
      bus.on('menu:enter', () => emitted.push({ event: 'menu:enter' }))
      bus.on('display:set', (p) => emitted.push({ event: 'display:set', payload: p }))
      bus.on('state:change', (p) => emitted.push({ event: 'state:change', payload: p }))
      manager.returnToMenu()
      expect(emitted[0].event).toBe('menu:enter')
      expect(emitted[1]).toEqual({ event: 'display:set', payload: DisplayState.IDLE })
      expect(emitted[2]).toEqual({
        event: 'state:change',
        payload: { oldState: GameState.GAME_OVER, newState: GameState.MENU },
      })
    })

    it('fires onMenuEnter callback', () => {
      const onMenuEnter = vi.fn()
      const m = new GameStateManager({ onMenuEnter })
      m.setEventBus(bus)
      m.startGame()
      m.gameOver()
      m.returnToMenu()
      expect(onMenuEnter).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // Boolean helpers
  // ---------------------------------------------------------------------------

  describe('boolean helpers', () => {
    it('isMenu() is true only in MENU state', () => {
      expect(manager.isMenu()).toBe(true)
      manager.startGame()
      expect(manager.isMenu()).toBe(false)
      manager.gameOver()
      expect(manager.isMenu()).toBe(false)
    })

    it('isPlaying() is true only in PLAYING state', () => {
      expect(manager.isPlaying()).toBe(false)
      manager.startGame()
      expect(manager.isPlaying()).toBe(true)
      manager.togglePause()
      expect(manager.isPlaying()).toBe(false)
    })

    it('isPaused() is true only in PAUSED state', () => {
      expect(manager.isPaused()).toBe(false)
      manager.startGame()
      expect(manager.isPaused()).toBe(false)
      manager.togglePause()
      expect(manager.isPaused()).toBe(true)
      manager.togglePause()
      expect(manager.isPaused()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // togglePause() guards
  // ---------------------------------------------------------------------------

  describe('togglePause() guards', () => {
    it('is a no-op from MENU state', () => {
      const emitted: string[] = []
      bus.on('state:change', () => emitted.push('state:change'))
      manager.togglePause()
      expect(manager.getState()).toBe(GameState.MENU)
      expect(emitted).toHaveLength(0)
    })

    it('is a no-op from GAME_OVER state', () => {
      manager.startGame()
      manager.gameOver()
      const emitted: string[] = []
      bus.on('state:change', () => emitted.push('state:change'))
      manager.togglePause()
      expect(manager.getState()).toBe(GameState.GAME_OVER)
      expect(emitted).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // No EventBus wired
  // ---------------------------------------------------------------------------

  describe('no EventBus wired', () => {
    it('all transitions complete without throwing', () => {
      const m = new GameStateManager()
      // No setEventBus() call — eventBus remains null
      expect(() => {
        m.startGame()
        m.togglePause()
        m.togglePause()
        m.gameOver()
        m.returnToMenu()
      }).not.toThrow()
    })

    it('StateManagerConfig callbacks still fire without EventBus', () => {
      const onGameStart = vi.fn()
      const onPause = vi.fn()
      const onResume = vi.fn()
      const onGameOver = vi.fn()
      const onMenuEnter = vi.fn()
      const m = new GameStateManager({ onGameStart, onPause, onResume, onGameOver, onMenuEnter })
      // No setEventBus() call
      m.startGame()
      m.togglePause()
      m.togglePause()
      m.gameOver()
      m.returnToMenu()
      expect(onGameStart).toHaveBeenCalledOnce()
      expect(onPause).toHaveBeenCalledOnce()
      expect(onResume).toHaveBeenCalledOnce()
      expect(onGameOver).toHaveBeenCalledOnce()
      expect(onMenuEnter).toHaveBeenCalledOnce()
    })
  })
})
