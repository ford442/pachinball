/**
 * The jackpot phase clock: breach / critical / meltdown as a pure function of
 * fixed sim steps — never render dt, never setTimeout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  JACKPOT_CUES,
  JACKPOT_PHASE_NAMES,
  JACKPOT_TIMELINE,
  JackpotPhaseClock,
  jackpotPhaseAt,
  type JackpotCue,
  type JackpotPhase,
} from '../src/effects/jackpot-phase-clock'
import { JackpotSequenceController } from '../src/effects/effects-jackpot'
import { GameSimClock, installSimClock } from '../src/core/sim-clock'

describe('jackpotPhaseAt', () => {
  it('lines up with the Cyber-Shock script: breach 0–2 s, critical 2–5 s, meltdown 5–10 s at 60 Hz', () => {
    expect(JACKPOT_TIMELINE).toEqual({ criticalAt: 120, meltdownAt: 300, endAt: 600 })
    expect(JACKPOT_PHASE_NAMES).toEqual(['idle', 'breach', 'critical', 'meltdown'])
    const at = (step: number) => jackpotPhaseAt(step)
    expect([at(-1), at(0), at(119), at(120), at(299), at(300), at(599), at(600), at(10_000)]).toEqual([0, 1, 1, 2, 2, 3, 3, 0, 0])
  })

  it('cues are the old 0.3 s / 0.9 s / 1.5 s countdown beeps after the critical phase begins', () => {
    expect(JACKPOT_CUES.map((c) => c.atStep)).toEqual([138, 174, 210])
    expect(JACKPOT_CUES.map((c) => c.freq)).toEqual([880, 880, 660])
  })
})

describe('JackpotPhaseClock', () => {
  const run = (clock: JackpotPhaseClock, from: number, to: number, stride: number) => {
    const phases: Array<[number, JackpotPhase]> = []
    const cues: Array<[number, number]> = []
    const handlers = {
      onPhase: (phase: JackpotPhase, at: number) => phases.push([at, phase]),
      onCue: (cue: JackpotCue, at: number) => cues.push([at, cue.freq]),
    }
    for (let step = from; step < to; step += stride) clock.advanceTo(step, handlers)
    clock.advanceTo(to, handlers) // the last poll always lands on `to`
    return { phases, cues }
  }

  it('reports every transition on its own step, whatever the stride it is polled with', () => {
    const results = [1, 2, 7, 60, 144, 1000].map((stride) => {
      const clock = new JackpotPhaseClock()
      clock.start(1000)
      const seen = run(clock, 1000, 1700, stride)
      return { seen, log: clock.log, active: clock.active }
    })
    for (const r of results) {
      expect(r.seen.phases).toEqual([[1120, 2], [1300, 3], [1600, 0]])
      expect(r.seen.cues).toEqual([[1138, 880], [1174, 880], [1210, 660]])
      expect(r.log).toEqual([
        { step: 1000, phase: 1 },
        { step: 1120, phase: 2 },
        { step: 1300, phase: 3 },
        { step: 1600, phase: 0 },
      ])
      expect(r.active).toBe(false)
    }
  })

  it('starts in breach at once and counts sim seconds', () => {
    const clock = new JackpotPhaseClock()
    expect(clock.active).toBe(false)
    const seen: Array<[number, JackpotPhase]> = []
    clock.start(500, { onPhase: (phase, at) => seen.push([at, phase]) })
    expect(seen).toEqual([[500, 1]])
    expect(clock.active).toBe(true)
    expect(clock.phase).toBe(1)
    expect(clock.elapsedSteps(560)).toBe(60)
    expect(clock.elapsedSeconds(620)).toBe(2)
    expect(clock.elapsedSteps(0)).toBe(0) // before the start: clamped
  })

  it('a restart during a running sequence starts it over', () => {
    const clock = new JackpotPhaseClock()
    clock.start(0)
    clock.advanceTo(310)
    expect(clock.phase).toBe(3)
    clock.start(310)
    expect(clock.phase).toBe(1)
    clock.advanceTo(310 + 119)
    expect(clock.phase).toBe(1)
    clock.advanceTo(310 + 120)
    expect(clock.phase).toBe(2)
  })

  it('keeps the log bounded over a long session', () => {
    const clock = new JackpotPhaseClock()
    for (let i = 0; i < 100; i++) {
      clock.start(i * 1000)
      clock.advanceTo(i * 1000 + 600)
    }
    expect(clock.log.length).toBe(64)
    expect(clock.log[clock.log.length - 1]).toEqual({ step: 99 * 1000 + 600, phase: 0 })
  })

  it('is idle until started and after reset()', () => {
    const clock = new JackpotPhaseClock()
    clock.advanceTo(5000)
    expect(clock.log).toEqual([])
    clock.start(0)
    clock.reset()
    expect(clock.active).toBe(false)
    expect(clock.phase).toBe(0)
    expect(clock.log).toEqual([])
  })
})

describe('JackpotSequenceController on the sim clock', () => {
  afterEach(() => {
    installSimClock(null)
    vi.restoreAllMocks()
  })

  const make = (currentStep: () => number) => {
    const events: string[] = []
    const controller = new JackpotSequenceController({
      emitJackpotPhase: (phase) => events.push(`phase:${phase}`),
      spawnJackpotBurst: () => events.push('burst'),
      playBeep: (freq) => events.push(`beep:${freq}`),
      setLightingMode: (mode) => events.push(`lighting:${mode}`),
      flashVignette: () => undefined,
      addCameraShake: () => undefined,
      isReducedMotion: () => false,
      setBloomEnergy: () => undefined,
      random: () => 0.5,
      currentStep,
    })
    return { controller, events }
  }

  it('plays the sequence from steps alone: phases, three bursts, countdown beeps, then normal lighting', () => {
    let step = 40
    const { controller, events } = make(() => step)
    controller.startJackpotSequence()
    expect(controller.isJackpotActive).toBe(true)
    expect(controller.jackpotPhase).toBe(1)
    expect(events).toEqual(['phase:1'])

    for (step = 41; step <= 40 + 600; step++) controller.advanceToStep(step)
    expect(events).toEqual([
      'phase:1',
      'phase:2', 'beep:880', 'beep:880', 'beep:660',
      'phase:3', 'burst', 'burst', 'burst',
      'lighting:normal',
    ])
    expect(controller.isJackpotActive).toBe(false)
    expect(controller.jackpotPhase).toBe(0)
    expect(controller.phaseLog).toEqual([
      { step: 40, phase: 1 }, { step: 160, phase: 2 }, { step: 340, phase: 3 }, { step: 640, phase: 0 },
    ])
  })

  it('advanceToStep says when the sequence ended', () => {
    const { controller } = make(() => 0)
    controller.startJackpotSequence()
    expect(controller.advanceToStep(599)).toBe(false)
    expect(controller.advanceToStep(600)).toBe(true)
    expect(controller.advanceToStep(601)).toBe(false) // already over
  })

  it('render dt does nothing to the sequence: the per-frame update only adds cosmetic meltdown bursts', () => {
    let step = 0
    const { controller, events } = make(() => step)
    controller.startJackpotSequence()
    for (let i = 0; i < 1000; i++) controller.updateJackpotSequence(1 / 144) // ~7 s of render frames
    expect(controller.jackpotPhase).toBe(1)
    expect(controller.isJackpotActive).toBe(true)
    expect(events).toEqual(['phase:1'])

    step = 300
    controller.advanceToStep(step)
    expect(controller.jackpotPhase).toBe(3)
  })

  it('starts on the installed GameSimClock’s live step by default', () => {
    const physics = { getStepCount: () => steps }
    let steps = 0
    const clock = new GameSimClock()
    clock.beforeStep(physics)
    installSimClock(clock)
    const controller = new JackpotSequenceController({
      emitJackpotPhase: () => undefined,
      spawnJackpotBurst: () => undefined,
      playBeep: () => undefined,
      setLightingMode: () => undefined,
      flashVignette: () => undefined,
      addCameraShake: () => undefined,
      isReducedMotion: () => false,
      setBloomEnergy: () => undefined,
    })
    steps = 25 // the engine stepped mid-frame; the clock has not been advanced
    expect(clock.steps()).toBe(0)
    controller.startJackpotSequence()
    expect(controller.phaseLog).toEqual([{ step: 25, phase: 1 }])
  })
})

describe('GameSimClock.liveSteps', () => {
  it('counts the ticks of the render frame in progress; steps() commits them on advance()', () => {
    let engine = 100
    const physics = { getStepCount: () => engine }
    const clock = new GameSimClock()
    clock.beforeStep(physics)
    expect(clock.liveSteps()).toBe(0)
    engine = 103
    expect(clock.steps()).toBe(0)
    expect(clock.liveSteps()).toBe(3)
    clock.advance(physics, 1 / 60)
    expect(clock.steps()).toBe(3)
    expect(clock.liveSteps()).toBe(3)
    engine = 104
    expect(clock.liveSteps()).toBe(4)
  })

  it('a snapshot restore moves the engine counter without moving the clock', () => {
    let engine = 100
    const physics = { getStepCount: () => engine }
    const clock = new GameSimClock()
    clock.beforeStep(physics)
    engine = 102
    clock.advance(physics, 0)
    engine = 5000 // restore: the engine now reports the recorder's counter
    clock.resync(physics)
    expect(clock.liveSteps()).toBe(2)
    engine = 5001
    expect(clock.liveSteps()).toBe(3)
  })

  it('reports the committed count for a host with no counter or one that went backwards', () => {
    const clock = new GameSimClock()
    expect(clock.liveSteps()).toBe(0)
    let engine = 10
    const physics = { getStepCount: () => engine }
    clock.beforeStep(physics)
    engine = 12
    clock.advance(physics, 0)
    engine = 3
    expect(clock.liveSteps()).toBe(2)
  })
})
