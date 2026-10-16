import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Tools } from '@babylonjs/core/Misc/tools'
import { createTimerScope, type TimerBase } from '../src/core/timers'

const cabinetLoad = vi.hoisted(() => ({ current: null as null | (() => Promise<void>) }))

vi.mock('../src/cabinet', () => ({
  getCabinetBuilder: () => ({
    setQualityTier: vi.fn(),
    loadCabinetPreset: () => cabinetLoad.current?.() ?? Promise.resolve(),
  }),
}))
vi.mock('../src/objects', () => ({ applyTableDecorations: vi.fn() }))
vi.mock('../src/materials', () => ({ getMaterialLibrary: vi.fn() }))
vi.mock('../src/game-elements', () => ({ CameraController: vi.fn() }))

import { FRAME_YIELD_TIMEOUT_MS, GameSceneBuilder, type SceneBuilderHost } from '../src/game/game-scene-builder'

interface FakeMesh {
  name: string
  uniqueId: number
  parent: unknown
}

/** Flush microtasks so everything not blocked on the cabinet promise has run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function deferred() {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Rig {
  builder: GameSceneBuilder
  host: { playfieldGroup: unknown }
  meshes: FakeMesh[]
  calls: string[]
  cabinet: ReturnType<typeof deferred>
}

function makeRig(opts: { rightJoint?: boolean; flipperCount?: number } = {}): Rig {
  const { rightJoint = true, flipperCount = 2 } = opts
  const meshes: FakeMesh[] = []
  const calls: string[] = []
  let nextId = 1
  const add = (name: string): FakeMesh => {
    const mesh = { name, uniqueId: nextId++, parent: null }
    meshes.push(mesh)
    return mesh
  }
  const cabinet = deferred()
  cabinetLoad.current = () => {
    calls.push('cabinet:start')
    return cabinet.promise.then(() => {
      // Late arrival, like a glTF container being added to the scene.
      add('cabinetBody')
      calls.push('cabinet:resolved')
    })
  }

  const flippers = new Map<string, { mesh: unknown; body: unknown; joint: unknown }>()
  const gameObjects = {
    createWalls: () => {
      add('wallLeft')
      calls.push('walls')
    },
    createFlippers: () => {
      for (let i = 0; i < flipperCount; i++) {
        const side = i === 0 ? 'left' : 'right'
        add('flipperBlade')
        flippers.set(side, {
          mesh: { setParent: vi.fn() },
          body: {},
          joint: side === 'right' && !rightJoint ? undefined : {},
        })
      }
      calls.push('flippers')
    },
    getAllFlippers: () => flippers,
  }
  const ballManager = {
    setMirrorTexture: vi.fn(),
    createMainBall: () => {
      add('ball')
      calls.push('ball')
    },
  }
  const display = {
    createBackbox: () => {
      add('cabinetBackbox')
      calls.push('backbox')
    },
  }
  const scene = { meshes, getMeshByName: () => null }

  const host = {
    timers: createTimerScope(),
    scene,
    physics: {},
    accessibility: {},
    qualityTier: 0,
    effects: null,
    display,
    gameObjects,
    ballManager,
    tableCam: null,
    cameraController: null,
    adventureMode: null,
    mirrorTexture: null,
    shadowGenerator: null,
    playfieldGroup: null as unknown,
    uiManager: null,
  }
  // The host surface is large and engine-typed; this test only exercises what buildCriticalScene reads.
  const builder = new GameSceneBuilder(host as unknown as SceneBuilderHost)
  vi.spyOn(builder, 'createLCDPlayfield').mockImplementation(() => {
    calls.push('lcd')
  })
  return { builder, host, meshes, calls, cabinet }
}

describe('GameSceneBuilder.buildCriticalScene', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.assign(Tools, { ToRadians: (deg: number) => (deg * Math.PI) / 180 })
  })

  it('builds walls, flippers and the ball while the cabinet loads, then holds the stage for it (#453)', async () => {
    const rig = makeRig()
    let settled = false
    const done = rig.builder.buildCriticalScene().then(() => {
      settled = true
    })

    await settle()
    expect(rig.calls).toEqual(['cabinet:start', 'lcd', 'walls', 'flippers', 'ball'])
    expect(settled).toBe(false) // Start must still wait for the cabinet

    rig.cabinet.resolve()
    await done
    expect(settled).toBe(true)
    // The backbox binds to the cabinet's 'cabinetBackbox' mesh, so it follows the cabinet.
    expect(rig.calls.slice(-2)).toEqual(['cabinet:resolved', 'backbox'])
  })

  it('reparents walls and flippers into playfieldGroup but never the cabinet, backbox or ball', async () => {
    const rig = makeRig()
    const done = rig.builder.buildCriticalScene()
    await settle()
    rig.cabinet.resolve()
    await done

    const byName = (name: string) => rig.meshes.find(m => m.name === name)
    const group = rig.host.playfieldGroup
    expect(group).toBeTruthy()
    expect(byName('wallLeft')?.parent).toBe(group)
    expect(byName('flipperBlade')?.parent).toBe(group)
    expect(byName('cabinetBody')?.parent).toBeNull()
    expect(byName('cabinetBackbox')?.parent).toBeNull()
    expect(byName('ball')?.parent).toBeNull()
  })

  it('propagates a cabinet load failure so the stage fails', async () => {
    const rig = makeRig()
    const done = rig.builder.buildCriticalScene()
    const assertion = expect(done).rejects.toThrow('cabinet exploded')
    await settle()
    rig.cabinet.reject(new Error('cabinet exploded'))
    await assertion
  })

  it('fails immediately, without waiting for the cabinet, when a flipper has no joint', async () => {
    const rig = makeRig({ rightJoint: false })

    // The cabinet promise never settles here: a stage that waited for it would hang.
    await expect(rig.builder.buildCriticalScene()).rejects.toThrow(/1\/2 flipper joints/)
    expect(rig.calls).not.toContain('backbox')

    // A later cabinet rejection must not surface as an unhandled rejection.
    rig.cabinet.reject(new Error('late failure'))
    await settle()
  })

  it('fails when fewer than two flippers were built', async () => {
    const rig = makeRig({ flipperCount: 1 })

    await expect(rig.builder.buildCriticalScene()).rejects.toThrow(/Critical scene incomplete: 1\/2 flipper joints, 1 flipper meshes/)
  })
})

describe('GameSceneBuilder.yieldFrame (#452)', () => {
  /** A scope whose animation frames only fire when the test says so, as in a hidden tab. */
  function makeFrameScope() {
    const frames: Array<(time: number) => void> = []
    const base: TimerBase = {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
      requestAnimationFrame: (fn) => frames.push(fn),
      cancelAnimationFrame: () => undefined,
    }
    const timers = createTimerScope(base)
    const builder = new GameSceneBuilder({ timers } as unknown as SceneBuilderHost)
    return { builder, frames, timers }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the fallback timeout when no frame ever fires (hidden tab)', async () => {
    const { builder } = makeFrameScope()
    let resolved = false
    const pending = builder.yieldFrame().then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(FRAME_YIELD_TIMEOUT_MS - 1)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(resolved).toBe(true)
  })

  it('resolves on the frame, well before the fallback timeout, when a frame does fire', async () => {
    const { builder, frames } = makeFrameScope()
    let resolved = false
    const pending = builder.yieldFrame().then(() => {
      resolved = true
    })

    frames[0]?.(16)
    await pending

    expect(resolved).toBe(true)
    // The losing timeout is harmless: it fires into an already-resolved promise.
    await vi.advanceTimersByTimeAsync(FRAME_YIELD_TIMEOUT_MS)
  })

  it('does not resolve once the owning scope is disposed (Game.dispose)', async () => {
    const { builder, timers } = makeFrameScope()
    timers.dispose()
    let resolved = false
    void builder.yieldFrame().then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(FRAME_YIELD_TIMEOUT_MS * 4)
    expect(resolved).toBe(false)
  })
})
