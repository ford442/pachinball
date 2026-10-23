/**
 * The CRT and jackpot passes DisplayShaderLayer hands to the backbox Frame Graph (#461 Slice A).
 * They used to be camera PostProcesses that also shaded the playfield; now they are graph passes
 * on the backbox composite, and this layer owns only when they run and what they bind.
 */

import { describe, it, expect, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const uploads = { count: 0 }
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => (key === 'canvas' ? { width: 256, height: 256 } : vi.fn()),
      set: () => true,
    },
  )
  class DynamicTexture {
    getContext = () => ctx
    update = vi.fn(() => {
      uploads.count++
    })
    dispose = vi.fn()
  }
  class ShaderMaterial {
    setFloat = vi.fn()
    setColor3 = vi.fn()
    dispose = vi.fn()
  }
  const mkMesh = () => ({
    parent: null as unknown,
    position: { z: 0 },
    rotation: { y: 0 },
    material: null as unknown,
    isPickable: true,
    isVisible: true,
    freezeWorldMatrix: vi.fn(),
    dispose: vi.fn(),
  })
  return { uploads, DynamicTexture, ShaderMaterial, mkMesh }
})

vi.mock('@babylonjs/core', () => ({
  Effect: { ShadersStore: {} as Record<string, string> },
  ShaderMaterial: hoisted.ShaderMaterial,
  DynamicTexture: hoisted.DynamicTexture,
  Color3: { FromHexString: () => ({}) },
  MeshBuilder: { CreatePlane: () => hoisted.mkMesh() },
}))

import { DisplayShaderLayer } from '../src/display/display-shader'
import { DisplayState, DEFAULT_DISPLAY_CONFIG } from '../src/display/display-types'
import { crtEffectShader } from '../src/shaders/crt-effect'
import { SCANLINE_UNIFORM } from '../src/shaders/scanline'

function makeEffect() {
  const floats = new Map<string, number>()
  const ints = new Map<string, number>()
  const textures = new Map<string, unknown>()
  return {
    floats,
    ints,
    textures,
    effect: {
      setFloat: (k: string, v: number) => floats.set(k, v),
      setInt: (k: string, v: number) => ints.set(k, v),
      setTexture: (k: string, v: unknown) => textures.set(k, v),
    } as never,
  }
}

function makeLayer() {
  const layer = new DisplayShaderLayer({} as never, DEFAULT_DISPLAY_CONFIG)
  layer.createLayer({} as never)
  return layer
}

describe('DisplayShaderLayer backbox passes', () => {
  it('the CRT shader declares the scanline uniform the pass sets', () => {
    expect(crtEffectShader.fragment).toContain(`uniform float ${SCANLINE_UNIFORM};`)
  })

  it('exposes the grid plane as its layer mesh', () => {
    expect(makeLayer().getMeshes()).toHaveLength(1)
  })

  it('CRT runs only while a system asked for it and the player has scanlines on', () => {
    const layer = makeLayer()
    const crt = layer.getEffectPasses().crt
    expect(crt.isActive()).toBe(false)
    layer.setCRTEffectEnabled(true)
    expect(crt.isActive()).toBe(true)
    layer.setPlayerScanlineEnabled(false)
    expect(crt.isActive()).toBe(false)
    layer.setPlayerScanlineEnabled(true)
    expect(crt.isActive()).toBe(true)

    const { effect, floats } = makeEffect()
    crt.bind(effect)
    expect([...floats.keys()].sort()).toEqual([...crt.uniforms].sort())
  })

  it('the jackpot passes run only in the JACKPOT state, and the still one freezes time', () => {
    const layer = makeLayer()
    const { jackpot, jackpotStill } = layer.getEffectPasses()
    layer.update(0.016, DisplayState.IDLE, 0)
    expect(jackpot.isActive()).toBe(false)

    layer.update(0.5, DisplayState.JACKPOT, 2)
    expect(jackpot.isActive()).toBe(true)
    expect(jackpotStill.isActive()).toBe(true)

    const animated = makeEffect()
    jackpot.bind(animated.effect)
    expect(animated.floats.get('uTime')).toBeGreaterThan(0)
    expect(animated.ints.get('uPhase')).toBe(2)
    expect(animated.textures.has('myTexture')).toBe(true)

    const still = makeEffect()
    jackpotStill.bind(still.effect)
    expect(still.floats.get('uTime')).toBe(0)
    expect(still.floats.get('uGlitchIntensity')).toBe(0)
    expect(still.ints.get('uPhase')).toBe(2)
  })

  it('uploads the jackpot canvas every frame only while animated, once per phase when still', () => {
    const layer = makeLayer()
    hoisted.uploads.count = 0
    for (let i = 0; i < 10; i++) layer.update(0.016, DisplayState.IDLE, 0)
    expect(hoisted.uploads.count).toBe(0) // it used to clear and re-upload every idle frame

    for (let i = 0; i < 5; i++) layer.update(0.016, DisplayState.JACKPOT, 1)
    expect(hoisted.uploads.count).toBe(5)

    layer.setJackpotStill(true)
    hoisted.uploads.count = 0
    for (let i = 0; i < 5; i++) layer.update(0.016, DisplayState.JACKPOT, 1)
    layer.update(0.016, DisplayState.JACKPOT, 3)
    expect(hoisted.uploads.count).toBe(2)

    layer.update(0.016, DisplayState.IDLE, 0)
    expect(hoisted.uploads.count).toBe(3) // cleared once on the way out
  })
})
