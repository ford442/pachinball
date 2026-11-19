/**
 * Rules (#556 Slice 1): a machine's scoring as data. `RulesEngine` runs a rules v2 program, the
 * vanilla program is today's scoring, and `rulesHash` names a ruleset in tapes, submissions and
 * leaderboards. Pure TS — the headless replay runner runs it in Node. `rulesHash` itself is not
 * re-exported: it is `rules-digest.ts`, a lazy chunk (a vanilla run never hashes).
 */

export {
  RulesEngine,
  type RulesDisplayState,
  type RulesEmit,
  type RulesEventContext,
  type RulesLampCue,
  type RulesMultiballReason,
  type RulesSink,
  type RulesTally,
} from './rules-engine'
export { LEGACY_RULES_HASH, RULES_HASH_PATTERN, VANILLA_RULES_HASH, runRulesOf } from './rules-hash'
export type { RunRules } from './rules-types'
export { VANILLA_PROGRAM, vanillaRunRules } from './vanilla'
