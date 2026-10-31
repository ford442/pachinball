/**
 * Schema-3 replay tape: one row per fixed step, so playback is independent of
 * the viewer's refresh rate. A recording made at 60 Hz replays to the same
 * score, ball pose and state hash at 30, 60 and 144 Hz — and so does one made
 * at 144 Hz.
 *
 * The engine here is a deterministic stand-in with the native engine's
 * accumulator contract (`step(rawDt)` clamps to 1/30, runs whole 1/60 substeps
 * and keeps the remainder), so a controller that handed it the render dt
 * would take a different number of substeps between inputs on a faster
 * display. The control case replays the same rows as a schema-2 tape (one row
 * per render frame) and must drift. The compiled C++ bundle runs the same
 * scenario in tests/replay-snapshot-wasm.test.ts (RUN_WASM_PARITY=1).
 */
import { describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { FIXED_TIMESTEP } from '../src/core/sim-clock'
import type { InputFrame } from '../src/game-elements/types'
import { REPLAY_SCHEMA_VERSION, ReplayRecorder, type ReplayPayload } from '../src/replay/replay-recorder'
import { ReplayRunner } from '../src/replay/replay-runner'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

/** A 1-D ball under gravity, flipper kicks and a plunger, with an accumulator like PhysicsWorld::step. */
function makeEngine() {
  const s = { x: 0, v: 0, steps: 0, acc: 0, left: false, right: false, pending: 0, hits: 0 }
  return {
    s,
    step(rawDt: number): number {
      s.acc += Math.min(rawDt, 1 / 30)
      while (s.acc >= FIXED_TIMESTEP) {
        s.acc -= FIXED_TIMESTEP
        // The kick is applied per substep while held: more substeps between
        // inputs means a different trajectory.
        const kick = (s.left ? 0.3 : 0) - (s.right ? 0.2 : 0)
        s.v += (-9.81 + kick * 30) * FIXED_TIMESTEP + s.pending
        s.pending = 0
        const before = s.x
        s.x += s.v * FIXED_TIMESTEP
        if (s.x < -2) { s.x = -2; s.v = -s.v }
        // "Bumper" band: score on each upward crossing of x = 0.5.
        if (before < 0.5 && s.x >= 0.5) s.hits++
        s.steps++
      }
      return s.acc / FIXED_TIMESTEP
    },
    /** Everything that decides the future of the sim, like `getStateHash()` (accumulator included). */
    hash(): string {
      return JSON.stringify([s.x, s.v, s.steps, s.acc, s.left, s.right, s.pending, s.hits])
    },
  }
}

/** Live input as a pure function of the 60 Hz input-event index. */
function tape(i: number): InputFrame {
  const left = i % 40 >= 5 && i % 40 < 15
  const right = (i + 20) % 40 >= 5 && (i + 20) % 40 < 12
  return {
    flipperLeft: left,
    flipperRight: right,
    plungerCharge: i === 30 ? 0.75 : null,
    plunger: i === 30,
    nudge: null,
    timestamp: i,
  }
}

function makeTable(hz: number) {
  const engine = makeEngine()
  const physics = {
    step: vi.fn((dt: number) => engine.step(dt)),
    getStepCount: () => engine.s.steps,
    getWorld: () => null,
    isWasmActive: () => false,
    isWasmOwnerMode: () => false,
  }
  const host = makePhysicsHostShell({
    physics,
    ballManager: makeBallManagerStub(),
    gameObjects: makeGameObjectsStub(),
  })
  ;(host.engine.getDeltaTime as ReturnType<typeof vi.fn>).mockReturnValue(1000 / hz)
  const controller = new GamePhysicsController(host)
  const actions = {
    handleFlipperLeft: (p: boolean) => { engine.s.left = p },
    handleFlipperRight: (p: boolean) => { engine.s.right = p },
    handlePlunger: (charge?: number | null) => { engine.s.pending += 12 * (charge ?? 0) },
  }
  const score = () => engine.s.hits * 100
  return { engine, controller, actions, score }
}

/** Record `seconds` of play at `hz`: one live input event per 1/60 s of wall time. */
function record(hz: number, seconds: number) {
  const t = makeTable(hz)
  const recorder = new ReplayRecorder()
  recorder.start({
    version: REPLAY_SCHEMA_VERSION, buildId: 'vitest', mapId: 'neon-helix', seed: 7,
    physicsEngine: 'rapier', renderer: 'webgl2', createdAt: '2026-10-29T00:00:00.000Z',
  })
  // Input events arrive on wall time; the 144 Hz recorder drains them on
  // whichever render frame comes next, just like the real buffered input.
  let wall = 0
  let next = 0
  let pending: InputFrame | null = null
  const input = {
    update: () => {
      while (next * (1 / 60) <= wall + 1e-9) {
        const f = tape(next++)
        pending = pending ? { ...f, plungerCharge: pending.plungerCharge ?? f.plungerCharge } : f
      }
    },
    processBufferedInputs: () => {
      const f = pending
      pending = null
      return f
    },
  }
  const frames = Math.round(seconds * hz)
  for (let i = 0; i < frames; i++) {
    t.controller.stepPhysics(input, t.actions, null, recorder)
    wall += 1 / hz
  }
  const payload = recorder.stop(t.score())!
  return { live: t, payload }
}

function replayAt(payload: ReplayPayload, hz: number) {
  const t = makeTable(hz)
  const runner = new ReplayRunner()
  runner.load(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload)))
  let guard = 0
  while (runner.isPlaying() && guard++ < 100_000) t.controller.stepPhysics(null, t.actions, runner, null)
  return t
}

describe('schema-3 replay tape: one row per fixed step (refresh-rate independent)', () => {
  it('records one row per fixed step, not per render frame', () => {
    const { live, payload } = record(144, 4)
    expect(payload.version).toBe(3)
    expect(payload.frames).toHaveLength(live.engine.s.steps)
    // 144 Hz: most render frames run no step at all.
    expect(payload.frames.length).toBeLessThan(4 * 144 / 2)
    // A 30 Hz frame runs two steps; the second carries "no change".
    const { payload: p30 } = record(30, 1)
    expect(p30.frames[1]).toMatchObject({ flipperLeft: null, flipperRight: null, plungerCharge: null })
  })

  it.each([30, 60, 144])('a 60 Hz recording replays bit-for-bit at %i Hz', (hz) => {
    const { live, payload } = record(60, 4)
    expect(live.score()).toBeGreaterThan(0)
    expect(payload.frames.some((f) => f.plungerCharge !== null)).toBe(true)
    const client = replayAt(payload, hz)
    expect(client.score()).toBe(live.score())
    expect(client.engine.s.x).toBe(live.engine.s.x)
    expect(client.engine.s.v).toBe(live.engine.s.v)
    expect(client.engine.hash()).toBe(live.engine.hash())
  })

  it.each([30, 60, 144])('a 144 Hz recording replays bit-for-bit at %i Hz', (hz) => {
    const { live, payload } = record(144, 4)
    const client = replayAt(payload, hz)
    expect(client.score()).toBe(live.score())
    expect(client.engine.hash()).toBe(live.engine.hash())
  })

  it('control: the same rows as a schema-2 tape (per render frame) drift at 144 Hz', () => {
    const { live, payload } = record(60, 4)
    const legacy: ReplayPayload = { ...payload, version: 2 }
    // At the recorder's own rate the legacy path still matches...
    expect(replayAt(legacy, 60).engine.hash()).toBe(live.engine.hash())
    // ...at any other rate it does not.
    expect(replayAt(legacy, 144).engine.hash()).not.toBe(live.engine.hash())
  })
})
