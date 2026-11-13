/**
 * The shared Valibot layer (#505 §A): issue paths and messages read the way
 * the hand-written validators wrote them, because the HUD, the CLIs and the
 * machine editor show them.
 */
import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import {
  canonicalJson,
  num,
  parseJsonWith,
  parseWith,
  strict,
  withCrossCheck,
} from '../src/schemas/schema-kit'
import { validateTrackDefinition } from '../src/schemas/track'
import { validateMachine } from '../src/schemas/machine'

const Thing = strict({
  name: v.string('must be a string'),
  size: num('must be a finite number > 0', { gt: 0 }),
  parts: v.array(strict({ x: num() }), 'must be an array'),
})

const errorsOf = (raw: unknown) => {
  const result = parseWith(Thing, raw)
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)
}

describe('schema-kit issues', () => {
  it('indexes arrays and dots keys', () => {
    expect(errorsOf({ name: 'a', size: 1, parts: [{ x: 1 }, { x: 'q' }] })).toEqual(['parts[1].x: must be a finite number'])
  })

  it('an extra key is `unknown field`', () => {
    expect(errorsOf({ name: 'a', size: 1, parts: [{ x: 1, y: 2 }], extra: 1 })).toEqual([
      'parts[0].y: unknown field',
      'extra: unknown field',
    ])
  })

  it('a missing key carries the message of the field it is missing', () => {
    expect(errorsOf({ name: 'a', parts: [] })).toEqual(['size: must be a finite number > 0'])
  })

  it('a non-object reports at the root', () => {
    expect(parseWith(Thing, 5)).toEqual({ ok: false, errors: [{ path: '', message: 'must be an object' }] })
  })

  it('reports one message per failed value, however many bounds it breaks', () => {
    const result = parseWith(num('in range', { min: 0, max: 1, lt: 1 }), 7)
    expect(result).toEqual({ ok: false, errors: [{ path: '', message: 'in range' }] })
  })

  it('a cross-field check reports at a relative path, and knows whether the value parsed clean', () => {
    const Pair = withCrossCheck(strict({ a: num(), b: num() }), (value, issue, clean) => {
      const pair = value as { a: unknown; b: unknown }
      if (clean && (pair.a as number) > (pair.b as number)) issue(['a'], 'must be <= b')
    })
    expect(parseWith(Pair, { a: 2, b: 1 })).toEqual({ ok: false, errors: [{ path: 'a', message: 'must be <= b' }] })
    expect(parseWith(Pair, { a: 2, b: 'x' })).toEqual({ ok: false, errors: [{ path: 'b', message: 'must be a finite number' }] })
  })

  it('parseJsonWith returns null for bad JSON and for a failed parse', () => {
    expect(parseJsonWith(Thing, '{')).toBeNull()
    expect(parseJsonWith(Thing, null)).toBeNull()
    expect(parseJsonWith(Thing, '{"name":1}')).toBeNull()
    expect(parseJsonWith(Thing, '{"name":"a","size":2,"parts":[]}')).toEqual({ name: 'a', size: 2, parts: [] })
  })

  it('canonicalJson sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}')
  })
})

describe('track schema messages', () => {
  const base = { schemaVersion: 1, id: 'GLITCH_SPIRE' }
  const errorsFor = (segment: unknown) => {
    const result = validateTrackDefinition({ ...base, segments: [segment] })
    return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)
  }

  it('an unknown segment type names the types', () => {
    expect(errorsFor({ type: 'loop' })[0]).toMatch(/^segments\[0\]\.type: type must be one of: straight, curve,/)
  })

  it('a non-object segment', () => {
    expect(errorsFor(3)).toEqual(['segments[0]: segment must be an object'])
  })

  it('keeps the type / bound split of the hand-written validator', () => {
    expect(errorsFor({ type: 'straight', width: -1, length: 'x', inclineDeg: 0 })).toEqual([
      'segments[0].width: must be > 0',
      'segments[0].length: must be a finite number',
    ])
  })

  it('a material that is neither a role nor #rrggbb', () => {
    expect(errorsFor({ type: 'bucket', material: 'chrome' })).toEqual([
      'segments[0].material: material must be a theme role (structure|accent|energy|glow) or #rrggbb',
    ])
    expect(errorsFor({ type: 'bucket', material: 3 })).toEqual(['segments[0].material: material must be a string (role or #rrggbb)'])
  })

  it('an unknown id and an unknown material role', () => {
    const result = validateTrackDefinition({ ...base, id: 'NOPE', materials: { chrome: '#ffffff' }, segments: [{ type: 'gap', length: 1, drop: 0 }] })
    expect(result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      'id: unknown AdventureTrackType: NOPE',
      'materials.chrome: unknown material role',
    ])
  })

  it('accepts an editor `$schema` key', () => {
    expect(validateTrackDefinition({ $schema: '../../../public/schemas/track.json', ...base, segments: [{ type: 'gap', length: 1, drop: 0 }] }).ok).toBe(true)
  })
})

describe('machine schema messages', () => {
  it('a track ref with neither id nor inline', () => {
    const result = validateMachine({ tracks: [{}] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({ path: 'tracks[0]', message: 'needs `id` or `inline`' })
  })

  it('a missing section says what it must be', () => {
    const result = validateMachine({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ path: 'schemaVersion', message: 'must be 1' })
      expect(result.errors).toContainEqual({ path: 'backbox', message: 'must be an object' })
      expect(result.errors).toContainEqual({ path: 'cabinet', message: 'must be one of classic | neo | vertical | wide' })
    }
  })
})
