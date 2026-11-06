/**
 * #503 A3 — what a physics / sim fault does to the run. A strict (verification) playback is
 * rejected on the first fault; spectate (non-strict) plays on; a live run is marked unranked and
 * ends on 3 faulting frames of 8. Wired as the Game wires it: FrameScheduler `onFault` →
 * `SimFaultPolicy.report`.
 */
import { describe, expect, it, vi } from 'vitest'
import { FrameScheduler, type FrameSchedulerEngine } from '../src/core/frame-scheduler'
import { ReplayRunner } from '../src/replay/replay-runner'
import { SimFaultPolicy } from '../src/game/sim-fault-policy'
import type { ReplayPayload } from '../src/replay/replay-recorder'

vi.mock('../src/boot-log', () => ({ bootError: vi.fn(), bootWarn: vi.fn() }))

const engine = (): FrameSchedulerEngine => ({ runRenderLoop() {}, stopRenderLoop() {}, getDeltaTime: () => 16 })

const tape = (frames = 100): ReplayPayload => ({
  version: 3, buildId: 't', mapId: 'neon-helix', seed: 1, physicsEngine: 'wasm-owner', renderer: 'webgl2',
  createdAt: '2026-11-06T00:00:00.000Z', finalScore: 0,
  frames: Array.from({ length: frames }, () => ({
    flipperLeft: false, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: 0,
  })),
} as unknown as ReplayPayload)

function rig({ live = true } = {}) {
  const runner = new ReplayRunner()
  const deferred: Array<() => void> = []
  let playing = live
  const host = {
    replayRunner: runner,
    isRunLive: () => playing,
    frame: () => scheduler.getFrameCount(),
    onUnranked: vi.fn(),
    endRun: vi.fn(() => { playing = false }),
    defer: (fn: () => void) => deferred.push(fn),
  }
  const policy = new SimFaultPolicy(host)
  const scheduler: FrameScheduler = new FrameScheduler(engine(), {
    onFault: (f) => { if (f.sim) policy.report({ phase: f.phase === 'physics' ? 'physics' : 'sim', name: f.name, message: f.message }) },
  })
  const hud = vi.fn()
  scheduler.register({ phase: 'hud', name: 'hud', update: hud })
  const flush = () => deferred.splice(0).forEach((fn) => fn())
  return { runner, host, policy, scheduler, hud, flush }
}

/** A sim system that throws on the frames listed (0-based). */
function simThrowsOn(frames: number[]) {
  let frame = 0
  return { phase: 'sim' as const, name: 'table', update: vi.fn(() => { if (frames.includes(frame++)) throw new Error('diverged') }) }
}

describe('SimFaultPolicy (#503 A3)', () => {
  it('a strict playback is rejected on the first sim fault; the sim system stays registered', () => {
    const r = rig({ live: false })
    r.runner.setStrict(true)
    r.runner.load(tape())
    const sim = simThrowsOn([0])
    r.scheduler.register(sim)
    r.scheduler.tick()
    expect(r.runner.getRejection()).toEqual({ outcome: 'sim-fault', message: 'sim/table: diverged' })
    expect(r.runner.isPlaying()).toBe(false)
    r.scheduler.tick()
    expect(sim.update).toHaveBeenCalledTimes(2)
    expect(r.hud).toHaveBeenCalledTimes(2)
  })

  it('strict survives load(): the verifier sets it before loading the tape', () => {
    const runner = new ReplayRunner()
    runner.setStrict(true)
    runner.load(tape())
    runner.reset()
    expect(runner.isStrict()).toBe(true)
  })

  it('a non-strict playback (spectate, ghosts) plays on through a sim fault', () => {
    const r = rig({ live: false })
    r.runner.load(tape())
    r.scheduler.register(simThrowsOn([0, 1, 2]))
    for (let i = 0; i < 3; i++) r.scheduler.tick()
    expect(r.runner.getRejection()).toBeNull()
    expect(r.runner.isPlaying()).toBe(true)
    expect(r.policy.isUnranked()).toBe(false)
  })

  it('a live run is marked unranked on its first sim fault and plays on', () => {
    const r = rig()
    r.scheduler.register(simThrowsOn([0]))
    for (let i = 0; i < 8; i++) r.scheduler.tick()
    r.flush()
    expect(r.policy.isUnranked()).toBe(true)
    expect(r.host.onUnranked).toHaveBeenCalledTimes(1)
    expect(r.host.onUnranked).toHaveBeenCalledWith('sim/table: diverged', false)
    expect(r.host.endRun).not.toHaveBeenCalled()
  })

  it('3 faulting frames of 8 end the live run — after the frame, once', () => {
    const r = rig()
    r.scheduler.register(simThrowsOn([0, 2, 4, 5, 6]))
    for (let i = 0; i < 5; i++) r.scheduler.tick()
    expect(r.host.endRun).not.toHaveBeenCalled()
    expect(r.host.onUnranked).toHaveBeenLastCalledWith('sim/table: diverged', true)
    r.flush()
    expect(r.host.endRun).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) r.scheduler.tick()
    r.flush()
    expect(r.host.endRun).toHaveBeenCalledTimes(1)
  })

  it('reset() starts the next run ranked, with a clean window', () => {
    const r = rig()
    r.policy.report({ phase: 'physics', name: 'contact', message: 'x' })
    expect(r.policy.isUnranked()).toBe(true)
    r.policy.reset()
    expect(r.policy.isUnranked()).toBe(false)
  })

  it('faults outside a run (menu, game over) change nothing', () => {
    const r = rig({ live: false })
    r.policy.report({ phase: 'sim', name: 'table', message: 'x' })
    expect(r.policy.isUnranked()).toBe(false)
    expect(r.host.onUnranked).not.toHaveBeenCalled()
  })
})
