/**
 * Rules v2 (#556 Slice 1): a machine's scoring program as data, as a Valibot schema.
 *
 * A program is a list of handlers. Each handler names a playfield event (`on`), optionally narrows
 * it to one id / kind, tests conditions (`if`, all must hold) and runs actions (`do`) in order:
 *
 *   { "on": "lane", "kind": "inlane", "do": [{ "award": { "points": 15, "source": "lane-rollover:{id}" } }] }
 *
 * State the program owns — counters, flags, lamps, a mode stack, a playfield multiplier and timers —
 * lives in `RulesEngine` (`src/rules/rules-engine.ts`) and counts **sim ticks**, never wall time.
 * Actions reach the game through a sink (award, multiball, ball save, kickback, display state) and
 * presentation through cues; the engine never touches Babylon.
 *
 * Values are numbers or references (`event.combo`, `counter.lanes`, `timer.hurry`,
 * `rules.feverThreshold`); a cross-check rejects a reference to an undeclared counter or timer and an
 * `event.<field>` the handler's event does not carry. Conditions and actions are one-key objects so
 * an editor (and `public/schemas/rules.json`) can offer them as a list.
 *
 * Pure TS — no Babylon, no DOM.
 */

import * as v from 'valibot'
import { inRange, intInRange, isRecord, num, strict, withCrossCheck } from './schema-kit'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The events the game raises into a program. */
const RULES_EVENTS = [
  /** A ball hit a pop bumper (low, not a hologram catch). */
  'bumper',
  /** A ball knocked down a target. */
  'target',
  /** A ball hit a spinner. */
  'spinner',
  /** A ball rolled over a lane sensor (once per lane per ball launch). `id` = lane id, `kind` = lane kind. */
  'lane',
  /** A ball drained. */
  'drain',
  /** A ball trap / saucer caught a ball. */
  'saucer',
  /** A moving gate opened. */
  'gate',
  /** A launcher fired. */
  'launcher',
  /** A gold ball was collected at the drain. `kind` = ball type. */
  'goldCollect',
  /** A jackpot started (any source). */
  'jackpot',
  /** The combo window ran out (not on a drain). */
  'comboExpire',
  /** A program timer reached zero. `id` = timer name. */
  'timer',
  /** A program mode ended (its ticks ran out, or `endMode`). `id` = mode name. */
  'modeEnd',
] as const
export type RulesEventName = (typeof RULES_EVENTS)[number]

/** The numeric fields each event carries: `event.<field>` in a value. */
const RULES_EVENT_FIELDS = {
  bumper: ['combo', 'chainMultiplier', 'chainBonus'],
  target: [],
  spinner: [],
  lane: [],
  drain: ['primary'],
  saucer: [],
  gate: [],
  launcher: [],
  goldCollect: ['goldBalls', 'jackpot'],
  jackpot: [],
  comboExpire: ['finalCombo'],
  timer: [],
  modeEnd: [],
} as const satisfies Record<RulesEventName, readonly string[]>

/** Named constants a value can read: `rules.<name>`, from the v1 part of the rules. */
const RULES_CONSTANTS = ['feverThreshold'] as const

/** Backbox states a program may set (adventure and portal states belong to adventure mode). */
export const RULES_DISPLAY_STATES = ['idle', 'reach', 'fever', 'jackpot'] as const
/** Game events a program may raise on the EventBus (presentation and audio listen to them). */
export const RULES_EMITS = ['fever:start', 'fever:end', 'reach:start', 'jackpot:start'] as const
/** Why a program started a multiball (shown and counted by `multiball:start` listeners). */
export const RULES_MULTIBALL_REASONS = ['jackpot', 'gold-threshold'] as const
/** Where a program's base points are also counted for the end-of-ball bonus tally. */
export const RULES_TALLIES = ['chain-bonus', 'gold-ball'] as const

/** Limits the program schema enforces; the editor's form renderer reads them too. */
const RULES_PROGRAM_LIMITS = {
  namePattern: /^[a-z][a-zA-Z0-9_-]{0,31}$/,
  idPattern: /^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,47}$/,
  sourcePattern: /^[a-z][a-z0-9:{}_-]{0,63}$/,
  handlers: 256,
  conditions: 16,
  actions: 32,
  names: 64,
  inList: 32,
  /** One hour of fixed steps. */
  ticks: { min: 1, max: 216_000 },
  points: { min: 0, max: 1_000_000 },
  value: { min: -1_000_000, max: 1_000_000 },
  multiplier: { min: 0, max: 100 },
  tierPer: { min: 1, max: 1000 },
  balls: { min: 1, max: 8 },
  impulse: { min: -50, max: 50 },
  messageMs: { min: 100, max: 10_000 },
  messageLength: 48,
} as const
const L = RULES_PROGRAM_LIMITS

/** `event.combo`, `counter.lanes`, `timer.hurry`, `rules.feverThreshold`. */
const REF = /^(?:event|counter|timer|rules)\.[a-zA-Z][a-zA-Z0-9_-]{0,31}$/

const enumOf = <const T extends readonly string[]>(values: T) => v.picklist(values, `must be one of ${values.join(' | ')}`)
const name = (what: string) =>
  v.pipe(v.string(`must be a ${what} name`), v.regex(L.namePattern, `${what} names are lower camelCase, ≤ 32 characters`))

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A number, or a reference read when the handler runs. */
const RulesValueSchema = v.union(
  [inRange(L.value), v.pipe(v.string(), v.regex(REF))],
  `must be a number in [${L.value.min}, ${L.value.max}] or a reference like event.combo / counter.<name>`,
)
export type RulesValue = v.InferOutput<typeof RulesValueSchema>

/** One factor of an award: a value, or `{ tier: { of, per } }` = floor(of / per) + 1. */
const FactorSchema = v.union(
  [RulesValueSchema, strict({ tier: strict({ of: RulesValueSchema, per: intInRange(L.tierPer) }) })],
  'must be a value or { "tier": { "of": <value>, "per": <int> } }',
)
export type RulesFactor = v.InferOutput<typeof FactorSchema>

// ---------------------------------------------------------------------------
// One-key objects (conditions, actions, cues)
// ---------------------------------------------------------------------------

/**
 * A union of one-key objects that reports against the branch the input names: `{ "flag": 3 }` reads
 * "flag: must be a flag name", not every branch's error. The JSON Schema renders the plain union.
 */
function oneKey<const B extends readonly v.StrictObjectSchema<v.ObjectEntries, v.ErrorMessage<v.StrictObjectIssue> | undefined>[]>(
  branches: B,
  what: string,
) {
  const keys = branches.map((b) => Object.keys(b.entries)[0] ?? '')
  const union = v.union(branches, `must be a ${what}: an object with one of ${keys.join(', ')}`)
  return v.lazy((input): typeof union | B[number] => {
    if (isRecord(input)) {
      const own = Object.keys(input)
      const index = own.length === 1 ? keys.indexOf(own[0] ?? '') : -1
      const branch = index >= 0 ? branches[index] : undefined
      if (branch) return branch
    }
    return union
  })
}

const Compare = v.tuple([RulesValueSchema, RulesValueSchema], 'must be [<value>, <value>]')
const displayState = enumOf(RULES_DISPLAY_STATES)

const conditionBranches = [
  strict({ eq: Compare }),
  strict({ ne: Compare }),
  strict({ gt: Compare }),
  strict({ gte: Compare }),
  strict({ lt: Compare }),
  strict({ lte: Compare }),
  strict({
    in: v.tuple(
      [RulesValueSchema, v.pipe(v.array(num(), 'must be an array of numbers'), v.maxLength(L.inList, `at most ${L.inList} numbers`))],
      'must be [<value>, [<number>, …]]',
    ),
  }),
  strict({ flag: name('flag') }),
  strict({ notFlag: name('flag') }),
  strict({ lit: name('lamp') }),
  strict({ unlit: name('lamp') }),
  strict({ mode: name('mode') }),
  strict({ notMode: name('mode') }),
  strict({ display: displayState }),
  strict({ notDisplay: displayState }),
] as const
const RulesConditionSchema = oneKey(conditionBranches, 'condition')
export type RulesCondition = v.InferOutput<(typeof conditionBranches)[number]>

/** Presentation cues: the game's lights, sound and screen. Nothing here touches the sim. */
const cueBranches = [
  strict({ lighting: strict({ mode: enumOf(['normal', 'hit', 'fever', 'reach'] as const), seconds: inRange({ min: 0, max: 60 }) }) }),
  strict({ atmosphere: enumOf(['IDLE', 'REACH', 'FEVER', 'JACKPOT'] as const) }),
  strict({ beep: inRange({ min: 20, max: 20_000 }) }),
  strict({ bloom: inRange({ min: 0, max: 10 }) }),
  strict({ goldPulse: strict({}) }),
  strict({ haptic: enumOf(['jackpot', 'bumper', 'ballLost'] as const) }),
  strict({
    message: strict({
      text: v.pipe(v.string('must be a string'), v.maxLength(L.messageLength, `at most ${L.messageLength} characters`)),
      ms: intInRange(L.messageMs),
    }),
  }),
] as const
const CueSchema = oneKey(cueBranches, 'cue')
export type RulesCue = v.InferOutput<(typeof cueBranches)[number]>

const counterOp = strict({ counter: name('counter'), value: RulesValueSchema })

const actionBranches = [
  strict({
    award: strict({
      points: RulesValueSchema,
      scale: v.optional(v.pipe(v.array(FactorSchema, 'must be an array of factors'), v.maxLength(8, 'at most 8 factors'))),
      source: v.pipe(v.string('must be a string'), v.regex(L.sourcePattern, 'a lower-case score source, e.g. bumper-hit or lane-rollover:{id}')),
      tally: v.optional(enumOf(RULES_TALLIES)),
    }),
  }),
  strict({ comboHit: strict({}) }),
  strict({ add: counterOp }),
  strict({ set: counterOp }),
  strict({ setFlag: name('flag') }),
  strict({ clearFlag: name('flag') }),
  strict({ light: name('lamp') }),
  strict({ unlight: name('lamp') }),
  strict({ startMode: name('mode') }),
  strict({ endMode: name('mode') }),
  strict({ startTimer: name('timer') }),
  strict({ stopTimer: name('timer') }),
  strict({ multiplier: RulesValueSchema }),
  strict({ multiball: strict({ balls: intInRange(L.balls), reason: enumOf(RULES_MULTIBALL_REASONS) }) }),
  strict({ addBalls: intInRange(L.balls) }),
  strict({ ballSave: strict({ ticks: intInRange(L.ticks) }) }),
  strict({ kickback: strict({ impulse: v.tuple([inRange(L.impulse), inRange(L.impulse), inRange(L.impulse)], 'must be [x, y, z]') }) }),
  strict({ display: displayState }),
  strict({ emit: enumOf(RULES_EMITS) }),
  strict({ cue: CueSchema }),
] as const
const RulesActionSchema = oneKey(actionBranches, 'action')
export type RulesAction = v.InferOutput<(typeof actionBranches)[number]>

// ---------------------------------------------------------------------------
// Handlers and the program
// ---------------------------------------------------------------------------

const RulesHandlerSchema = strict({
  on: enumOf(RULES_EVENTS),
  /** Only the event with this id (lane id, timer / mode name). */
  id: v.optional(v.pipe(v.string('must be a string'), v.regex(L.idPattern, 'an id: letters, digits, _ : -'))),
  /** Only the event with this kind (lane kind, gold ball type). */
  kind: v.optional(v.pipe(v.string('must be a string'), v.regex(L.idPattern, 'a kind: letters, digits, _ : -'))),
  if: v.optional(v.pipe(v.array(RulesConditionSchema, 'must be an array of conditions'), v.maxLength(L.conditions, `at most ${L.conditions} conditions`))),
  do: v.pipe(
    v.array(RulesActionSchema, 'must be an array of actions'),
    v.minLength(1, 'needs at least one action'),
    v.maxLength(L.actions, `at most ${L.actions} actions`),
  ),
})
export type RulesHandler = v.InferOutput<typeof RulesHandlerSchema>

const names = <S extends v.GenericSchema>(value: S, what: string) =>
  v.pipe(
    v.record(name(what), value, 'must be an object'),
    v.maxEntries(L.names, `at most ${L.names} ${what}s`),
  )

const ProgramShape = strict({
  /** Counters and their value at the start of a run. */
  counters: v.optional(names(strict({ initial: inRange(L.value) }), 'counter')),
  /** Timers: `startTimer` arms one for `ticks` fixed steps; at zero it raises `timer`, and re-arms when `repeat`. */
  timers: v.optional(names(strict({ ticks: intInRange(L.ticks), repeat: v.optional(v.boolean('must be a boolean')) }), 'timer')),
  /** Modes: `startMode` pushes one (for `ticks`, or until `endMode`); `multiplier` scales every award while it runs. */
  modes: v.optional(names(strict({ ticks: v.optional(intInRange(L.ticks)), multiplier: v.optional(inRange(L.multiplier)) }), 'mode')),
  handlers: v.pipe(v.array(RulesHandlerSchema, 'must be an array'), v.maxLength(L.handlers, `at most ${L.handlers} handlers`)),
})

/** Every reference in a value / factor, with where it is. */
function* refsOf(value: unknown, keys: (string | number)[]): Generator<{ ref: string; keys: (string | number)[] }> {
  if (typeof value === 'string') {
    yield { ref: value, keys }
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* refsOf(value[i], [...keys, i])
    return
  }
  if (isRecord(value)) {
    for (const [k, inner] of Object.entries(value)) {
      // Names (flags, modes, sources, display states, …) are strings too; only value positions hold references.
      if (VALUE_KEYS.has(k)) yield* refsOf(inner, [...keys, k])
      else if (isRecord(inner) || Array.isArray(inner)) yield* refsOf(inner, [...keys, k])
    }
  }
}
/** Keys whose (possibly nested) strings are values. */
const VALUE_KEYS = new Set(['points', 'scale', 'of', 'value', 'multiplier', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'])

/**
 * The program: handlers plus the state they declare. The cross-check resolves every reference — a
 * counter / timer must be declared, `event.<field>` must be a field of the handler's event, and a
 * mode / timer a handler starts must exist.
 */
export const RulesProgramSchema = withCrossCheck(ProgramShape, (program, issue, clean) => {
  if (!clean || !isRecord(program) || !Array.isArray(program.handlers)) return
  const declared = (key: 'counters' | 'timers' | 'modes') => new Set(isRecord(program[key]) ? Object.keys(program[key]) : [])
  const counters = declared('counters')
  const timers = declared('timers')
  const modes = declared('modes')
  program.handlers.forEach((handler: unknown, h) => {
    if (!isRecord(handler)) return
    const event = handler.on as RulesEventName
    const fields: readonly string[] = RULES_EVENT_FIELDS[event]
    const where = (keys: (string | number)[]) => ['handlers', h, ...keys]
    for (const { ref, keys } of refsOf({ if: handler.if, do: handler.do }, [])) {
      const [space, field = ''] = ref.split('.')
      if (space === 'event' && !fields.includes(field)) {
        issue(where(keys), fields.length ? `${event} events carry ${fields.map((f) => `event.${f}`).join(', ')}` : `${event} events carry no fields`)
      } else if (space === 'counter' && !counters.has(field)) {
        issue(where(keys), `undeclared counter ${field}`)
      } else if (space === 'timer' && !timers.has(field)) {
        issue(where(keys), `undeclared timer ${field}`)
      } else if (space === 'rules' && !(RULES_CONSTANTS as readonly string[]).includes(field)) {
        issue(where(keys), `rules.<name> is one of ${RULES_CONSTANTS.join(', ')}`)
      }
    }
    const actions: unknown[] = Array.isArray(handler.do) ? handler.do : []
    actions.forEach((action, a) => {
      if (!isRecord(action)) return
      for (const key of ['startMode', 'endMode'] as const) {
        if (typeof action[key] === 'string' && !modes.has(action[key])) issue(where(['do', a, key]), `undeclared mode ${action[key]}`)
      }
      for (const key of ['startTimer', 'stopTimer'] as const) {
        if (typeof action[key] === 'string' && !timers.has(action[key])) issue(where(['do', a, key]), `undeclared timer ${action[key]}`)
      }
      for (const key of ['add', 'set'] as const) {
        const op = action[key]
        if (isRecord(op) && typeof op.counter === 'string' && !counters.has(op.counter)) issue(where(['do', a, key, 'counter']), `undeclared counter ${op.counter}`)
      }
    })
    const conditions: unknown[] = Array.isArray(handler.if) ? handler.if : []
    conditions.forEach((condition, c) => {
      if (!isRecord(condition)) return
      for (const key of ['mode', 'notMode'] as const) {
        if (typeof condition[key] === 'string' && !modes.has(condition[key])) issue(where(['if', c, key]), `undeclared mode ${condition[key]}`)
      }
    })
    if (handler.on === 'timer' && typeof handler.id === 'string' && !timers.has(handler.id)) issue(where(['id']), `undeclared timer ${handler.id}`)
    if (handler.on === 'modeEnd' && typeof handler.id === 'string' && !modes.has(handler.id)) issue(where(['id']), `undeclared mode ${handler.id}`)
  })
})

export type RulesProgram = v.InferOutput<typeof ProgramShape>
