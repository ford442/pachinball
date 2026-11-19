/**
 * Machine rules (`MachineDescriptor.rules`), as a Valibot schema (#505 §A).
 *
 * Rules v1 is the ball economy — spawn weights / points / fever multipliers —
 * the fever threshold and the Daily Cascade constraints (`cascade.weekly`: a
 * weekly machine's seeded table). Rules v2 (#556 Slice 1) adds `program`: the
 * scoring as event handlers (`rules-program.ts`), run by `RulesEngine`
 * (`src/rules/`). A v1 file is a valid v2 file: a rules object without a
 * `program` plays the vanilla program (`src/rules/vanilla.ts`), the scoring the
 * game has always had. The rules a run played under are recorded in its tape
 * as `rulesHash` (`src/rules/rules-hash.ts`).
 *
 * Pure TS — no Babylon, no DOM.
 */

import * as v from 'valibot'
import { BALL_SPAWN_CONFIG, BallType } from '../config/balls'
import { GAME_TUNING } from '../config/gameplay'
import { inRange, intInRange, isRecord, strict, withCrossCheck } from './schema-kit'
import { RulesProgramSchema } from './rules-program'
import { WeeklyMachineSchema } from './weekly'

const BALL_TYPE_KEYS = [BallType.STANDARD, BallType.GOLD_PLATED, BallType.SOLID_GOLD] as const

/** Limits the rules schema enforces; the editor's form renderer reads them too. */
const RULES_LIMITS = {
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
  /** Rules v2: the scoring program. Absent → the vanilla program. */
  program: v.optional(RulesProgramSchema),
})

export type MachineRules = v.InferOutput<typeof MachineRulesSchema>

/**
 * The rules a run plays under, as a tape carries them inline (#556): the scoring part of the rules
 * with the program resolved (`src/rules/rules-types.ts` `RunRules`).
 */
export const RunRulesSchema = strict({
  balls: MachineRulesSchema.entries.balls,
  fever: MachineRulesSchema.entries.fever,
  program: RulesProgramSchema,
})
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

