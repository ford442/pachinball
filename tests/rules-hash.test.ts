/**
 * #556 Slice 1 — rules as data: the rules v2 schema accepts the vanilla program and the shipped
 * machines, `rulesHash` is the SHA-256 of canonical JSON (key order never matters, every scoring
 * field does), `LEGACY_RULES_HASH` is pinned in every place that carries it, and a replay's rules
 * resolve from its tape — refused (`rules-mismatch`) when they do not hash to what it names.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BALL_TIERS, BallType } from '../src/config'
import { sha256HexOfText } from '../src/core/sha256'
import { VANILLA_BALL_ECONOMY } from '../src/game-elements/ball-manager-context'
import { resolveRunRules } from '../src/game/run-start'
import { ReplayRecorder } from '../src/replay/replay-recorder'
import { LEGACY_RULES_HASH, VANILLA_RULES_HASH, runRulesOf } from '../src/rules/rules-hash'
import { rulesHash } from '../src/rules/rules-digest'
import { VANILLA_PROGRAM, vanillaRunRules } from '../src/rules/vanilla'
import { MachineRulesSchema, RunRulesSchema, defaultMachineRules } from '../src/schemas/rules'
import { RulesProgramSchema } from '../src/schemas/rules-program'
import { canonicalJson, parseWith } from '../src/schemas/schema-kit'
import { LEGACY_RULES_HASH as JUDGE_LEGACY_RULES_HASH } from '../services/replay-verifier/judge.mjs'

const root = join(import.meta.dirname, '..')

describe('sha256', () => {
  it('matches node:crypto', () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'ünïcode ✓'.repeat(40), canonicalJson(vanillaRunRules())]) {
      expect(sha256HexOfText(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    }
  })
})

describe('rules v2 schema', () => {
  it('accepts the vanilla program and the vanilla run rules', () => {
    expect(parseWith(RulesProgramSchema, VANILLA_PROGRAM)).toMatchObject({ ok: true })
    expect(parseWith(RunRulesSchema, vanillaRunRules())).toMatchObject({ ok: true })
    expect(parseWith(MachineRulesSchema, { ...defaultMachineRules(), program: VANILLA_PROGRAM })).toMatchObject({ ok: true })
  })

  it('reports a bad reference where it is, against the handler\'s event', () => {
    const result = parseWith(RulesProgramSchema, {
      counters: { lanes: { initial: 0 } },
      handlers: [
        { on: 'lane', do: [{ award: { points: 'event.combo', source: 'x' } }] },
        { on: 'bumper', if: [{ gte: ['counter.missing', 1] }], do: [{ startMode: 'nope' }] },
        { on: 'target', do: [{ flag: 'not-an-action' }] },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const paths = result.errors.map((e) => `${e.path}: ${e.message}`)
    expect(paths).toContainEqual(expect.stringMatching(/^handlers\[2\]\.do\[0\]: must be a action: an object with one of award, comboHit/))
    expect(parseWith(RulesProgramSchema, {
      counters: { lanes: { initial: 0 } },
      handlers: [
        { on: 'lane', do: [{ award: { points: 'event.combo', source: 'x' } }] },
        { on: 'bumper', if: [{ gte: ['counter.missing', 1] }], do: [{ startMode: 'nope' }] },
      ],
    })).toEqual({
      ok: false,
      errors: [
        { path: 'handlers[0].do[0].award.points', message: 'lane events carry no fields' },
        { path: 'handlers[1].if[0].gte[0]', message: 'undeclared counter missing' },
        { path: 'handlers[1].do[0].startMode', message: 'undeclared mode nope' },
      ],
    })
  })

  it('names the branch a one-key object picked', () => {
    const result = parseWith(RulesProgramSchema, { handlers: [{ on: 'drain', do: [{ ballSave: { ticks: 0 } }] }] })
    expect(result).toEqual({ ok: false, errors: [{ path: 'handlers[0].do[0].ballSave.ticks', message: 'must be an integer in [1, 216000]' }] })
  })
})

describe('rulesHash', () => {
  it('is the SHA-256 of the canonical JSON of the run rules', () => {
    const rules = vanillaRunRules()
    expect(rulesHash(rules)).toBe(createHash('sha256').update(canonicalJson(rules)).digest('hex'))
  })

  it('VANILLA_RULES_HASH is pinned to the vanilla rules (update it, and re-record the tapes, when they change)', () => {
    expect(rulesHash(vanillaRunRules())).toBe(VANILLA_RULES_HASH)
  })

  it('does not depend on key order, and moves with any scoring field', () => {
    const rules = vanillaRunRules()
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys)
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]))
    }
    const reversed = reverseKeys(rules) as typeof rules
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(rules))
    expect(rulesHash(reversed)).toBe(VANILLA_RULES_HASH)
    expect(rulesHash({ ...rules, fever: { threshold: rules.fever.threshold + 1 } })).not.toBe(VANILLA_RULES_HASH)
    expect(rulesHash({ ...rules, program: { handlers: rules.program.handlers.slice(1) } })).not.toBe(VANILLA_RULES_HASH)
  })

  it('a machine without a program plays, and hashes as, the vanilla program; its table does not count', () => {
    expect(rulesHash(runRulesOf(defaultMachineRules()))).toBe(VANILLA_RULES_HASH)
    expect(rulesHash(runRulesOf({ ...defaultMachineRules(), program: VANILLA_PROGRAM }))).toBe(VANILLA_RULES_HASH)
  })

  it('the vanilla ball economy is the one the spawner always used', () => {
    const { balls } = vanillaRunRules()
    for (const type of [BallType.STANDARD, BallType.GOLD_PLATED, BallType.SOLID_GOLD]) {
      expect(balls.weights[type]).toBe(BALL_TIERS[type].spawnWeight)
      expect(balls.points[type]).toBe(BALL_TIERS[type].basePoints)
      expect(VANILLA_BALL_ECONOMY.weights[type]).toBe(balls.weights[type])
      expect(VANILLA_BALL_ECONOMY.points[type]).toBe(balls.points[type])
    }
  })

  /**
   * Tapes from before replay schema 4 read as LEGACY_RULES_HASH, the vanilla rules of #556. If this
   * fails, the vanilla rules changed: the golden tapes need re-recording under the new rules, and
   * LEGACY_RULES_HASH stays what it is (old tapes were played under the old rules).
   */
  it('the legacy hash is frozen, every copy of it agrees, and it is today\'s vanilla rules', () => {
    expect(LEGACY_RULES_HASH).toBe('a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528')
    expect(VANILLA_RULES_HASH, 'the vanilla rules changed: see docs/RULES.md').toBe(LEGACY_RULES_HASH)
    expect(JUDGE_LEGACY_RULES_HASH).toBe(LEGACY_RULES_HASH)
    const migration = readFileSync(join(root, 'supabase/migrations/20261119180000_rules_hash.sql'), 'utf8')
    const quoted = [...migration.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1])
    expect(quoted.length).toBeGreaterThan(0)
    expect(new Set(quoted)).toEqual(new Set([LEGACY_RULES_HASH]))
  })
})

describe('a replay\'s rules', () => {
  const tape = (extra: object) => ReplayRecorder.fromJSON({ version: 4, seed: 1, compressedFrames: '1:0,0,0,0,0,0,-', ...extra })

  it('an older tape reads as the legacy vanilla rules and replays under them', async () => {
    const old = ReplayRecorder.fromJSON({ version: 3, seed: 1, compressedFrames: '1:0,0,0,0,0,0,-' })
    expect(old.rulesHash).toBe(LEGACY_RULES_HASH)
    expect(await resolveRunRules({ replay: old, machineRules: null })).toEqual({ ok: true, rules: vanillaRunRules(), hash: LEGACY_RULES_HASH })
  })

  it('a schema 4 tape without a well-formed hash is refused, not replayed as vanilla', async () => {
    const res = await resolveRunRules({ replay: tape({ rulesHash: 'nope' }), machineRules: null })
    expect(res).toMatchObject({ ok: false })
  })

  it('a tape naming rules it does not carry is refused', async () => {
    const res = await resolveRunRules({ replay: tape({ rulesHash: 'e'.repeat(64) }), machineRules: null })
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/played under rules eeeeeeeeeeee and does not carry them/) })
  })

  it('a tape carrying its rules replays under them; rules that do not hash to its hash are refused', async () => {
    const fire = { ...vanillaRunRules(), fever: { threshold: 3 } }
    const hash = rulesHash(fire)
    const ok = await resolveRunRules({ replay: tape({ rulesHash: hash, rules: fire }), machineRules: null })
    expect(ok).toEqual({ ok: true, rules: fire, hash })
    // Round-trips through the stored JSON.
    const stored = ReplayRecorder.fromJSON(ReplayRecorder.toJSON(tape({ rulesHash: hash, rules: fire })))
    expect(await resolveRunRules({ replay: stored, machineRules: null })).toMatchObject({ ok: true, hash })

    const forged = await resolveRunRules({ replay: tape({ rulesHash: VANILLA_RULES_HASH, rules: fire }), machineRules: null })
    expect(forged).toEqual({ ok: false, reason: expect.stringMatching(new RegExp(`hash to ${hash.slice(0, 12)}, but it names ${VANILLA_RULES_HASH.slice(0, 12)}`)) })
    const invalid = await resolveRunRules({ replay: tape({ rulesHash: hash, rules: { ...fire, fever: { threshold: 0 } } }), machineRules: null })
    expect(invalid).toMatchObject({ ok: false, reason: expect.stringMatching(/^the tape's rules are invalid: fever\.threshold/) })
  })

  it('a live run plays its machine\'s rules, or the vanilla ones', async () => {
    expect(await resolveRunRules({ replay: null, machineRules: null })).toEqual({ ok: true, rules: vanillaRunRules(), hash: VANILLA_RULES_HASH })
    const machine = { ...defaultMachineRules(), fever: { threshold: 4 } }
    const res = await resolveRunRules({ replay: null, machineRules: machine })
    expect(res).toMatchObject({ ok: true, hash: rulesHash(runRulesOf(machine)) })
  })
})
