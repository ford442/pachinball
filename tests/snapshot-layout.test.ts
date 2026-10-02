/**
 * #441 — the id table of a world snapshot, read without restoring it: what
 * the worker client's id shadow, the worker's hinge set and the spectate
 * remap mirror after a restore. Layout parity with the real bundle is
 * asserted in tests/replay-snapshot-wasm.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { readSnapshotIds } from '../src/wasm/snapshot-layout'
import { fakeSnapshot } from './helpers/fake-snapshot'

describe('readSnapshotIds', () => {
  it('reads step count, body ids, the next body id and active hinges', () => {
    const bytes = fakeSnapshot({
      hashHi: 0xabc, hashLo: 0xdef, ids: [0, 2, 5], stepCount: 1234,
      hinges: [{ id: 0, bodyId: 2 }, { id: 1, bodyId: 9, active: false }, { id: 2, bodyId: 5 }],
    })
    expect(readSnapshotIds(bytes)).toEqual({
      version: 1,
      staticHash: '00000abc00000def',
      stepCount: 1234,
      bodyIds: [0, 2, 5],
      nextBodyId: 6,
      hinges: [{ id: 0, bodyId: 2 }, { id: 2, bodyId: 5 }],
      nextHingeId: 3,
    })
  })

  it('returns null when the body columns or hinge section are cut short', () => {
    const bytes = fakeSnapshot({ hashHi: 1, hashLo: 2, ids: [0, 1], hinges: [{ id: 0, bodyId: 1 }] })
    expect(readSnapshotIds(bytes.subarray(0, bytes.length - 8))).toBeNull()
    const noHingeWords = fakeSnapshot({ hashHi: 1, hashLo: 2, ids: [0, 1] })
    expect(readSnapshotIds(noHingeWords.subarray(0, noHingeWords.length - 8))).toBeNull()
  })
})
