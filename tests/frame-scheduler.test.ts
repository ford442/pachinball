/**
 * FrameScheduler (#488 §4): the one owner of `engine.runRenderLoop`. Phases run in a fixed order,
 * pause / resume touch only its own loop, and a disposed scheduler never restarts.
 */

import { describe, it, expect, vi } from 'vitest'
import { FRAME_PHASES, FrameScheduler, type FramePhase, type FrameSchedulerEngine } from '../src/core/frame-scheduler'

function fakeEngine(deltaMs = 16): FrameSchedulerEngine & { loops: Array<() => void>; frame(): void } {
  const loops: Array<() => void> = []
  return {
    loops,
    runRenderLoop(fn) {
      if (!loops.includes(fn)) loops.push(fn)
    },
    stopRenderLoop(fn) {
      if (!fn) {
        loops.length = 0
        return
      }
      const i = loops.indexOf(fn)
      if (i >= 0) loops.splice(i, 1)
    },
    getDeltaTime: () => deltaMs,
    frame() {
      for (const loop of [...loops]) loop()
    },
  }
}

describe('FrameScheduler', () => {
  it('runs every phase in order, registration order within a phase', () => {
    const engine = fakeEngine()
    const s = new FrameScheduler(engine)
    const order: string[] = []
    // Registered out of order on purpose.
    for (const phase of [...FRAME_PHASES].reverse()) {
      s.register({ phase, update: () => order.push(`${phase}:a`) })
      s.register({ phase, update: () => order.push(`${phase}:b`) })
    }
    s.tick()
    expect(order).toEqual(FRAME_PHASES.flatMap((p) => [`${p}:a`, `${p}:b`]))
  })

  it('passes dt in seconds', () => {
    const s = new FrameScheduler(fakeEngine(20))
    const update = vi.fn()
    s.register({ phase: 'sim', update })
    s.tick()
    expect(update).toHaveBeenCalledWith(0.02)
  })

  it('owns exactly one render loop; pause / resume touch only that loop', () => {
    const engine = fakeEngine()
    const other = (): void => undefined
    engine.runRenderLoop(other)
    const s = new FrameScheduler(engine)
    s.start()
    s.start()
    expect(engine.loops).toHaveLength(2)
    s.pause()
    expect(engine.loops).toEqual([other])
    s.resume()
    expect(engine.loops).toHaveLength(2)
    s.dispose()
    expect(engine.loops).toEqual([other])
    s.resume()
    expect(engine.loops).toEqual([other])
  })

  it('the loop calls the frame hook when one is given (so a harness can wrap it)', () => {
    const engine = fakeEngine()
    const update = vi.fn()
    let hooked = 0
    const s: FrameScheduler = new FrameScheduler(engine, { frame: () => { hooked++; s.tick() } })
    s.register({ phase: 'render', update })
    s.start()
    engine.frame()
    expect(hooked).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('unregister and signal abort remove (and dispose) a system', () => {
    const s = new FrameScheduler(fakeEngine())
    const a = { phase: 'sim' as FramePhase, update: vi.fn(), dispose: vi.fn() }
    const b = { phase: 'sim' as FramePhase, update: vi.fn(), dispose: vi.fn() }
    const controller = new AbortController()
    const off = s.register(a)
    s.register(b, { signal: controller.signal })
    off()
    off()
    controller.abort()
    s.tick()
    expect(a.update).not.toHaveBeenCalled()
    expect(b.update).not.toHaveBeenCalled()
    expect(a.dispose).toHaveBeenCalledTimes(1)
    expect(b.dispose).toHaveBeenCalledTimes(1)
  })

  it('a system removed by an earlier one during a frame does not run that frame', () => {
    const s = new FrameScheduler(fakeEngine())
    const late = vi.fn()
    let offLate = (): void => undefined
    s.register({ phase: 'input', update: () => offLate() })
    offLate = s.register({ phase: 'hud', update: late })
    s.tick()
    expect(late).not.toHaveBeenCalled()
  })

  it('a system added during a frame starts on the next frame', () => {
    const s = new FrameScheduler(fakeEngine())
    const added = vi.fn()
    let once = false
    s.register({
      phase: 'sim',
      update: () => {
        if (once) return
        once = true
        s.register({ phase: 'sim', update: added })
      },
    })
    s.tick()
    expect(added).not.toHaveBeenCalled()
    s.tick()
    expect(added).toHaveBeenCalledTimes(1)
  })

  it('the owner signal disposes the scheduler and every system', () => {
    const engine = fakeEngine()
    const controller = new AbortController()
    const s = new FrameScheduler(engine, { signal: controller.signal })
    const sys = { phase: 'visuals' as FramePhase, update: vi.fn(), dispose: vi.fn() }
    s.register(sys)
    s.start()
    controller.abort()
    expect(s.isDisposed).toBe(true)
    expect(engine.loops).toHaveLength(0)
    expect(sys.dispose).toHaveBeenCalledTimes(1)
    // Late registration on a dead scheduler disposes at once and never runs.
    const late = { phase: 'sim' as FramePhase, update: vi.fn(), dispose: vi.fn() }
    s.register(late)
    s.tick()
    expect(late.dispose).toHaveBeenCalledTimes(1)
    expect(late.update).not.toHaveBeenCalled()
  })

  it('measures per-phase time with the injected clock', () => {
    let t = 0
    const s = new FrameScheduler(fakeEngine(), { now: () => t, timingSmoothing: 1 })
    s.register({ phase: 'physics', update: () => { t += 3 } })
    s.register({ phase: 'render', update: () => { t += 5 } })
    s.tick()
    const timings = s.getTimings()
    expect(timings.phases.physics).toBe(3)
    expect(timings.phases.render).toBe(5)
    expect(timings.phases.sim).toBe(0)
    expect(timings.total).toBe(8)
    expect(timings.frames).toBe(1)
    expect(s.describe().physics).toHaveLength(1)
  })

  it('iterates without allocating a new list per frame (copy-on-write registration)', () => {
    const s = new FrameScheduler(fakeEngine())
    s.register({ phase: 'sim', update: () => undefined })
    const lists = (s as unknown as { lists: unknown[][] }).lists
    const before = lists[2]
    s.tick()
    s.tick()
    expect(lists[2]).toBe(before)
  })

  it('rejects an unknown phase', () => {
    const s = new FrameScheduler(fakeEngine())
    expect(() => s.register({ phase: 'bogus' as FramePhase, update: () => undefined })).toThrow(/Unknown phase/)
  })
})

describe('FrameScheduler fault isolation (#503 A3)', () => {
  it('a throwing system does not stop the rest of its phase or later phases', () => {
    const engine = fakeEngine()
    const onFault = vi.fn()
    const s = new FrameScheduler(engine, { onFault })
    const ran: string[] = []
    s.register({ phase: 'visuals', name: 'boom', update: () => { throw new Error('boom') } })
    s.register({ phase: 'visuals', name: 'after', update: () => ran.push('after') })
    s.register({ phase: 'hud', name: 'hud', update: () => ran.push('hud') })
    s.start()
    engine.frame()
    expect(ran).toEqual(['after', 'hud'])
    expect(onFault).toHaveBeenCalledWith(expect.objectContaining({ phase: 'visuals', name: 'boom', message: 'boom', quarantined: false }))
  })

  it('quarantines a presentation system on its 3rd throw in 8 frames; the loop keeps running', () => {
    const engine = fakeEngine()
    const onFault = vi.fn()
    const s = new FrameScheduler(engine, { onFault })
    const dispose = vi.fn()
    const thrower = vi.fn(() => { throw new Error('x') })
    let hud = 0
    s.register({ phase: 'render', name: 'scene', update: thrower, dispose })
    s.register({ phase: 'hud', name: 'hud', update: () => { hud++ } })
    s.start()
    for (let i = 0; i < 6; i++) engine.frame()
    expect(thrower).toHaveBeenCalledTimes(3)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(s.describe().render).toEqual([])
    expect(hud).toBe(6)
    expect(engine.loops).toHaveLength(1)
    expect(onFault.mock.calls.at(-1)?.[0]).toMatchObject({ quarantined: true, overLimit: true })
  })

  it('the window catches a system that throws every other frame', () => {
    const engine = fakeEngine()
    const s = new FrameScheduler(engine, { onFault: () => {} })
    let n = 0
    s.register({ phase: 'idle', name: 'flaky', update: () => { if (n++ % 2 === 0) throw new Error('odd') } })
    for (let i = 0; i < 5; i++) s.tick()
    expect(s.describe().idle).toEqual([])
  })

  it('does not quarantine a system that throws rarely', () => {
    const s = new FrameScheduler(fakeEngine(), { onFault: () => {} })
    let n = 0
    s.register({ phase: 'hud', name: 'rare', update: () => { if (n++ % 5 === 0) throw new Error('rare') } })
    for (let i = 0; i < 40; i++) s.tick()
    expect(s.describe().hud).toEqual(['rare'])
  })

  it('never removes a physics / sim system; reports sim faults', () => {
    const onFault = vi.fn()
    const s = new FrameScheduler(fakeEngine(), { onFault })
    s.register({ phase: 'sim', name: 'table', update: () => { throw new Error('nan') } })
    for (let i = 0; i < 10; i++) s.tick()
    expect(s.describe().sim).toEqual(['table'])
    expect(onFault).toHaveBeenCalledTimes(10)
    expect(onFault.mock.calls.at(-1)?.[0]).toMatchObject({ sim: true, overLimit: true, quarantined: false })
  })

  it('a throwing onFault does not escape the frame', () => {
    const s = new FrameScheduler(fakeEngine(), { onFault: () => { throw new Error('reporter') } })
    s.register({ phase: 'hud', name: 'boom', update: () => { throw new Error('boom') } })
    expect(() => s.tick()).not.toThrow()
  })
})
