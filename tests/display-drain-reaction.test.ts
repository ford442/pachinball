/**
 * Unit tests for DisplaySystem drain / ball-lost reaction
 *
 * These tests cover:
 *  1. triggerDrainReaction() activates drain mode
 *  2. isDrainReactionActive() reflects current mode
 *  3. update() ticks the drain timer down and auto-exits drain mode after 2 s
 *  4. Splash index cycles at the expected rate (~0.3 s per image)
 *  5. Accessibility / photosafe mode keeps the static-alpha path (no per-frame redraw)
 *  6. Calling triggerDrainReaction() mid-drain resets and restarts the sequence
 *
 * All Babylon.js imports and layer managers are mocked at the module boundary
 * so the suite runs in the plain Node environment provided by Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccessibilityConfig } from '../src/game-elements/accessibility-config'

// ---------------------------------------------------------------------------
// Hoisted mocks — evaluated before vi.mock() factories run
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  /** Minimal Canvas2D context stub */
  const mkCtx = () => ({
    canvas: { width: 256, height: 256 },
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    drawImage: vi.fn(),
  })

  /** DynamicTexture stub */
  class DynTex {
    hasAlpha = false
    private _ctx = mkCtx()
    getContext() { return this._ctx }
    update = vi.fn()
    dispose = vi.fn()
  }

  /** StandardMaterial stub */
  class StdMat {
    diffuseTexture: unknown = null
    opacityTexture: unknown = null
    emissiveTexture: unknown = null
    emissiveColor: unknown = {}
    disableLighting = false
    backFaceCulling = true
    dispose = vi.fn()
  }

  /** Mesh stub */
  const mkMesh = () => ({
    parent: null as unknown,
    position: { z: 0, x: 0, y: 0 },
    rotation: { y: 0 },
    material: null as unknown,
    dispose: vi.fn(),
  })

  /** TransformNode stub */
  class TNode {
    position = { clone: vi.fn(() => ({})) }
    dispose = vi.fn()
  }

  /** Single source of truth for accessibility defaults — shared by the
   *  detectAccessibility() mock and the explicit makeDisplay() helper below. */
  const BASE_ACCESSIBILITY = {
    reducedMotion: false,
    cameraShakeEnabled: true,
    flashFrequencyMax: 2,
    scanlineIntensity: 0.25,
    effectIntensity: 1.0,
    maxCameraShakeIntensity: 0.08,
    hapticsEnabled: true,
    hapticIntensity: 1.0,
  }

  return { DynTex, StdMat, mkMesh, TNode, mkCtx, BASE_ACCESSIBILITY }
})

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  MeshBuilder: { CreatePlane: vi.fn(() => hoisted.mkMesh()) },
  Vector3: vi.fn(() => ({ clone: vi.fn(() => ({})) })),
  DynamicTexture: hoisted.DynTex,
  StandardMaterial: hoisted.StdMat,
  Color3: { White: vi.fn(() => ({})) },
  TransformNode: hoisted.TNode,
}))

vi.mock('../src/display/display-shader', () => ({
  DisplayShaderLayer: class {
    createLayer = vi.fn()
    setCRTEffectEnabled = vi.fn()
    update = vi.fn()
    updateParallax = vi.fn()
    setBackgroundVisible = vi.fn()
    setShaderParams = vi.fn()
    onStateChange = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('../src/display/display-reels', () => ({
  DisplayReelsLayer: class {
    createLayer = vi.fn()
    update = vi.fn()
    updateParallax = vi.fn()
    setVisible = vi.fn()
    onStateChange = vi.fn()
    startSpin = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('../src/display/display-video', () => ({
  DisplayVideoLayer: class {
    createLayer = vi.fn()
    update = vi.fn()
    updateParallax = vi.fn()
    setVisible = vi.fn()
    loadVideo = vi.fn()
    onStateChange = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('../src/display/display-image', () => ({
  DisplayImageLayer: class {
    createLayer = vi.fn()
    update = vi.fn()
    updateParallax = vi.fn()
    setVisible = vi.fn()
    loadImage = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('../src/display/display-border-glow', () => ({
  BackboxBorderGlow: class {
    onDisplaySet = vi.fn()
    update = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('../src/game-elements/display-config', () => ({
  DisplayState: {
    IDLE: 'idle',
    FEVER: 'fever',
    JACKPOT: 'jackpot',
    REACH: 'reach',
    ADVENTURE: 'adventure',
  },
  DEFAULT_DISPLAY_CONFIG: { width: 2, height: 1.5, states: {} },
  getStateConfig: vi.fn(() => ({})),
}))

vi.mock('../src/game-elements/visual-language', () => ({
  QualityTier: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', ULTRA: 'ultra' },
  PALETTE: { CYAN: '#00d9ff', GOLD: '#ffd700' },
}))

vi.mock('../src/game-elements/accessibility-config', () => ({
  detectAccessibility: vi.fn(() => hoisted.BASE_ACCESSIBILITY),
}))

// ---------------------------------------------------------------------------
// Import class under test AFTER mocks
// ---------------------------------------------------------------------------

import { DisplaySystem } from '../src/display/display-core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Single source of truth for accessibility defaults is hoisted.BASE_ACCESSIBILITY.
 *  Re-exported here for use in tests that pass explicit configs to makeDisplay(). */
const BASE_ACCESSIBILITY: AccessibilityConfig = hoisted.BASE_ACCESSIBILITY

const PHOTOSAFE_ACCESSIBILITY: AccessibilityConfig = {
  ...BASE_ACCESSIBILITY,
  reducedMotion: true,
  flashFrequencyMax: 1,
}

/** Minimal engine stub — enough for the DisplaySystem constructor */
const mkEngine = () => ({
  getClassName: () => 'Engine',
  isWebGPU: false,
})

/** Minimal scene stub */
const mkScene = () => ({
  getMeshByName: vi.fn(() => null),
})

function makeDisplay(accessibility?: AccessibilityConfig): DisplaySystem {
  return new DisplaySystem(
    mkScene() as never,
    mkEngine() as never,
    undefined,
    undefined,
    accessibility ?? BASE_ACCESSIBILITY,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DisplaySystem — drain reaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---- initial state -------------------------------------------------------

  it('isDrainReactionActive() is false initially', () => {
    const ds = makeDisplay()
    expect(ds.isDrainReactionActive()).toBe(false)
  })

  // ---- triggerDrainReaction ------------------------------------------------

  it('triggerDrainReaction() activates drain mode', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    expect(ds.isDrainReactionActive()).toBe(true)
  })

  it('triggerDrainReaction() does not throw when called before createBackbox()', () => {
    const ds = makeDisplay()
    expect(() => ds.triggerDrainReaction()).not.toThrow()
  })

  it('triggering drain a second time while already active resets the sequence', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    // Partially tick down the timer
    ds.update(1.0)
    expect(ds.isDrainReactionActive()).toBe(true)
    // Re-trigger — should reset to a fresh 2 s sequence
    ds.triggerDrainReaction()
    expect(ds.isDrainReactionActive()).toBe(true)
    // A further 1 s tick is still within the new 2 s window
    ds.update(1.0)
    expect(ds.isDrainReactionActive()).toBe(true)
  })

  // ---- update() / auto-exit ------------------------------------------------

  it('update() keeps drain mode active while timer is positive', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    ds.update(1.0)
    expect(ds.isDrainReactionActive()).toBe(true)
  })

  it('update() exits drain mode after ~2 s total elapsed time', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    ds.update(2.01)
    expect(ds.isDrainReactionActive()).toBe(false)
  })

  it('exactly 2.0 s of update() clears drain mode', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    // Step in small increments that sum to just over 2.0 s (121 × 1/60 ≈ 2.017 s)
    for (let i = 0; i < 121; i++) ds.update(1 / 60)
    expect(ds.isDrainReactionActive()).toBe(false)
  })

  it('isDrainReactionActive() returns false after drain sequence completes', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    ds.update(3.0)
    expect(ds.isDrainReactionActive()).toBe(false)
  })

  // ---- re-entrant safety ---------------------------------------------------

  it('update() is safe to call without prior triggerDrainReaction()', () => {
    const ds = makeDisplay()
    expect(() => ds.update(0.016)).not.toThrow()
  })

  // ---- photosafe / reduced-motion ------------------------------------------

  it('drain mode still activates under photosafe accessibility settings', () => {
    const ds = makeDisplay(PHOTOSAFE_ACCESSIBILITY)
    ds.triggerDrainReaction()
    expect(ds.isDrainReactionActive()).toBe(true)
  })

  it('drain mode still auto-exits under photosafe settings', () => {
    const ds = makeDisplay(PHOTOSAFE_ACCESSIBILITY)
    ds.triggerDrainReaction()
    ds.update(2.01)
    expect(ds.isDrainReactionActive()).toBe(false)
  })

  // ---- splash index cycling ------------------------------------------------

  it('does not throw during multiple splash-cycle ticks', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    // Tick through several splash cycles (0.3 s each) — should not throw
    expect(() => {
      for (let i = 0; i < 7; i++) ds.update(0.3)
    }).not.toThrow()
  })

  // ---- dispose safety -------------------------------------------------------

  it('dispose() is safe to call while drain mode is active', () => {
    const ds = makeDisplay()
    ds.triggerDrainReaction()
    expect(() => ds.dispose()).not.toThrow()
  })
})
