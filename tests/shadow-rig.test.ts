import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { QualityTier } from '../src/game-elements/visual-language'
import { ShadowRig } from '../src/game/shadow-rig'
import { DYNAMIC_LIGHT_SHARE } from '../src/game/shadow-config'

// The alias mock gives lights and generators almost no behaviour; these fakes carry what the rig reads.

interface Vec { x: number; y: number; z: number; clone(): Vec; copyFrom(v: Vec): Vec }
function vec(x = 0, y = 0, z = 0): Vec {
  return {
    x, y, z,
    clone() { return vec(this.x, this.y, this.z) },
    copyFrom(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this },
  }
}
interface Rgb { r: number; g: number; b: number; copyFrom(c: Rgb): Rgb }
function rgb(r = 1, g = 1, b = 1): Rgb {
  return { r, g, b, copyFrom(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this } }
}

interface FakeLight {
  name: string
  intensity: number
  enabled: boolean
  direction: Vec
  position: Vec
  diffuse: Rgb
  specular: Rgb
  includedOnlyMeshes: unknown[]
  excludedMeshes: unknown[]
  setEnabled(v: boolean): void
  dispose: ReturnType<typeof vi.fn>
}

function fakeLight(name: string): FakeLight {
  return {
    name, intensity: 1, enabled: true,
    direction: vec(-0.6, -0.8, 0.2), position: vec(-15, 25, -15),
    diffuse: rgb(), specular: rgb(),
    includedOnlyMeshes: [], excludedMeshes: [],
    setEnabled(v) { this.enabled = v },
    dispose: vi.fn(),
  }
}

interface FakeMap {
  refreshRate: number
  renderList: Array<{ name: string; isEnabled: () => boolean }>
  customIsReadyFunction: ReturnType<typeof vi.fn>
}

const generators: Array<{ light: FakeLight; mapSize: number; map: FakeMap; addShadowCaster: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; [k: string]: unknown }> = []

function makeScene() {
  let observer: (() => void) | null = null
  return {
    onBeforeRenderObservable: {
      add: vi.fn((cb: () => void) => { observer = cb; return cb }),
      remove: vi.fn(() => { observer = null }),
    },
    frame: () => observer?.(),
    hasObserver: () => observer !== null,
  }
}

function makeMesh(name: string, material: object | null = null) {
  const dispose: Array<() => void> = []
  return {
    name, receiveShadows: false, material,
    onDisposeObservable: { addOnce: (cb: () => void) => { dispose.push(cb) } },
    runDispose: () => dispose.forEach((cb) => cb()),
  }
}

function build(tier: QualityTier = QualityTier.MEDIUM) {
  const scene = makeScene()
  const key = fakeLight('keyLight')
  key.intensity = 1.2
  key.diffuse = rgb(1, 0.5, 0.25)
  const rig = new ShadowRig(scene as never, key as never, tier)
  const [staticGen, dynamicGen] = generators.slice(-2)
  const [staticLight, dynamicLight] = [staticGen!.light, dynamicGen!.light]
  return { scene, key, rig, staticGen: staticGen!, dynamicGen: dynamicGen!, staticLight, dynamicLight }
}

beforeEach(() => {
  generators.length = 0
  vi.mocked(DirectionalLight).mockImplementation(function (this: Record<string, unknown>, name: string) {
    Object.assign(this, fakeLight(name))
    return this
  } as never)
  vi.mocked(ShadowGenerator).mockImplementation(function (this: Record<string, unknown>, mapSize: number, light: FakeLight) {
    const map: FakeMap = { refreshRate: 1, renderList: [], customIsReadyFunction: vi.fn(() => true) }
    this.light = light
    this.mapSize = mapSize
    this.getShadowMap = () => map
    this.map = map
    this.setDarkness = vi.fn()
    this.addShadowCaster = vi.fn((mesh: { name: string; isEnabled: () => boolean }) => { map.renderList.push(mesh) })
    this.dispose = vi.fn()
    generators.push(this as never)
    return this
  } as never)
})

describe('ShadowRig', () => {
  it('puts the two generators on two different twins of the key light, sized per generator', () => {
    const { staticGen, dynamicGen, staticLight, dynamicLight, key } = build()
    expect(staticLight).not.toBe(dynamicLight)
    expect([staticLight, dynamicLight]).not.toContain(key)
    expect(staticLight.name).toBe('keyLightStatic')
    expect(dynamicLight.name).toBe('keyLightDynamic')
    expect(staticGen.mapSize).toBe(2048)
    expect(dynamicGen.mapSize).toBe(1024)
  })

  it('keeps the twins off until a receiver exists (an empty include list would light the whole scene)', () => {
    const { staticLight, dynamicLight } = build()
    expect(staticLight.enabled).toBe(false)
    expect(dynamicLight.enabled).toBe(false)
  })

  it('routes casters to the generator that matches how they move', () => {
    const { rig, staticGen, dynamicGen } = build()
    const wall = makeMesh('cabinet')
    const ball = makeMesh('ball')
    rig.addStaticCaster(wall as never)
    rig.addDynamicCaster(ball as never, true)
    expect(staticGen.addShadowCaster).toHaveBeenCalledWith(wall, false)
    expect(dynamicGen.addShadowCaster).toHaveBeenCalledWith(ball, true)
    expect(dynamicGen.addShadowCaster).not.toHaveBeenCalledWith(wall, expect.anything())
  })

  describe('receivers', () => {
    it('receive shadows, are lit by the twins only, and switch the twins on', () => {
      const { rig, key, staticLight, dynamicLight } = build()
      const ground = makeMesh('lcdGround')
      rig.addReceiver(ground as never)
      expect(ground.receiveShadows).toBe(true)
      expect(staticLight.includedOnlyMeshes).toEqual([ground])
      expect(dynamicLight.includedOnlyMeshes).toEqual([ground])
      expect(key.excludedMeshes).toEqual([ground])
      expect(staticLight.enabled).toBe(true)
      expect(dynamicLight.enabled).toBe(true)
    })

    it('lifts a receiver material\'s light cap once per material, for the extra twin', () => {
      const { rig } = build()
      const shared = { maxSimultaneousLights: 4 }
      rig.addReceiver(makeMesh('a', shared) as never)
      rig.addReceiver(makeMesh('b', shared) as never)
      rig.addReceiver(makeMesh('c', {}) as never)
      expect(shared.maxSimultaneousLights).toBe(5)
    })

    it('ignores a receiver added twice', () => {
      const { rig, staticLight } = build()
      const ground = makeMesh('g')
      rig.addReceiver(ground as never)
      rig.addReceiver(ground as never)
      expect(staticLight.includedOnlyMeshes).toHaveLength(1)
    })

    it('a disposed receiver leaves every list, and the twins go off with the last one', () => {
      const { rig, key, staticLight, dynamicLight } = build()
      const a = makeMesh('a')
      const b = makeMesh('b')
      rig.addReceiver(a as never)
      rig.addReceiver(b as never)
      a.runDispose()
      expect(staticLight.includedOnlyMeshes).toEqual([b])
      expect(key.excludedMeshes).toEqual([b])
      b.runDispose()
      expect(staticLight.enabled).toBe(false)
      expect(dynamicLight.enabled).toBe(false)
      expect(key.excludedMeshes).toEqual([])
    })
  })

  describe('light sync', () => {
    it('the twins carry the key light\'s intensity between them, and follow its colour and pose', () => {
      const { rig, scene, key, staticLight, dynamicLight } = build()
      rig.addReceiver(makeMesh('g') as never)
      scene.frame()
      expect(staticLight.intensity + dynamicLight.intensity).toBeCloseTo(key.intensity)
      expect(dynamicLight.intensity).toBeCloseTo(key.intensity * DYNAMIC_LIGHT_SHARE)

      // The track themes lerp the key light every frame.
      key.intensity = 0.5
      key.diffuse.r = 0.1
      key.direction.x = 0.3
      scene.frame()
      expect(staticLight.intensity + dynamicLight.intensity).toBeCloseTo(0.5)
      expect(staticLight.diffuse.r).toBe(0.1)
      expect(dynamicLight.direction.x).toBe(0.3)
    })
  })

  describe('as a StaticSceneGate target', () => {
    const noShadows = { reason: 'ball:spawn', materials: false, shadows: false }
    const shadows = { reason: 'cabinet:load', materials: true, shadows: true }

    it('renders the static map every frame until the first refreeze, then once, then not at all', () => {
      const { rig, staticGen, dynamicGen } = build()
      expect(staticGen.map.refreshRate).toBe(1)
      expect(rig.isStaticLive()).toBe(true)
      rig.refreeze()
      expect(staticGen.map.refreshRate).toBe(0)
      expect(rig.isStaticLive()).toBe(false)
      // The dynamic map is never frozen.
      expect(dynamicGen.map.refreshRate).toBe(1)
    })

    it('thaws only for an invalidation that says the static caster set may have changed', () => {
      const { rig, staticGen } = build()
      rig.refreeze()
      rig.thaw(noShadows)
      expect(staticGen.map.refreshRate).toBe(0)
      rig.thaw(shadows)
      expect(staticGen.map.refreshRate).toBe(1)
      expect(rig.isStaticLive()).toBe(true)
    })

    it('a refreeze with nothing thawed does not re-render the map', () => {
      const { rig, staticGen } = build()
      rig.refreeze()
      let writes = 0
      let rate = staticGen.map.refreshRate
      Object.defineProperty(staticGen.map, 'refreshRate', {
        get: () => rate,
        set: (v: number) => { writes++; rate = v },
      })
      rig.refreeze()
      expect(writes).toBe(0)
    })

    it('waits for every enabled static caster\'s depth shader before it will freeze', () => {
      const { rig, staticGen } = build()
      const wall = makeMesh('wall') as ReturnType<typeof makeMesh> & { isEnabled: () => boolean }
      Object.assign(wall, { isEnabled: () => true })
      rig.addStaticCaster(wall as never)
      staticGen.map.customIsReadyFunction.mockReturnValue(false)
      expect(rig.canRefreeze()).toBe(false)
      staticGen.map.customIsReadyFunction.mockReturnValue(true)
      expect(rig.canRefreeze()).toBe(true)
    })

    it('is ready when the static map has no casters', () => {
      expect(build().rig.canRefreeze()).toBe(true)
    })
  })

  describe('quality tier', () => {
    it('re-points the static technique and lowers the dynamic PCF kernel', () => {
      const { rig, staticGen, dynamicGen } = build(QualityTier.HIGH)
      expect(staticGen.usePercentageCloserFiltering).toBe(true)
      expect(dynamicGen.filteringQuality).toBe(ShadowGenerator.QUALITY_MEDIUM)
      rig.applyTier(QualityTier.MEDIUM)
      expect(staticGen.useBlurExponentialShadowMap).toBe(true)
      expect(dynamicGen.filteringQuality).toBe(ShadowGenerator.QUALITY_LOW)
    })

    it('does not touch a generator whose settings the new tier shares (MEDIUM -> LOW)', () => {
      const { rig, staticGen, dynamicGen } = build(QualityTier.MEDIUM)
      const before = { ...staticGen }
      rig.applyTier(QualityTier.LOW)
      expect(staticGen.usePercentageCloserFiltering).toBe(before.usePercentageCloserFiltering)
      expect(dynamicGen.filteringQuality).toBe(ShadowGenerator.QUALITY_LOW)
    })
  })

  it('dispose stops the sync, hands the receivers back to the key light, and disposes both generators and twins', () => {
    const { rig, scene, key, staticGen, dynamicGen, staticLight, dynamicLight } = build()
    rig.addReceiver(makeMesh('g') as never)
    rig.dispose()
    expect(scene.hasObserver()).toBe(false)
    expect(key.excludedMeshes).toEqual([])
    expect(staticGen.dispose).toHaveBeenCalled()
    expect(dynamicGen.dispose).toHaveBeenCalled()
    expect(staticLight.dispose).toHaveBeenCalled()
    expect(dynamicLight.dispose).toHaveBeenCalled()
    // Idempotent.
    expect(() => rig.dispose()).not.toThrow()
  })
})
