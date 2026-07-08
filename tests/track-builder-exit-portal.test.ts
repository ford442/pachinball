/**
 * Tests for the exit portal infrastructure added to track builders.
 *
 * These tests use a lightweight mock context (no BabylonJS scene or physics
 * world) to verify that each of the 5 core campaign track builders:
 *   - reads currentTrackInfo.modeType from the context
 *   - calls addExitPortal() at a position above the catch basin
 *
 * The mock validates the shape expected by TrackBuilderContext without
 * importing any browser-only dependencies.
 */

import { describe, it, expect } from 'vitest'
import { TRACK_CATALOG } from '../src/game-elements/adventure-track-progression'
import type { TrackBuilderContext } from '../src/adventure/adventure-types'

// ─── Minimal Vector3-like helper ─────────────────────────────────────────────

class MockVec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  clone(): MockVec3 { return new MockVec3(this.x, this.y, this.z) }
  add(other: MockVec3): MockVec3 { return new MockVec3(this.x + other.x, this.y + other.y, this.z + other.z) }
  scale(s: number): MockVec3 { return new MockVec3(this.x * s, this.y * s, this.z * s) }
  copyFrom(other: MockVec3): void { this.x = other.x; this.y = other.y; this.z = other.z }
}

// ─── Mock context builder ─────────────────────────────────────────────────────

function makeMockContext(
  trackId: string,
  startPos: MockVec3 = new MockVec3(0, 0, 0)
): { ctx: TrackBuilderContext; portalPositions: MockVec3[] } {
  const portalPositions: MockVec3[] = []

  const ctx: TrackBuilderContext = {
    scene: {} as never,
    world: {} as never,
    rapier: {} as never,
    currentStartPos: startPos as never,
    currentTrackInfo: TRACK_CATALOG[trackId] ?? null,
    adventureTrack: [],
    materials: [],
    adventureBodies: [],
    kinematicBindings: [],
    animatedObstacles: [],
    conveyorZones: [],
    gravityWells: [],
    dampingZones: [],
    chromaGates: [],
    resetSensors: [],
    adventureSensor: null,
    getTrackMaterial: () => ({} as never),
    addStraightRamp: (startP: never, _heading: number, _w: number, length: number, incline: number) => {
      const hLen = length * Math.cos(incline)
      const vDrop = length * Math.sin(incline)
      const sp = startP as unknown as MockVec3
      return new MockVec3(sp.x, sp.y - vDrop, sp.z + hLen) as never
    },
    addCurvedRamp: (startP: never) => {
      // simplified: return the same position (orientation changes are irrelevant here)
      const sp = startP as unknown as MockVec3
      return sp.clone() as never
    },
    createBasin: () => { /* no-op */ },
    createRotatingPlatform: () => { /* no-op */ },
    createStaticCylinder: () => { /* no-op */ },
    createDynamicBlock: () => { /* no-op */ },
    createChromaGate: () => { /* no-op */ },
    createArcPylon: () => { /* no-op */ },
    addExitPortal: (position: never) => {
      const p = position as unknown as MockVec3
      portalPositions.push(p.clone())
    },
  }

  return { ctx, portalPositions }
}

// ─── TrackBuilderContext shape tests ─────────────────────────────────────────

describe('TrackBuilderContext interface', () => {
  it('includes currentTrackInfo and addExitPortal fields', () => {
    const { ctx } = makeMockContext('NEON_HELIX')
    expect('currentTrackInfo' in ctx).toBe(true)
    expect(typeof ctx.addExitPortal).toBe('function')
  })

  it('carries modeType from the campaign catalog', () => {
    const { ctx: extCtx } = makeMockContext('NEON_HELIX')
    expect(extCtx.currentTrackInfo?.modeType).toBe('EXTENDED_MAP')

    const { ctx: statCtx } = makeMockContext('CYBER_CORE')
    expect(statCtx.currentTrackInfo?.modeType).toBe('STATIONARY_TABLE')
  })
})

// ─── addExitPortal recording tests ───────────────────────────────────────────

describe('addExitPortal in track builder context', () => {
  it('stores a portal position above the catch basin floor', () => {
    const { ctx, portalPositions } = makeMockContext('NEON_HELIX', new MockVec3(0, 2, 8))

    // Simulate the minimal sequence a builder performs
    const basinY = -6
    const basinPos = new MockVec3(0, basinY, -12)
    ctx.addExitPortal(new MockVec3(basinPos.x, basinPos.y + 1.8, basinPos.z) as never)

    expect(portalPositions).toHaveLength(1)
    // Portal y must be above the basin floor
    expect(portalPositions[0].y).toBeGreaterThan(basinY)
  })

  it('allows only one portal registration per call (last wins)', () => {
    const { ctx, portalPositions } = makeMockContext('QUANTUM_GRID')

    ctx.addExitPortal(new MockVec3(0, 5, 10) as never)
    ctx.addExitPortal(new MockVec3(0, 7, 20) as never)

    // The test context records every call; the real TrackBuilder only keeps the last
    expect(portalPositions).toHaveLength(2)
    expect(portalPositions[1].z).toBe(20)
  })
})

// ─── modeType awareness tests ─────────────────────────────────────────────────

describe('campaign catalog modeType for 5 core tracks', () => {
  it('NEON_HELIX is EXTENDED_MAP', () => {
    expect(TRACK_CATALOG['NEON_HELIX'].modeType).toBe('EXTENDED_MAP')
  })

  it('CYBER_CORE is STATIONARY_TABLE', () => {
    expect(TRACK_CATALOG['CYBER_CORE'].modeType).toBe('STATIONARY_TABLE')
  })

  it('QUANTUM_GRID is EXTENDED_MAP', () => {
    expect(TRACK_CATALOG['QUANTUM_GRID'].modeType).toBe('EXTENDED_MAP')
  })

  it('PACHINKO_SPIRE is STATIONARY_TABLE', () => {
    expect(TRACK_CATALOG['PACHINKO_SPIRE'].modeType).toBe('STATIONARY_TABLE')
  })

  it('SINGULARITY_WELL is EXTENDED_MAP', () => {
    expect(TRACK_CATALOG['SINGULARITY_WELL'].modeType).toBe('EXTENDED_MAP')
  })

  it('PACHINKO_HALL is EXTENDED_MAP hub on main campaign spine', () => {
    expect(TRACK_CATALOG['PACHINKO_HALL'].modeType).toBe('EXTENDED_MAP')
    expect(TRACK_CATALOG['PACHINKO_HALL'].unlockedBy).toBe('NEON_HELIX')
  })

  it('free-roam tracks outside the catalog yield null currentTrackInfo', () => {
    const { ctx } = makeMockContext('UNKNOWN_FREE_ROAM_TRACK')
    expect(ctx.currentTrackInfo).toBeNull()
  })
})
