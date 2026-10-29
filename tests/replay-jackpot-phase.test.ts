/**
 * A tape of a run that enters the jackpot sequence replays the same score and
 * the same phase at the same sim step, at any refresh rate.
 *
 * Same stand-in engine as replay-fixed-step.test.ts (the native accumulator
 * contract), plus a "jackpot" table rule: the third crossing of the bumper band
 * — seen inside the engine step, like a contact callback — starts the sequence,
 * and while the display is in JACKPOT the band scores nothing (the real gates
 * are hologram catch and fever, both `getDisplayState() === IDLE`). So the step
 * the sequence ends on decides the score: a viewer that ended it a frame late
 * would score differently. The jackpot runs through the real controller, the
 * real phase clock and `GamePhysicsController.runTick`.
 *
 * Control: the old render-dt driver (the sequence's timer fed by render dt)
 * ends the sequence on a different step at each refresh rate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { FIXED_TIMESTEP, installSimClock } from '../src/core/sim-clock'
import { DisplayState } from '../src/display/display-types'
import type { InputFrame } from '../src/game-elements/types'
import { REPLAY_SCHEMA_VERSION, ReplayRecorder, type ReplayPayload } from '../src/replay/replay-recorder'
import { ReplayRunner } from '../src/replay/replay-runner'
import { JackpotSequenceController } from '../src/effects/effects-jackpot'
import { JACKPOT_TIMELINE, type JackpotPhaseLogEntry } from '../src/effects/jackpot-phase-clock'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

/** The 1-D table of replay-fixed-step.test.ts; a band crossing calls `onHit` from inside the step. */
function makeEngine(onHit: (hits: number) => void, bandScores: () => boolean) {
  const s = { x: 0, v: 0, steps: 0, acc: 0, left: false, right: false, pending: 0, hits: 0, scored: 0, dark: [] as number[] }
  return {
    s,
    step(rawDt: number): number {
      s.acc += Math.min(rawDt, 1 / 30)
      while (s.acc >= FIXED_TIMESTEP) {
        s.acc -= FIXED_TIMESTEP
        const kick = (s.left ? 0.3 : 0) - (s.right ? 0.2 : 0)
        s.v += (-9.81 + kick * 30) * FIXED_TIMESTEP + s.pending
        s.pending = 0
        const before = s.x
        s.x += s.v * FIXED_TIMESTEP
        if (s.x < -2) { s.x = -2; s.v = -s.v }
        s.steps++
        if (before < 0.5 && s.x >= 0.5) {
          s.hits++
          onHit(s.hits)
          if (bandScores()) s.scored++
          else s.dark.push(s.steps)
        }
      }
      return s.acc / FIXED_TIMESTEP
    },
    hash(): string {
      return JSON.stringify([s.x, s.v, s.steps, s.acc, s.left, s.right, s.pending, s.hits, s.scored, s.dark])
    },
  }
}

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

const JACKPOT_ON_HIT = 3

function makeTable(hz: number, accessibility: Record<string, unknown> = {}) {
  let displayState: DisplayState = DisplayState.IDLE

  const host = makePhysicsHostShell({
    physics: {},
    ballManager: makeBallManagerStub(),
    accessibility,
    // The bumper-state calls the jackpot visuals make are no-ops here.
    gameObjects: { ...makeGameObjectsStub(), setBumperState: vi.fn() },
  })
  host.eventBus.on('display:set', (state) => { displayState = state })

  const jackpot = new JackpotSequenceController({
    emitJackpotPhase: (phase) => host.eventBus.emit('jackpot:phase', { phase }),
    spawnJackpotBurst: () => undefined,
    playBeep: () => undefined,
    setLightingMode: () => undefined,
    flashVignette: () => undefined,
    addCameraShake: () => undefined,
    isReducedMotion: () => false,
    setBloomEnergy: () => undefined,
    random: () => 0.5,
  })

  const engine = makeEngine(
    (hits) => {
      if (hits !== JACKPOT_ON_HIT) return
      // What triggerJackpot() does: start the sequence, flip the display.
      jackpot.startJackpotSequence()
      host.eventBus.emit('display:set', DisplayState.JACKPOT)
    },
    () => displayState === DisplayState.IDLE,
  )

  const physics = {
    step: vi.fn((dt: number) => engine.step(dt)),
    getStepCount: () => engine.s.steps,
    getWorld: () => null,
    isWasmActive: () => false,
    isWasmOwnerMode: () => false,
  }
  const mutableHost = host as unknown as Record<string, unknown>
  mutableHost.physics = physics
  const noop = vi.fn()
  // EffectsSystem's surface as the controller reads it; the jackpot members are the real thing.
  mutableHost.effects = new Proxy({
    get isJackpotActive() { return jackpot.isJackpotActive },
    get jackpotPhase() { return jackpot.jackpotPhase },
    advanceJackpotToStep: (step: number) => jackpot.advanceToStep(step),
    setAtmosphereState: noop,
    currentLightingMode: 'normal',
  } as Record<string, unknown>, {
    get: (t, key: string) => (key in t ? t[key] : noop),
  })
  mutableHost.display = { update: noop, getDisplayState: () => displayState }
  ;(host.engine.getDeltaTime as ReturnType<typeof vi.fn>).mockReturnValue(1000 / hz)

  const controller = new GamePhysicsController(host)
  installSimClock(controller.simClock)
  const actions = {
    handleFlipperLeft: (p: boolean) => { engine.s.left = p },
    handleFlipperRight: (p: boolean) => { engine.s.right = p },
    handlePlunger: (charge?: number | null) => { engine.s.pending += 12 * (charge ?? 0) },
  }
  return {
    engine,
    controller,
    actions,
    jackpot,
    score: () => engine.s.scored * 100,
    displayState: () => displayState,
    phaseLog: (): JackpotPhaseLogEntry[] => [...jackpot.phaseLog],
  }
}

function record(hz: number, seconds: number, accessibility: Record<string, unknown> = {}) {
  const t = makeTable(hz, accessibility)
  const recorder = new ReplayRecorder()
  recorder.start({
    version: REPLAY_SCHEMA_VERSION, buildId: 'vitest', mapId: 'neon-helix', seed: 7,
    physicsEngine: 'rapier', renderer: 'webgl2', createdAt: '2026-10-29T00:00:00.000Z',
  })
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
  return { live: t, payload: recorder.stop(t.score())! }
}

function replayAt(payload: ReplayPayload, hz: number, accessibility: Record<string, unknown> = {}) {
  const t = makeTable(hz, accessibility)
  const runner = new ReplayRunner()
  runner.load(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload)))
  let guard = 0
  while (runner.isPlaying() && guard++ < 100_000) t.controller.stepPhysics(null, t.actions, runner, null)
  return t
}

afterEach(() => installSimClock(null))

describe('a tape that enters the jackpot sequence', () => {
  // 40 s: the sequence (10 s) starts seven seconds in and is over well before the tape ends.
  const SECONDS = 40

  it('goes breach → critical → meltdown → over on the steps the clock says, and gates the band until it ends', () => {
    const { live } = record(60, SECONDS)
    const log = live.phaseLog()
    expect(log).toHaveLength(4)
    const start = log[0]!.step
    expect(log).toEqual([
      { step: start, phase: 1 },
      { step: start + JACKPOT_TIMELINE.criticalAt, phase: 2 },
      { step: start + JACKPOT_TIMELINE.meltdownAt, phase: 3 },
      { step: start + JACKPOT_TIMELINE.endAt, phase: 0 },
    ])
    expect(live.displayState()).toBe(DisplayState.IDLE) // the display left JACKPOT on the end step
    // The band scored before the jackpot, was dark while the display was in JACKPOT and scores
    // again after it: the step the sequence ends on decides the score.
    const { dark, hits, scored } = live.engine.s
    expect(dark.length).toBeGreaterThan(0)
    expect(dark.every((at) => at >= start && at < start + JACKPOT_TIMELINE.endAt)).toBe(true)
    expect(scored).toBe(hits - dark.length)
    expect(scored).toBeGreaterThan(JACKPOT_ON_HIT - 1) // the two before it, and at least one after it
  })

  it.each([30, 60, 144])('a 60 Hz recording replays the same score and the same phase log at %i Hz', (hz) => {
    const { live, payload } = record(60, SECONDS)
    expect(live.phaseLog().length).toBe(4)
    const client = replayAt(payload, hz)
    expect(client.phaseLog()).toEqual(live.phaseLog())
    expect(client.score()).toBe(live.score())
    expect(client.engine.hash()).toBe(live.engine.hash())
    expect(client.displayState()).toBe(live.displayState())
  })

  it.each([30, 60, 144])('a 144 Hz recording replays the same score and the same phase log at %i Hz', (hz) => {
    const { live, payload } = record(144, SECONDS)
    const client = replayAt(payload, hz)
    expect(client.phaseLog()).toEqual(live.phaseLog())
    expect(client.score()).toBe(live.score())
    expect(client.engine.hash()).toBe(live.engine.hash())
  })

  it('photosensitive mode and reduced motion change what is shown, never what is awarded', () => {
    const calm = { reducedMotion: true, photosensitiveMode: true, flashFrequencyMax: 1, maxCameraShakeIntensity: 0 }
    const normal = record(60, SECONDS)
    const gated = record(60, SECONDS, calm)
    expect(gated.live.phaseLog()).toEqual(normal.live.phaseLog())
    expect(gated.live.score()).toBe(normal.live.score())
    expect(gated.live.score()).toBeGreaterThan(0)
    expect(gated.payload.frames).toEqual(normal.payload.frames)
    // ...and a spectator with the setting on replays a tape recorded with it off.
    const client = replayAt(normal.payload, 144, calm)
    expect(client.phaseLog()).toEqual(normal.live.phaseLog())
    expect(client.score()).toBe(normal.live.score())
  })

  it('the phase at any sim step is the clock’s, even sampled mid-sequence', () => {
    const { payload } = record(60, 13) // the tape ends inside the meltdown
    for (const hz of [30, 144]) {
      const client = replayAt(payload, hz)
      expect(client.jackpot.isJackpotActive).toBe(true)
      expect(client.jackpot.jackpotPhase).toBe(3)
      expect(client.displayState()).toBe(DisplayState.JACKPOT)
    }
  })

  it('control: a timer fed by render dt (the old driver) ends the sequence on different steps per refresh rate', () => {
    // Each render frame adds min(dt, 1/30) — what `updateJackpotSequence(dt)` accumulated —
    // and is only looked at once per frame. A 30 Hz recorder and a 144 Hz spectator
    // that start the sequence on the same step see it end on different ones.
    const endStepOf = (hz: number) => {
      const dt = Math.min(1 / hz, 1 / 30)
      let timer = 0
      let step = 0
      for (let frame = 0; ; frame++) {
        timer += dt
        // `hz`-rate frames take 60/hz steps each (fractionally, on the accumulator).
        step = Math.floor((frame + 1) * (60 / hz))
        if (timer >= 10) return step
      }
    }
    expect(new Set([30, 60, 144].map(endStepOf)).size).toBeGreaterThan(1)
  })
})
