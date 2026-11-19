/**
 * Naming a run's rules (#556 Slice 1). `rulesHash` (`rules-digest.ts`) is the SHA-256 of a run's
 * rules as canonical JSON. The hash is of the *run* rules (`RunRules`: ball economy, fever
 * threshold, program), with the program resolved — a machine that leaves `program` out plays, and
 * hashes as, the vanilla program. Leaderboards are keyed by (board, rulesHash), a tape records the
 * hash it was played under, and the verifier rejects a run whose tape and submission disagree.
 *
 * The constants here sit in the entry chunk (the recorder and every board read need them); the
 * hashing itself is a lazy chunk. Pure TS — no Babylon, no DOM.
 */

import type { MachineRules } from '../schemas/rules'
import type { RunRules } from './rules-types'
import { VANILLA_PROGRAM } from './vanilla'

/** 64 lower-case hex characters. */
export const RULES_HASH_PATTERN = /^[0-9a-f]{64}$/

/** A machine's rules as the rules a run plays under: `cascade` dropped, a missing program filled with the vanilla one. */
export function runRulesOf(rules: Pick<MachineRules, 'balls' | 'fever' | 'program'>): RunRules {
  return { balls: rules.balls, fever: rules.fever, program: rules.program ?? VANILLA_PROGRAM }
}

/**
 * `rulesHash(vanillaRunRules())`, pinned so a vanilla run never hashes at boot.
 * `tests/rules-hash.test.ts` recomputes it: a change to the vanilla rules (a tuning number, a
 * handler) fails there until this is updated — and the golden tapes are re-recorded with it.
 */
export const VANILLA_RULES_HASH = 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'

/**
 * The rules hash a tape recorded before tapes named their rules (replay schema < 4) is read as: the
 * vanilla rules as they were when #556 introduced the hash — the scoring those tapes were played
 * under. Frozen: if the vanilla rules ever change, `VANILLA_RULES_HASH` moves and this does not, so
 * an old tape is refused (`rules-mismatch`) instead of replayed under rules it never saw.
 * `tests/rules-hash.test.ts` pins it; the arcade migration `20261119180000_rules_hash.sql` and
 * `services/replay-verifier/judge.mjs` carry the same constant.
 */
export const LEGACY_RULES_HASH = 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'
