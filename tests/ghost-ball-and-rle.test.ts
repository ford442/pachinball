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
} from '../src/game-elements/replay-recorder'

describe('Replay InputFrame RLE Compression & Payload Serialization', () => {
  it('compressInputFrames compresses static frames dramatically and decompresses accurately', () => {
    const frames: InputFrame[] = []
    // 60 unpressed frames
    for (let i = 0; i < 60; i++) {
      frames.push({ flipperLeft: false, flipperRight: false, plunger: false, nudge: null, timestamp: i * 16.66 })
    }
    // 30 left flipper pressed frames
    for (let i = 0; i < 30; i++) {
      frames.push({ flipperLeft: true, flipperRight: false, plunger: false, nudge: null, timestamp: (60 + i) * 16.66 })
    }
    // 15 plunger charged frames
    for (let i = 0; i < 15; i++) {
      frames.push({ flipperLeft: false, flipperRight: false, plunger: true, nudge: null, timestamp: (90 + i) * 16.66 })
    }

    const compressed = compressInputFrames(frames)
    expect(compressed).toBe('60:0,0,0,0,0,0;30:1,0,0,0,0,0;15:0,0,1,0,0,0')

    const decompressed = decompressInputFrames(compressed)
    expect(decompressed.length).toBe(105)

    // Check sample frames
    expect(decompressed[0]?.flipperLeft).toBe(false)
    expect(decompressed[65]?.flipperLeft).toBe(true)
    expect(decompressed[95]?.plunger).toBe(true)
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
        { flipperLeft: false, flipperRight: false, plunger: false, nudge: null, timestamp: 0 },
        { flipperLeft: false, flipperRight: false, plunger: false, nudge: null, timestamp: 16 },
        { flipperLeft: true, flipperRight: false, plunger: false, nudge: null, timestamp: 32 },
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
