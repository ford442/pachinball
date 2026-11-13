/**
 * The shared Valibot layer (#505 §A): the helpers every schema in
 * `src/schemas/` builds with, and the one place a Valibot issue becomes the
 * `{ path, message }` pair the HUD, the CLI and the machine editor show.
 *
 * Paths read the way the hand-written validators wrote them —
 * `segments[3].offset.x`, `rules.balls.weights.STANDARD`, `''` for the root —
 * and an object never reports "Invalid key": an extra key is `unknown field`,
 * a missing one carries the message of the field it is missing.
 *
 * Pure TS — no Babylon, no DOM.
 */

import * as v from 'valibot'

/** One validation error: a dotted / indexed path into the value and what is wrong there. */
export interface SchemaIssue {
  path: string
  message: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: SchemaIssue[] }

// Valibot's own schema / issue shapes, loosened to "any schema" for the helpers below.
export type AnySchema = v.GenericSchema
type Entries = v.ObjectEntries
type ObjectIssueMessage = (issue: v.BaseIssue<unknown>) => string

/** `segments[3].offset.x` from an issue's path items. */
export function issuePath(issue: v.BaseIssue<unknown>): string {
  let out = ''
  for (const item of issue.path ?? []) {
    const key: unknown = item.key
    if (typeof key === 'number') out += `[${key}]`
    else out += out ? `.${String(key)}` : String(key)
  }
  return out
}

/** Flatten Valibot issues into `{ path, message }`, in the order Valibot found them. */
export function toSchemaIssues(issues: readonly v.BaseIssue<unknown>[]): SchemaIssue[] {
  const out: SchemaIssue[] = []
  const seen = new Set<string>()
  for (const issue of issues) {
    const entry = { path: issuePath(issue), message: issue.message }
    // A pipe reports each failed bound; one value, one message.
    const key = `${entry.path}\u0000${entry.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/** Parse `raw` with `schema`; never throws. */
export function parseWith<S extends AnySchema>(schema: S, raw: unknown): ParseResult<v.InferOutput<S>> {
  const result = v.safeParse(schema, raw)
  return result.success ? { ok: true, value: result.output } : { ok: false, errors: toSchemaIssues(result.issues) }
}

/** `JSON.parse` + `schema`: null on bad JSON or a failed parse. For `localStorage` and other untrusted text. */
export function parseJsonWith<S extends AnySchema>(schema: S, text: string | null | undefined): v.InferOutput<S> | null {
  if (text == null || text === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const result = v.safeParse(schema, raw)
  return result.success ? result.output : null
}

export function formatSchemaIssues(errors: readonly SchemaIssue[]): string {
  return errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ')
}

/** The plain message of each `strict` / `loose` object (their Valibot message is a function). */
const objectMessages = new WeakMap<object, string>()

/** The message a schema reports for a wrong value (a pipe reports its first schema's). */
function messageOf(schema: unknown): string | null {
  if (typeof schema !== 'object' || schema === null) return null
  const registered = objectMessages.get(schema)
  if (registered !== undefined) return registered
  const { message, pipe, wrapped } = schema as { message?: unknown; pipe?: unknown; wrapped?: unknown }
  if (typeof message === 'string') return message
  if (Array.isArray(pipe) && pipe.length > 0) return messageOf(pipe[0])
  return wrapped ? messageOf(wrapped) : null
}

/**
 * An object's issue message: `unknown field` for a key it does not declare,
 * the missing field's own message for one it does, `message` otherwise.
 */
function objectMessage(entries: Entries, message: string): ObjectIssueMessage {
  return (issue) => {
    if (issue.kind === 'schema' && issue.expected === 'never') return 'unknown field'
    const key = issue.path?.[issue.path.length - 1]?.key
    if (issue.received === 'undefined' && typeof key === 'string' && key in entries) {
      return messageOf(entries[key]) ?? 'is required'
    }
    return message
  }
}

/** An object that rejects keys it does not declare. */
export function strict<const E extends Entries>(entries: E, message = 'must be an object') {
  const schema = v.strictObject(entries, objectMessage(entries, message))
  objectMessages.set(schema, message)
  return schema
}

/** An object that keeps (and does not check) keys it does not declare. */
export function loose<const E extends Entries>(entries: E, message = 'must be an object') {
  const schema = v.looseObject(entries, objectMessage(entries, message))
  objectMessages.set(schema, message)
  return schema
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Bounds for `num`; `gt` / `lt` are exclusive. */
export interface NumberBounds {
  readonly min?: number
  readonly max?: number
  readonly gt?: number
  readonly lt?: number
}

/** The bound actions for `bounds`, each reporting `message`. */
function boundActions(bounds: NumberBounds, message: string): v.PipeItem<number, number, v.BaseIssue<unknown>>[] {
  const actions: v.PipeItem<number, number, v.BaseIssue<unknown>>[] = []
  if (bounds.min !== undefined) actions.push(v.minValue(bounds.min, message))
  if (bounds.max !== undefined) actions.push(v.maxValue(bounds.max, message))
  if (bounds.gt !== undefined) actions.push(v.gtValue(bounds.gt, message))
  if (bounds.lt !== undefined) actions.push(v.ltValue(bounds.lt, message))
  return actions
}

/** A finite number schema: what `num` / `numSplit` return. */
export type NumberSchema = v.GenericSchema<number, number>

/**
 * A finite number within `bounds`, every failure reported as `message` (JSON
 * has no NaN / Infinity, but a hand-built value can). Bounds are Valibot
 * actions, not a closure, so the generated JSON Schema carries them.
 */
export function num(message = 'must be a finite number', bounds: NumberBounds = {}): NumberSchema {
  return numSplit(message, bounds, message)
}

/** A finite number; a type error reads `typeMessage`, a bound error `boundMessage`. */
export function numSplit(typeMessage: string, bounds: NumberBounds, boundMessage: string): NumberSchema {
  // A variadic pipe loses Valibot's tuple typing; the declared return type restores `number`.
  return v.pipe(v.number(typeMessage), v.finite(typeMessage), ...boundActions(bounds, boundMessage))
}

/** A finite number in `[min, max]`. */
export function inRange(range: { readonly min: number; readonly max: number }, message?: string) {
  return num(message ?? `must be a number in [${range.min}, ${range.max}]`, range)
}

/** An integer in `[min, max]`. */
export function intInRange(range: { readonly min: number; readonly max: number }, message?: string) {
  const text = message ?? `must be an integer in [${range.min}, ${range.max}]`
  return v.pipe(v.number(text), v.integer(text), v.minValue(range.min, text), v.maxValue(range.max, text))
}

/** An unsigned 32-bit integer. */
export function u32(message = 'must be a u32') {
  return intInRange({ min: 0, max: 0xffffffff }, message)
}

export function bool(message = 'must be a boolean') {
  return v.boolean(message)
}

// ---------------------------------------------------------------------------
// Lenient records (storage written by older builds)
// ---------------------------------------------------------------------------

/**
 * An optional field that reads as absent when it holds the wrong type: a
 * stored record from an older build loses that field, not the whole record.
 */
export function lenient<S extends AnySchema>(schema: S) {
  return v.fallback(v.optional(schema), undefined)
}

/** `value` without its `undefined` fields, so spreading it over defaults keeps the defaults. */
export function pickDefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) out[key] = value[key]
  }
  return out
}

/** A string matching `pattern` with no `..` segment (a media path must not climb out of `public/`). */
export function safePath(pattern: RegExp, message: string) {
  return v.pipe(v.string(message), v.regex(pattern, message), v.check((s) => !s.includes('..'), message))
}

// ---------------------------------------------------------------------------
// Issues from cross-field checks (`v.rawCheck`)
// ---------------------------------------------------------------------------

type AddIssue = (info: { message: string; path?: [v.IssuePathItem, ...v.IssuePathItem[]] }) => void

/** True for a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Report `message` at `keys` below the value a `rawCheck` runs on (`[]` = the value itself). */
export function addIssueAt(addIssue: AddIssue, root: unknown, keys: readonly (string | number)[], message: string): void {
  if (keys.length === 0) {
    addIssue({ message })
    return
  }
  const items: v.IssuePathItem[] = []
  let input: unknown = root
  for (const key of keys) {
    const value: unknown = isRecord(input) || Array.isArray(input) ? (input as Record<string | number, unknown>)[key] : undefined
    items.push(
      typeof key === 'number'
        ? { type: 'array', origin: 'value', input: input as unknown[], key, value }
        : { type: 'object', origin: 'value', input: input as Record<string, unknown>, key, value },
    )
    input = value
  }
  addIssue({ message, path: items as [v.IssuePathItem, ...v.IssuePathItem[]] })
}

export type IssueReporter = (keys: readonly (string | number)[], message: string) => void

/**
 * `schema` followed by a cross-field check. `check` sees the raw value whether
 * or not `schema` accepted it, so it can report next to the field errors the
 * way the hand-written validators did; `clean` is true only when `schema`
 * found nothing wrong (the value has its parsed shape). It reports with
 * `issue(keys, message)`, `keys` relative to the value.
 */
export function withCrossCheck<S extends AnySchema>(
  schema: S,
  check: (value: unknown, issue: IssueReporter, clean: boolean) => void,
) {
  return v.pipe(
    schema,
    v.rawCheck<v.InferOutput<S>>(({ dataset, addIssue }) => {
      const clean = dataset.typed === true && !dataset.issues
      check(dataset.value, (keys, message) => addIssueAt(addIssue, dataset.value, keys, message), clean)
    }),
  )
}

// ---------------------------------------------------------------------------
// Canonical JSON (hashing)
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every level: the same value always serialises to the same text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = sortKeys(value[key])
  }
  return out
}
