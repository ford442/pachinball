/**
 * Machine rules (`MachineDescriptor.rules`), as a Valibot schema (#505 §A):
 * ball spawn weights / points / fever multipliers, the fever threshold and
 * the Daily Cascade constraints (`cascade.weekly`: a weekly machine's seeded
 * table). This is rules v1 — what the runtime plays today. Slice 1 (#506)
 * grows it into rules v2 (scoring, combos, multiball, modes, wizard) behind
 * a `RulesEngine`, and records its hash in the replay tape.
 *
 * Pure TS — no Babylon, no DOM.
 */

import * as v from 'valibot'
import { BALL_SPAWN_CONFIG, BallType } from '../config/balls'
import { GAME_TUNING } from '../config/gameplay'
import { canonicalJson, inRange, intInRange, isRecord, strict, withCrossCheck } from './schema-kit'
import { WeeklyMachineSchema } from './weekly'

export const BALL_TYPE_KEYS = [BallType.STANDARD, BallType.GOLD_PLATED, BallType.SOLID_GOLD] as const

/** Limits the rules schema enforces; the editor's form renderer reads them too. */
export const RULES_LIMITS = {
  points: { max: 1_000_000 },
  feverMultiplier: { min: 1, max: 100 },
  feverThreshold: { min: 1, max: 100 },
} as const

function ballTable<S extends v.GenericSchema<unknown, number>>(value: () => S) {
  return strict({
    [BallType.STANDARD]: value(),
    [BallType.GOLD_PLATED]: value(),
    [BallType.SOLID_GOLD]: value(),
  })
}

export const MachineRulesSchema = strict({
  balls: strict({
    /** Spawn weights; must sum to 1. */
    weights: withCrossCheck(ballTable(() => inRange({ min: 0, max: 1 })), (weights, issue) => {
      if (!isRecord(weights)) return
      const sum = BALL_TYPE_KEYS.reduce((acc, key) => {
        const w = weights[key]
        return acc + (typeof w === 'number' && Number.isFinite(w) ? w : 0)
      }, 0)
      if (Math.abs(sum - 1) > 1e-9) issue([], `weights sum to ${sum}; must sum to 1`)
    }),
    points: ballTable(() => intInRange({ min: 0, max: RULES_LIMITS.points.max })),
    feverMultipliers: ballTable(() => inRange(RULES_LIMITS.feverMultiplier)),
  }),
  fever: strict({
    /** Combo count that enters FEVER from IDLE. */
    threshold: intInRange(RULES_LIMITS.feverThreshold),
  }),
  /** Daily Cascade constraints; `weekly` is the seeded table of a weekly machine. */
  cascade: strict({
    weekly: v.optional(WeeklyMachineSchema),
  }),
})

export type MachineRules = v.InferOutput<typeof MachineRulesSchema>
export type BallTable = Record<BallType, number>

/** The rules the game plays today (`BALL_SPAWN_CONFIG`, `GAME_TUNING.combo`), as machine rules. */
export function defaultMachineRules(): MachineRules {
  return {
    balls: {
      weights: { ...BALL_SPAWN_CONFIG.weights },
      points: { ...BALL_SPAWN_CONFIG.points },
      feverMultipliers: { ...BALL_SPAWN_CONFIG.feverMultipliers },
    },
    fever: { threshold: GAME_TUNING.combo.feverThreshold },
    cascade: {},
  }
}

/** True when `rules` are the ones the game plays without a machine (the only rules the runtime applies yet); key order does not matter. */
export function rulesAreDefault(rules: MachineRules): boolean {
  const { cascade: _cascade, ...rest } = rules
  const { cascade: _defaultCascade, ...defaults } = defaultMachineRules()
  return canonicalJson(rest) === canonicalJson(defaults)
}
