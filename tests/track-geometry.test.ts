/**
 * Unit tests for the pure adventure-track layout maths extracted from
 * track-builder.ts (#383 Slice B). No Babylon, no Rapier — these functions
 * are what keep a primitive's mesh and its collider descriptor in agreement,
 * so they are worth pinning independently of either engine.
 */

import { describe, it, expect } from 'vitest'

import {
  addScaled,
  curvedRampLayout,
  headingForward,
  headingRight,
  inclinedMillAxis,
  pinFieldLayout,
  platformToothLayout,
  rampForward,
  rampNormal,
  straightRampLayout,
  triangularPrismLayout,
  wallLayout,
  RAMP_HALF_THICKNESS,
  WALL_HALF_THICKNESS,
} from '../src/adventure/track-geometry'

const ORIGIN = { x: 0, y: 0, z: 0 }

describe('heading vectors', () => {
  it('points forward along +Z at heading 0 and along +X at heading pi/2', () => {
    expect(headingForward(0).z).toBeCloseTo(1, 9)
    expect(headingForward(0).x).toBeCloseTo(0, 9)
    expect(headingForward(Math.PI / 2).x).toBeCloseTo(1, 9)
  })

  it('keeps right perpendicular to forward and horizontal', () => {
    for (const heading of [0, 0.7, -1.3, Math.PI]) {
      const f = headingForward(heading)
      const r = headingRight(heading)
      expect(f.x * r.x + f.y * r.y + f.z * r.z).toBeCloseTo(0, 9)
      expect(r.y).toBe(0)
    }
  })

  it('keeps the ramp normal perpendicular to the down-slope direction', () => {
    for (const incline of [0, 0.2, -0.4]) {
      const n = rampNormal(1.1, incline)
      const f = rampForward(1.1, incline)
      expect(n.x * f.x + n.y * f.y + n.z * f.z).toBeCloseTo(0, 9)
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 9)
    }
  })
})

describe('straightRampLayout', () => {
  it('centres the slab halfway along the ramp and drops it half the fall', () => {
    const { center, endPos } = straightRampLayout(ORIGIN, 0, 10, 0)
    expect(center).toEqual({ x: 0, y: 0, z: 5 })
    expect(endPos).toEqual({ x: 0, y: 0, z: 10 })
  })

  it('shortens the horizontal run and drops the end for a positive incline', () => {
    const incline = Math.PI / 6 // 30 degrees
    const { center, endPos } = straightRampLayout(ORIGIN, 0, 10, incline)
    expect(endPos.z).toBeCloseTo(10 * Math.cos(incline), 9)
    expect(endPos.y).toBeCloseTo(-10 * Math.sin(incline), 9)
    expect(center.z).toBeCloseTo(endPos.z / 2, 9)
    expect(center.y).toBeCloseTo(endPos.y / 2, 9)
  })

  it('follows the heading', () => {
    const { endPos } = straightRampLayout(ORIGIN, Math.PI / 2, 4, 0)
    expect(endPos.x).toBeCloseTo(4, 9)
    expect(endPos.z).toBeCloseTo(0, 9)
  })

  it('does not mutate the start position', () => {
    const start = { x: 1, y: 2, z: 3 }
    straightRampLayout(start, 0.5, 6, 0.2)
    expect(start).toEqual({ x: 1, y: 2, z: 3 })
  })
})

describe('curvedRampLayout', () => {
  it('emits one slab per segment, each centred on its own mid-heading', () => {
    const layout = curvedRampLayout(ORIGIN, 0, 10, Math.PI / 2, 0, 4)
    expect(layout.segments).toHaveLength(4)
    const step = Math.PI / 2 / 4
    layout.segments.forEach((seg, i) => {
      expect(seg.heading).toBeCloseTo(step / 2 + i * step, 9)
    })
  })

  it('uses the chord, not the arc, as the slab depth', () => {
    const radius = 10
    const segments = 6
    const total = Math.PI
    const layout = curvedRampLayout(ORIGIN, 0, radius, total, 0, segments)
    const segmentAngle = total / segments
    expect(layout.chordLen).toBeCloseTo(2 * radius * Math.sin(segmentAngle / 2), 9)
    expect(layout.chordLen).toBeLessThan(radius * segmentAngle)
  })

  it('traces a half-turn back onto the start heading axis', () => {
    // 180 degrees at radius 10 from the origin ends roughly 2*r to the side.
    const layout = curvedRampLayout(ORIGIN, 0, 10, Math.PI, 0, 64)
    expect(layout.endPos.z).toBeCloseTo(0, 1)
    expect(Math.abs(layout.endPos.x)).toBeCloseTo(20, 0)
  })

  it('drops each segment by the arc length times sin(incline)', () => {
    const radius = 8
    const segments = 4
    const total = Math.PI / 2
    const incline = 0.25
    const layout = curvedRampLayout(ORIGIN, 0, radius, total, incline, segments)
    const arc = radius * Math.abs(total / segments)
    const perSegmentDrop = arc * Math.sin(incline)
    expect(layout.endPos.y).toBeCloseTo(-perSegmentDrop * segments, 9)
  })

  it('does not mutate the start position', () => {
    const start = { x: 1, y: 2, z: 3 }
    curvedRampLayout(start, 0, 5, 1, 0.1, 3)
    expect(start).toEqual({ x: 1, y: 2, z: 3 })
  })
})

describe('wallLayout', () => {
  it('places both walls clear of the track edge and lifted by half their height', () => {
    const [left, right] = wallLayout(ORIGIN, 0, 8, 2)
    expect(left.y).toBe(1)
    expect(right.y).toBe(1)
    // Heading 0: right vector is +X, so the offsets land on +/- X.
    expect(left.x).toBeCloseTo(8 / 2 + WALL_HALF_THICKNESS, 9)
    expect(right.x).toBeCloseTo(-(8 / 2 + WALL_HALF_THICKNESS), 9)
  })

  it('rotates the wall pair with the heading', () => {
    const [left] = wallLayout(ORIGIN, Math.PI / 2, 8, 2)
    expect(left.z).toBeCloseTo(-(8 / 2 + WALL_HALF_THICKNESS), 9)
    expect(left.x).toBeCloseTo(0, 9)
  })

  it('does not mutate the segment centre', () => {
    const center = { x: 5, y: 1, z: -2 }
    wallLayout(center, 0.4, 6, 3)
    expect(center).toEqual({ x: 5, y: 1, z: -2 })
  })
})

describe('pinFieldLayout', () => {
  it('alternates the even and odd lateral offsets by row', () => {
    const pins = pinFieldLayout(ORIGIN, 0, 0, 10, 2, [-1, 1], [0], 1)
    // floor(10/2) - 1 = 4 rows: odd, even, odd, even -> 1 + 2 + 1 + 2 pins.
    expect(pins).toHaveLength(6)
  })

  it('lifts every pin clear of the ramp slab along its normal', () => {
    const pinHeight = 1.5
    const pins = pinFieldLayout(ORIGIN, 0, 0, 6, 2, [0], [0], pinHeight)
    for (const pin of pins) {
      expect(pin.y).toBeCloseTo(RAMP_HALF_THICKNESS + pinHeight / 2, 9)
    }
  })

  it('walks pins down the slope on an inclined ramp', () => {
    const pins = pinFieldLayout(ORIGIN, 0, 0.3, 12, 3, [0], [0], 1)
    expect(pins.length).toBeGreaterThan(1)
    for (let i = 1; i < pins.length; i++) {
      expect(pins[i].z).toBeGreaterThan(pins[i - 1].z)
      expect(pins[i].y).toBeLessThan(pins[i - 1].y)
    }
  })

  it('produces nothing for a ramp shorter than two rows of spacing', () => {
    expect(pinFieldLayout(ORIGIN, 0, 0, 2, 2, [0], [0], 1)).toEqual([])
  })
})

describe('platformToothLayout', () => {
  it('places teeth on every other slot of a twelve-slot ring', () => {
    const teeth = platformToothLayout(5, 12)
    expect(teeth).toHaveLength(6)
    for (const t of teeth) {
      expect(Math.hypot(t.x, t.z)).toBeCloseTo(5 - 0.25, 9)
    }
  })

  it('spaces the teeth evenly around the ring', () => {
    const teeth = platformToothLayout(4, 12)
    const step = (2 * Math.PI) / 12
    teeth.forEach((t, i) => expect(t.angle).toBeCloseTo(i * 2 * step, 9))
  })
})

describe('inclinedMillAxis', () => {
  it('spins about the ramp normal rather than world Y', () => {
    const axis = inclinedMillAxis(0.4, 3)
    expect(axis.x).toBe(0)
    expect(axis.y).toBeCloseTo(Math.cos(0.4) * 3, 9)
    expect(axis.z).toBeCloseTo(Math.sin(0.4) * 3, 9)
    expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(3, 9)
  })

  it('reduces to world Y for a flat mill', () => {
    expect(inclinedMillAxis(0, 2)).toEqual({ x: 0, y: 2, z: 0 })
  })
})

describe('addScaled', () => {
  it('returns a new vector and leaves both inputs alone', () => {
    const a = { x: 1, y: 1, z: 1 }
    const dir = { x: 0, y: 1, z: 0 }
    const out = addScaled(a, dir, 3)
    expect(out).toEqual({ x: 1, y: 4, z: 1 })
    expect(a).toEqual({ x: 1, y: 1, z: 1 })
    expect(dir).toEqual({ x: 0, y: 1, z: 0 })
  })
})

describe('triangularPrismLayout', () => {
  const layout = triangularPrismLayout(0.5, 1.5)
  const vertex = (i: number) => ({ x: layout.vertices[i * 3], y: layout.vertices[i * 3 + 1], z: layout.vertices[i * 3 + 2] })

  it('puts its ring vertices where Babylon\'s tessellation-3 cylinder draws them', () => {
    expect(layout.vertices).toHaveLength(18)
    for (let j = 0; j < 3; j++) {
      const angle = (j * 2 * Math.PI) / 3
      for (const [ring, y] of [[0, -0.75], [1, 0.75]] as const) {
        const v = vertex(ring * 3 + j)
        expect(v.x).toBeCloseTo(Math.cos(-angle) * 0.5, 9)
        expect(v.y).toBe(y)
        expect(v.z).toBeCloseTo(Math.sin(-angle) * 0.5, 9)
      }
    }
  })

  it('winds all eight triangles outward', () => {
    expect(layout.indices).toHaveLength(24)
    for (let t = 0; t < 8; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => vertex(layout.indices[t * 3 + k]))
      const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
      const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
      const n = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x }
      const centroid = { x: a.x + b.x + c.x, y: a.y + b.y + c.y, z: a.z + b.z + c.z }
      expect(n.x * centroid.x + n.y * centroid.y + n.z * centroid.z).toBeGreaterThan(0)
    }
  })

  it('is closed: every directed edge is matched by its reverse exactly once', () => {
    const edges = new Map<string, number>()
    for (let t = 0; t < 8; t++) {
      for (let k = 0; k < 3; k++) {
        const from = layout.indices[t * 3 + k]
        const to = layout.indices[t * 3 + ((k + 1) % 3)]
        edges.set(`${from}>${to}`, (edges.get(`${from}>${to}`) ?? 0) + 1)
      }
    }
    for (const [key, count] of edges) {
      const [from, to] = key.split('>')
      expect(count).toBe(1)
      expect(edges.get(`${to}>${from}`)).toBe(1)
    }
  })
})
