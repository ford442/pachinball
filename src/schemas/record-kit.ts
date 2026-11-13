/**
 * The boot-path half of the schema layer (#505 §A): what the game needs to
 * read its own stored records at startup (settings, scoring breakdown,
 * unseen rewards, map cache, campaign save, replay tapes). The authoring kit
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
