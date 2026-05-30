import { describe, it, expect, vi, beforeEach } from 'vitest'

import { InputHandler } from '../src/game-elements/input'
import { GameState } from '../src/game-elements/types'

// Minimal KeyboardEvent polyfill for Node test environment
class MockKeyboardEvent {
  code: string
  type: string
  defaultPrevented = false
  constructor(type: string, init: { code: string }) {
    this.type = type
    this.code = init.code
  }
  preventDefault(): void {
    this.defaultPrevented = true
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).KeyboardEvent = MockKeyboardEvent

describe('InputHandler', () => {
  let handler: InputHandler
  const callbacks = {
    onFlipperLeft: vi.fn(),
    onFlipperRight: vi.fn(),
    onPlunger: vi.fn(),
    onPlungerChargeUpdate: vi.fn(),
    onNudge: vi.fn(),
    onPause: vi.fn(),
    onReset: vi.fn(),
    onStart: vi.fn(),
    onAdventureToggle: vi.fn(),
    getState: vi.fn().mockReturnValue(GameState.PLAYING),
    getTiltActive: vi.fn().mockReturnValue(false),
  }

  const fakeRapier = {
    Vector3: vi.fn().mockImplementation((x: number, y: number, z: number) => ({ x, y, z })),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    callbacks.getState.mockReturnValue(GameState.PLAYING)
    callbacks.getTiltActive.mockReturnValue(false)
    handler = new InputHandler(callbacks, fakeRapier as unknown as typeof import('@dimforge/rapier3d-compat'))
  })

  describe('handleKeyDown', () => {
    it('queues flipperLeft when ShiftLeft is pressed', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'ShiftLeft' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperLeft).toBe(true)
    })

    it('does not queue flipperLeft when KeyZ is pressed (KeyZ is nudge-left)', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyZ' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperLeft).toBeNull()
    })

    it('queues flipperRight when ShiftRight is pressed', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'ShiftRight' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperRight).toBe(true)
    })

    it('does not queue flipperRight when Slash is pressed (Slash is nudge-right)', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'Slash' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperRight).toBeNull()
    })

    it('does not queue flipper inputs when tilt is active', () => {
      callbacks.getTiltActive.mockReturnValue(true)
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'ShiftLeft' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperLeft).toBeNull()
    })

    it('does not queue gameplay inputs when state is MENU', () => {
      callbacks.getState.mockReturnValue(GameState.MENU)
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'ShiftLeft' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperLeft).toBeNull()
    })

    it('calls onStart when Space is pressed in MENU state', () => {
      callbacks.getState.mockReturnValue(GameState.MENU)
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'Space' }))
      expect(callbacks.onStart).toHaveBeenCalledTimes(1)
    })

    it('queues nudge with correct direction for KeyZ', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyZ' }))
      const frame = handler.processBufferedInputs()
      expect(frame.nudge).toEqual({ x: -0.6, y: 0, z: 0.3 })
    })

    it('queues nudge with correct direction for Slash', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'Slash' }))
      const frame = handler.processBufferedInputs()
      expect(frame.nudge).toEqual({ x: 0.6, y: 0, z: 0.3 })
    })

    it('queues nudge with correct direction for Space', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'Space' }))
      const frame = handler.processBufferedInputs()
      expect(frame.nudge).toEqual({ x: 0, y: 0, z: 0.8 })
    })

    it('calls onPause when KeyP is pressed', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyP' }))
      expect(callbacks.onPause).toHaveBeenCalledTimes(1)
    })

    it('calls onReset when KeyR is pressed during PLAYING', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyR' }))
      expect(callbacks.onReset).toHaveBeenCalledTimes(1)
    })

    it('calls onAdventureToggle when KeyH is pressed', () => {
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'KeyH' }))
      expect(callbacks.onAdventureToggle).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleKeyUp', () => {
    it('queues flipperLeft=false when ShiftLeft is released', () => {
      handler.handleKeyUp(new KeyboardEvent('keyup', { code: 'ShiftLeft' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperLeft).toBe(false)
    })

    it('queues flipperRight=false when ShiftRight is released', () => {
      handler.handleKeyUp(new KeyboardEvent('keyup', { code: 'ShiftRight' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperRight).toBe(false)
    })

    it('does not queue flipper on KeyZ release (KeyZ is nudge-left)', () => {
      handler.handleKeyUp(new KeyboardEvent('keyup', { code: 'KeyZ' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperLeft).toBeNull()
    })

    it('does not queue flipper on Slash release (Slash is nudge-right)', () => {
      handler.handleKeyUp(new KeyboardEvent('keyup', { code: 'Slash' }))
      const frame = handler.processBufferedInputs()
      expect(frame.flipperRight).toBeNull()
    })

    it('queues plunger=true when Enter is released while held', () => {
      // Enter keydown starts plunger charge; Enter keyup releases and queues plunger
      handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'Enter' }))
      handler.handleKeyUp(new KeyboardEvent('keyup', { code: 'Enter' }))
      const frame = handler.processBufferedInputs()
      expect(frame.plunger).toBe(true)
    })
  })

  it('cancelPlungerCharge clears held charge and queued launch state', () => {
    handler.handleKeyDown(new KeyboardEvent('keydown', { code: 'Enter' }))

    handler.cancelPlungerCharge()

    expect(handler.isPlungerHeld()).toBe(false)
    expect(handler.getPlungerChargeState().chargeLevel).toBe(0)
    expect(handler.processBufferedInputs().plunger).toBe(false)
    expect(callbacks.onPlungerChargeUpdate).toHaveBeenCalledWith(0)
  })
})
