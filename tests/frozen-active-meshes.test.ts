import { describe, expect, it, vi } from 'vitest'
import {
  FrozenActiveMeshes,
  MAX_OFFSCREEN_RATIO,
  RenderStateWatcher,
  isActiveMeshFreezeEnabled,
  type ActiveListMaterial,
  type ActiveListMesh,
  type ActiveListParticleSystem,
  type ActiveMeshesScene,
} from '../src/game/frozen-active-meshes'
import { FRAMES_BEFORE_REFREEZE, StaticSceneGate, type StaticSceneGateHost } from '../src/core/static-scene-gate'

interface FakeMesh extends ActiveListMesh {
  name: string
  enabled: boolean
  ready: boolean
  material: { uniqueId: number } | null
  subMeshes: unknown[]
}

function makeMesh(name: string, over: Partial<FakeMesh> = {}): FakeMesh {
  const mesh: FakeMesh = {
    name,
    enabled: true,
    ready: true,
    isVisible: true,
    visibility: 1,
    material: { uniqueId: 1 },
    subMeshes: [{}],
    isEnabled: () => mesh.enabled,
    isReady: () => mesh.ready,
    ...over,
  }
  return mesh
}

function makeMaterial(): ActiveListMaterial & { blend: boolean; test: boolean } {
  const m = { blend: false, test: false, needAlphaBlending: () => m.blend, needAlphaTesting: () => m.test }
  return m
}

function makeParticles(): ActiveListParticleSystem & { started: boolean; emitter: unknown } {
  const p = { started: false, emitter: {} as unknown, isStarted: () => p.started }
  return p
}

function makeCamera() {
  return { uniqueId: 7, fov: 0.85, globalPosition: { x: 0, y: 16, z: -21 } }
}

function makeScene() {
  const meshes = [makeMesh('a'), makeMesh('b'), makeMesh('c')]
  const materials = [makeMaterial(), makeMaterial()]
  const particleSystems = [makeParticles(), makeParticles()]
  const camera = makeCamera()
  const scene = { meshes, materials, particleSystems, activeCamera: camera as typeof camera | null }
  return { scene, meshes, materials, particleSystems, camera }
}

describe('RenderStateWatcher.sample', () => {
  it('is stable while nothing changes', () => {
    const { scene } = makeScene()
    const watcher = new RenderStateWatcher(scene)
    const first = watcher.sample()
    expect(watcher.sample()).toBe(first)
    expect(watcher.sample()).toBe(first)
  })

  const cases: Array<[string, (s: ReturnType<typeof makeScene>) => void]> = [
    ['a mesh is disabled', (s) => { s.meshes[1].enabled = false }],
    ['a mesh is hidden', (s) => { s.meshes[1].isVisible = false }],
    ['a mesh turns translucent via visibility', (s) => { s.meshes[1].visibility = 0.5 }],
    ['a mesh gets another material', (s) => { s.meshes[1].material = { uniqueId: 9 } }],
    ['a mesh loses its material', (s) => { s.meshes[1].material = null }],
    ['a material starts blending (it changes render group)', (s) => { s.materials[0].blend = true }],
    ['a material becomes alpha-tested', (s) => { s.materials[1].test = true }],
    ['a particle system starts', (s) => { s.particleSystems[0].started = true }],
    ['the scene switches particles off (the SceneOptimizer does)', (s) => { (s.scene as { particlesEnabled?: boolean }).particlesEnabled = false }],
    ['the camera moves half a unit', (s) => { s.camera.globalPosition.x += 0.5 }],
    ['the camera is swapped', (s) => { s.scene.activeCamera = { ...makeCamera(), uniqueId: 8 } }],
    ['the camera fov changes', (s) => { s.camera.fov = 1.1 }],
    ['the last camera goes away', (s) => { s.scene.activeCamera = null }],
  ]
  it.each(cases)('changes when %s', (_name, mutate) => {
    const s = makeScene()
    const watcher = new RenderStateWatcher(s.scene)
    const before = watcher.sample()
    mutate(s)
    expect(watcher.sample()).not.toBe(before)
  })

  it('changes when a started particle system loses its emitter', () => {
    const s = makeScene()
    s.particleSystems[0].started = true
    const watcher = new RenderStateWatcher(s.scene)
    const before = watcher.sample()
    s.particleSystems[0].emitter = null
    expect(watcher.sample()).not.toBe(before)
  })

  it('changes when a particle emitter mesh is disabled', () => {
    const s = makeScene()
    const emitter = makeMesh('emitter')
    s.particleSystems[0].started = true
    s.particleSystems[0].emitter = emitter
    const watcher = new RenderStateWatcher(s.scene)
    const before = watcher.sample()
    emitter.enabled = false
    expect(watcher.sample()).not.toBe(before)
  })

  it('ignores camera jitter well inside one grid step', () => {
    const s = makeScene()
    s.camera.globalPosition.x = 0.1
    const watcher = new RenderStateWatcher(s.scene)
    const before = watcher.sample()
    s.camera.globalPosition.x += 0.01
    s.camera.globalPosition.y += 0.02
    expect(watcher.sample()).toBe(before)
  })

  it('does not read meshes\' poses: a mover is not a change (the list is not frustum-clipped)', () => {
    const s = makeScene()
    const watcher = new RenderStateWatcher(s.scene)
    const before = watcher.sample()
    ;(s.meshes[0] as unknown as { position: { x: number } }).position = { x: 50 }
    expect(watcher.sample()).toBe(before)
  })
})

describe('FrozenActiveMeshes', () => {
  /** `clipped` meshes survive the frustum test, `unclipped` is what skipFrustumClipping selects. */
  function makeActiveScene(counts = { clipped: 10, unclipped: 12 }, extra: Partial<ActiveMeshesScene> = {}) {
    const s = makeScene()
    const calls: string[] = []
    const frozenMeshes: string[] = []
    const data = Array.from({ length: 256 }, (_, i) => ({ _freeze: () => { frozenMeshes.push(`m${i}`) } }))
    const active = { length: 0, data }
    const scene = {
      ...s.scene,
      skipFrustumClipping: false,
      updateTransformMatrix: () => { calls.push('updateTransformMatrix') },
      unfreezeActiveMeshes: () => { calls.push('unfreezeActiveMeshes') },
      _evaluateActiveMeshes: () => {
        calls.push(`evaluate(skip=${String(scene.skipFrustumClipping)})`)
        active.length = scene.skipFrustumClipping ? counts.unclipped : counts.clipped
      },
      _activeMeshes: active,
      _activeMeshesFrozen: false,
      _activeMeshesFrozenButKeepClipping: true,
      _skipEvaluateActiveMeshesCompletely: false,
      ...extra,
    } as unknown as ActiveMeshesScene
    return { scene, calls, frozenMeshes, meshes: s.meshes }
  }

  it('freezes the UNCLIPPED list, in the order Babylon does minus its readiness wait', () => {
    const { scene, calls, frozenMeshes } = makeActiveScene()
    const target = new FrozenActiveMeshes(scene)
    expect(target.isSupported).toBe(true)

    target.refreeze()

    expect(calls).toEqual(['updateTransformMatrix', 'evaluate(skip=false)', 'evaluate(skip=true)'])
    expect(scene.skipFrustumClipping, 'the scene setting is put back').toBe(false)
    expect(scene._activeMeshesFrozen).toBe(true)
    expect(scene._activeMeshesFrozenButKeepClipping).toBe(false)
    expect(scene._skipEvaluateActiveMeshesCompletely).toBe(true)
    expect(frozenMeshes).toHaveLength(12) // every mesh of the unclipped list
    expect(target.isFrozen).toBe(true)
    expect(target.declined).toBe(false)
  })

  it('restores a skipFrustumClipping the scene already had', () => {
    const { scene } = makeActiveScene(undefined, { skipFrustumClipping: true })
    new FrozenActiveMeshes(scene).refreeze()
    expect(scene.skipFrustumClipping).toBe(true)
  })

  it('declines when freezing would draw too many meshes off screen, and says so', () => {
    const { scene, frozenMeshes } = makeActiveScene({ clipped: 100, unclipped: Math.ceil(100 * MAX_OFFSCREEN_RATIO) + 1 })
    const target = new FrozenActiveMeshes(scene)

    target.refreeze()

    expect(target.isFrozen).toBe(false)
    expect(target.declined).toBe(true)
    expect(scene._activeMeshesFrozen).toBe(false)
    expect(frozenMeshes).toEqual([])
    expect(scene.skipFrustumClipping).toBe(false)
  })

  it('accepts a list right at the off-screen limit', () => {
    const { scene } = makeActiveScene({ clipped: 100, unclipped: Math.floor(100 * MAX_OFFSCREEN_RATIO) })
    const target = new FrozenActiveMeshes(scene)
    target.refreeze()
    expect(target.isFrozen).toBe(true)
  })

  it('a thaw clears the declined flag so the next attempt is a fresh one', () => {
    const { scene } = makeActiveScene({ clipped: 10, unclipped: 100 })
    const target = new FrozenActiveMeshes(scene)
    target.refreeze()
    expect(target.declined).toBe(true)
    target.thaw({ reason: 'x', materials: false, shadows: false })
    expect(target.declined).toBe(false)
  })

  it('refreezing a frozen list does nothing, and thaw only acts on a frozen one', () => {
    const { scene, calls } = makeActiveScene()
    const target = new FrozenActiveMeshes(scene)
    target.thaw({ reason: 'x', materials: false, shadows: false })
    expect(calls).toEqual([])

    target.refreeze()
    target.refreeze()
    expect(calls.filter((c) => c.startsWith('evaluate'))).toHaveLength(2) // one refreeze = two evaluations

    target.thaw({ reason: 'x', materials: false, shadows: false })
    expect(calls.at(-1)).toBe('unfreezeActiveMeshes')
    expect(target.isFrozen).toBe(false)
    target.thaw({ reason: 'x', materials: false, shadows: false })
    expect(calls.filter((c) => c === 'unfreezeActiveMeshes')).toHaveLength(1)
  })

  it('does nothing, without throwing, on a Babylon build that lacks the internals', () => {
    const { scene } = makeActiveScene(undefined, { _evaluateActiveMeshes: undefined, _activeMeshes: undefined })
    const target = new FrozenActiveMeshes(scene)
    expect(target.isSupported).toBe(false)
    expect(target.canRefreeze()).toBe(true)
    expect(() => target.refreeze()).not.toThrow()
    expect(target.isFrozen).toBe(false)
  })

  it('does not freeze without an active camera', () => {
    const { scene, calls } = makeActiveScene(undefined, { activeCamera: null })
    const target = new FrozenActiveMeshes(scene)
    target.refreeze()
    expect(calls).toEqual([])
    expect(target.isFrozen).toBe(false)
  })

  describe('canRefreeze', () => {
    it('waits for every visible mesh to be ready', () => {
      const { scene, meshes } = makeActiveScene()
      const target = new FrozenActiveMeshes(scene)
      meshes[1].ready = false
      expect(target.canRefreeze()).toBe(false)
      meshes[1].ready = true
      expect(target.canRefreeze()).toBe(true)
    })

    it('does not ask hidden, disabled or geometry-less meshes (asking compiles their shaders)', () => {
      const { scene, meshes } = makeActiveScene()
      const target = new FrozenActiveMeshes(scene)
      const isReady = vi.fn(() => false)
      for (const m of meshes) m.isReady = isReady
      meshes[0].isVisible = false
      meshes[1].enabled = false
      meshes[2].subMeshes = []
      expect(target.canRefreeze()).toBe(true)
      expect(isReady).not.toHaveBeenCalled()
    })
  })
})

describe('active-mesh freeze behind a StaticSceneGate', () => {
  function rig() {
    const observers: Array<() => void> = []
    const hostScene: StaticSceneGateHost = {
      onAfterRenderObservable: {
        add: (cb) => { observers.push(cb); return cb },
        remove: (o) => { observers.splice(observers.indexOf(o as () => void), 1) },
      },
    }
    const frames = (n: number) => { for (let i = 0; i < n; i++) [...observers].forEach((cb) => cb()) }
    const s = makeScene()
    const active = { length: 3, data: [{ _freeze: () => undefined }, { _freeze: () => undefined }, { _freeze: () => undefined }] }
    const scene = {
      ...s.scene,
      skipFrustumClipping: false,
      updateTransformMatrix: () => undefined,
      unfreezeActiveMeshes: vi.fn(),
      _evaluateActiveMeshes: () => undefined,
      _activeMeshes: active,
    } as unknown as ActiveMeshesScene
    const gate = new StaticSceneGate(hostScene, { watchMeshes: false })
    const target = new FrozenActiveMeshes(scene)
    gate.registerTarget(target)
    const watcher = new RenderStateWatcher(scene)
    gate.watchState('render-state', () => watcher.sample())
    return { gate, target, frames, meshes: s.meshes, camera: s.camera }
  }

  it('freezes once the scene is quiet, thaws on a visibility change, and refreezes', () => {
    const { gate, target, frames, meshes } = rig()
    gate.invalidate('boot')
    frames(FRAMES_BEFORE_REFREEZE)
    expect(target.isFrozen).toBe(true)

    meshes[0].isVisible = false
    frames(1)
    expect(target.isFrozen).toBe(false) // the watcher noticed, the gate thawed

    frames(FRAMES_BEFORE_REFREEZE)
    expect(target.isFrozen).toBe(true)
  })

  it('stays frozen while the camera re-aims and meshes move: neither is state the list depends on', () => {
    const { gate, target, frames, meshes } = rig()
    gate.invalidate('boot')
    frames(FRAMES_BEFORE_REFREEZE)
    expect(target.isFrozen).toBe(true)

    for (let i = 0; i < 60; i++) {
      ;(meshes[1] as unknown as { position?: { x: number } }).position = { x: i }
      frames(1)
    }
    expect(target.isFrozen).toBe(true)
    expect(gate.refreezeCount).toBe(1)
  })

  it('thaws when the camera is repositioned (LOD choices are frozen too)', () => {
    const { gate, target, frames, camera } = rig()
    gate.invalidate('boot')
    frames(FRAMES_BEFORE_REFREEZE)
    camera.globalPosition.z += 40
    frames(1)
    expect(target.isFrozen).toBe(false)
  })
})

describe('isActiveMeshFreezeEnabled', () => {
  it.each([
    ['', true],
    ['?debug=1', true],
    ['?freezeMeshes=1', true],
    ['?freezeMeshes=0', false],
    ['?renderer=webgl2&freezeMeshes=0', false],
  ])('%s -> %s', (search, expected) => {
    expect(isActiveMeshFreezeEnabled(search)).toBe(expected)
  })
})
