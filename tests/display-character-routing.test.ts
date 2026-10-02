/**
 * DisplaySystem character-take routing: the emoji walk-by is suppressed only
 * after the poster loads, a failed poster restores the state media, and stale
 * callbacks from an earlier state are ignored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ImageOpts { hasAlpha?: boolean; onLoad?: () => void; onError?: () => void }
interface VideoOpts { onReady?: () => void; onError?: () => void }

const reg = vi.hoisted(() => ({
  image: null as null | { loadImage: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn>; setTint: ReturnType<typeof vi.fn> },
  shader: null as null | { setShaderParams: ReturnType<typeof vi.fn> },
  video: null as null | { loadVideo: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn> },
  lcd: null as null | { setCharacterTakeActive: ReturnType<typeof vi.fn> },
}))

const layer = () => ({
  createLayer: vi.fn(),
  update: vi.fn(),
  updateParallax: vi.fn(),
  setVisible: vi.fn(),
  setOpacity: vi.fn(),
  onStateChange: vi.fn(),
  dispose: vi.fn(),
})

vi.mock('../src/display/display-shader', () => ({
  DisplayShaderLayer: class {
    constructor() {
      Object.assign(this, layer(), {
        setCRTEffectEnabled: vi.fn(),
        setBackgroundVisible: vi.fn(),
        setShaderParams: vi.fn(),
        setAccessibilityScanlineFactor: vi.fn(),
      })
      reg.shader = this as never
    }
  },
}))
vi.mock('../src/display/display-reels', () => ({
  DisplayReelsLayer: class { constructor() { Object.assign(this, layer(), { startSpin: vi.fn() }) } },
}))
vi.mock('../src/display/display-physical', () => ({
  DisplayPhysicalLayer: class { constructor() { Object.assign(this, layer()) } },
}))
vi.mock('../src/display/display-video', () => ({
  DisplayVideoLayer: class {
    constructor() {
      Object.assign(this, layer(), { loadVideo: vi.fn() })
      reg.video = this as never
    }
  },
}))
vi.mock('../src/display/display-image', () => ({
  DisplayImageLayer: class {
    constructor() {
      Object.assign(this, layer(), { loadImage: vi.fn(() => 1), setTint: vi.fn() })
      reg.image = this as never
    }
  },
}))
vi.mock('../src/display/display-lcd-overlay', () => ({
  DisplayLcdOverlayLayer: class {
    constructor() {
      Object.assign(this, layer(), {
        setAccessibility: vi.fn(),
        setDisplayOverlay: vi.fn(),
        setTrackTheme: vi.fn(),
        setBlend: vi.fn(),
        setCharacterTakeActive: vi.fn(),
      })
      reg.lcd = this as never
    }
  },
}))
vi.mock('../src/display/display-border-glow', () => ({
  BackboxBorderGlow: class { onDisplaySet = vi.fn(); update = vi.fn(); dispose = vi.fn() },
}))

import { DisplaySystem } from '../src/display/display-core'
import { DisplayState, adaptLegacyConfig } from '../src/game-elements/display-config'
import { QualityTier } from '../src/game-elements/visual-language'
import type { AccessibilityConfig } from '../src/game-elements/accessibility-config'

const A11Y: AccessibilityConfig = {
  reducedMotion: false,
  cameraShakeEnabled: true,
  flashFrequencyMax: 2,
  scanlineIntensity: 0.25,
  effectIntensity: 1,
  maxCameraShakeIntensity: 0.08,
  hapticsEnabled: true,
  hapticIntensity: 1,
} as AccessibilityConfig

const CONFIG = adaptLegacyConfig({
  attractVideoPath: '/backbox/attract.mp4',
  attractImagePath: '/backbox/attract.png',
  videoReplacesReels: true,
  reachVideoPath: '/backbox/reach.mp4',
  reachImagePath: '/backbox/reach.png',
  idleCharacterPath: '/backbox/nexus/idle.png',
  idleCharacterLoopPath: '/backbox/nexus/idle.webm',
  reachCharacterPath: '/backbox/nexus/reach.png',
})

function makeDisplay(a11y: AccessibilityConfig = A11Y): DisplaySystem {
  return new DisplaySystem(
    { getMeshByName: vi.fn(() => null) } as never,
    { getClassName: () => 'Engine', isWebGPU: false } as never,
    CONFIG,
    QualityTier.HIGH,
    a11y,
  )
}

const lastImage = () => reg.image!.loadImage.mock.calls.at(-1) as [string, ImageOpts]
const lastVideo = () => reg.video!.loadVideo.mock.calls.at(-1) as [string, VideoOpts?]
const takeCalls = () => reg.lcd!.setCharacterTakeActive.mock.calls.map((c) => c[0])

describe('DisplaySystem character take routing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('REACH loads the alpha poster, skips the state video, and suppresses the walk-by only on load', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.REACH)
    const [url, opts] = lastImage()
    expect(url).toBe('/backbox/nexus/reach.png')
    expect(opts.hasAlpha).toBe(true)
    expect(reg.video!.loadVideo).not.toHaveBeenCalled()
    expect(takeCalls()).toEqual([false])
    expect(ds.getCharacterTakeStatus()).toEqual({ poster: 'loading', loop: 'none', takeActive: false })

    opts.onLoad!()
    expect(takeCalls()).toEqual([false, true])
    expect(ds.getCharacterTakeStatus().poster).toBe('loaded')
  })

  it('a 404 poster keeps the walk-by and restores the state image and video', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.REACH)
    lastImage()[1].onError!()
    expect(takeCalls()).toEqual([false, false])
    expect(ds.getCharacterTakeStatus()).toMatchObject({ poster: 'failed', takeActive: false })
    expect(lastImage()[0]).toBe('/backbox/reach.png')
    expect(lastVideo()[0]).toBe('/backbox/reach.mp4')
  })

  it('ignores callbacks from a state that has already been left', () => {
    const ds = makeDisplay()
    ds.setDisplayState(DisplayState.REACH)
    const stale = lastImage()[1]
    ds.setDisplayState(DisplayState.ADVENTURE)
    stale.onLoad!()
    expect(takeCalls().at(-1)).toBe(false)
    expect(ds.getCharacterTakeStatus().takeActive).toBe(false)
  })

  it('IDLE plays the loop and hides the poster once the loop is ready', () => {
    const ds = makeDisplay()
    ds.createBackbox({ clone: () => ({}) } as never)
    expect(lastVideo()[0]).toBe('/backbox/nexus/idle.webm')
    expect(lastImage()[0]).toBe('/backbox/nexus/idle.png')
    lastVideo()[1]!.onReady!()
    expect(reg.image!.setVisible).toHaveBeenLastCalledWith(false)
    expect(ds.getCharacterTakeStatus()).toEqual({ poster: 'loading', loop: 'playing', takeActive: true })
  })

  it('a failed IDLE loop falls back to the attract video behind the poster', () => {
    const ds = makeDisplay()
    ds.createBackbox({ clone: () => ({}) } as never)
    lastImage()[1].onLoad!()
    lastVideo()[1]!.onError!()
    expect(lastVideo()[0]).toBe('/backbox/attract.mp4')
    expect(reg.image!.setVisible).toHaveBeenLastCalledWith(true)
    expect(ds.getCharacterTakeStatus()).toEqual({ poster: 'loaded', loop: 'failed', takeActive: true })
  })

  it('reduced motion shows the static poster and never requests the loop', () => {
    const ds = makeDisplay({ ...A11Y, reducedMotion: true })
    ds.createBackbox({ clone: () => ({}) } as never)
    expect(reg.video!.loadVideo.mock.calls.map((c) => c[0])).not.toContain('/backbox/nexus/idle.webm')
    expect(ds.getCharacterTakeStatus().loop).toBe('skipped')
  })

  it('turning on reduced motion mid-loop drops back to the poster', () => {
    const ds = makeDisplay()
    ds.createBackbox({ clone: () => ({}) } as never)
    lastVideo()[1]!.onReady!()
    ds.setAccessibility({ ...A11Y, reducedMotion: true })
    expect(ds.getCharacterTakeStatus().loop).toBe('skipped')
    expect(lastVideo()[0]).toBe('/backbox/attract.mp4')
  })
})

describe('DisplaySystem machine theme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tints the poster and recolours the IDLE grid, and null restores both', () => {
    const ds = makeDisplay()
    ds.setMachineTheme({ primaryHex: '#ff8800', accentHex: '#00ffaa', shaderSpeed: 0.7, characterTint: '#ffe0cc' })
    expect(reg.image!.setTint).toHaveBeenLastCalledWith('#ffe0cc')
    expect(reg.shader!.setShaderParams).toHaveBeenLastCalledWith(expect.objectContaining({ color: '#ff8800', speed: 0.7 }))

    ds.setDisplayState(DisplayState.REACH)
    expect(reg.shader!.setShaderParams).toHaveBeenLastCalledWith(expect.objectContaining({ color: '#ff0055' }))
    ds.setDisplayState(DisplayState.IDLE)
    expect(reg.shader!.setShaderParams).toHaveBeenLastCalledWith(expect.objectContaining({ color: '#ff8800' }))

    ds.setMachineTheme(null)
    expect(reg.image!.setTint).toHaveBeenLastCalledWith(null)
    expect(reg.shader!.setShaderParams).not.toHaveBeenLastCalledWith(expect.objectContaining({ color: '#ff8800' }))
  })
})
