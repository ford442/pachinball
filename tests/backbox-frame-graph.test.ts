/**
 * BackboxFrameGraph wiring (#461 Slice A): which tasks exist and in what order, the per-frame
 * pass-through of CRT / jackpot, layer meshes moving off the scene camera's mask and back.
 *
 * Babylon is mocked at the module boundary with just enough of the Frame Graph surface to record
 * what the graph builds; rendering itself is covered by tests/backbox-frame-graph.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => {
  let handles = 100
  const nextHandle = () => handles++

  class Task {
    disabled = false
    readonly outputTexture = nextHandle()
    readonly outputDepthTexture = nextHandle()
    targetTexture?: number
    sourceTexture?: number
    depthTexture?: number
    constructor(public name: string) {}
    getClassName() {
      return this.constructor.name
    }
  }
  class FrameGraphClearTextureTask extends Task {}
  class FrameGraphCopyToTextureTask extends Task {}
  class FrameGraphObjectRendererTask extends Task {
    objectList = { meshes: [] as unknown[], particleSystems: [] as unknown[] }
    camera: unknown
    depthTest = true
    depthWrite = true
    disableImageProcessing = false
    disableShadows = false
  }
  class FrameGraphCustomPostProcessTask extends Task {
    applies: Array<(e: unknown) => void> = []
    onApplyObservable = { add: (fn: (e: unknown) => void) => this.applies.push(fn) }
    constructor(name: string, _fg: unknown, public options: { fragmentShader: string }) {
      super(name)
    }
  }
  class FrameGraph {
    static instances: FrameGraph[] = []
    tasks: Task[] = []
    builds = 0
    executions: Array<Array<[string, boolean]>> = []
    disposed = false
    textureManager = {
      createRenderTargetTexture: () => nextHandle(),
      importTexture: () => nextHandle(),
    }
    constructor() {
      FrameGraph.instances.push(this)
    }
    addTask(t: Task) {
      this.tasks.push(t)
    }
    clear() {
      this.tasks = []
    }
    active = 0
    maxActive = 0
    failNext = false
    async buildAsync() {
      this.builds++
      this.active++
      this.maxActive = Math.max(this.maxActive, this.active)
      // Babylon's buildAsync awaits before it records the tasks: give an overlapping build room to interleave.
      await new Promise((r) => setTimeout(r, 0))
      this.active--
      if (this.failNext) {
        this.failNext = false
        throw new Error('build failed')
      }
    }
    async whenReadyAsync() {}
    execute() {
      this.executions.push(this.tasks.map((t) => [t.name, t.disabled]))
    }
    dispose() {
      this.disposed = true
    }
  }

  const mkMesh = (name: string) => ({
    name,
    layerMask: 0x0fffffff,
    isVisible: true,
    enabled: true,
    isEnabled() {
      return this.enabled
    },
    isDisposed: () => false,
    setEnabled(v: boolean) {
      this.enabled = v
    },
    parent: null as unknown,
    position: { z: 0 },
    isPickable: true,
    material: null as unknown,
    dispose: vi.fn(),
  })

  return {
    Task,
    FrameGraph,
    FrameGraphClearTextureTask,
    FrameGraphCopyToTextureTask,
    FrameGraphObjectRendererTask,
    FrameGraphCustomPostProcessTask,
    mkMesh,
  }
})

vi.mock('@babylonjs/core', () => ({
  Camera: { ORTHOGRAPHIC_CAMERA: 1 },
  FreeCamera: class {
    parent: unknown = null
    rotation = { y: 0 }
    mode = 0
    layerMask = 0x0fffffff
    dispose = vi.fn()
  },
  Constants: new Proxy({}, { get: () => 0 }),
  FrameGraph: hoisted.FrameGraph,
  FrameGraphClearTextureTask: hoisted.FrameGraphClearTextureTask,
  FrameGraphCopyToTextureTask: hoisted.FrameGraphCopyToTextureTask,
  FrameGraphObjectRendererTask: hoisted.FrameGraphObjectRendererTask,
  FrameGraphCustomPostProcessTask: hoisted.FrameGraphCustomPostProcessTask,
  StandardMaterial: class {
    dispose = vi.fn()
  },
  BaseTexture: class {
    name = ''
    dispose = vi.fn()
  },
  Color3: { Black: () => ({}) },
  Color4: class {},
  Vector3: class {},
  MeshBuilder: { CreatePlane: (name: string) => hoisted.mkMesh(name) },
}))

import { BackboxFrameGraph, BACKBOX_LAYER_MASK, type BackboxEffectPass } from '../src/display/backbox-frame-graph'
import { planBackboxGraph, type BackboxGraphFlags } from '../src/display/backbox-graph-plan'
import { QualityTier } from '../src/game-elements/visual-language'

type FakeMesh = ReturnType<typeof hoisted.mkMesh>

function setup() {
  let beforeRender: (() => void) | null = null
  const scene = {
    postProcessesEnabled: true,
    getEngine: () => ({
      isWebGPU: false,
      createRenderTargetTexture: () => ({ texture: { incrementReferences: vi.fn() }, dispose: vi.fn() }),
    }),
    onBeforeRenderObservable: {
      add: (fn: () => void) => {
        beforeRender = fn
        return { fn }
      },
      remove: vi.fn(() => {
        beforeRender = null
      }),
    },
  }
  const meshes = {
    physical: [hoisted.mkMesh('drum0'), hoisted.mkMesh('backdrop')],
    grid: [hoisted.mkMesh('shaderBg')],
    reels: [hoisted.mkMesh('displayReels')],
    video: [hoisted.mkMesh('displayVideo')],
    image: [hoisted.mkMesh('displayImage')],
    character: [] as FakeMesh[],
    lcd: [hoisted.mkMesh('displayLcd')],
  }
  const active = { crt: false, jackpot: false }
  const pass = (name: string, key: 'crt' | 'jackpot'): BackboxEffectPass => ({
    fragmentShader: name,
    uniforms: ['uTime'],
    samplers: [],
    isActive: () => active[key],
    bind: vi.fn(),
  })
  const onLayerMasksChanged = vi.fn()
  const options = {
    scene: scene as never,
    root: {} as never,
    displayWidth: 20,
    displayHeight: 12,
    planeZ: -0.75,
    layers: (Object.keys(meshes) as Array<keyof typeof meshes>).map((id) => ({ id, meshes: () => meshes[id] as never[] })),
    effects: { crt: pass('crtEffect', 'crt'), jackpot: pass('jackpotOverlay', 'jackpot'), jackpotStill: pass('jackpotOverlay', 'jackpot') },
    onLayerMasksChanged,
  }
  const frame = () => beforeRender?.()
  return { options, meshes, active, frame, scene, onLayerMasksChanged, hasObserver: () => beforeRender !== null }
}

const FLAGS: BackboxGraphFlags = { photosensitive: false, reducedMotion: false, noPostProcess: false }
const plan = (flags: Partial<BackboxGraphFlags> = {}) => planBackboxGraph({ ...FLAGS, ...flags }, QualityTier.MEDIUM, 20 / 12)
const lastGraph = () => hoisted.FrameGraph.instances[hoisted.FrameGraph.instances.length - 1]!

describe('BackboxFrameGraph', () => {
  beforeEach(() => {
    hoisted.FrameGraph.instances.length = 0
  })

  it('builds clear → one task per layer in order → CRT → jackpot', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    expect(graph.getInfo().nodes).toEqual([
      'backbox:clear',
      'backbox:physical',
      'backbox:grid',
      'backbox:reels',
      'backbox:video',
      'backbox:image',
      'backbox:character',
      'backbox:lcd',
      'backbox:crt',
      'backbox:jackpot',
    ])
    const tasks = lastGraph().tasks
    // Each layer draws over the previous one's output: the order is the composite.
    for (let i = 1; i < tasks.length; i++) {
      const input = tasks[i]!.targetTexture ?? tasks[i]!.sourceTexture
      if (tasks[i]!.name === 'backbox:jackpot') continue // writes the imported output
      expect(input, tasks[i]!.name).toBe(tasks[i - 1]!.outputTexture)
    }
    const physical = tasks.find((x) => x.name === 'backbox:physical') as InstanceType<typeof hoisted.FrameGraphObjectRendererTask>
    const lcd = tasks.find((x) => x.name === 'backbox:lcd') as InstanceType<typeof hoisted.FrameGraphObjectRendererTask>
    expect(physical.depthTest).toBe(true)
    expect(lcd.depthTest).toBe(false)
    expect(lcd.disableImageProcessing).toBe(true)
  })

  it('photosensitive and ?nopp=1 graphs have no CRT or jackpot task, only a copy to the output', async () => {
    for (const flags of [{ photosensitive: true }, { noPostProcess: true }]) {
      const t = setup()
      const graph = await BackboxFrameGraph.create(t.options, plan(flags))
      const nodes = graph.getInfo().nodes
      expect(nodes).not.toContain('backbox:crt')
      expect(nodes).not.toContain('backbox:jackpot')
      expect(nodes[nodes.length - 1]).toBe('backbox:output')
    }
  })

  it('reduced motion builds the still jackpot pass', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan({ reducedMotion: true }))
    expect(graph.getInfo().nodes.slice(-2)).toEqual(['backbox:crt', 'backbox:jackpotStill'])
  })

  it('passes CRT and jackpot through unless active, and skips layers with nothing visible', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    const fg = lastGraph()
    t.meshes.video[0]!.isVisible = false

    t.frame()
    let run = new Map(fg.executions.at(-1))
    expect(run.get('backbox:crt')).toBe(true)
    expect(run.get('backbox:jackpot')).toBe(true)
    expect(run.get('backbox:video')).toBe(true)
    expect(run.get('backbox:character')).toBe(true) // not loaded yet
    expect(run.get('backbox:lcd')).toBe(false)

    t.active.crt = true
    t.active.jackpot = true
    t.meshes.character.push(hoisted.mkMesh('displayCharacter'))
    t.frame()
    run = new Map(fg.executions.at(-1))
    expect(run.get('backbox:crt')).toBe(false)
    expect(run.get('backbox:jackpot')).toBe(false)
    expect(run.get('backbox:character')).toBe(false)
    expect(graph.getInfo().activeEffects).toEqual(['crt', 'jackpot'])

    // The SceneOptimizer turned post-processing off: the glass passes copy through.
    t.scene.postProcessesEnabled = false
    t.frame()
    run = new Map(fg.executions.at(-1))
    expect(run.get('backbox:crt')).toBe(true)
    expect(run.get('backbox:jackpot')).toBe(true)
  })

  it('on a software rasteriser, executes every frameInterval-th frame but still adopts late meshes each frame', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan({ softwareRaster: true }))
    const fg = lastGraph()
    expect(graph.getInfo()).toMatchObject({ width: 512, frameInterval: 3 })

    for (let i = 0; i < 6; i++) t.frame()
    expect(fg.executions.length).toBe(2)

    t.frame() // frame 6 executes
    const late = hoisted.mkMesh('displayCharacter')
    t.meshes.character.push(late)
    t.frame() // frame 7 is skipped, but the mesh still leaves the scene camera
    expect(fg.executions.length).toBe(3)
    expect(late.layerMask).toBe(BACKBOX_LAYER_MASK)
  })

  it('moves layer meshes off the scene camera mask, including late ones, and hands them back on dispose', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    expect(t.meshes.lcd[0]!.layerMask).toBe(BACKBOX_LAYER_MASK)
    expect(t.meshes.physical[0]!.layerMask).toBe(BACKBOX_LAYER_MASK)
    expect(t.onLayerMasksChanged).toHaveBeenCalledTimes(1)

    t.frame()
    expect(t.onLayerMasksChanged).toHaveBeenCalledTimes(1) // nothing new

    const late = hoisted.mkMesh('displayCharacter')
    t.meshes.character.push(late)
    t.frame()
    expect(late.layerMask).toBe(BACKBOX_LAYER_MASK)
    expect(t.onLayerMasksChanged).toHaveBeenCalledTimes(2)
    expect(graph.plane.isEnabled()).toBe(true)

    graph.dispose()
    expect(t.hasObserver()).toBe(false)
    expect(lastGraph().disposed).toBe(true)
    for (const m of [late, t.meshes.lcd[0]!, t.meshes.physical[1]!]) expect(m.layerMask).toBe(0x0fffffff)
  })

  it('rebuilds only when the node set changes', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    const fg = lastGraph()
    await graph.rebuild(plan())
    expect(fg.builds).toBe(1)
    await graph.rebuild(plan({ photosensitive: true }))
    expect(fg.builds).toBe(2)
    expect(graph.getInfo().nodes).not.toContain('backbox:crt')
    await graph.rebuild(plan())
    expect(graph.getInfo().nodes).toContain('backbox:crt')
  })

  it('ends on the latest plan when a setting flips back while a rebuild compiles', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    const first = graph.rebuild(plan({ photosensitive: true }))
    const second = graph.rebuild(plan())
    await Promise.all([first, second])
    expect(graph.getInfo().nodes).toContain('backbox:crt')
    expect(graph.getInfo().effects).toEqual(['crt', 'jackpot'])
  })

  it('never runs two builds on the one FrameGraph at once', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    const fg = lastGraph()
    await Promise.all([
      graph.rebuild(plan({ photosensitive: true })),
      graph.rebuild(plan({ reducedMotion: true })),
      graph.rebuild(plan({ noPostProcess: true })),
    ])
    expect(fg.maxActive).toBe(1)
    // All three requests land before the queue's turn: the two superseded ones are skipped, not built.
    expect(fg.builds).toBe(2) // create, then noPostProcess
    expect(graph.getInfo().nodes.at(-1)).toBe('backbox:output')
  })

  it('a failed rebuild shows the layers on the scene camera and does not block asking again', async () => {
    const t = setup()
    const graph = await BackboxFrameGraph.create(t.options, plan())
    const fg = lastGraph()
    fg.failNext = true
    await expect(graph.rebuild(plan({ photosensitive: true }))).rejects.toThrow('build failed')
    // The old graph is gone: the layers go back to the scene camera and the composite plane hides.
    expect(t.meshes.lcd[0]!.layerMask).toBe(0x0fffffff)
    expect(graph.plane.isEnabled()).toBe(false)
    expect(t.onLayerMasksChanged).toHaveBeenCalledTimes(2) // adopt, release
    await graph.rebuild(plan({ photosensitive: true }))
    expect(t.meshes.lcd[0]!.layerMask).toBe(BACKBOX_LAYER_MASK)
    expect(graph.plane.isEnabled()).toBe(true)
    expect(graph.getInfo().nodes).not.toContain('backbox:crt')
    t.frame()
    expect(fg.executions.length).toBeGreaterThan(0)
  })
})
