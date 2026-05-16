/**
 * Unit tests for BackboxBorderGlow
 *
 * These tests cover:
 *  1. Constructor gating: LOW-tier and null-mesh short-circuit (no owned material)
 *  2. MEDIUM/HIGH tier with a valid mesh: material is cloned and assigned
 *  3. onDisplaySet sets the correct target color per DisplayState string
 *  4. update() lerps toward the target color
 *  5. Jackpot strobe: active immediately, resolves to JACKPOT_SETTLE after phases
 *  6. reducedMotion disables strobe and GlowLayer
 *  7. dispose() clears owned material and GlowLayer
 *
 * Babylon.js and all related imports are mocked at the module boundary so the
 * suite runs in the plain Node environment provided by Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DisplayState } from '../src/game-elements/types'
import type { AccessibilityConfig } from '../src/game-elements/accessibility-config'

// ---------------------------------------------------------------------------
// Hoisted shared state — evaluated before vi.mock() factories run
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  /** Minimal Color3 that mirrors the Babylon API used inside display-border-glow */
  class FC3 {
    r: number; g: number; b: number
    constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b }
    clone() { return new FC3(this.r, this.g, this.b) }
    scale(s: number) { return new FC3(this.r * s, this.g * s, this.b * s) }
    static Black() { return new FC3(0, 0, 0) }
    static White() { return new FC3(1, 1, 1) }
    static LerpToRef(start: FC3, end: FC3, t: number, result: FC3) {
      result.r = start.r + (end.r - start.r) * t
      result.g = start.g + (end.g - start.g) * t
      result.b = start.b + (end.b - start.b) * t
    }
    static FromHexString(hex: string) {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      return new FC3(r, g, b)
    }
  }

  /** GlowLayer singleton that tests can spy on */
  const glowInst = { intensity: 0, addIncludedOnlyMesh: vi.fn(), dispose: vi.fn() }
  // GlowLayer must be a true constructor function (not an arrow fn) so `new GlowLayerCtor()`
  // works inside display-border-glow.ts. vi.fn() wraps a regular function to allow spying.
  const GlowLayerCtor = vi.fn(function GlowLayer() { return glowInst })

  /**
   * Shared clone registry — every StandardMaterial.clone() call pushes here.
   * Tests read from this array to access the cloned material.
   */
  const clones: Array<{ name: string; emissiveColor: InstanceType<typeof FC3>; dispose: ReturnType<typeof vi.fn> }> = []

  /** StandardMaterial stub — instances of this class satisfy instanceof checks */
  class StdMat {
    name: string
    emissiveColor: FC3 = FC3.Black()
    constructor(name: string) { this.name = name }
    clone(cloneName: string): StdMat {
      const c = new StdMat(cloneName)
      clones.push(c)
      return c
    }
    dispose = vi.fn()
  }

  /** PBRMaterial stub */
  class PBRMat {
    name: string
    emissiveColor: FC3 = FC3.Black()
    constructor(name: string) { this.name = name }
    clone(cloneName: string): PBRMat {
      const c = new PBRMat(cloneName)
      clones.push(c)
      return c
    }
    dispose = vi.fn()
  }

  return { FC3, glowInst, GlowLayerCtor, clones, StdMat, PBRMat }
})

const { FC3, glowInst, GlowLayerCtor, clones, StdMat, PBRMat } = hoisted

// Expose QualityTier as a plain object — mirrors the real enum values
const QualityTier = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', ULTRA: 'ultra' } as const

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Color3: hoisted.FC3,
  GlowLayer: hoisted.GlowLayerCtor,
  StandardMaterial: hoisted.StdMat,
  PBRMaterial: hoisted.PBRMat,
}))

vi.mock('../src/game-elements/visual-language', () => ({
  QualityTier: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', ULTRA: 'ultra' },
  PALETTE: {
    CYAN: '#00d9ff',
    PURPLE: '#8800ff',
    GOLD: '#ffd700',
    ALERT: '#ff4400',
    MAGENTA: '#ff00aa',
    MATRIX: '#00ff41',
    WHITE: '#ffffff',
  },
  INTENSITY: {
    AMBIENT: 0.3,
    LOW: 0.4,
    NORMAL: 0.6,
    ACTIVE: 0.8,
    HIGH: 1.0,
    CRITICAL: 1.5,
  },
  emissive(hexColor: string, intensity: number) {
    const base = hoisted.FC3.FromHexString(hexColor)
    return new hoisted.FC3(base.r * intensity, base.g * intensity, base.b * intensity)
  },
}))

// ---------------------------------------------------------------------------
// Import class under test AFTER mocks
// ---------------------------------------------------------------------------

import { BackboxBorderGlow } from '../src/display/display-border-glow'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEFAULT_ACCESSIBILITY: AccessibilityConfig = {
  reducedMotion: false,
  cameraShakeEnabled: true,
  flashFrequencyMax: 2,
  scanlineIntensity: 0.25,
  effectIntensity: 1.0,
  maxCameraShakeIntensity: 0.08,
  hapticsEnabled: true,
  hapticIntensity: 1.0,
}

const REDUCED_MOTION: AccessibilityConfig = {
  ...DEFAULT_ACCESSIBILITY,
  reducedMotion: true,
  flashFrequencyMax: 1,
}

/** Create a mesh whose material is a real instance of the mocked StandardMaterial */
function makeMesh(useMaterial = true) {
  const material = useMaterial ? new StdMat('sourceMat') : null
  return { name: 'cabinetBackbox', material }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackboxBorderGlow', () => {
  beforeEach(() => {
    // Clear clone registry and spy call history between tests
    clones.length = 0
    vi.clearAllMocks()
  })

  // ---- constructor gating ------------------------------------------------

  describe('constructor gating', () => {
    it('does nothing on LOW quality tier — no material cloned', () => {
      const mesh = makeMesh()
      new BackboxBorderGlow(mesh as never, {} as never, QualityTier.LOW, DEFAULT_ACCESSIBILITY)
      expect(clones).toHaveLength(0)
    })

    it('does nothing when backboxMesh is null', () => {
      const glow = new BackboxBorderGlow(null as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      expect(() => glow.update(0.016)).not.toThrow()
      expect(() => glow.dispose()).not.toThrow()
    })

    it('does nothing when mesh has no material', () => {
      const mesh = makeMesh(false)
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      expect(clones).toHaveLength(0)
      expect(() => glow.update(0.016)).not.toThrow()
    })

    it('clones the material on MEDIUM tier and assigns it back to the mesh', () => {
      const mesh = makeMesh()
      new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      expect(clones).toHaveLength(1)
      expect(clones[0].name).toBe('backboxGlowMat')
      // The clone must be assigned back to the mesh so the glow drives the right material
      expect(mesh.material).toBe(clones[0])
    })

    it('does NOT create a GlowLayer on MEDIUM tier', () => {
      const mesh = makeMesh()
      new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      expect(GlowLayerCtor).not.toHaveBeenCalled()
    })

    it('creates a GlowLayer on HIGH tier without reduced motion', () => {
      const mesh = makeMesh()
      new BackboxBorderGlow(mesh as never, { meshes: [] } as never, QualityTier.HIGH, DEFAULT_ACCESSIBILITY)
      expect(GlowLayerCtor).toHaveBeenCalledOnce()
      expect(glowInst.addIncludedOnlyMesh).toHaveBeenCalledWith(mesh)
    })

    it('does NOT create a GlowLayer on HIGH tier when reducedMotion is true', () => {
      const mesh = makeMesh()
      new BackboxBorderGlow(mesh as never, {} as never, QualityTier.HIGH, REDUCED_MOTION)
      expect(GlowLayerCtor).not.toHaveBeenCalled()
    })
  })

  // ---- onDisplaySet --------------------------------------------------------

  describe('onDisplaySet()', () => {
    it('sets a non-black emissive for REACH after lerping for ~1 s', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      glow.onDisplaySet(DisplayState.REACH)
      for (let i = 0; i < 60; i++) glow.update(0.016)
      const em = clones[0].emissiveColor as InstanceType<typeof FC3>
      expect(em.r + em.g + em.b).toBeGreaterThan(0)
    })

    it('FEVER produces higher total emissive than IDLE', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)

      glow.onDisplaySet(DisplayState.IDLE)
      for (let i = 0; i < 60; i++) glow.update(0.016)
      const idleSum = (() => {
        const em = clones[0].emissiveColor as InstanceType<typeof FC3>
        return em.r + em.g + em.b
      })()

      glow.onDisplaySet(DisplayState.FEVER)
      for (let i = 0; i < 60; i++) glow.update(0.016)
      const feverSum = (() => {
        const em = clones[0].emissiveColor as InstanceType<typeof FC3>
        return em.r + em.g + em.b
      })()

      expect(feverSum).toBeGreaterThan(idleSum)
    })

    it('JACKPOT activates strobe — first update frame produces white', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      glow.onDisplaySet(DisplayState.JACKPOT)
      glow.update(0.001)   // tiny dt — stays within first strobe half-cycle
      const em = clones[0].emissiveColor as InstanceType<typeof FC3>
      expect(em.r).toBe(1)
      expect(em.g).toBe(1)
      expect(em.b).toBe(1)
    })

    it('JACKPOT strobe resolves to a non-black settle color', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      glow.onDisplaySet(DisplayState.JACKPOT)
      // 6 phases × 0.25 s half-period = 1.5 s total strobe, plus extra lerp time
      for (let i = 0; i < 200; i++) glow.update(0.016)
      const em = clones[0].emissiveColor as InstanceType<typeof FC3>
      // Cyan settle: green + blue component should be significant
      expect(em.g + em.b).toBeGreaterThan(0)
    })

    it('reducedMotion suppresses JACKPOT strobe — no immediate white flash', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, REDUCED_MOTION)
      glow.onDisplaySet(DisplayState.JACKPOT)
      glow.update(0.001)
      const em = clones[0].emissiveColor as InstanceType<typeof FC3>
      // Without strobe the color is still lerping from black — should not be (1,1,1)
      expect(em.r).not.toBe(1)
    })

    it('ADVENTURE state sets a non-black emissive after lerping', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      glow.onDisplaySet(DisplayState.ADVENTURE)
      for (let i = 0; i < 60; i++) glow.update(0.016)
      const em = clones[0].emissiveColor as InstanceType<typeof FC3>
      expect(em.r + em.g + em.b).toBeGreaterThan(0)
    })

    it('handles an unknown state string gracefully', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      expect(() => glow.onDisplaySet('unknown_state' as DisplayState)).not.toThrow()
    })
  })

  // ---- update() -----------------------------------------------------------

  describe('update()', () => {
    it('lerps emissiveColor closer to target on each frame', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      glow.onDisplaySet(DisplayState.ADVENTURE)
      glow.update(0.001)
      const early = (clones[0].emissiveColor as InstanceType<typeof FC3>).r
      glow.update(0.5)
      const later = (clones[0].emissiveColor as InstanceType<typeof FC3>).r
      // After a larger dt the channel should be at least as close to target
      expect(Math.abs(later)).toBeGreaterThanOrEqual(Math.abs(early))
    })

    it('is a no-op when LOW tier (no owned material)', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.LOW, DEFAULT_ACCESSIBILITY)
      expect(() => glow.update(1)).not.toThrow()
    })
  })

  // ---- dispose() ----------------------------------------------------------

  describe('dispose()', () => {
    it('calls dispose on the cloned material', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      const clonedMat = clones[0]
      glow.dispose()
      expect(clonedMat.dispose).toHaveBeenCalled()
    })

    it('disposes the GlowLayer on HIGH tier', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, { meshes: [] } as never, QualityTier.HIGH, DEFAULT_ACCESSIBILITY)
      glow.dispose()
      expect(glowInst.dispose).toHaveBeenCalled()
    })

    it('is safe to call twice without throwing', () => {
      const mesh = makeMesh()
      const glow = new BackboxBorderGlow(mesh as never, {} as never, QualityTier.MEDIUM, DEFAULT_ACCESSIBILITY)
      glow.dispose()
      expect(() => glow.dispose()).not.toThrow()
    })
  })
})
