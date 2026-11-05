/** EventBus handler isolation (#503 A3): one throwing handler never skips the others. */
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'

vi.mock('../src/boot-log', () => ({ bootError: vi.fn(), bootWarn: vi.fn() }))

describe('EventBus fault isolation', () => {
  it('runs the remaining handlers after one throws, and emit does not throw', () => {
    const bus = new EventBus()
    const after = vi.fn()
    bus.on('ball:launched', () => { throw new Error('first') })
    bus.on('ball:launched', after)
    expect(() => bus.emit('ball:launched')).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('keeps a handler that throws once', () => {
    const bus = new EventBus()
    let n = 0
    const handler = vi.fn(() => { if (n++ === 0) throw new Error('once') })
    bus.on('ball:launched', handler)
    for (let i = 0; i < 10; i++) bus.emit('ball:launched')
    expect(handler).toHaveBeenCalledTimes(10)
  })

  it('quarantines a handler on its 3rd throw in 8 emits and reports it once', () => {
    const bus = new EventBus()
    const quarantined = vi.fn()
    bus.on('handler:quarantined', quarantined)
    const bad = vi.fn(() => { throw new Error('bad') })
    const good = vi.fn()
    bus.on('ball:launched', bad)
    bus.on('ball:launched', good)
    for (let i = 0; i < 6; i++) bus.emit('ball:launched')
    expect(bad).toHaveBeenCalledTimes(3)
    expect(good).toHaveBeenCalledTimes(6)
    expect(quarantined).toHaveBeenCalledTimes(1)
    expect(quarantined).toHaveBeenCalledWith({ event: 'ball:launched', message: 'bad' })
  })

  it('keeps reusing the dispatch snapshot when nothing throws', () => {
    const bus = new EventBus()
    bus.on('ball:launched', () => {})
    bus.emit('ball:launched')
    const first = bus.dispatchSnapshot('ball:launched')
    bus.emit('ball:launched')
    expect(bus.dispatchSnapshot('ball:launched')).toBe(first)
  })
})
