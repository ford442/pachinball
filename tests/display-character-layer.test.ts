/**
 * Nexus character plane (DisplayCharacterLayer) composited over the backbox
 * video / image stack.
 *
 *  - A set characterLayer does not steal videoPath / imagePath.
 *  - The LCD walk-by is suppressed only once the take has loaded; a failed
 *    load leaves it running.
 *  - Photosensitive mode holds a steady alpha through REACH / JACKPOT.
 *  - Reduced motion skips the walk-on and holds a video take on a still.
 *
 * Babylon is mocked at the module boundary; the other display layers are spies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccessibilityConfig } from '../src/game-elements/accessibility-config'

const hoisted = vi.hoisted(() => {
  interface TexRecord {
    url: string
    onLoad?: () => void
    onError?: () => void
    disposed: boolean
  }
  const textures: TexRecord[] = []

  class Tex {
    static TRILINEAR_SAMPLINGMODE = 3
    hasAlpha = false
    record: TexRecord
    constructor(
      url: string,
      _scene: unknown,
      _noMip?: boolean,
      _invertY?: boolean,
      _sampling?: number,
      onLoad?: () => void,
      onError?: () => void,
    ) {
      this.record = { url, onLoad, onError, disposed: false }
      textures.push(this.record)
    }
    dispose() {
      this.record.disposed = true
    }
  }
  class VideoTex {
    dispose = vi.fn()
  }
  class StdMat {
    alpha = 1
    diffuseTexture: unknown = null
    useAlphaFromDiffuseTexture = false
    emissiveColor: unknown = {}
    disableLighting = false
    backFaceCulling = true
    dispose = vi.fn()
  }
  const mkMesh = () => ({
    parent: null as unknown,
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0 },
    material: null as unknown,
    isVisible: true,
    isPickable: true,
    dispose: vi.fn(),
  })
  class TNode {
    position = { clone: vi.fn(() => ({})) }
    dispose = vi.fn()
  }

  const calls = {
    loadVideo: vi.fn(),
    loadImage: vi.fn(),
    setCharacterTakeActive: vi.fn(),
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

  const layerStub = () =>
    class {
      createLayer = vi.fn()
      update = vi.fn()
      updateParallax = vi.fn()
      setVisible = vi.fn()
      setOpacity = vi.fn()
      setBackgroundVisible = vi.fn()
      setShaderParams = vi.fn()
      setCRTEffectEnabled = vi.fn()
      setAccessibilityScanlineFactor = vi.fn()
      onStateChange = vi.fn()
      startSpin = vi.fn()
      dispose = vi.fn()
    }

  return { layerStub, Tex, VideoTex, StdMat, mkMesh, TNode, textures, calls, BASE_ACCESSIBILITY }
})

vi.mock('@babylonjs/core', () => ({
  MeshBuilder: { CreatePlane: vi.fn(() => hoisted.mkMesh()) },
  Vector3: vi.fn(() => ({ clone: vi.fn(() => ({})) })),
  Texture: hoisted.Tex,
  VideoTexture: hoisted.VideoTex,
  StandardMaterial: hoisted.StdMat,
  Color3: { White: vi.fn(() => ({})) },
  TransformNode: hoisted.TNode,
}))

vi.mock('../src/display/display-shader', () => ({ DisplayShaderLayer: hoisted.layerStub() }))
vi.mock('../src/display/display-reels', () => ({ DisplayReelsLayer: hoisted.layerStub() }))
vi.mock('../src/display/display-physical', () => ({ DisplayPhysicalLayer: hoisted.layerStub() }))
vi.mock('../src/display/display-video', () => ({
  DisplayVideoLayer: class extends hoisted.layerStub() {
    loadVideo = hoisted.calls.loadVideo
  },
}))
vi.mock('../src/display/display-image', () => ({
  DisplayImageLayer: class extends hoisted.layerStub() {
    loadImage = hoisted.calls.loadImage
  },
}))
vi.mock('../src/display/display-lcd-overlay', () => ({
  DisplayLcdOverlayLayer: class extends hoisted.layerStub() {
    setAccessibility = vi.fn()
    setDisplayOverlay = vi.fn()
    setTrackTheme = vi.fn()
    setBlend = vi.fn()
    setCharacterTakeActive = hoisted.calls.setCharacterTakeActive
  },
}))
vi.mock('../src/display/display-state-machine', () => ({
  DisplayStateMachine: class {
    requestState = vi.fn(() => true)
    update = vi.fn(() => ({ blend: 1 }))
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

import { DisplaySystem } from '../src/display/display-core'
import { DisplayMode, DisplayState, type DisplayConfig } from '../src/display/display-types'
import { CHARACTER_WALK_ON_S, classifyCharacterTake } from '../src/display/display-character'

const ATTRACT = 'backbox/attract.mp4'
const ATTRACT_IMG = 'backbox/attract.png'
const IDLE_TAKE = 'backbox/nexus/idle.png'
const REACH_TAKE = 'backbox/nexus/reach.png'

function makeConfig(): Partial<DisplayConfig> {
  return {
    mode: DisplayMode.HYBRID,
    width: 20,
    height: 12,
    defaultMedia: { videoPath: ATTRACT, imagePath: ATTRACT_IMG, characterLayer: IDLE_TAKE },
    stateMedia: {
      [DisplayState.REACH]: { characterLayer: REACH_TAKE },
      [DisplayState.JACKPOT]: { characterLayer: REACH_TAKE },
    },
  }
}

function makeDisplay(accessibility: AccessibilityConfig = hoisted.BASE_ACCESSIBILITY): DisplaySystem {
  const scene = { getMeshByName: vi.fn(() => null) }
  const engine = { getClassName: () => 'Engine', isWebGPU: false }
  const display = new DisplaySystem(scene as never, engine as never, makeConfig(), undefined, accessibility)
  display.createBackbox({ clone: () => ({}) } as never)
  return display
}

const lastTexture = () => hoisted.textures[hoisted.textures.length - 1]

beforeEach(() => {
  hoisted.textures.length = 0
  hoisted.calls.loadVideo.mockClear()
  hoisted.calls.loadImage.mockClear()
  hoisted.calls.setCharacterTakeActive.mockClear()
})

describe('classifyCharacterTake', () => {
  it('splits posters from loops and rejects unknown extensions', () => {
    expect(classifyCharacterTake('a/idle.png')).toBe('image')
    expect(classifyCharacterTake('a/idle.webp?v=2')).toBe('image')
    expect(classifyCharacterTake('a/idle.webm')).toBe('video')
    expect(classifyCharacterTake('a/idle.mp4')).toBe('video')
    expect(classifyCharacterTake('')).toBeNull()
    expect(classifyCharacterTake('a/idle.gif')).toBeNull()
  })
})

describe('DisplaySystem character plane', () => {
  it('a set characterLayer leaves videoPath and imagePath on their own layers', async () => {
    const display = makeDisplay()
    display.setDisplayState(DisplayState.IDLE)
    await vi.dynamicImportSettled()

    expect(hoisted.calls.loadVideo).toHaveBeenCalledWith(ATTRACT)
    expect(hoisted.calls.loadImage).toHaveBeenCalledWith(ATTRACT_IMG, expect.any(Number))
    expect(hoisted.calls.loadVideo).not.toHaveBeenCalledWith(IDLE_TAKE)
    expect(hoisted.calls.loadImage).not.toHaveBeenCalledWith(IDLE_TAKE, expect.anything())
    expect(lastTexture()?.url).toBe(IDLE_TAKE)
  })

  it('suppresses the LCD walk-by only after the take loads', async () => {
    const display = makeDisplay()
    display.setDisplayState(DisplayState.IDLE)
    await vi.dynamicImportSettled()
    expect(hoisted.calls.setCharacterTakeActive).not.toHaveBeenCalledWith(true)
    expect(display.getCharacterTakeState()).toEqual({ url: IDLE_TAKE, active: false })

    lastTexture()?.onLoad?.()
    expect(hoisted.calls.setCharacterTakeActive).toHaveBeenLastCalledWith(true)
    expect(display.getCharacterTakeState().active).toBe(true)
  })

  it('a missing file keeps the LCD walk-by', async () => {
    const display = makeDisplay()
    display.setDisplayState(DisplayState.IDLE)
    await vi.dynamicImportSettled()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    lastTexture()?.onError?.()
    expect(hoisted.calls.setCharacterTakeActive).not.toHaveBeenCalledWith(true)
    expect(display.getCharacterTakeState().active).toBe(false)
  })

  it('a take that loads after the state moved on is ignored', async () => {
    const display = makeDisplay()
    display.setDisplayState(DisplayState.IDLE)
    await vi.dynamicImportSettled()
    const idle = lastTexture()
    display.setDisplayState(DisplayState.REACH)
    idle?.onLoad?.()
    expect(idle?.disposed).toBe(true)
    expect(display.getCharacterTakeState()).toEqual({ url: REACH_TAKE, active: false })
  })

  it('walks on over CHARACTER_WALK_ON_S, then rests at full alpha', async () => {
    const display = makeDisplay()
    display.setDisplayState(DisplayState.IDLE)
    await vi.dynamicImportSettled()
    lastTexture()?.onLoad?.()
    const state = display as unknown as { characterLayer: { getAlpha(): number } }
    expect(state.characterLayer.getAlpha()).toBe(0)
    display.update(CHARACTER_WALK_ON_S / 2)
    const mid = state.characterLayer.getAlpha()
    expect(mid).toBeGreaterThan(0)
    display.update(CHARACTER_WALK_ON_S)
    expect(state.characterLayer.getAlpha()).toBeGreaterThan(mid)
  })

  it('reduced motion cuts the walk-on to a still', async () => {
    const display = makeDisplay({ ...hoisted.BASE_ACCESSIBILITY, reducedMotion: true })
    display.setDisplayState(DisplayState.IDLE)
    await vi.dynamicImportSettled()
    lastTexture()?.onLoad?.()
    const layer = (display as unknown as { characterLayer: { getAlpha(): number } }).characterLayer
    expect(layer.getAlpha()).toBeCloseTo(0.95)
  })

  it('photosensitive mode holds a steady alpha through REACH and JACKPOT', async () => {
    const sample = async (accessibility: AccessibilityConfig, state: DisplayState): Promise<number[]> => {
      const display = makeDisplay(accessibility)
      display.setDisplayState(state)
      await vi.dynamicImportSettled()
      lastTexture()?.onLoad?.()
      display.update(CHARACTER_WALK_ON_S * 2)
      const layer = (display as unknown as { characterLayer: { getAlpha(): number } }).characterLayer
      const out: number[] = []
      for (let i = 0; i < 20; i++) {
        display.update(0.037)
        out.push(layer.getAlpha())
      }
      return out
    }
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)

    for (const state of [DisplayState.REACH, DisplayState.JACKPOT]) {
      expect(spread(await sample(hoisted.BASE_ACCESSIBILITY, state))).toBeGreaterThan(0.05)
      expect(spread(await sample({ ...hoisted.BASE_ACCESSIBILITY, flashFrequencyMax: 1 }, state))).toBe(0)
    }
  })
})
