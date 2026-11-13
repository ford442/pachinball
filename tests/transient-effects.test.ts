import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Animation } from '@babylonjs/core/Animations/animation'
import { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { ShardEffects } from '../src/effects/effects-shards'
import { RipplesEffects } from '../src/effects/effects-ripples'
import { TrailEffects } from '../src/effects/effects-trails'
import { FloatingNumberEffects } from '../src/effects/effects-floating'
import { EffectsConfig } from '../src/config'
import { TrailMaterialPool } from '../src/materials/material-trail'
import { fakeThinMesh, type FakeThinMesh } from './helpers/fake-thin-mesh'

/**
 * #524: things that spawn during play must not build materials (or meshes). The effects build
 * their fields at boot; after that, bursts only write numbers into pre-sized buffers.
 */

const created = new Map<string, FakeThinMesh>()

function meshBuilderCalls(): number {
  return Object.values(MeshBuilder).reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0)
}

function scene() {
  return new (Scene as unknown as new () => never)()
}

beforeEach(() => {
  created.clear()
  for (const name of ['CreateBox', 'CreateTorus', 'CreatePlane'] as const) {
    vi.mocked(MeshBuilder[name]).mockImplementation(((meshName: string) => {
      const fake = fakeThinMesh()
      created.set(meshName, fake)
      return fake.mesh
    }) as never)
  }
  vi.mocked(StandardMaterial).mockClear()
  vi.mocked(DynamicTexture).mockClear()
  for (const fn of Object.values(MeshBuilder)) (fn as ReturnType<typeof vi.fn>).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shard bursts and impact rings', () => {
  it('create no material at all, and no mesh beyond the one per field built on first use', () => {
    const effects = new ShardEffects(scene(), 5)
    const materials = vi.mocked(StandardMaterial).mock.calls.length
    expect(meshBuilderCalls()).toBe(0) // idle: nothing in the scene yet

    // First burst: builds the two field meshes (once), but no material.
    effects.spawnShardBurst(new Vector3(), '#ff00ff')
    effects.spawnImpactRing(new Vector3(), new Vector3(0, 1, 0), '#00ffff')
    effects.updateShards(1 / 60)
    expect(meshBuilderCalls()).toBe(2)
    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(materials)
    const meshes = meshBuilderCalls()

    for (let i = 0; i < 30; i++) {
      effects.spawnShardBurst(new Vector3(i, 0, 0), '#ff00ff')
      effects.spawnImpactRing(new Vector3(0, 0, i), new Vector3(0, 1, 0), '#00ffff')
      for (let f = 0; f < 10; f++) effects.updateShards(1 / 60)
    }
    for (let f = 0; f < 120; f++) effects.updateShards(1 / 60)

    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(materials)
    expect(meshBuilderCalls()).toBe(meshes)
  })

  it('draws a burst as 8 instances that fade out and hide the mesh', () => {
    const effects = new ShardEffects(scene(), 5)

    effects.spawnShardBurst(new Vector3(0, 1, 0))
    effects.updateShards(1 / 60)
    const shards = created.get('shardField')!
    expect(shards.state.count).toBe(8)
    expect(shards.state.enabled).toBe(true)

    for (let f = 0; f < 70; f++) effects.updateShards(1 / 60) // 1 s of life
    expect(shards.state.count).toBe(0)
    expect(shards.state.enabled).toBe(false)
  })

  it('skips a burst that would not fit instead of growing', () => {
    const effects = new ShardEffects(scene(), 5)
    for (let i = 0; i < 100; i++) effects.spawnShardBurst(new Vector3())
    effects.updateShards(1 / 60)
    const shards = created.get('shardField')!
    expect(shards.state.count).toBe(shards.raw.thinInstanceSetBuffer.mock.calls[0]![1].length / 16)
  })

  it('keeps the impact-ring cap and frees a slot when a ring ends', () => {
    const effects = new ShardEffects(scene(), 2)
    const up = new Vector3(0, 1, 0)

    for (let i = 0; i < 5; i++) effects.spawnImpactRing(new Vector3(i, 0, 0), up, '#00ffff')
    expect(effects.getActiveImpactCount()).toBe(2)
    effects.updateShards(1 / 60)
    const rings = created.get('impactRingField')!
    expect(rings.state.count).toBe(2)

    for (let f = 0; f < 30; f++) effects.updateShards(1 / 60) // > 20 frames at 60 fps
    expect(effects.getActiveImpactCount()).toBe(0)
    expect(rings.state.enabled).toBe(false)

    effects.spawnImpactRing(new Vector3(), up, '#00ffff')
    expect(effects.getActiveImpactCount()).toBe(1)
  })
})

describe('ripple rings', () => {
  it('create no material, build one mesh on first use, and expire', () => {
    const effects = new RipplesEffects(scene())
    const materials = vi.mocked(StandardMaterial).mock.calls.length
    expect(meshBuilderCalls()).toBe(0)

    effects.spawnRippleRings(new Vector3(1, 0, 2), 'heavy')
    effects.updateRippleRings(1 / 60)
    const field = created.get('rippleRingField')!
    const meshes = meshBuilderCalls()
    expect(meshes).toBe(1)
    expect(field.state.count).toBe(EffectsConfig.bumperImpact.rippleRingCount)
    expect(field.state.enabled).toBe(true)

    for (let f = 0; f < 60; f++) effects.updateRippleRings(1 / 60)
    expect(field.state.count).toBe(0)
    expect(field.state.enabled).toBe(false)

    effects.spawnRippleRings(new Vector3(3, 0, 1), 'light')
    effects.updateRippleRings(1 / 60)
    expect(field.state.enabled).toBe(true)

    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(materials)
    expect(meshBuilderCalls()).toBe(meshes)
  })
})

describe('fever trail', () => {
  const body = (handle: number) => ({ handle, translation: () => ({ x: handle, y: 0, z: 0 }) })

  it('creates no material and at most one mesh, however long it runs', () => {
    const trails = new TrailEffects(scene())
    const materials = vi.mocked(StandardMaterial).mock.calls.length
    expect(meshBuilderCalls()).toBe(0)

    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // The first fever frame builds the one quad-field mesh (no material)...
    now += 1000 / 60
    trails.updateFeverTrails([body(1)], true, 1 / 60)
    const meshes = meshBuilderCalls()
    expect(meshes).toBe(1)
    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(materials)
    // ...and nothing after it builds anything, however many balls and frames.
    for (let f = 0; f < 600; f++) {
      now += 1000 / 60
      trails.updateFeverTrails([body(1), body(2), body(3)], true, 1 / 60)
    }
    trails.updateFeverTrails([body(1)], false, 1 / 60)

    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(materials)
    expect(meshBuilderCalls()).toBe(meshes)
  })

  it('draws every live particle, caps each ball, and hides when fever ends', () => {
    const trails = new TrailEffects(scene())

    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // Spawn rate is 0.05 s; run ~2 s: far more spawns than the 50-per-ball cap would admit alive at once
    // (lifetime 0.5 s keeps the live set near 10 per ball).
    for (let f = 0; f < 120; f++) {
      now += 1000 / 60
      trails.updateFeverTrails([body(1)], true, 1 / 60)
    }
    const field = created.get('feverTrailField')!
    expect(field.state.count).toBeGreaterThan(0)
    expect(field.state.count).toBeLessThanOrEqual(EffectsConfig.feverTrail.maxParticlesPerBall)
    expect(field.state.enabled).toBe(true)

    trails.updateFeverTrails([body(1)], false, 1 / 60)
    expect(field.state.count).toBe(0)
    expect(field.state.enabled).toBe(false)
  })
})

describe('TrailMaterialPool', () => {
  it('recycles: after the most balls ever, taking a trail material builds none', () => {
    const pool = new TrailMaterialPool(scene())
    const colour = () => ({ r: 0, g: 1, b: 1 }) as never
    const a = pool.acquire(colour())
    const b = pool.acquire(colour())
    expect(pool.size).toBe(2)
    const built = vi.mocked(StandardMaterial).mock.calls.length

    pool.release(a)
    pool.release(b)
    const again = pool.acquire(colour())
    expect([a, b]).toContain(again)
    expect(again.alpha).toBe(1)
    expect(pool.size).toBe(2)
    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(built)
  })

  it('resets the fade and takes the colour it is given', () => {
    const pool = new TrailMaterialPool(scene())
    const first = pool.acquire({ r: 0, g: 1, b: 1 } as never)
    first.alpha = 0.2
    pool.release(first)

    const fresh = { r: 1, g: 0, b: 1 }
    const second = pool.acquire(fresh as never)
    expect(second).toBe(first)
    expect(second.alpha).toBe(1)
    expect(second.emissiveColor).toBe(fresh)
  })

  it('ignores a double release and a foreign material', () => {
    const pool = new TrailMaterialPool(scene())
    const a = pool.acquire({ r: 0, g: 0, b: 0 } as never)
    pool.release(a)
    pool.release(a)
    pool.release({} as never)
    const x = pool.acquire({ r: 0, g: 0, b: 0 } as never)
    const y = pool.acquire({ r: 0, g: 0, b: 0 } as never)
    expect(x).toBe(a)
    expect(y).not.toBe(a)
    expect(pool.size).toBe(2)
  })
})

describe('floating numbers', () => {
  function fakeSceneWithAnimation() {
    const s = scene() as unknown as { beginAnimation: ReturnType<typeof vi.fn> }
    s.beginAnimation = vi.fn(() => ({ stop: vi.fn() }))
    return s
  }

  beforeEach(() => {
    vi.mocked(Animation).mockImplementation(function (this: Record<string, unknown>) {
      this.setKeys = vi.fn()
      return this
    } as never)
    vi.mocked(DynamicTexture).mockImplementation(function (this: Record<string, unknown>) {
      this.dispose = vi.fn()
      this.update = vi.fn()
      this.getContext = vi.fn(() => ({
        clearRect: vi.fn(),
        fillText: vi.fn(),
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
      }))
      return this
    } as never)
    vi.mocked(MeshBuilder.CreatePlane).mockImplementation(((meshName: string) => {
      const fake = fakeThinMesh()
      ;(fake.raw as unknown as { position: Vector3 }).position = new Vector3()
      created.set(meshName, fake)
      return fake.mesh
    }) as never)
  })

  it('builds at most 8 popups (plane + texture + material) however many scores there are', () => {
    const s = fakeSceneWithAnimation()
    const effects = new FloatingNumberEffects(s as never)
    for (let i = 0; i < 40; i++) effects.spawnFloatingNumber(i * 100, new Vector3(i, 0, 0))

    expect(vi.mocked(StandardMaterial).mock.calls.length).toBe(8)
    expect(vi.mocked(DynamicTexture).mock.calls.length).toBe(8)
    expect(vi.mocked(MeshBuilder.CreatePlane).mock.calls.length).toBe(8)
  })

  it('reuses a slot once its animation has finished', () => {
    const s = fakeSceneWithAnimation()
    const effects = new FloatingNumberEffects(s as never)

    effects.spawnFloatingNumber(100, new Vector3())
    const onEnd = s.beginAnimation.mock.calls[0]![5] as () => void
    onEnd()
    effects.spawnFloatingNumber(200, new Vector3())
    effects.spawnFloatingNumber(300, new Vector3())

    // 100's slot is free again, so the second popup reused it and only the third needed another.
    expect(vi.mocked(MeshBuilder.CreatePlane).mock.calls.length).toBe(2)
  })

  it('ignores the end callback of an animation whose slot was recycled', () => {
    const s = fakeSceneWithAnimation()
    const effects = new FloatingNumberEffects(s as never)
    for (let i = 0; i < 8; i++) effects.spawnFloatingNumber(i, new Vector3())
    const firstEnd = s.beginAnimation.mock.calls[0]![5] as () => void

    effects.spawnFloatingNumber(999, new Vector3()) // all 8 busy: recycles the oldest (slot 0)
    const slot0 = created.get('floatingNumber_0')!
    expect(slot0.state.enabled).toBe(true)

    firstEnd() // the cut-short popup's stale callback must not hide the popup now using the slot
    expect(slot0.state.enabled).toBe(true)
  })
})
