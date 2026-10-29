/**
 * The backbox screen border (`enableScreenBorder`): an emissive strip driven by
 * DisplayState, the sim-step jackpot phase and bumper contacts — and held still
 * by photosensitive mode and reduced motion.
 *
 * `ScreenBorderModel` is pure; `BackboxScreenBorder` and the `CabinetLighting`
 * routing run against local Babylon stubs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  class Rgb {
    r = 0
    g = 0
    b = 0
    set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; return this }
  }
  class StdMat {
    emissiveColor = new Rgb()
    diffuseColor = new Rgb()
    specularColor = new Rgb()
    disableLighting = false
    dispose = vi.fn()
    constructor(public name: string) { materials.push(this) }
  }
  const materials: StdMat[] = []
  const meshes: Array<{
    name: string
    material: StdMat | null
    parent: unknown
    isPickable: boolean
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }
    dispose: ReturnType<typeof vi.fn>
    setEnabled: ReturnType<typeof vi.fn>
    size: { width: number; height: number; depth: number }
  }> = []
  const createBox = vi.fn((name: string, size: { width: number; height: number; depth: number }) => {
    const mesh = {
      name,
      material: null as StdMat | null,
      parent: null as unknown,
      isPickable: true,
      position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { mesh.position.x = x; mesh.position.y = y; mesh.position.z = z } },
      dispose: vi.fn(),
      setEnabled: vi.fn(),
      size,
    }
    meshes.push(mesh)
    return mesh
  })
  return { StdMat, materials, meshes, createBox }
})

// Every @babylonjs/core deep import resolves to one stub module (vitest.config.ts), so one partial
// mock covers MeshBuilder and StandardMaterial alike and keeps the rest (Color3, PointLight…).
vi.mock('@babylonjs/core/Meshes/meshBuilder', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    MeshBuilder: { ...(actual.MeshBuilder as object), CreateBox: hoisted.createBox },
    StandardMaterial: hoisted.StdMat,
  }
})

import { BackboxScreenBorder } from '../src/display/backbox-screen-border'
import {
  BORDER_NOMINAL_HZ,
  BORDER_SEGMENT_COUNT,
  BORDER_SEGMENT_ROW,
  JACKPOT_END_STATE,
  ScreenBorderModel,
  type Rgb,
  type ScreenBorderAccessibility,
} from '../src/display/screen-border-model'
import { DisplayState } from '../src/display/display-types'
import { QualityTier } from '../src/game-elements/visual-language'
import { CabinetLighting } from '../src/effects/cabinet-lighting'
import { EventBus } from '../src/core/event-bus'
import { DEFAULT_ACCESSIBILITY } from '../src/game-elements/accessibility-config'

const DEFAULT: ScreenBorderAccessibility = { reducedMotion: false, photosensitiveMode: false, flashFrequencyMax: 2 }
const PHOTOSENSITIVE: ScreenBorderAccessibility = { reducedMotion: false, photosensitiveMode: true, flashFrequencyMax: 1 }
const REDUCED: ScreenBorderAccessibility = { reducedMotion: true, photosensitiveMode: false, flashFrequencyMax: 1 }
const BOTH: ScreenBorderAccessibility = { reducedMotion: true, photosensitiveMode: true, flashFrequencyMax: 1 }

const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
const FRAME = 1 / 60

/** Drive the model `seconds` at 60 fps and return segment 0's colour per frame. */
function run(model: ScreenBorderModel, seconds: number, segment = 0): Rgb[] {
  const out: Rgb[] = []
  for (let i = 0; i < Math.round(seconds / FRAME); i++) {
    model.update(FRAME)
    out.push([...model.colors[segment]!] as Rgb)
  }
  return out
}

/**
 * Luminance reversals of at least `delta`: two opposing changes make one flash,
 * so the WCAG general-flash limit of 3 flashes per second is 6 reversals per second.
 */
function reversalsPerSecond(samples: Rgb[], seconds: number, delta = 0.1): number {
  const lum = samples.map(luminance)
  let reversals = 0
  let dir = 0
  let last = lum[0]!
  for (const l of lum) {
    if (Math.abs(l - last) < delta) continue
    const d = Math.sign(l - last)
    if (dir !== 0 && d !== dir) reversals++
    dir = d
    last = l
  }
  return reversals / seconds
}

const spread = (samples: Rgb[]): number => {
  const lum = samples.map(luminance)
  return Math.max(...lum) - Math.min(...lum)
}

function modelIn(
  a: ScreenBorderAccessibility,
  state: DisplayState,
  phase: number,
): ScreenBorderModel {
  const model = new ScreenBorderModel(() => a)
  model.setDisplayState(state)
  model.setJackpotPhase(phase)
  run(model, 3) // settle fades
  return model
}

describe('ScreenBorderModel', () => {
  describe('driven by DisplayState', () => {
    it('shows a dim neutral at idle and a brighter colour for each active state', () => {
      const idle = modelIn(DEFAULT, DisplayState.IDLE, 0)
      const idleLum = luminance(idle.colors[0]!)
      expect(idleLum).toBeLessThan(0.2)
      for (const state of [DisplayState.REACH, DisplayState.FEVER, DisplayState.ADVENTURE, DisplayState.PORTAL_OPEN, DisplayState.ESCAPE]) {
        const m = modelIn(PHOTOSENSITIVE, state, 0)
        expect(luminance(m.colors[0]!), state).toBeGreaterThan(idleLum)
      }
    })

    it('every segment shows the state colour outside a jackpot', () => {
      const m = modelIn(DEFAULT, DisplayState.PORTAL_OPEN, 0)
      for (let i = 1; i < BORDER_SEGMENT_COUNT; i++) expect(m.colors[i]).toEqual(m.colors[0])
    })
  })

  describe('the jackpot script (docs/PLAN.md §8)', () => {
    it('breach is a red pulse, critical a white/gold strobe, meltdown a wave down the frame', () => {
      const breach = run(modelIn(DEFAULT, DisplayState.JACKPOT, 1), 1)
      expect(spread(breach)).toBeGreaterThan(0.1) // pulses
      expect(breach.every(([r, , b]) => r >= b)).toBe(true) // red-dominant

      const critical = run(modelIn(DEFAULT, DisplayState.JACKPOT, 2), 1)
      expect(spread(critical.map(([r, g, b]) => [r, g, b] as Rgb))).toBeGreaterThan(0.02)
      expect(critical.every(([r, g]) => r > 0.8 && g > 0.7)).toBe(true) // gold ↔ white

      const meltdown = modelIn(DEFAULT, DisplayState.JACKPOT, 3)
      meltdown.update(FRAME)
      const rows = BORDER_SEGMENT_ROW.map((_, i) => meltdown.colors[i]!)
      // The rainbow offsets by row: top and bottom differ, the two sides of one row match.
      expect(rows[0]).not.toEqual(rows[5])
      expect(rows[1]).toEqual(rows[2])
      expect(rows[3]).toEqual(rows[4])
    })

    it('follows the phase it is told, not wall time: the jackpot:phase event is the only clock', () => {
      const m = modelIn(DEFAULT, DisplayState.JACKPOT, 1)
      m.setJackpotPhase(3)
      for (let i = 0; i < 30; i++) m.update(FRAME)
      const lum = BORDER_SEGMENT_ROW.map((_, i) => m.colors[i]!)
      expect(new Set(lum.map((c) => c.map((v) => v.toFixed(2)).join(','))).size).toBeGreaterThan(1) // a wave, not breach red
    })

    it('returns to the state colour when the sequence ends (phase 0, display back to idle)', () => {
      const m = modelIn(DEFAULT, DisplayState.JACKPOT, 3)
      m.setJackpotPhase(0)
      m.setDisplayState(DisplayState.IDLE)
      run(m, 3)
      expect(luminance(m.colors[0]!)).toBeLessThan(0.2)
    })
  })

  describe('flash cap', () => {
    it('clamps the nominal 4 Hz and 10 Hz pulses to flashFrequencyMax', () => {
      const m = new ScreenBorderModel(() => DEFAULT)
      expect(BORDER_NOMINAL_HZ.breach).toBe(4)
      expect(BORDER_NOMINAL_HZ.critical).toBe(10)
      expect(m.pulseHz(BORDER_NOMINAL_HZ.breach)).toBe(2)
      expect(m.pulseHz(BORDER_NOMINAL_HZ.critical)).toBe(2)
      expect(new ScreenBorderModel(() => ({ ...DEFAULT, flashFrequencyMax: 1 })).pulseHz(10)).toBe(1)
      expect(new ScreenBorderModel(() => ({ ...DEFAULT, flashFrequencyMax: 8 })).pulseHz(4)).toBe(4)
    })

    it.each([1, 2, 3])('jackpot phase %i stays under the general flash threshold (3 flashes per second)', (phase) => {
      const seconds = 4
      const samples = run(modelIn(DEFAULT, DisplayState.JACKPOT, phase), seconds)
      expect(reversalsPerSecond(samples, seconds) / 2).toBeLessThanOrEqual(3)
    })

    it('a lower cap slows the pulse: at 1 Hz the breach flashes once a second', () => {
      const seconds = 4
      const samples = run(modelIn({ ...DEFAULT, flashFrequencyMax: 1 }, DisplayState.JACKPOT, 1), seconds)
      expect(reversalsPerSecond(samples, seconds) / 2).toBeLessThanOrEqual(1.1)
    })
  })

  describe('photosensitive mode', () => {
    it.each([
      ['breach', DisplayState.JACKPOT, 1],
      ['critical', DisplayState.JACKPOT, 2],
      ['meltdown', DisplayState.JACKPOT, 3],
      ['fever', DisplayState.FEVER, 0],
      ['reach', DisplayState.REACH, 0],
    ] as const)('%s holds a steady colour: no pulse, strobe or wave', (_name, state, phase) => {
      const m = modelIn(PHOTOSENSITIVE, state, phase)
      for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
        const samples = run(m, 2, i)
        expect(spread(samples), `segment ${i}`).toBeLessThan(1e-6)
        expect(reversalsPerSecond(samples, 2, 0.001)).toBe(0)
      }
    })

    it('rests on each phase’s end state', () => {
      for (const phase of [1, 2, 3] as const) {
        const m = modelIn(PHOTOSENSITIVE, DisplayState.JACKPOT, phase)
        for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
          m.colors[i]!.forEach((v, c) => expect(v).toBeCloseTo(JACKPOT_END_STATE[phase][c]!, 3))
        }
      }
    })

    it('fades between states slowly — no step in brightness large enough to read as a flash', () => {
      const m = modelIn(PHOTOSENSITIVE, DisplayState.IDLE, 0)
      m.setDisplayState(DisplayState.JACKPOT)
      m.setJackpotPhase(1)
      const samples = run(m, 2)
      let worst = 0
      for (let i = 1; i < samples.length; i++) worst = Math.max(worst, Math.abs(luminance(samples[i]!) - luminance(samples[i - 1]!)))
      expect(worst).toBeLessThan(0.05)
    })

    it('ignores bumper contacts', () => {
      const m = modelIn(PHOTOSENSITIVE, DisplayState.IDLE, 0)
      const before = [...m.colors[0]!]
      m.contact(1)
      m.update(FRAME)
      expect([...m.colors[0]!]).toEqual(before)
    })

    it('is honoured live: switching it on mid-jackpot stops the pulse', () => {
      let accessibility = DEFAULT
      const m = new ScreenBorderModel(() => accessibility)
      m.setDisplayState(DisplayState.JACKPOT)
      m.setJackpotPhase(1)
      expect(spread(run(m, 1))).toBeGreaterThan(0.1)
      accessibility = PHOTOSENSITIVE
      run(m, 12) // the slow fade settles
      expect(spread(run(m, 2))).toBeLessThan(1e-6)
    })
  })

  describe('reduced motion', () => {
    it('cuts to the end state of each phase on the next frame, with no fade', () => {
      const m = new ScreenBorderModel(() => REDUCED)
      m.setDisplayState(DisplayState.JACKPOT)
      for (const phase of [1, 2, 3, 0] as const) {
        m.setJackpotPhase(phase)
        m.update(FRAME) // one frame, not a fade
        if (phase === 0) {
          // JACKPOT display state with no phase is the breach's end state.
          m.colors[0]!.forEach((v, c) => expect(v).toBeCloseTo(JACKPOT_END_STATE[1][c]!, 6))
        } else {
          for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
            m.colors[i]!.forEach((v, c) => expect(v).toBeCloseTo(JACKPOT_END_STATE[phase][c]!, 6))
          }
        }
      }
    })

    it('holds still, and still ignores contacts', () => {
      const m = modelIn(REDUCED, DisplayState.JACKPOT, 2)
      expect(spread(run(m, 2))).toBeLessThan(1e-6)
      m.contact(1)
      expect(spread(run(m, 1))).toBeLessThan(1e-6)
    })

    it('both flags together are no different', () => {
      const m = modelIn(BOTH, DisplayState.JACKPOT, 3)
      expect(spread(run(m, 2))).toBeLessThan(1e-6)
    })
  })

  describe('bumper contacts', () => {
    it('swell the strip briefly and decay', () => {
      const m = modelIn(DEFAULT, DisplayState.PORTAL_OPEN, 0)
      const rest = luminance(m.colors[0]!)
      m.contact(1)
      m.update(FRAME)
      expect(luminance(m.colors[0]!)).toBeGreaterThan(rest * 1.2)
      run(m, 0.5)
      expect(luminance(m.colors[0]!)).toBeCloseTo(rest, 3)
    })

    it('are rate-limited to the flash cap, so a burst of hits is one swell, not a strobe', () => {
      const m = modelIn(DEFAULT, DisplayState.PORTAL_OPEN, 0)
      const samples: Rgb[] = []
      for (let i = 0; i < 120; i++) { // 2 s of a hit every frame
        m.contact(1)
        m.update(FRAME)
        samples.push([...m.colors[0]!] as Rgb)
      }
      // flashFrequencyMax = 2 Hz → at most about four swells in two seconds
      const peaks = samples.filter((c, i) => i > 0 && i < samples.length - 1 && luminance(c) > luminance(samples[i - 1]!) && luminance(c) >= luminance(samples[i + 1]!))
      expect(peaks.length).toBeLessThanOrEqual(5)
      expect(reversalsPerSecond(samples, 2) / 2).toBeLessThanOrEqual(3)
    })
  })
})

describe('BackboxScreenBorder', () => {
  beforeEach(() => {
    hoisted.materials.length = 0
    hoisted.meshes.length = 0
    hoisted.createBox.mockClear()
  })

  const sceneWith = (root: object | null) => ({ getTransformNodeByName: vi.fn((name: string) => (name === 'backboxRoot' ? root : null)) })
  const make = (root: object | null, tier = QualityTier.HIGH, accessibility: ScreenBorderAccessibility = DEFAULT) => {
    const scene = sceneWith(root)
    const border = new BackboxScreenBorder(scene as never, {
      width: 16,
      height: 9,
      qualityTier: tier,
      getAccessibility: () => accessibility,
    })
    return { border, scene }
  }

  it('builds six lit segments around the glass once the backbox root exists', () => {
    const root = {}
    const { border, scene } = make(null)
    border.update(FRAME)
    expect(border.built).toBe(false) // the display has not built the backbox yet
    expect(hoisted.createBox).not.toHaveBeenCalled()

    scene.getTransformNodeByName.mockImplementation(() => root)
    border.update(FRAME)
    expect(border.built).toBe(true)
    expect(hoisted.meshes).toHaveLength(BORDER_SEGMENT_COUNT)
    for (const mesh of hoisted.meshes) {
      expect(mesh.parent).toBe(root)
      expect(mesh.isPickable).toBe(false)
      expect(mesh.position.z).toBeLessThan(-0.75) // in front of the composite glass
      expect(mesh.material?.disableLighting).toBe(true)
    }
    // Top and bottom span the glass; the sides split in half so the wave has rows.
    expect(hoisted.meshes[0]!.size.width).toBeGreaterThan(16)
    expect(hoisted.meshes[1]!.size.height).toBe(4.5)
    expect(hoisted.meshes[0]!.position.y).toBeGreaterThan(4.5)
    expect(hoisted.meshes[5]!.position.y).toBeLessThan(-4.5)

    border.update(FRAME)
    expect(hoisted.createBox).toHaveBeenCalledTimes(BORDER_SEGMENT_COUNT) // built once
  })

  it('writes the model’s colours onto the segment materials', () => {
    const { border } = make({}, QualityTier.HIGH, PHOTOSENSITIVE)
    border.onDisplaySet(DisplayState.JACKPOT)
    border.onJackpotPhase(3)
    for (let i = 0; i < 200; i++) border.update(FRAME)
    for (const material of hoisted.materials) {
      expect(material.emissiveColor.r).toBeCloseTo(JACKPOT_END_STATE[3][0], 3)
      expect(material.emissiveColor.g).toBeCloseTo(JACKPOT_END_STATE[3][1], 3)
    }
  })

  it('builds nothing on the LOW quality tier', () => {
    const { border } = make({}, QualityTier.LOW)
    border.update(FRAME)
    expect(border.built).toBe(false)
    expect(hoisted.createBox).not.toHaveBeenCalled()
  })

  it('hides with the cabinet lighting, and disposes meshes and materials', () => {
    const { border } = make({})
    border.update(FRAME)
    border.setEnabled(false)
    for (const mesh of hoisted.meshes) expect(mesh.setEnabled).toHaveBeenCalledWith(false)
    border.dispose()
    for (const mesh of hoisted.meshes) expect(mesh.dispose).toHaveBeenCalled()
    for (const material of hoisted.materials) expect(material.dispose).toHaveBeenCalled()
    expect(border.built).toBe(false)
    border.update(FRAME) // no rebuild after dispose
    expect(hoisted.createBox).toHaveBeenCalledTimes(BORDER_SEGMENT_COUNT)
  })
})

describe('CabinetLighting enableScreenBorder', () => {
  beforeEach(() => {
    hoisted.materials.length = 0
    hoisted.meshes.length = 0
  })

  const lighting = async (enableScreenBorder: boolean, accessibility = DEFAULT_ACCESSIBILITY) => {
    const scene = { getTransformNodeByName: () => ({}) }
    const bus = new EventBus()
    const cabinet = new CabinetLighting(scene as never, {
      enableEdgeLighting: false,
      enableUnderCabinetGlow: false,
      enableScreenBorder,
      screenBorder: { width: 16, height: 9, getAccessibility: () => accessibility },
      qualityTier: QualityTier.HIGH,
    })
    cabinet.subscribeToEvents(bus)
    await vi.dynamicImportSettled() // the strip is a lazy chunk
    return { cabinet, bus }
  }

  it('builds no strip when the flag is off', async () => {
    const { cabinet } = await lighting(false)
    cabinet.update(FRAME)
    expect(hoisted.meshes).toHaveLength(0)
  })

  it('lights the strip from display:set, jackpot:phase and bumper:contact', async () => {
    const { cabinet, bus } = await lighting(true)
    cabinet.update(FRAME)
    expect(hoisted.meshes).toHaveLength(BORDER_SEGMENT_COUNT)
    const top = () => hoisted.materials[0]!.emissiveColor
    const settle = () => { for (let i = 0; i < 240; i++) cabinet.update(FRAME) }

    bus.emit('display:set', DisplayState.FEVER)
    settle()
    const fever = { ...top() }
    expect(fever.r).toBeGreaterThan(0.1)

    bus.emit('jackpot:phase', { phase: 3 })
    bus.emit('display:set', DisplayState.JACKPOT)
    for (let i = 0; i < 30; i++) cabinet.update(FRAME)
    const bottom = hoisted.materials[5]!.emissiveColor
    expect([top().r, top().g, top().b]).not.toEqual([bottom.r, bottom.g, bottom.b]) // the meltdown wave has rows

    bus.emit('jackpot:end')
    bus.emit('display:set', DisplayState.IDLE)
    settle()
    expect(top().r + top().g + top().b).toBeLessThan(0.6)

    const rest = top().r
    bus.emit('bumper:contact', { strength: 1 })
    cabinet.update(FRAME)
    expect(top().r).toBeGreaterThan(rest)
  })

  it('photosensitive mode: a whole jackpot sequence and a hail of bumper hits never fade anything but steadily', async () => {
    // What detectAccessibility({ photosensitiveMode: true }) returns in a browser.
    const photosensitive = { ...DEFAULT_ACCESSIBILITY, photosensitiveMode: true, flashFrequencyMax: 1, effectIntensity: 0.45, maxCameraShakeIntensity: 0 }
    const { cabinet, bus } = await lighting(true, photosensitive)
    cabinet.update(FRAME)
    bus.emit('display:set', DisplayState.JACKPOT)
    const tails: number[][] = []
    for (const phase of [1, 2, 3]) {
      bus.emit('jackpot:phase', { phase })
      const tail: number[] = []
      for (let i = 0; i < 180; i++) {
        bus.emit('bumper:contact', { strength: 1 })
        cabinet.update(FRAME)
        if (i >= 60) tail.push(hoisted.materials[0]!.emissiveColor.r)
      }
      tails.push(tail)
    }
    // Inside each phase the strip only ever fades toward the phase's end state: it never reverses
    // (a pulse) and never steps (a flash), however many bumpers are hit.
    for (const tail of tails) {
      const deltas = tail.slice(1).map((v, i) => v - tail[i]!)
      expect(deltas.every((d) => d >= -1e-9) || deltas.every((d) => d <= 1e-9)).toBe(true)
      expect(Math.max(...deltas.map(Math.abs))).toBeLessThan(0.02)
    }
  })

  it('picks up the display state it saw while its chunk was loading', async () => {
    const scene = { getTransformNodeByName: () => ({}) }
    const bus = new EventBus()
    const cabinet = new CabinetLighting(scene as never, {
      enableEdgeLighting: false,
      enableUnderCabinetGlow: false,
      enableScreenBorder: true,
      screenBorder: { width: 16, height: 9, getAccessibility: () => ({ ...DEFAULT_ACCESSIBILITY, photosensitiveMode: true }) },
      qualityTier: QualityTier.HIGH,
    })
    cabinet.subscribeToEvents(bus)
    bus.emit('display:set', DisplayState.ADVENTURE) // before the lazy chunk resolves
    await vi.dynamicImportSettled()
    for (let i = 0; i < 400; i++) cabinet.update(FRAME)
    const top = hoisted.materials[0]!.emissiveColor
    expect(top.b).toBeGreaterThan(top.g) // adventure purple, not the idle grey
  })

  it('builds nothing when disposed before its chunk loads, or on the LOW tier', async () => {
    const make = (qualityTier: QualityTier) =>
      new CabinetLighting({ getTransformNodeByName: () => ({}) } as never, {
        enableEdgeLighting: false,
        enableUnderCabinetGlow: false,
        enableScreenBorder: true,
        screenBorder: { width: 16, height: 9, getAccessibility: () => DEFAULT_ACCESSIBILITY },
        qualityTier,
      })
    const early = make(QualityTier.HIGH)
    early.dispose()
    const low = make(QualityTier.LOW)
    await vi.dynamicImportSettled()
    early.update(FRAME)
    low.update(FRAME)
    expect(hoisted.meshes).toHaveLength(0)
  })

  it('stops listening once disposed', async () => {
    const { cabinet, bus } = await lighting(true)
    cabinet.update(FRAME)
    cabinet.dispose()
    expect(() => {
      bus.emit('jackpot:phase', { phase: 2 })
      bus.emit('bumper:contact', { strength: 1 })
    }).not.toThrow()
    for (const mesh of hoisted.meshes) expect(mesh.dispose).toHaveBeenCalled()
  })
})
