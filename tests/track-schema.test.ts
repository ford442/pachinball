/**
 * Unit tests for declarative adventure track schema (#296).
 *
 * Covers:
 *  1. Every shipped track-data JSON passes validateTrackDefinition
 *  2. Known-bad fixtures fail with structured errors
 *  3. compileTrackDefinition advances the cursor via a stub TrackBuildApi
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Vector3 stub — must be declared before compiler import
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  class Vector3 {
    x: number
    y: number
    z: number
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    clone() {
      return new Vector3(this.x, this.y, this.z)
    }
    add(other: Vector3) {
      return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z)
    }
    scale(s: number) {
      return new Vector3(this.x * s, this.y * s, this.z * s)
    }
  }
  return { Vector3 }
})

import { Vector3 } from '@babylonjs/core'
import {
  validateTrackDefinition,
  formatTrackValidationErrors,
  TRACK_SCHEMA_VERSION,
  type TrackDefinition,
} from '../src/adventure/track-schema'
import { compileTrackDefinition } from '../src/adventure/track-compiler'

const TRACK_DATA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/adventure/track-data',
)

function loadShippedTracks(): Array<{ file: string; raw: unknown }> {
  return readdirSync(TRACK_DATA_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((file) => ({
      file,
      raw: JSON.parse(readFileSync(join(TRACK_DATA_DIR, file), 'utf8')) as unknown,
    }))
}

describe('validateTrackDefinition — shipped JSON', () => {
  const shipped = loadShippedTracks()

  it('ships at least 3 data tracks', () => {
    expect(shipped.length).toBeGreaterThanOrEqual(3)
  })

  it.each(shipped)('$file validates', ({ raw }) => {
    const result = validateTrackDefinition(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.definition.schemaVersion).toBe(TRACK_SCHEMA_VERSION)
      expect(result.definition.segments.length).toBeGreaterThan(0)
    }
  })

  it('includes the three v1 migrations', () => {
    const ids = shipped.map((s) => (s.raw as TrackDefinition).id)
    expect(ids).toEqual(
      expect.arrayContaining(['GLITCH_SPIRE', 'RETRO_WAVE_HILLS', 'HYPER_DRIFT']),
    )
  })
})

describe('validateTrackDefinition — invalid fixtures', () => {
  it('rejects missing schemaVersion', () => {
    const result = validateTrackDefinition({
      id: 'GLITCH_SPIRE',
      segments: [{ type: 'gap', length: 1, drop: 0 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'schemaVersion')).toBe(true)
    }
  })

  it('rejects unknown track id', () => {
    const result = validateTrackDefinition({
      schemaVersion: 1,
      id: 'NOT_A_REAL_TRACK',
      segments: [{ type: 'gap', length: 1, drop: 0 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'id')).toBe(true)
    }
  })

  it('rejects empty segments', () => {
    const result = validateTrackDefinition({
      schemaVersion: 1,
      id: 'GLITCH_SPIRE',
      segments: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'segments')).toBe(true)
    }
  })

  it('rejects bad segment type', () => {
    const result = validateTrackDefinition({
      schemaVersion: 1,
      id: 'GLITCH_SPIRE',
      segments: [{ type: 'wormhole', length: 1 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'segments[0].type')).toBe(true)
    }
  })

  it('rejects invalid material ref', () => {
    const result = validateTrackDefinition({
      schemaVersion: 1,
      id: 'GLITCH_SPIRE',
      segments: [
        {
          type: 'straight',
          width: 4,
          length: 5,
          inclineDeg: 0,
          material: 'not-a-color',
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'segments[0].material')).toBe(true)
    }
  })

  it('formatTrackValidationErrors is HUD-friendly', () => {
    const result = validateTrackDefinition({ schemaVersion: 2, id: '', segments: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const msg = formatTrackValidationErrors(result.errors)
      expect(msg.startsWith('Invalid track:')).toBe(true)
    }
  })
})

describe('compileTrackDefinition', () => {
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
  })

  it('maps a minimal fixture to geometry API calls and advances cursor', () => {
    const def: TrackDefinition = {
      schemaVersion: 1,
      id: 'GLITCH_SPIRE',
      materials: { structure: '#FF00FF' },
      segments: [
        { type: 'straight', width: 4, length: 10, inclineDeg: 0, material: '#FF00FF' },
        { type: 'gap', length: 5, drop: 2 },
        { type: 'turn', deltaHeadingDeg: 90 },
        { type: 'bucket', material: '#FF00FF' },
      ],
    }

    const start = new Vector3(0, 10, 0)
    let lastStraightEnd = start.clone()

    const cursor = compileTrackDefinition(def, {
      currentStartPos: start,
      getTrackMaterial: (hex) => {
        calls.push(`mat:${hex}`)
        return { hex } as never
      },
      getThemedTrackMaterial: (role) => {
        calls.push(`theme:${role}`)
        return { role } as never
      },
      addStraightRamp: (pos, heading, width, length) => {
        calls.push(`straight:${width}x${length}@${heading.toFixed(2)}`)
        lastStraightEnd = new Vector3(pos.x, pos.y, pos.z + length)
        return lastStraightEnd
      },
      addCurvedRamp: () => {
        calls.push('curve')
        return lastStraightEnd.clone()
      },
      createBasin: (pos) => {
        calls.push(`bucket:${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`)
      },
      addExitPortal: () => {
        calls.push('portal')
      },
      createRotatingPlatform: () => {
        calls.push('spinner')
      },
      createChromaGate: (_pos, color) => {
        calls.push(`gate:${color}`)
      },
    })

    expect(calls.some((c) => c.startsWith('straight:'))).toBe(true)
    expect(calls.some((c) => c.startsWith('bucket:'))).toBe(true)
    // After gap of length 5 along heading 0 (forward +Z) then turn 90°, y dropped by 2
    expect(cursor.pos.y).toBeCloseTo(lastStraightEnd.y - 2, 5)
    expect(cursor.heading).toBeCloseTo(Math.PI / 2, 5)
  })
})
