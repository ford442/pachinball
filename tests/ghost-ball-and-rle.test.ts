/**
 * Unit tests for InputFrame RLE compression/decompression and ReplayPayload encoding.
 */

import { describe, it, expect } from 'vitest'
import {
  compressInputFrames,
  decompressInputFrames,
  ReplayRecorder,
  type InputFrame,
  type ReplayPayload,
} from '../src/replay/replay-recorder'

describe('Replay InputFrame RLE Compression & Payload Serialization', () => {
  it('compressInputFrames compresses static frames dramatically and decompresses accurately', () => {
    const frames: InputFrame[] = []
    // 60 unpressed frames
    for (let i = 0; i < 60; i++) {
      frames.push({ flipperLeft: false, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: i * 16.66 })
    }
    // 30 left flipper pressed frames
    for (let i = 0; i < 30; i++) {
      frames.push({ flipperLeft: true, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: (60 + i) * 16.66 })
    }
    // 15 plunger charged frames
    for (let i = 0; i < 15; i++) {
      frames.push({ flipperLeft: false, flipperRight: false, plungerCharge: 1, plunger: true, nudge: null, timestamp: (90 + i) * 16.66 })
    }

    const compressed = compressInputFrames(frames)
    expect(compressed).toBe('60:0,0,0,0,0,0,-;30:1,0,0,0,0,0,-;15:0,0,1,0,0,0,1')

    const decompressed = decompressInputFrames(compressed)
    expect(decompressed.length).toBe(105)

    // Check sample frames
    expect(decompressed[0]?.flipperLeft).toBe(false)
    expect(decompressed[65]?.flipperLeft).toBe(true)
    expect(decompressed[95]?.plunger).toBe(true)
    expect(decompressed[95]?.plungerCharge).toBe(1)
    expect(decompressed[0]?.plungerCharge).toBeNull()
  })

  it('round-trips plunger charge exactly, including null, 0, 1 and non-terminating values', () => {
    const charges = [null, 0, 1, 1 / 3, 37 * (1000 / 60) / 1500, 0.5]
    const frames: InputFrame[] = charges.map((plungerCharge, i) => ({
      flipperLeft: false, flipperRight: false, plungerCharge, plunger: plungerCharge !== null, nudge: null, timestamp: i,
    }))
    const decoded = decompressInputFrames(compressInputFrames(frames))
    expect(decoded.map((f) => f.plungerCharge)).toEqual(charges)
    expect(decoded.map((f) => f.plunger)).toEqual(charges.map((c) => c !== null))
  })

  it('decodes schema-1 rows (no charge field): a fired plunger replays at charge 0', () => {
    const decoded = decompressInputFrames('2:0,0,0,0,0,0;1:0,0,1,0,0,0')
    expect(decoded.map((f) => f.plungerCharge)).toEqual([null, null, 0])
    expect(decoded[2]?.plunger).toBe(true)
  })

  it('fromJSON fills plungerCharge on a schema-1 raw frames array and accepts a parsed object', () => {
    const legacy = {
      version: 1, seed: 1, finalScore: 0,
      frames: [
        { flipperLeft: false, flipperRight: false, plunger: true, nudge: null, timestamp: 0 },
        { flipperLeft: false, flipperRight: false, plunger: false, nudge: null, timestamp: 16 },
      ],
    }
    const restored = ReplayRecorder.fromJSON(legacy)
    expect(restored.frames.map((f) => f.plungerCharge)).toEqual([0, null])
  })

  it('fromJSON decodes compressed frames from an already-parsed API object (spectate path)', () => {
    const restored = ReplayRecorder.fromJSON({ version: 2, frames: [], compressedFrames: '3:0,0,0,0,0,0,-;1:0,0,1,0,0,0,0.25' })
    expect(restored.frames).toHaveLength(4)
    expect(restored.frames[3]?.plungerCharge).toBe(0.25)
  })

  it('ReplayRecorder.toJSON compresses payload and fromJSON restores input frames', () => {
    const payload: ReplayPayload = {
      version: 1,
      buildId: '1.0.0',
      mapId: 'neon-helix',
      seed: 42,
      physicsEngine: 'rapier',
      renderer: 'webgl2',
      createdAt: new Date().toISOString(),
      finalScore: 50000,
      frames: [
        { flipperLeft: false, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: 0 },
        { flipperLeft: false, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: 16 },
        { flipperLeft: true, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: 32 },
      ],
    }

    const json = ReplayRecorder.toJSON(payload, true)
    const parsed = JSON.parse(json) as Record<string, unknown>

    expect(parsed.compressedFrames).toBeDefined()
    expect(Array.isArray(parsed.frames) && parsed.frames.length === 0).toBe(true)

    const restored = ReplayRecorder.fromJSON(json)
    expect(restored.frames.length).toBe(3)
    expect(restored.frames[2]?.flipperLeft).toBe(true)
  })
})
