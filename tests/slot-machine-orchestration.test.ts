/**
 * Integration tests for SlotMachine orchestration (win / near-miss / jackpot events).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '../src/game/event-bus'
import { SlotMachine } from '../src/display/slot-machine'
import { SlotSymbol, SlotSpinState, SlotActivationMode } from '../src/display/slot-types'
import type { DisplayReelsLayer } from '../src/display/display-reels'

function createMockReelsLayer(): DisplayReelsLayer & {
  startSpin: ReturnType<typeof vi.fn>
  stopReel: ReturnType<typeof vi.fn>
  setOnStopped: ReturnType<typeof vi.fn>
  setSymbols: ReturnType<typeof vi.fn>
} {
  let stoppedCallback: ((symbols: string[]) => void) | null = null

  return {
    startSpin: vi.fn(),
    stopReel: vi.fn(),
    setSymbols: vi.fn(),
    setOnStopped: vi.fn((cb) => {
      stoppedCallback = cb
    }),
    // Test helper — simulates reels settling
    simulateStop(symbols: string[]) {
      stoppedCallback?.(symbols)
    },
  } as unknown as DisplayReelsLayer & {
    startSpin: ReturnType<typeof vi.fn>
    stopReel: ReturnType<typeof vi.fn>
    setOnStopped: ReturnType<typeof vi.fn>
    setSymbols: ReturnType<typeof vi.fn>
    simulateStop(symbols: string[]): void
  }
}

describe('SlotMachine orchestration', () => {
  let bus: EventBus
  let reels: ReturnType<typeof createMockReelsLayer>
  let slot: SlotMachine

  beforeEach(() => {
    bus = new EventBus()
    reels = createMockReelsLayer()
    slot = new SlotMachine(reels, bus, {
      activationMode: SlotActivationMode.ALWAYS,
      cooldownSeconds: 0,
    })
    slot.setScoreProvider(() => 5000)
  })

  it('awards Double Seven payout and emits near-miss tension', () => {
    const wins: unknown[] = []
    const nearMisses: unknown[] = []
    const points: unknown[] = []

    bus.on('slot:win', (payload) => wins.push(payload))
    bus.on('slot:nearmiss', (payload) => nearMisses.push(payload))
    bus.on('points:awarded', (payload) => points.push(payload))

    slot.forceSpin([SlotSymbol.SEVEN, SlotSymbol.SEVEN, SlotSymbol.CHERRY])
    reels.simulateStop(['7', '7', 'CHERRY'])

    expect(wins).toHaveLength(1)
    expect(nearMisses).toHaveLength(1)
    expect(points).toHaveLength(1)
    expect((wins[0] as { points: number }).points).toBe(200)
  })

  it('emits slot:jackpot without duplicate jackpot:start (handled by game layer)', () => {
    const jackpots: unknown[] = []
    const jackpotStarts: unknown[] = []

    bus.on('slot:jackpot', (payload) => jackpots.push(payload))
    bus.on('jackpot:start', () => jackpotStarts.push(true))

    slot.forceSpin([SlotSymbol.SEVEN, SlotSymbol.SEVEN, SlotSymbol.SEVEN])
    reels.simulateStop(['7', '7', '7'])

    expect(jackpots).toHaveLength(1)
    expect((jackpots[0] as { points: number }).points).toBe(100000)
    expect(jackpotStarts).toHaveLength(0)
    expect(slot.getSpinState()).toBe(SlotSpinState.JACKPOT)
  })

  it('returns to IDLE after the result settle timer', () => {
    slot.forceSpin([SlotSymbol.GRAPE, SlotSymbol.STAR, SlotSymbol.BELL])
    reels.simulateStop(['GRAPE', 'STAR', 'BELL'])
    expect(slot.getSpinState()).toBe(SlotSpinState.STOPPED)

    slot.update(3.0)
    expect(slot.getSpinState()).toBe(SlotSpinState.IDLE)
  })

  it('can spin again after settling to IDLE', () => {
    slot.forceSpin([SlotSymbol.GRAPE, SlotSymbol.STAR, SlotSymbol.BELL])
    reels.simulateStop(['GRAPE', 'STAR', 'BELL'])
    slot.update(3.0)

    const started = slot.tryActivate(10_000)
    expect(started).toBe(true)
    expect(reels.startSpin).toHaveBeenCalledTimes(2)
  })
})
