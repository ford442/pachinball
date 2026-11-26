/**
 * The boot-path half of the schema layer (#505 §A): what the game needs to
 * read its own stored records at startup (settings, scoring breakdown,
 * unseen rewards, map cache, campaign save, replay tapes, the profile core's
 * strict object). The authoring kit
 * the lazily loaded schemas build with is `./schema-kit.ts`, which re-exports
 * these; boot code imports this module so the entry chunk stays small.
 *
 * Pure TS — no Babylon, no DOM.
 */

import * as v from 'valibot'

/** True for a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `JSON.parse` + `schema`: null on bad JSON or a failed parse. For `localStorage` and other untrusted text. */
export function parseJsonWith<S extends v.GenericSchema>(schema: S, text: string | null | undefined): v.InferOutput<S> | null {
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

// ---------------------------------------------------------------------------
// Lenient records (storage written by older builds)
// ---------------------------------------------------------------------------

/**
 * An optional field that reads as absent when it holds the wrong type: a
 * stored record from an older build loses that field, not the whole record.
 */
export function lenient<S extends v.GenericSchema>(schema: S) {
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

// ---------------------------------------------------------------------------
// Strict objects (boot uses one: the profile core)
// ---------------------------------------------------------------------------

type Entries = v.ObjectEntries
type ObjectIssueMessage = (issue: v.BaseIssue<unknown>) => string

/** The plain message of each `strict` object (its Valibot message is a function). */
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

/** An object that rejects keys it does not declare. Lives here so the boot profile schema does not import `schema-kit`. */
export function strict<const E extends Entries>(entries: E, message = 'must be an object') {
  const schema = v.strictObject(entries, objectMessage(entries, message))
  objectMessages.set(schema, message)
  return schema
}
