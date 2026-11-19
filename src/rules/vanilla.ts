/**
 * The vanilla ruleset (#556 Slice 1): the scoring the game has always played, written as rules v2
 * data. Every number comes from `GAME_TUNING` / `BALL_SPAWN_CONFIG`, so a tuning change moves the
 * vanilla rules (and their hash) with it.
 *
 * Handler order is behaviour: a handler's conditions are read after the earlier handlers' actions,
 * and awards stack on the combo multiplier only after `comboHit`. The order below is the order the
 * hard-coded handlers ran in, which is what lets every golden tape replay bit-identical under it
 * (`npm run verify:replay`, `npm run verify:replay:node`).
 *
 * Pure data — no Babylon, no DOM, no Valibot (types only).
 */

import { BALL_SPAWN_CONFIG } from '../config/balls'
import { GAME_TUNING } from '../config/gameplay'
import type { RulesAction, RulesHandler, RulesProgram } from '../schemas/rules-program'
import type { RunRules } from './rules-types'

const S = GAME_TUNING.scoring
const C = GAME_TUNING.combo

/** Fever (and the backbox with it) ends with the combo, or with the ball. */
const END_FEVER: RulesAction[] = [
  { emit: 'fever:end' },
  { display: 'idle' },
  { cue: { lighting: { mode: 'normal', seconds: 0 } } },
]

const laneRollover = (kind: keyof typeof S.laneRollover): RulesHandler => ({
  on: 'lane',
  kind,
  do: [{ award: { points: S.laneRollover[kind], source: 'lane-rollover:{id}' } }],
})

export const VANILLA_PROGRAM: RulesProgram = {
  handlers: [
    // Pop bumpers: base × combo tier × chain multiplier, then a named chain's bonus.
    {
      on: 'bumper',
      do: [
        {
          award: {
            points: S.bumperHitBase,
            scale: [{ tier: { of: 'event.combo', per: C.multiplierDivisor } }, 'event.chainMultiplier'],
            source: 'bumper-hit',
          },
        },
      ],
    },
    {
      on: 'bumper',
      if: [{ gt: ['event.chainBonus', 0] }],
      do: [{ award: { points: 'event.chainBonus', source: 'combo-chain-bonus', tally: 'chain-bonus' } }],
    },
    { on: 'bumper', do: [{ comboHit: {} }] },
    // A long enough combo from an idle backbox starts FEVER.
    {
      on: 'bumper',
      if: [{ gte: ['event.combo', 'rules.feverThreshold'] }, { display: 'idle' }],
      do: [{ emit: 'fever:start' }, { display: 'fever' }, { cue: { lighting: { mode: 'fever', seconds: 0 } } }],
    },

    // A target: points, an extra ball and REACH.
    {
      on: 'target',
      do: [
        { award: { points: S.targetHitBase, source: 'target-hit' } },
        { comboHit: {} },
        { cue: { beep: 1200 } },
        { addBalls: 1 },
        { emit: 'reach:start' },
        { display: 'reach' },
        { cue: { lighting: { mode: 'reach', seconds: 3 } } },
        { cue: { atmosphere: 'REACH' } },
      ],
    },

    // Spinners, traps, launchers and gates feed the combo multiplier; a spinner also scores.
    { on: 'spinner', do: [{ comboHit: {} }, { award: { points: GAME_TUNING.obstacle.spinnerHitBase, source: 'spinner-hit' } }] },
    { on: 'saucer', do: [{ comboHit: {} }] },
    { on: 'launcher', do: [{ comboHit: {} }] },
    { on: 'gate', do: [{ comboHit: {} }] },

    // Lane rollovers, once per lane per ball.
    laneRollover('launch'),
    laneRollover('inlane'),
    laneRollover('outlane'),
    laneRollover('drainApproach'),

    { on: 'comboExpire', if: [{ display: 'fever' }], do: END_FEVER },
    { on: 'drain', if: [{ display: 'fever' }], do: END_FEVER },

    // Gold balls: every 10th starts a two-ball multiball; a jackpot-eligible one starts the jackpot.
    {
      on: 'goldCollect',
      if: [{ in: ['event.goldBalls', [...GAME_TUNING.multiball.triggerGoldThresholds]] }],
      do: [{ multiball: { balls: 2, reason: 'gold-threshold' } }],
    },
    {
      on: 'goldCollect',
      if: [{ eq: ['event.jackpot', 1] }],
      do: [{ cue: { goldPulse: {} } }, { emit: 'jackpot:start' }, { display: 'jackpot' }, { cue: { haptic: 'jackpot' } }],
    },
    { on: 'goldCollect', if: [{ eq: ['event.jackpot', 0] }], do: [{ cue: { bloom: 1.5 } }] },

    // A jackpot, from any source, is a three-ball multiball.
    { on: 'jackpot', do: [{ multiball: { balls: 3, reason: 'jackpot' } }] },
  ],
}

/** The vanilla run rules: today's ball economy and fever threshold, and the vanilla program. */
export function vanillaRunRules(): RunRules {
  return {
    balls: {
      weights: { ...BALL_SPAWN_CONFIG.weights },
      points: { ...BALL_SPAWN_CONFIG.points },
      feverMultipliers: { ...BALL_SPAWN_CONFIG.feverMultipliers },
    },
    fever: { threshold: C.feverThreshold },
    program: VANILLA_PROGRAM,
  }
}
