import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { FRAMES_BEFORE_REFREEZE } from '../src/core/static-scene-gate'
import { installStaticScene, type StaticSceneInstallInputs } from '../src/game/static-scene-install'

class FakeObservable {
  observers: Array<() => void> = []
  add(callback: () => void): () => void {
    this.observers.push(callback)
    return callback
  }
  remove(observer: unknown): void {
    this.observers = this.observers.filter((o) => o !== observer)
  }
  notify(): void {
    for (const callback of [...this.observers]) callback()
  }
}

function makeMaterial(name: string) {
  return { name, isFrozen: false, freeze() { this.isFrozen = true }, unfreeze() { this.isFrozen = false } }
}

function makeScene(opts: { internals?: boolean; skybox?: boolean } = {}) {
  const { internals = false, skybox = true } = opts
  const afterRender = new FakeObservable()
  const beforeRender = new FakeObservable()
  const camera = { uniqueId: 1, fov: 0.85, globalPosition: { x: 0, y: 16, z: -21 }, maxZ: 10_000 }
  const scene = {
    onAfterRenderObservable: afterRender,
    onBeforeRenderObservable: beforeRender,
    onNewMeshAddedObservable: new FakeObservable(),
    onMeshRemovedObservable: new FakeObservable(),
    meshes: [] as unknown[],
    materials: [] as unknown[],
    particleSystems: [] as unknown[],
    activeCamera: camera,
    autoClear: true,
    fogEnabled: true,
    fogMode: 2,
    fogDensity: 0.015,
    fogColor: { r: 0.1, g: 0.1, b: 0.2 },
    skipFrustumClipping: false,
    getMeshByName: (name: string) =>
      skybox && name === 'skybox' ? { isVisible: true, isEnabled: () => true, position: { x: 0, y: 0, z: 0 } } : null,
    updateTransformMatrix: () => undefined,
    unfreezeActiveMeshes: () => undefined,
    ...(internals ? { _evaluateActiveMeshes: () => undefined, _activeMeshes: { length: 0, data: [] } } : {}),
  }
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      beforeRender.notify()
      afterRender.notify()
    }
  }
  return { scene, frames, afterRender, beforeRender }
}

function inputs(scene: unknown, over: Partial<StaticSceneInstallInputs> = {}): StaticSceneInstallInputs {
  return {
    scene: scene as never,
    eventBus: new EventBus(),
    search: '',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141',
    skyboxSize: 200,
    frozenMaterials: [],
    ...over,
  }
}

describe('installStaticScene', () => {
  it('freezes the allowlist after the install invalidation settles, and thaws it for a material change', () => {
    const { scene, frames } = makeScene()
    const a = makeMaterial('a')
    const b = makeMaterial('b')
    const install = installStaticScene(inputs(scene, { frozenMaterials: [[a, 'why a'], [b, 'why b']] }))

    expect(install.materials.describe()).toEqual([['a', 'why a'], ['b', 'why b']])
    expect(a.isFrozen).toBe(false)
    frames(FRAMES_BEFORE_REFREEZE)
    expect([a.isFrozen, b.isFrozen]).toEqual([true, true])

    install.gate.invalidate('quality-tier', { materials: true })
    expect(a.isFrozen).toBe(false)
  })

  it('hands the light clamp to the frozen set, so a refreeze clamps first', () => {
    const { scene, frames } = makeScene()
    const order: string[] = []
    const a = { ...makeMaterial('a'), freeze() { order.push('freeze') } }
    installStaticScene(inputs(scene, { frozenMaterials: [[a, 'x']], clampLights: () => { order.push('clamp') } }))
    frames(FRAMES_BEFORE_REFREEZE)
    expect(order).toEqual(['clamp', 'freeze'])
  })

  it('a fog change thaws the frozen materials', () => {
    const { scene, frames } = makeScene()
    const a = makeMaterial('a')
    installStaticScene(inputs(scene, { frozenMaterials: [[a, 'x']] }))
    frames(FRAMES_BEFORE_REFREEZE)
    expect(a.isFrozen).toBe(true)

    scene.fogDensity += 0.004
    frames(1)
    expect(a.isFrozen).toBe(false)
    frames(FRAMES_BEFORE_REFREEZE)
    expect(a.isFrozen).toBe(true)
  })

  it('wires the active-mesh target when the Babylon internals exist, and not otherwise', () => {
    expect(installStaticScene(inputs(makeScene({ internals: true }).scene)).activeMeshes).not.toBeNull()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(installStaticScene(inputs(makeScene({ internals: false }).scene)).activeMeshes).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Active-mesh freeze unavailable'))
    warn.mockRestore()
  })

  it('?freezeMeshes=0 leaves the active-mesh list alone', () => {
    const { scene } = makeScene({ internals: true })
    expect(installStaticScene(inputs(scene, { search: '?freezeMeshes=0' })).activeMeshes).toBeNull()
  })

  it('skips the colour clear under the skybox (not on a phone), and works without a skybox', () => {
    const desktop = makeScene()
    installStaticScene(inputs(desktop.scene))
    desktop.frames(1)
    expect(desktop.scene.autoClear).toBe(false)

    const phone = makeScene()
    installStaticScene(inputs(phone.scene, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' }))
    phone.frames(1)
    expect(phone.scene.autoClear).toBe(true)

    expect(() => installStaticScene(inputs(makeScene({ skybox: false }).scene))).not.toThrow()
  })

  it('dispose removes every observer it added, restores autoClear and ignores later events', () => {
    const { scene, frames, afterRender, beforeRender } = makeScene({ internals: true })
    const bus = new EventBus()
    const a = makeMaterial('a')
    const install = installStaticScene(inputs(scene, { eventBus: bus, frozenMaterials: [[a, 'x']] }))
    frames(FRAMES_BEFORE_REFREEZE)
    expect(scene.autoClear).toBe(false)

    install.dispose()

    expect(afterRender.observers).toHaveLength(0)
    expect(beforeRender.observers).toHaveLength(0)
    expect(scene.onNewMeshAddedObservable.observers).toHaveLength(0)
    expect(scene.autoClear).toBe(true)
    bus.emit('fever:start')
    expect(install.gate.getStats().holds).toBe(0)
    expect(install.materials.size).toBe(0)
  })
})
