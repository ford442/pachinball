/**
 * #556 Slice 1 — the rules interpreter (`src/rules/rules-engine.ts`) on its own: handler order,
 * conditions, the award formula, counters / flags / lamps, modes and timers in sim ticks, nested
 * events, and the vanilla program's awards. The golden tapes prove the vanilla program against the
 * real game (`npm run verify:replay`, `npm run verify:replay:node`).
 */

import { describe, expect, it } from 'vitest'
import { GAME_TUNING } from '../src/config'
import { MAX_DEPTH, RulesEngine, type RulesSink } from '../src/rules/rules-engine'
import { vanillaRunRules } from '../src/rules/vanilla'
import type { RunRules } from '../src/rules/rules-types'
import type { RulesProgram } from '../src/schemas/rules-program'

type Call = [string, ...unknown[]]

/** A sink that records every action, with a backbox state the test can set. */
function recordingSink() {
  const calls: Call[] = []
  let display = 'idle'
  const sink: RulesSink = {
    displayState: () => display,
    award: (base, source, multiplier, tally) => calls.push(['award', base, source, multiplier, tally]),
    comboHit: () => calls.push(['comboHit']),
    multiball: (balls, reason) => calls.push(['multiball', balls, reason]),
    addBalls: (count) => calls.push(['addBalls', count]),
    ballSave: (ticks) => calls.push(['ballSave', ticks]),
    kickback: (impulse) => calls.push(['kickback', impulse]),
    display: (state) => {
      display = state
      calls.push(['display', state])
    },
    emit: (event) => calls.push(['emit', event]),
    cue: (cue) => calls.push(['cue', cue]),
  }
  return { sink, calls, setDisplay: (s: string) => (display = s) }
}

const rulesWith = (program: RulesProgram): RunRules => ({ ...vanillaRunRules(), program })

describe('RulesEngine: the vanilla program', () => {
  it('scores a bumper as base × combo tier × chain multiplier, rounded, then the chain bonus', () => {
    const { sink, calls } = recordingSink()
    const engine = new RulesEngine(vanillaRunRules(), sink)
    const combo = 7
    const chain = 1.7
    const base = Math.round(GAME_TUNING.scoring.bumperHitBase * (Math.floor(combo / GAME_TUNING.combo.multiplierDivisor) + 1) * chain)
    const awarded = engine.dispatch('bumper', { values: { combo, chainMultiplier: chain, chainBonus: 250 } })
    expect(calls).toEqual([
      ['award', base, 'bumper-hit', 1, null],
      ['award', 250, 'combo-chain-bonus', 1, 'chain-bonus'],
      ['comboHit'],
    ])
    expect(awarded).toBe(base + 250)
  })

  it('starts FEVER at the threshold, only from an idle backbox', () => {
    const { sink, calls, setDisplay } = recordingSink()
    const engine = new RulesEngine(vanillaRunRules(), sink)
    const threshold = GAME_TUNING.combo.feverThreshold
    engine.dispatch('bumper', { values: { combo: threshold - 1, chainMultiplier: 1, chainBonus: 0 } })
    expect(calls.some(([k]) => k === 'emit')).toBe(false)
    calls.length = 0
    engine.dispatch('bumper', { values: { combo: threshold, chainMultiplier: 1, chainBonus: 0 } })
    expect(calls.slice(-3)).toEqual([['emit', 'fever:start'], ['display', 'fever'], ['cue', { lighting: { mode: 'fever', seconds: 0 } }]])
    calls.length = 0
    setDisplay('reach')
    engine.dispatch('bumper', { values: { combo: threshold + 5, chainMultiplier: 1, chainBonus: 0 } })
    expect(calls.some(([k]) => k === 'emit')).toBe(false)
  })

  it('a target scores, feeds the combo, adds a ball and raises REACH, in that order', () => {
    const { sink, calls } = recordingSink()
    new RulesEngine(vanillaRunRules(), sink).dispatch('target')
    expect(calls.map(([k]) => k)).toEqual(['award', 'comboHit', 'cue', 'addBalls', 'emit', 'display', 'cue', 'cue'])
    expect(calls[0]).toEqual(['award', GAME_TUNING.scoring.targetHitBase, 'target-hit', 1, null])
  })

  it('a spinner feeds the combo before it scores (the award sees the new combo multiplier)', () => {
    const { sink, calls } = recordingSink()
    new RulesEngine(vanillaRunRules(), sink).dispatch('spinner')
    expect(calls).toEqual([['comboHit'], ['award', GAME_TUNING.obstacle.spinnerHitBase, 'spinner-hit', 1, null]])
  })

  it('scores each lane kind its rollover value, sourced by lane id', () => {
    for (const [kind, points] of Object.entries(GAME_TUNING.scoring.laneRollover)) {
      const { sink, calls } = recordingSink()
      const awarded = new RulesEngine(vanillaRunRules(), sink).dispatch('lane', { id: 'left-inlane', kind })
      expect(calls).toEqual([['award', points, 'lane-rollover:left-inlane', 1, null]])
      expect(awarded).toBe(points)
    }
  })

  it('ends FEVER when the combo expires or the ball drains, and only then', () => {
    for (const event of ['comboExpire', 'drain'] as const) {
      const { sink, calls, setDisplay } = recordingSink()
      const engine = new RulesEngine(vanillaRunRules(), sink)
      engine.dispatch(event)
      expect(calls).toEqual([])
      setDisplay('fever')
      engine.dispatch(event)
      expect(calls).toEqual([['emit', 'fever:end'], ['display', 'idle'], ['cue', { lighting: { mode: 'normal', seconds: 0 } }]])
    }
  })

  it('gold balls: a multiball at every threshold, the jackpot for an eligible ball, else a bloom', () => {
    const [first] = GAME_TUNING.multiball.triggerGoldThresholds
    const { sink, calls } = recordingSink()
    const engine = new RulesEngine(vanillaRunRules(), sink)
    engine.dispatch('goldCollect', { values: { goldBalls: first, jackpot: 0 } })
    expect(calls).toEqual([['multiball', 2, 'gold-threshold'], ['cue', { bloom: 1.5 }]])
    calls.length = 0
    engine.dispatch('goldCollect', { values: { goldBalls: first + 1, jackpot: 1 } })
    expect(calls.map(([k]) => k)).toEqual(['cue', 'emit', 'display', 'cue'])
    expect(calls[1]).toEqual(['emit', 'jackpot:start'])
    calls.length = 0
    engine.dispatch('jackpot')
    expect(calls).toEqual([['multiball', 3, 'jackpot']])
  })
})

describe('RulesEngine: a machine program', () => {
  const streak: RulesProgram = {
    counters: { lanes: { initial: 0 } },
    timers: { window: { ticks: 3 } },
    modes: { onFire: { ticks: 5, multiplier: 2 } },
    handlers: [
      { on: 'lane', do: [{ add: { counter: 'lanes', value: 1 } }, { startTimer: 'window' }, { light: 'streak' }] },
      { on: 'lane', if: [{ gte: ['counter.lanes', 3] }], do: [{ startMode: 'onFire' }, { set: { counter: 'lanes', value: 0 } }] },
      { on: 'timer', id: 'window', do: [{ set: { counter: 'lanes', value: 0 } }, { unlight: 'streak' }] },
      { on: 'modeEnd', id: 'onFire', do: [{ cue: { message: { text: 'COOLED', ms: 1000 } } }] },
      { on: 'bumper', do: [{ award: { points: 100, source: 'bumper-hit' } }] },
      { on: 'drain', if: [{ notMode: 'onFire' }], do: [{ ballSave: { ticks: 120 } }, { kickback: { impulse: [0, 1, -5] } }] },
    ],
  }

  it('counts, lights, starts a mode, and the mode doubles awards until its ticks run out', () => {
    const { sink, calls } = recordingSink()
    const engine = new RulesEngine(rulesWith(streak), sink)
    engine.dispatch('lane', { id: 'a' })
    engine.dispatch('lane', { id: 'b' })
    expect(engine.getCounter('lanes')).toBe(2)
    expect(engine.isLit('streak')).toBe(true)
    engine.dispatch('lane', { id: 'c' })
    expect(engine.isModeActive('onFire')).toBe(true)
    expect(engine.getCounter('lanes')).toBe(0)
    calls.length = 0
    engine.dispatch('bumper')
    expect(calls).toEqual([['award', 100, 'bumper-hit', 2, null]])
    for (let i = 0; i < 4; i++) engine.tick()
    expect(engine.isModeActive('onFire')).toBe(true)
    engine.tick()
    expect(engine.isModeActive('onFire')).toBe(false)
    expect(calls).toContainEqual(['cue', { message: { text: 'COOLED', ms: 1000 } }])
    calls.length = 0
    engine.dispatch('bumper')
    expect(calls).toEqual([['award', 100, 'bumper-hit', 1, null]])
  })

  it('a timer fires after exactly its ticks, restarted by each start', () => {
    const { sink } = recordingSink()
    const engine = new RulesEngine(rulesWith(streak), sink)
    engine.dispatch('lane', { id: 'a' })
    engine.tick()
    engine.tick()
    engine.dispatch('lane', { id: 'b' }) // restarts the window
    expect(engine.getTimer('window')).toBe(3)
    engine.tick()
    engine.tick()
    expect(engine.getCounter('lanes')).toBe(2)
    engine.tick()
    expect(engine.getCounter('lanes')).toBe(0)
    expect(engine.isLit('streak')).toBe(false)
    expect(engine.getTimer('window')).toBe(0)
  })

  it('grants a ball save and a kickback outside the mode', () => {
    const { sink, calls } = recordingSink()
    new RulesEngine(rulesWith(streak), sink).dispatch('drain')
    expect(calls).toEqual([['ballSave', 120], ['kickback', [0, 1, -5]]])
  })

  it('reset() puts every piece of state back', () => {
    const { sink } = recordingSink()
    const engine = new RulesEngine(rulesWith({ ...streak, counters: { lanes: { initial: 2 } } }), sink)
    engine.dispatch('lane', { id: 'a' })
    engine.reset()
    expect(engine.getCounter('lanes')).toBe(2)
    expect(engine.isLit('streak')).toBe(false)
    expect(engine.getTimer('window')).toBe(0)
    expect(engine.activeModes()).toEqual([])
    expect(engine.getMultiplier()).toBe(1)
  })

  it('matches handlers by id and kind', () => {
    const { sink, calls } = recordingSink()
    const engine = new RulesEngine(rulesWith({
      handlers: [
        { on: 'lane', id: 'top-a', do: [{ award: { points: 1, source: 'a' } }] },
        { on: 'lane', kind: 'outlane', do: [{ award: { points: 2, source: 'b:{kind}' } }] },
      ],
    }), sink)
    engine.dispatch('lane', { id: 'top-b', kind: 'inlane' })
    expect(calls).toEqual([])
    engine.dispatch('lane', { id: 'top-a', kind: 'outlane' })
    expect(calls).toEqual([['award', 1, 'a', 1, null], ['award', 2, 'b:outlane', 1, null]])
  })

  it('an ended mode raises modeEnd at once; a ruleset that loops throws instead of hanging', () => {
    const { sink, calls } = recordingSink()
    const engine = new RulesEngine(rulesWith({
      modes: { m: {} },
      handlers: [
        { on: 'target', do: [{ startMode: 'm' }, { endMode: 'm' }, { cue: { beep: 440 } }] },
        { on: 'modeEnd', id: 'm', do: [{ cue: { beep: 880 } }] },
      ],
    }), sink)
    engine.dispatch('target')
    expect(calls).toEqual([['cue', { beep: 880 }], ['cue', { beep: 440 }]])

    const looping = new RulesEngine(rulesWith({
      modes: { m: {} },
      handlers: [{ on: 'modeEnd', do: [{ startMode: 'm' }, { endMode: 'm' }] }, { on: 'target', do: [{ startMode: 'm' }, { endMode: 'm' }] }],
    }), recordingSink().sink)
    expect(() => looping.dispatch('target')).toThrow(new RegExp(`${MAX_DEPTH} events deep`))
  })

  it('iterates named state in sorted order, so key order never changes behaviour', () => {
    const order = (timers: RulesProgram['timers']) => {
      const { sink, calls } = recordingSink()
      const engine = new RulesEngine(rulesWith({
        timers,
        handlers: [
          { on: 'target', do: [{ startTimer: 'b' }, { startTimer: 'a' }] },
          { on: 'timer', do: [{ award: { points: 1, source: 't:{id}' } }] },
        ],
      }), sink)
      engine.dispatch('target')
      engine.tick()
      return calls
    }
    const ab = order({ a: { ticks: 1 }, b: { ticks: 1 } })
    expect(ab.map((c) => c[2])).toEqual(['t:a', 't:b'])
    expect(order({ b: { ticks: 1 }, a: { ticks: 1 } })).toEqual(ab)
  })
})
