/**
 * The element segments of the track schema (#505 §A): what each refuses, with
 * the path the editor shows, and the ordering rules the whole track enforces
 * (a spinner before its parts, a mark before its jump, a straight before
 * anything measured from it).
 */
import { describe, expect, it } from 'vitest'
import { validateTrackDefinition } from '../src/schemas/track'

const STRAIGHT = { type: 'straight', width: 6, length: 10, inclineDeg: 0 }
const SPINNER = { type: 'spinner', radius: 8, angVel: 1, at: { along: 9 } }

function errorsOf(segments: unknown[]): string[] {
  const result = validateTrackDefinition({ schemaVersion: 1, id: 'CPU_CORE', segments })
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)
}

describe('element segments — accepted', () => {
  it('a spinner with parts, a mark and a jump back to it, a seeded scatter and a mover', () => {
    expect(
      errorsOf([
        STRAIGHT,
        { type: 'mark', name: 'start' },
        { type: 'scatter', seedKey: 'test:scatter', count: 3, along: { random: [1, 9] }, lateral: { random: [-2, 2] }, shape: { kind: 'box', size: 'size' }, size: [0.5, 1], seat: true },
        SPINNER,
        { type: 'spinnerParts', ring: { count: 4 }, radius: 3, y: 1, shape: { kind: 'box', size: { x: 0.5, y: 1, z: 'arc' } }, yaw: true },
        { type: 'obstacle', shape: { kind: 'box', size: { x: 1, y: 1, z: 1 } }, motion: { kind: 'piston', frequency: 2, amplitude: 1 }, items: [{ at: { from: 'spinner', lateral: -4 } }] },
        { type: 'jump', to: 'start' },
      ]),
    ).toEqual([])
  })
})

describe('element segments — refused', () => {
  it.each([
    ['spinner parts before any spinner', [STRAIGHT, { type: 'spinnerParts', ring: { count: 2 }, radius: 3, y: 1, shape: { kind: 'cylinder', diameter: 1, height: 1 } }], 'segments[1]: spinnerParts needs an earlier spinner'],
    ['a jump to a mark that does not exist yet', [{ type: 'jump', to: 'later' }, { type: 'mark', name: 'later' }], 'segments[0].to: no earlier mark named later'],
    ['a placement from a spinner before one is built', [STRAIGHT, { type: 'bucket', at: { from: 'spinner', along: 2 } }], 'segments[1].at: spinner needs an earlier spinner'],
    ['a scatter before any straight', [{ type: 'scatter', seedKey: 'k', count: 1, along: 1, shape: { kind: 'sphere', diameter: 1 } }], 'segments[0]: rampStart needs an earlier straight'],
    ['pin rows before any straight', [{ type: 'pinRows', spacing: 2, evenOffsets: [0], oddOffsets: [0], pinHeight: 1, pinRadius: 0.1 }], 'segments[0]: pinRows must follow a straight segment'],
    ['a "size" dimension without a size range', [STRAIGHT, { type: 'scatter', seedKey: 'k', count: 1, along: 1, shape: { kind: 'tetra', size: 'size' } }], 'segments[1].size: a shape dimension is "size", so set `size: [min, max]`'],
    ['variants without a seed key', [STRAIGHT, { type: 'obstacle', shape: { kind: 'sphere', diameter: 1 }, variants: [[{ at: {} }], [{ at: {} }]] }], 'segments[1].seedKey: variants are picked by a seeded draw; set `seedKey`'],
    ['a seeded mover without a seed key', [STRAIGHT, { type: 'obstacle', shape: { kind: 'sphere', diameter: 1 }, motion: { kind: 'piston', frequency: { random: [1, 2] }, amplitude: 1 }, items: [{ at: {} }] }], 'segments[1].seedKey: a { random } value draws from a seeded stream; set `seedKey`'],
    ['an item with no shape anywhere', [STRAIGHT, { type: 'obstacle', items: [{ at: {} }] }], 'segments[1].items[0]: needs a `shape` (here or on the segment)'],
    ['a jump that names nothing', [{ type: 'jump' }], 'segments[0]: set exactly one of `to`, `midpoint` and `at`'],
    ['a spinner with both angular velocities', [{ type: 'spinner', radius: 2, angVel: 1, angVelDeg: 30 }], 'segments[0].angVelDeg: set exactly one of `angVelDeg` and `angVel`'],
    ['a surface frame measured from the cursor', [STRAIGHT, { type: 'bucket', at: { frame: 'surface', along: 1 } }], 'segments[1].at.frame: a surface frame is measured from rampStart'],
    ['a normal offset in a flat frame', [STRAIGHT, { type: 'bucket', at: { from: 'rampStart', normal: 1 } }], 'segments[1].at.normal: only applies to frame "surface"'],
    ['a spinner child without a local position', [SPINNER, { type: 'decor', parent: 'spinner', items: [{ shape: { kind: 'sphere', diameter: 1 } }] }], 'segments[1].items[0].local: a spinner child needs `local`'],
    ['a ring with both radius forms', [SPINNER, { type: 'spinnerParts', ring: { count: 2 }, radius: 3, radiusFactor: 0.5, y: 1, shape: { kind: 'cylinder', diameter: 1, height: 1 } }], 'segments[1].radius: a ring needs exactly one of `radius` and `radiusFactor`'],
    ['an unknown placement anchor', [{ type: 'bucket', at: { from: 'ceiling' } }], 'segments[0].at.from: must be one of cursor | rampStart | rampCenter | spinner'],
    ['a malformed number spec', [STRAIGHT, { type: 'scatter', seedKey: 'k', count: 1, along: { spread: 3 }, shape: { kind: 'sphere', diameter: 1 } }], 'segments[1].along: must be a number, { random: [min, max] } or { start, step }'],
    ['a scatter with zones', [STRAIGHT, { type: 'scatter', seedKey: 'k', count: 1, along: 1, shape: { kind: 'sphere', diameter: 1 }, zone: { kind: 'damping', damping: 1 } }], 'segments[1].zone: a scatter builds solid copies, not zones'],
  ])('%s', (_name, segments, expected) => {
    expect(errorsOf(segments)).toContain(expected)
  })
})
