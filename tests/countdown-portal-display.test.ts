/**
 * Unit tests for:
 *   - TIMER_COLORS visual-language tokens
 *   - DisplayState.PORTAL_OPEN / DisplayState.ESCAPE enum values
 *   - DEFAULT_DISPLAY_CONFIG stateMedia entries for portal states
 *   - DisplaySystem.setDisplayState behaviour for portal/escape states
 *
 * Babylon.js layer managers are mocked at module boundary so the suite runs
 * in the plain Node environment provided by Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted stubs (mirror the pattern in display-drain-reaction.test.ts)
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
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

  class DynTex {
    hasAlpha = false
    private _ctx = mkCtx()
    getContext() { return this._ctx }
    update = vi.fn()
    dispose = vi.fn()
  }

  class StdMat {
    diffuseTexture: unknown = null
    opacityTexture: unknown = null
    emissiveTexture: unknown = null
    emissiveColor: unknown = {}
    disableLighting = false
    backFaceCulling = true
    dispose = vi.fn()
  }

  const mkMesh = () => ({
    parent: null as unknown,
    position: { z: 0, x: 0, y: 0 },
    rotation: { y: 0 },
    material: null as unknown,
    dispose: vi.fn(),
  })

  class TNode {
    position = { clone: vi.fn(() => ({})) }
    dispose = vi.fn()
  }

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

  return { DynTex, StdMat, mkMesh, TNode, BASE_ACCESSIBILITY }
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

vi.mock('../src/game-elements/accessibility-config', () => ({
  detectAccessibility: vi.fn(() => hoisted.BASE_ACCESSIBILITY),
}))

// ---------------------------------------------------------------------------
// Imports under test — after mocks
// ---------------------------------------------------------------------------

import { TIMER_COLORS } from '../src/game-elements/visual-language'
import { DisplayState, DEFAULT_DISPLAY_CONFIG, getStateConfig } from '../src/game-elements/display-config'
import { DisplaySystem } from '../src/display/display-core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkEngine = () => ({ getClassName: () => 'Engine', isWebGPU: false })
const mkScene = () => ({ getMeshByName: vi.fn(() => null) })

function makeDisplay(): DisplaySystem {
  return new DisplaySystem(
    mkScene() as never,
    mkEngine() as never,
    undefined,
    undefined,
    hoisted.BASE_ACCESSIBILITY,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TIMER_COLORS visual-language tokens', () => {
  it('exports a SAFE color string', () => {
    expect(typeof TIMER_COLORS.SAFE).toBe('string')
    expect(TIMER_COLORS.SAFE).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('exports a CAUTION color string', () => {
    expect(typeof TIMER_COLORS.CAUTION).toBe('string')
    expect(TIMER_COLORS.CAUTION).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('exports a WARNING color string', () => {
    expect(typeof TIMER_COLORS.WARNING).toBe('string')
    expect(TIMER_COLORS.WARNING).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('exports a DANGER color string', () => {
    expect(typeof TIMER_COLORS.DANGER).toBe('string')
    expect(TIMER_COLORS.DANGER).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('exports a PORTAL color string', () => {
    expect(typeof TIMER_COLORS.PORTAL).toBe('string')
    expect(TIMER_COLORS.PORTAL).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('exports an ESCAPE color string', () => {
    expect(typeof TIMER_COLORS.ESCAPE).toBe('string')
    expect(TIMER_COLORS.ESCAPE).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('SAFE is visually "green" (green channel dominant over both red and blue)', () => {
    // #00ff88 → R=0, G=255, B=136
    const hex = TIMER_COLORS.SAFE.slice(1)
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('DANGER is visually "red" (red channel dominant)', () => {
    const hex = TIMER_COLORS.DANGER.slice(1)
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    expect(r).toBeGreaterThan(g)
  })
})

describe('DisplayState — portal and escape values', () => {
  it('has PORTAL_OPEN state', () => {
    expect(DisplayState.PORTAL_OPEN).toBe('portal_open')
  })

  it('has ESCAPE state', () => {
    expect(DisplayState.ESCAPE).toBe('escape')
  })

  it('still has all original states', () => {
    expect(DisplayState.IDLE).toBe('idle')
    expect(DisplayState.REACH).toBe('reach')
    expect(DisplayState.FEVER).toBe('fever')
    expect(DisplayState.JACKPOT).toBe('jackpot')
    expect(DisplayState.ADVENTURE).toBe('adventure')
  })
})

describe('DEFAULT_DISPLAY_CONFIG — portal/escape stateMedia', () => {
  it('defines stateMedia entry for PORTAL_OPEN', () => {
    const media = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.PORTAL_OPEN]
    expect(media).toBeDefined()
  })

  it('PORTAL_OPEN has showReels = false (no reel distraction during portal)', () => {
    const media = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.PORTAL_OPEN]
    expect(media?.showReels).toBe(false)
  })

  it('PORTAL_OPEN shaderParams color is cyan-ish', () => {
    const color = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.PORTAL_OPEN]?.shaderParams?.color ?? ''
    // Accept any hex that has a strong blue or cyan channel
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
    const hex = color.slice(1)
    const b = parseInt(hex.slice(4, 6), 16)
    expect(b).toBeGreaterThan(100) // cyan has a strong blue channel
  })

  it('defines stateMedia entry for ESCAPE', () => {
    const media = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.ESCAPE]
    expect(media).toBeDefined()
  })

  it('ESCAPE has showReels = false', () => {
    const media = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.ESCAPE]
    expect(media?.showReels).toBe(false)
  })

  it('ESCAPE shaderParams color is red-ish (urgent)', () => {
    const color = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.ESCAPE]?.shaderParams?.color ?? ''
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
    const hex = color.slice(1)
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    expect(r).toBeGreaterThan(g) // red channel dominates for urgency
  })

  it('PORTAL_OPEN speed is faster than ADVENTURE (wormhole urgency)', () => {
    const portalSpeed = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.PORTAL_OPEN]?.shaderParams?.speed ?? 0
    const adventureSpeed = DEFAULT_DISPLAY_CONFIG.stateMedia?.[DisplayState.ADVENTURE]?.shaderParams?.speed ?? 0
    expect(portalSpeed).toBeGreaterThan(adventureSpeed)
  })
})

describe('getStateConfig — portal/escape state configs', () => {
  it('returns a config for PORTAL_OPEN without throwing', () => {
    expect(() => getStateConfig(DEFAULT_DISPLAY_CONFIG, DisplayState.PORTAL_OPEN)).not.toThrow()
  })

  it('returns a config for ESCAPE without throwing', () => {
    expect(() => getStateConfig(DEFAULT_DISPLAY_CONFIG, DisplayState.ESCAPE)).not.toThrow()
  })
})

describe('DisplaySystem — setDisplayState with portal states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getDisplayState() starts as IDLE', () => {
    const ds = makeDisplay()
    expect(ds.getDisplayState()).toBe(DisplayState.IDLE)
  })

  it('setDisplayState(PORTAL_OPEN) changes state to portal_open', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.PORTAL_OPEN)
    expect(ds.getDisplayState()).toBe('portal_open')
  })

  it('setDisplayState(ESCAPE) changes state to escape', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.ESCAPE)
    expect(ds.getDisplayState()).toBe('escape')
  })

  it('calling setDisplayState with the same state is a no-op (no re-apply)', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.PORTAL_OPEN)
    ds.setDisplayState(DisplayState.PORTAL_OPEN) // second call should be ignored
    expect(ds.getDisplayState()).toBe('portal_open')
  })

  it('ESCAPE state can transition back to IDLE', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.ESCAPE)
    ds.setDisplayState(DisplayState.IDLE)
    expect(ds.getDisplayState()).toBe('idle')
  })
})
