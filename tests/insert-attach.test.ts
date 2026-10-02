/**
 * Insert placement: the glTF root moves to the anchor (keeping the loader's
 * handedness conversion and authored node transforms), and the Mag-Spin
 * insert replaces only the procedural well shell — the spin rings stay.
 */
import { describe, it, expect, vi } from 'vitest'
import { attachInsertMeshes } from '../src/cabinet/insert-gltf-loader'

interface FakeMesh {
  name: string
  parent: FakeMesh | null
  isPickable: boolean
  position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void }
  enabled: boolean
  setEnabled: (v: boolean) => void
}

function fakeMesh(name: string, parent: FakeMesh | null = null, pos = [0, 0, 0]): FakeMesh {
  const m: FakeMesh = {
    name,
    parent,
    isPickable: true,
    enabled: true,
    setEnabled: (v) => {
      m.enabled = v
    },
    position: {
      x: pos[0],
      y: pos[1],
      z: pos[2],
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
    },
  }
  return m
}

describe('attachInsertMeshes', () => {
  it('moves the glTF root to the anchor and leaves children in its frame', () => {
    const root = fakeMesh('__root__')
    const well = fakeMesh('magSpinWell', root, [0, 0.1, 0])
    const shard = fakeMesh('prismCoreShardDetail', root, [-0.9, 0.4, 0])
    attachInsertMeshes([root, well, shard] as never, { x: 4.5, y: 0.5, z: 15 })
    expect(root.position).toMatchObject({ x: 4.5, y: 0.5, z: 15 })
    expect(well.parent).toBe(root)
    expect(shard.parent).toBe(root)
    expect(shard.position).toMatchObject({ x: -0.9, y: 0.4, z: 0 })
    for (const m of [root, well, shard]) expect(m.isPickable).toBe(false)
  })

  it('places each mesh directly when a file has no root', () => {
    const a = fakeMesh('a')
    const b = fakeMesh('b')
    attachInsertMeshes([a, b] as never, { x: 1, y: 2, z: 3 })
    for (const m of [a, b]) {
      expect(m.position).toMatchObject({ x: 1, y: 2, z: 3 })
      expect(m.isPickable).toBe(false)
    }
  })
})

const created = vi.hoisted(() => [] as { name: string; setEnabled: ReturnType<typeof vi.fn>; enabled: boolean }[])

vi.mock('@babylonjs/core', () => {
  class V3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    clone() { return new V3(this.x, this.y, this.z) }
    copyFrom(v: V3) { this.x = v.x; this.y = v.y; this.z = v.z; return this }
    add(v: V3) { return new V3(this.x + v.x, this.y + v.y, this.z + v.z) }
  }
  const mesh = (name: string) => {
    const m = { name, position: new V3(), rotation: { y: 0 }, material: null, enabled: true, setEnabled: vi.fn() }
    m.setEnabled.mockImplementation((v: boolean) => { m.enabled = v })
    created.push(m)
    return m
  }
  return {
    Mesh: { NO_CAP: 0 },
    MeshBuilder: { CreateCylinder: vi.fn((n: string) => mesh(n)), CreateTorus: vi.fn((n: string) => mesh(n)) },
    Vector3: V3,
    StandardMaterial: vi.fn().mockImplementation(function (this: Record<string, unknown>) { return this }),
    Color3: { Black: () => ({}), FromHexString: () => ({ scale: () => ({}) }) },
    Scalar: { Lerp: (a: number, b: number, t: number) => a + (b - a) * t },
    PointLight: vi.fn().mockImplementation(function (this: Record<string, unknown>) { this.setEnabled = vi.fn(); return this }),
    Quaternion: { FromEulerAngles: () => ({}) },
  }
})

vi.mock('../src/game-elements/visual-language', () => ({
  color: () => ({ scale: () => ({}) }),
  emissive: () => ({}),
  FEEDER_STYLES: { MAG_SPIN: { base: '#00aaff', active: '#00ffff', locked: '#aa00ff', release: '#ff00aa' } },
  INTENSITY: { LOW: 0.3, FLASH: 1.0 },
}))

vi.mock('../src/cabinet/insert-gltf-loader', async (orig) => {
  const actual = await orig<typeof import('../src/cabinet/insert-gltf-loader')>()
  return {
    ...actual,
    loadInsertGltfForPreset: vi.fn(async () => ({
      container: { meshes: [], removeAllFromScene: vi.fn(), dispose: vi.fn() },
      meshes: [],
      url: 'models/inserts/mag-spin/high.glb',
      lod: 'high',
    })),
  }
})

describe('MagSpinFeeder insert', () => {
  it('hides the procedural well and floor but keeps the spin rings', async () => {
    const { MagSpinFeeder } = await import('../src/objects/feeders/mag-spin-feeder')
    const { GameConfig } = await import('../src/config')
    created.length = 0
    const world = { createRigidBody: vi.fn().mockReturnValue({ setEnabled: vi.fn() }), createCollider: vi.fn(), getRigidBody: vi.fn(() => null) }
    const rapier = {
      RigidBodyDesc: { fixed: vi.fn().mockReturnValue({ setTranslation: vi.fn().mockReturnThis() }) },
      ColliderDesc: {
        cylinder: vi.fn().mockReturnValue({ setTranslation: vi.fn().mockReturnThis() }),
        cuboid: vi.fn().mockReturnValue({ setTranslation: vi.fn().mockReturnThis(), setRotation: vi.fn().mockReturnThis() }),
      },
    }
    const feeder = new MagSpinFeeder({} as never, world as never, rapier as never, GameConfig.magSpin)
    await feeder.loadInsertGltf('high' as never)

    const byName = (n: string) => created.find((m) => m.name === n)!
    expect(byName('magSpinWell').enabled).toBe(false)
    expect(byName('magSpinFloor').enabled).toBe(false)
    for (const ring of created.filter((m) => m.name.startsWith('magSpinRing'))) expect(ring.enabled).toBe(true)

    feeder.setGameplayEnabled(false)
    for (const ring of created.filter((m) => m.name.startsWith('magSpinRing'))) expect(ring.enabled).toBe(false)
    feeder.setGameplayEnabled(true)
    expect(byName('magSpinWell').enabled).toBe(false)
    for (const ring of created.filter((m) => m.name.startsWith('magSpinRing'))) expect(ring.enabled).toBe(true)
  })
})
