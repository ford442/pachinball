/**
 * RulesEngine (#556 Slice 1): runs a rules v2 program (`src/schemas/rules-program.ts`).
 *
 * The game raises events (`dispatch('bumper', ctx)`) at the points the hard-coded scoring used to
 * run; the engine runs the matching handlers in declaration order — each handler's conditions are
 * read when it is reached, after the earlier handlers' actions — and every action goes out through
 * a `RulesSink`: points, multiball, ball save, kickback, the backbox state, EventBus events and
 * presentation cues. The engine owns the program's state (counters, flags, lamps, the mode stack,
 * the playfield multiplier, timers) and counts it in **sim ticks**: `tick()` runs once per fixed
 * step, so a program is a pure function of the tape and replays bit-identically (in Node too).
 *
 * An action that raises an event (`endMode`, a `jackpot:start` emit the game routes back) runs that
 * event's handlers at once, nested, like a function call; nesting deeper than `MAX_DEPTH` throws —
 * a ruleset that loops is broken, and the throw becomes a sim fault (the run goes unranked).
 *
 * Iteration over named state is in sorted-name order, never insertion order: two rulesets with the
 * same canonical JSON (and so the same `rulesHash`) behave the same.
 *
 * Pure TS — no Babylon, no DOM, no Valibot.
 */

import type { PhysicsBody } from '../core/physics-api'
import type { Vec3Like } from '../core/vec3-scalar'
import type {
  RULES_DISPLAY_STATES,
  RULES_EMITS,
  RULES_MULTIBALL_REASONS,
  RULES_TALLIES,
  RulesAction,
  RulesCondition,
  RulesCue,
  RulesEventName,
  RulesFactor,
  RulesHandler,
  RulesValue,
} from '../schemas/rules-program'
import type { RunRules } from './rules-types'

export type RulesDisplayState = (typeof RULES_DISPLAY_STATES)[number]
export type RulesEmit = (typeof RULES_EMITS)[number]
export type RulesMultiballReason = (typeof RULES_MULTIBALL_REASONS)[number]
export type RulesTally = (typeof RULES_TALLIES)[number]

/** What an event carries into the program. */
export interface RulesEventContext {
  /** Lane id, timer / mode name: what a handler's `id` matches. */
  readonly id?: string
  /** Lane kind, gold ball type: what a handler's `kind` matches. */
  readonly kind?: string
  /** `event.<field>` values (`RULES_EVENT_FIELDS`). A missing field reads 0. */
  readonly values?: Readonly<Record<string, number>>
  /** The ball the event is about (a kickback pushes it). Opaque to the engine. */
  readonly ball?: PhysicsBody
  /** Where it happened (floating score numbers). Opaque to the engine. */
  readonly position?: Vec3Like
}

/** A lamp changed: presentation draws it. */
export interface RulesLampCue {
  lamp: string
  on: boolean
}

/** Where a program's actions land. The engine never reaches the game any other way. */
export interface RulesSink {
  /** The backbox state conditions read (`DisplayState` values). */
  displayState(): string
  /**
   * Award `base` points (the program's points × factors, rounded): the game applies its own
   * multipliers (multiball, combo) and then `multiplier`, the program's playfield × mode multiplier.
   * `tally`: also count `base` toward the end-of-ball bonus.
   */
  award(base: number, source: string, multiplier: number, tally: RulesTally | null, ctx: RulesEventContext): void
  /** Count a hit toward the rolling combo multiplier. */
  comboHit(): void
  multiball(balls: number, reason: RulesMultiballReason): void
  addBalls(count: number): void
  /** Grant a ball save for `ticks` fixed steps from now. */
  ballSave(ticks: number): void
  kickback(impulse: readonly [number, number, number], ctx: RulesEventContext): void
  display(state: RulesDisplayState): void
  emit(event: RulesEmit): void
  cue(cue: RulesCue | RulesLampCue, ctx: RulesEventContext): void
}

/** Nested events (an action raising an event that raises another…) deeper than this throw. */
export const MAX_DEPTH = 16

interface ModeEntry {
  readonly id: string
  /** Ticks left; null runs until `endMode`. */
  remaining: number | null
}

interface ParsedRef {
  readonly space: 'event' | 'counter' | 'timer' | 'rules'
  readonly name: string
}

const NO_CONTEXT: RulesEventContext = {}

export class RulesEngine {
  private readonly handlers = new Map<RulesEventName, RulesHandler[]>()
  private readonly counterNames: readonly string[]
  private readonly timerNames: readonly string[]
  private readonly counters = new Map<string, number>()
  private readonly timers = new Map<string, number>()
  private readonly flags = new Set<string>()
  private readonly lamps = new Set<string>()
  private modes: ModeEntry[] = []
  private playfieldMultiplier = 1
  private depth = 0
  private readonly refs = new Map<string, ParsedRef>()
  private readonly constants: Readonly<Record<string, number>>
  /** Base points awarded by the outermost dispatch so far (what `dispatch` returns). */
  private awardedBase = 0

  constructor(
    readonly rules: RunRules,
    private readonly sink: RulesSink,
  ) {
    for (const handler of rules.program.handlers) {
      const list = this.handlers.get(handler.on)
      if (list) list.push(handler)
      else this.handlers.set(handler.on, [handler])
    }
    this.counterNames = Object.keys(rules.program.counters ?? {}).sort()
    this.timerNames = Object.keys(rules.program.timers ?? {}).sort()
    this.constants = { feverThreshold: rules.fever.threshold }
    this.reset()
  }

  /** A run starts: counters at their initial values, everything else off. */
  reset(): void {
    this.counters.clear()
    const declared = this.rules.program.counters ?? {}
    for (const name of this.counterNames) this.counters.set(name, declared[name]?.initial ?? 0)
    this.timers.clear()
    for (const name of this.timerNames) this.timers.set(name, 0)
    this.flags.clear()
    this.lamps.clear()
    this.modes = []
    this.playfieldMultiplier = 1
    this.depth = 0
  }

  /** Whether any handler listens for `event` (callers may skip building a context when not). */
  handles(event: RulesEventName): boolean {
    return this.handlers.has(event)
  }

  /**
   * Run `event`'s handlers. Returns the base points its handlers awarded (not counting events they
   * raised in turn).
   */
  dispatch(event: RulesEventName, ctx: RulesEventContext = NO_CONTEXT): number {
    const list = this.handlers.get(event)
    if (!list) return 0
    if (this.depth >= MAX_DEPTH) {
      throw new Error(`rules: ${event} raised ${MAX_DEPTH} events deep — the ruleset loops`)
    }
    const outerAwarded = this.awardedBase
    this.awardedBase = 0
    this.depth++
    try {
      for (const handler of list) {
        if (handler.id !== undefined && handler.id !== ctx.id) continue
        if (handler.kind !== undefined && handler.kind !== ctx.kind) continue
        if (handler.if && !this.allHold(handler.if, ctx)) continue
        for (const action of handler.do) this.run(action, ctx)
      }
      return this.awardedBase
    } finally {
      this.depth--
      this.awardedBase = outerAwarded
    }
  }

  /**
   * One fixed step: every running timer and timed mode loses a tick. Those that reach zero then
   * fire, in name order (timers) and stack order (modes): `timer` (a repeating timer re-arms first)
   * and `modeEnd`.
   */
  tick(): void {
    let firedTimers: string[] | null = null
    for (const name of this.timerNames) {
      const left = this.timers.get(name) ?? 0
      if (left <= 0) continue
      if (left === 1) {
        const def = this.rules.program.timers?.[name]
        this.timers.set(name, def?.repeat ? def.ticks : 0)
        ;(firedTimers ??= []).push(name)
      } else {
        this.timers.set(name, left - 1)
      }
    }
    let endedModes: string[] | null = null
    for (const mode of this.modes) {
      if (mode.remaining === null) continue
      mode.remaining--
      if (mode.remaining <= 0) (endedModes ??= []).push(mode.id)
    }
    if (endedModes) this.modes = this.modes.filter((m) => m.remaining === null || m.remaining > 0)
    if (firedTimers) for (const id of firedTimers) this.dispatch('timer', { id })
    if (endedModes) for (const id of endedModes) this.dispatch('modeEnd', { id })
  }

  // ---- State (tests, debug HUD, presentation) ----

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0
  }

  getTimer(name: string): number {
    return this.timers.get(name) ?? 0
  }

  hasFlag(name: string): boolean {
    return this.flags.has(name)
  }

  isLit(lamp: string): boolean {
    return this.lamps.has(lamp)
  }

  isModeActive(id: string): boolean {
    return this.modes.some((m) => m.id === id)
  }

  /** Active modes, oldest first. */
  activeModes(): readonly string[] {
    return this.modes.map((m) => m.id)
  }

  /** Playfield multiplier × every active mode's multiplier, in stack order. */
  getMultiplier(): number {
    let multiplier = this.playfieldMultiplier
    const defs = this.rules.program.modes
    for (const mode of this.modes) multiplier *= defs?.[mode.id]?.multiplier ?? 1
    return multiplier
  }

  // ---- Evaluation ----

  private ref(text: string): ParsedRef {
    let parsed = this.refs.get(text)
    if (!parsed) {
      const dot = text.indexOf('.')
      parsed = { space: text.slice(0, dot) as ParsedRef['space'], name: text.slice(dot + 1) }
      this.refs.set(text, parsed)
    }
    return parsed
  }

  private value(value: RulesValue, ctx: RulesEventContext): number {
    if (typeof value === 'number') return value
    const { space, name } = this.ref(value)
    switch (space) {
      case 'event':
        return ctx.values?.[name] ?? 0
      case 'counter':
        return this.counters.get(name) ?? 0
      case 'timer':
        return this.timers.get(name) ?? 0
      case 'rules':
        return this.constants[name] ?? 0
    }
  }

  private factor(factor: RulesFactor, ctx: RulesEventContext): number {
    if (typeof factor === 'number' || typeof factor === 'string') return this.value(factor, ctx)
    return Math.floor(this.value(factor.tier.of, ctx) / factor.tier.per) + 1
  }

  private allHold(conditions: readonly RulesCondition[], ctx: RulesEventContext): boolean {
    for (const condition of conditions) {
      if (!this.holds(condition, ctx)) return false
    }
    return true
  }

  private holds(c: RulesCondition, ctx: RulesEventContext): boolean {
    if ('eq' in c) return this.value(c.eq[0], ctx) === this.value(c.eq[1], ctx)
    if ('ne' in c) return this.value(c.ne[0], ctx) !== this.value(c.ne[1], ctx)
    if ('gt' in c) return this.value(c.gt[0], ctx) > this.value(c.gt[1], ctx)
    if ('gte' in c) return this.value(c.gte[0], ctx) >= this.value(c.gte[1], ctx)
    if ('lt' in c) return this.value(c.lt[0], ctx) < this.value(c.lt[1], ctx)
    if ('lte' in c) return this.value(c.lte[0], ctx) <= this.value(c.lte[1], ctx)
    if ('in' in c) return c.in[1].includes(this.value(c.in[0], ctx))
    if ('flag' in c) return this.flags.has(c.flag)
    if ('notFlag' in c) return !this.flags.has(c.notFlag)
    if ('lit' in c) return this.lamps.has(c.lit)
    if ('unlit' in c) return !this.lamps.has(c.unlit)
    if ('mode' in c) return this.isModeActive(c.mode)
    if ('notMode' in c) return !this.isModeActive(c.notMode)
    if ('display' in c) return this.sink.displayState() === c.display
    return this.sink.displayState() !== c.notDisplay
  }

  private run(a: RulesAction, ctx: RulesEventContext): void {
    if ('award' in a) {
      const { points, scale, source, tally } = a.award
      let total = this.value(points, ctx)
      if (scale) for (const factor of scale) total *= this.factor(factor, ctx)
      const base = Math.max(0, Math.round(total))
      this.awardedBase += base
      this.sink.award(base, expandSource(source, ctx), this.getMultiplier(), tally ?? null, ctx)
    } else if ('comboHit' in a) {
      this.sink.comboHit()
    } else if ('add' in a) {
      this.counters.set(a.add.counter, (this.counters.get(a.add.counter) ?? 0) + this.value(a.add.value, ctx))
    } else if ('set' in a) {
      this.counters.set(a.set.counter, this.value(a.set.value, ctx))
    } else if ('setFlag' in a) {
      this.flags.add(a.setFlag)
    } else if ('clearFlag' in a) {
      this.flags.delete(a.clearFlag)
    } else if ('light' in a) {
      this.lamps.add(a.light)
      this.sink.cue({ lamp: a.light, on: true }, ctx)
    } else if ('unlight' in a) {
      this.lamps.delete(a.unlight)
      this.sink.cue({ lamp: a.unlight, on: false }, ctx)
    } else if ('startMode' in a) {
      const ticks = this.rules.program.modes?.[a.startMode]?.ticks ?? null
      const active = this.modes.find((m) => m.id === a.startMode)
      // Starting a running mode restarts its clock; it keeps its place in the stack.
      if (active) active.remaining = ticks
      else this.modes.push({ id: a.startMode, remaining: ticks })
    } else if ('endMode' in a) {
      const before = this.modes.length
      this.modes = this.modes.filter((m) => m.id !== a.endMode)
      if (this.modes.length !== before) this.dispatch('modeEnd', { id: a.endMode })
    } else if ('startTimer' in a) {
      this.timers.set(a.startTimer, this.rules.program.timers?.[a.startTimer]?.ticks ?? 0)
    } else if ('stopTimer' in a) {
      this.timers.set(a.stopTimer, 0)
    } else if ('multiplier' in a) {
      this.playfieldMultiplier = Math.min(100, Math.max(0, this.value(a.multiplier, ctx)))
    } else if ('multiball' in a) {
      this.sink.multiball(a.multiball.balls, a.multiball.reason)
    } else if ('addBalls' in a) {
      this.sink.addBalls(a.addBalls)
    } else if ('ballSave' in a) {
      this.sink.ballSave(a.ballSave.ticks)
    } else if ('kickback' in a) {
      this.sink.kickback(a.kickback.impulse, ctx)
    } else if ('display' in a) {
      this.sink.display(a.display)
    } else if ('emit' in a) {
      this.sink.emit(a.emit)
    } else {
      this.sink.cue(a.cue, ctx)
    }
  }
}

/** `lane-rollover:{id}` → `lane-rollover:left-inlane`. */
function expandSource(source: string, ctx: RulesEventContext): string {
  if (!source.includes('{')) return source
  return source.replace('{id}', ctx.id ?? '').replace('{kind}', ctx.kind ?? '')
}
