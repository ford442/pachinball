/**
 * `rulesHash` (#556): SHA-256 (hex) of a run's rules as canonical JSON — object keys sorted at every
 * level (`schema-kit.canonicalJson`), so key order never changes it and any scoring field does.
 *
 * Kept out of the entry chunk: a vanilla run never hashes (its hash is the pinned
 * `VANILLA_RULES_HASH`), so the SHA-256 code loads only with a machine's rules or a tape that
 * carries its own (`resolveRunRules`).
 *
 * Pure TS — no Babylon, no DOM.
 */

import { sha256HexOfText } from '../core/sha256'
import { canonicalJson } from '../schemas/schema-kit'
import type { RunRules } from './rules-types'

export function rulesHash(rules: RunRules): string {
  return sha256HexOfText(canonicalJson(rules))
}
