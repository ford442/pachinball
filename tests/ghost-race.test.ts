/**
 * #444 Slice D — the race ghost's track: the verifier's Int32 millimetre
 * samples (one every `stride` steps from frame 0) decoded and interpolated by
 * the player's step count.
 */
import { describe, expect, it } from 'vitest'
import { decodeGhostTrack, ghostPositionAt } from '../src/replay/ghost-race'

/** What the verifier uploads: base64 of little-endian Int32 triples. */
function encode(points: Array<[number, number, number]>, stride = 2) {
  const ints = Int32Array.from(points.flat())
  const bytes = new Uint8Array(ints.buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return { stride, samples: points.length, track: btoa(binary) }
}

const NO_BALL = -2147483648

describe('race ghost track (#444 Slice D)', () => {
  const track = encode([[1000, 250, -9000], [1200, 250, -8000], [NO_BALL, 0, 0], [500, 250, 3000]])
  const samples = decodeGhostTrack(track)

  it('decodes the verifier\'s Int32 millimetre triples', () => {
    expect(Array.from(samples.subarray(0, 6))).toEqual([1000, 250, -9000, 1200, 250, -8000])
    expect(samples.length).toBe(12)
  })

  it('places the ghost after step n at sample (n - 1) / stride, interpolated, in metres', () => {
    expect(ghostPositionAt(samples, 2, 0)).toBeNull()
    expect(ghostPositionAt(samples, 2, 1)).toEqual({ x: 1, y: 0.25, z: -9 })
    expect(ghostPositionAt(samples, 2, 2)).toEqual({ x: 1.1, y: 0.25, z: -8.5 })
    expect(ghostPositionAt(samples, 2, 3)).toEqual({ x: 1.2, y: 0.25, z: -8 })
  })

  it('hides between balls and after the run ends', () => {
    expect(ghostPositionAt(samples, 2, 5)).toBeNull()
    // Approaching a no-ball sample, it holds its last position rather than sweeping toward the sentinel.
    expect(ghostPositionAt(samples, 2, 4)).toEqual({ x: 1.2, y: 0.25, z: -8 })
    expect(ghostPositionAt(samples, 2, 7)).toEqual({ x: 0.5, y: 0.25, z: 3 })
    expect(ghostPositionAt(samples, 2, 9)).toBeNull()
  })
})
