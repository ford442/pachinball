/**
 * PostProcessManager owns the scene post-process graph's plan (#461 Slice B): it resolves the tier,
 * plans the nodes, builds the graph lazily, re-plans on quality / accessibility, and degrades (with
 * the same telemetry as before) when WebGPU reports a uniform-buffer overflow or the graph cannot be
 * built. The graph itself is faked here (frame-graph-runtime is the lazy chunk); what the real one
 * does to pixels is asserted in tests/scene-frame-graph.spec.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QualityTier } from '../src/game-elements/visual-language'
import { PostProcessManager } from '../src/game/game-post-process'
import type { SceneGraphPlan } from '../src/game/scene-graph-plan'
import { ScenePostController } from '../src/game/scene-post-controller'
import {
  getGpuDegrades,
  getGpuProbe,
  resetGpuDegradesForTests,
  setActiveGpuFeatureLevel,
} from '../src/engine/gpu-degrade-telemetry'

interface FakeGraph {
  plans: SceneGraphPlan[]
  disposed: boolean
  rebuild: (plan: SceneGraphPlan) => Promise<void>
  dispose: () => void
  getInfo: () => { nodes: string[]; building: boolean }
}

const runtime = vi.hoisted(() => ({
  created: [] as Array<{ plan: SceneGraphPlan; graph: FakeGraph }>,
  failNextCreate: null as Error | null,
  gate: null as Promise<void> | null,
}))

vi.mock('../src/frame-graph-runtime', () => ({
  SceneFrameGraph: {
    async create(
      options: { controller: ScenePostController },
      plan: SceneGraphPlan,
    ): Promise<FakeGraph> {
      if (runtime.gate) await runtime.gate
      if (runtime.failNextCreate) {
        const err = runtime.failNextCreate
        runtime.failNextCreate = null
        throw err
      }
      const graph: FakeGraph = {
        plans: [plan],
        disposed: false,
        async rebuild(next) {
          graph.plans.push(next)
        },
        dispose() {
          graph.disposed = true
          options.controller.attach(null)
        },
        getInfo: () => ({ nodes: ['scene:render', ...graph.plans.at(-1)!.nodes.map((n) => `scene:${n}`)], building: false }),
      }
      options.controller.attach({ requestRebuild: () => undefined, dispose: () => graph.dispose() })
      runtime.created.push({ plan, graph })
      return graph
    },
  },
}))

type ErrorListener = (event: unknown) => void

function makeHost(opts: { webgpuCap?: number; reducedMotion?: boolean } = {}) {
  const device = (() => {
    const listeners: ErrorListener[] = []
    return {
      listeners,
      addEventListener: (_type: string, cb: ErrorListener) => listeners.push(cb),
      removeEventListener: (_type: string, cb: ErrorListener) => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      },
    }
  })()
  const webgpu = opts.webgpuCap !== undefined
  const engine = {
    getClassName: () => (webgpu ? 'WebGPUEngine' : 'Engine'),
    isWebGPU: webgpu,
    currentLimits: webgpu ? { maxUniformBuffersPerShaderStage: opts.webgpuCap } : undefined,
    _device: webgpu ? device : undefined,
    getCaps: () => ({ maxDrawBuffers: 8, textureFloatRender: true }),
    getDeltaTime: () => 16,
  }
  const imageProcessingConfiguration = { applyByPostProcess: false }
  const scene = {
    onBeforeRenderObservable: { add: vi.fn() },
    imageProcessingConfiguration,
    getEngine: () => engine,
    materials: [],
  }
  const host = {
    engine,
    signal: new AbortController().signal,
    scene,
    accessibility: { reducedMotion: opts.reducedMotion ?? false, effectIntensity: 1 },
    qualityTier: QualityTier.MEDIUM,
    tableCam: { position: { set: vi.fn(), copyFrom: vi.fn() } },
    bloomPipeline: null as ScenePostController | null,
    staticSceneGate: { invalidate: vi.fn() },
    eventBus: undefined,
    postProcessDegraded: false,
    effects: { setPipeline: vi.fn(), setQualityTier: vi.fn() },
  }
  return { host, device, config: imageProcessingConfiguration }
}

/** Wait for every build the manager has queued (the dynamic import of the runtime included). */
async function settle(manager: PostProcessManager): Promise<void> {
  await vi.waitFor(() => {
    if (manager.getGraphInfo().pending) throw new Error('graph build still pending')
  })
}

function setQuery(search: string): void {
  ;(globalThis as { window?: unknown }).window = { location: { search } }
}

describe('PostProcessManager', () => {
  beforeEach(() => {
    resetGpuDegradesForTests()
    runtime.created.length = 0
    runtime.failNextCreate = null
    runtime.gate = null
    setQuery('')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { window?: unknown }).window
  })

  it('builds the graph for the tier: WebGL2 gets the full node set, and the probe says so', async () => {
    const { host, config } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)

    expect(host.bloomPipeline).toBeInstanceOf(ScenePostController)
    expect(runtime.created).toHaveLength(1)
    expect(runtime.created[0]!.plan.nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
    expect(manager.getGraphInfo().graph?.nodes).toEqual([
      'scene:render', 'scene:bloom', 'scene:imageProcessing', 'scene:sharpen', 'scene:fxaa',
    ])
    expect(getGpuProbe().postProcessTier).toBe('full')
    expect(getGpuDegrades()).toEqual([])
    // Materials leave tone mapping to the node from the first compile, not once the chunk arrives.
    expect(config.applyByPostProcess).toBe(true)
    expect(host.bloomPipeline!.imageProcessing).not.toBeNull()
  })

  it('on a strict WebGPU adapter the plan has no image-processing node, and the boot degrade is recorded', async () => {
    setActiveGpuFeatureLevel('core')
    const { host, config } = makeHost({ webgpuCap: 12 })
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)

    expect(runtime.created[0]!.plan.nodes).toEqual(['bloom'])
    expect(runtime.created[0]!.plan.omitted).toContainEqual({ node: 'imageProcessing', reason: 'tier' })
    expect(host.postProcessDegraded).toBe(true)
    expect(host.bloomPipeline!.imageProcessing).toBeNull()
    expect(config.applyByPostProcess).toBe(false)
    const [entry] = getGpuDegrades()
    expect(entry).toMatchObject({ path: 'postprocess-tier-boot', featureLevel: 'core' })
    expect(entry!.detail).toContain('tier bloom-only')
    expect(getGpuProbe()).toMatchObject({ postProcessTier: 'bloom-only', maxUniformBuffersPerShaderStage: 12 })
  })

  it('?nopp=1 builds nothing: no controller, no graph', async () => {
    setQuery('?nopp=1')
    const { host } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)

    expect(host.bloomPipeline).toBeNull()
    expect(runtime.created).toEqual([])
    expect(manager.getGraphInfo()).toMatchObject({ plan: null, graph: null })
  })

  it('a uniform-buffer overflow downgrades to none: graph disposed, controller gone, telemetry recorded', async () => {
    setActiveGpuFeatureLevel('compatibility')
    const { host, device, config } = makeHost({ webgpuCap: 24 })
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)
    expect(runtime.created[0]!.plan.nodes).toContain('imageProcessing')

    expect(device.listeners).toHaveLength(1)
    device.listeners[0]!({
      error: { message: 'The number of uniform buffers (17) in the Vertex stage exceeds the maximum per-stage limit (12).' },
    })

    expect(runtime.created[0]!.graph.disposed).toBe(true)
    expect(host.bloomPipeline).toBeNull()
    expect(host.effects.setPipeline).toHaveBeenCalledWith(null)
    expect(host.postProcessDegraded).toBe(true)
    expect(config.applyByPostProcess).toBe(false)
    const runtimeEntry = getGpuDegrades().find((d) => d.path === 'postprocess-tier-runtime')
    expect(runtimeEntry).toMatchObject({ featureLevel: 'compatibility' })
    expect(runtimeEntry!.detail).toContain('full → none')
    expect(manager.getGraphInfo().plan?.nodes).toEqual([])

    // The same error repeats every frame: it must not record, or rebuild, again.
    device.listeners[0]?.({ error: { message: 'uniform buffers exceeds the maximum' } })
    expect(getGpuDegrades().filter((d) => d.path === 'postprocess-tier-runtime')).toHaveLength(1)
  })

  it('ignores WebGPU errors that are not uniform-buffer overflows', async () => {
    const { host, device } = makeHost({ webgpuCap: 24 })
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)
    device.listeners[0]!({ error: { message: 'Dimension (Cube) must match textureBindingViewDimension' } })
    expect(runtime.created[0]!.graph.disposed).toBe(false)
    expect(host.bloomPipeline).not.toBeNull()
    expect(getGpuDegrades()).toEqual([])
  })

  it('a graph that cannot be built is tier none: recorded as a runtime degrade, post-processing off', async () => {
    runtime.failNextCreate = new Error('chunk fetch failed')
    const { host, config } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)

    expect(host.bloomPipeline).toBeNull()
    expect(host.postProcessDegraded).toBe(true)
    expect(config.applyByPostProcess).toBe(false)
    expect(manager.getGraphInfo().error).toBe('chunk fetch failed')
    const entry = getGpuDegrades().find((d) => d.path === 'postprocess-tier-runtime')
    expect(entry!.detail).toContain('full → none')
    expect(entry!.detail).toContain('scene graph build failed: chunk fetch failed')
  })

  it('a quality tier change re-plans: LOW drops sharpen, MEDIUM brings it back', async () => {
    const { host } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)
    const graph = runtime.created[0]!.graph

    manager.applyQualityTier(QualityTier.LOW)
    await settle(manager)
    expect(graph.plans.at(-1)!.nodes).toEqual(['bloom', 'imageProcessing', 'fxaa'])
    expect(host.bloomPipeline).toMatchObject({ bloomKernel: 16, bloomScale: 0.2 })
    expect(host.bloomPipeline!.bloomWeight).toBeLessThanOrEqual(0.12)

    manager.applyQualityTier(QualityTier.MEDIUM)
    await settle(manager)
    expect(graph.plans.at(-1)!.nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
    expect(host.bloomPipeline).toMatchObject({ bloomKernel: 32, bloomScale: 0.35 })
    expect(runtime.created).toHaveLength(1) // one graph, rebuilt, not recreated
  })

  it('applying the tier it already has does not rebuild', async () => {
    const { host } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)
    const graph = runtime.created[0]!.graph
    manager.applyQualityTier(QualityTier.MEDIUM)
    await settle(manager)
    expect(graph.plans).toHaveLength(1)
  })

  it('HIGH-only nodes are planned on HIGH only where the context can afford them', async () => {
    const afford = makeHost()
    const manager = new PostProcessManager(afford.host as never)
    manager.setup()
    await settle(manager)
    manager.applyQualityTier(QualityTier.HIGH)
    await settle(manager)
    expect(runtime.created[0]!.graph.plans.at(-1)!.nodes).toEqual([
      'ssao', 'ssr', 'motionBlur', 'bloom', 'imageProcessing', 'sharpen', 'fxaa',
    ])

    const few = makeHost()
    few.host.engine.getCaps = () => ({ maxDrawBuffers: 2, textureFloatRender: true })
    const second = new PostProcessManager(few.host as never)
    second.setup()
    await settle(second)
    second.applyQualityTier(QualityTier.HIGH)
    await settle(second)
    expect(runtime.created[1]!.graph.plans.at(-1)!.nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
    expect(few.host.postProcessDegraded).toBe(true)
  })

  it('syncAccessibility: reduced motion drops bloom, sharpen and the vignette; off brings them back', async () => {
    const { host } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    await settle(manager)
    const graph = runtime.created[0]!.graph

    host.accessibility = { reducedMotion: true, effectIntensity: 1 }
    manager.syncAccessibility()
    await settle(manager)
    expect(graph.plans.at(-1)).toMatchObject({ nodes: ['imageProcessing', 'fxaa'], vignette: false })
    expect(host.bloomPipeline!.imageProcessingState.vignetteEnabled).toBe(false)

    host.accessibility = { reducedMotion: false, effectIntensity: 1 }
    manager.syncAccessibility()
    await settle(manager)
    expect(graph.plans.at(-1)!.nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
  })

  it('dispose() disposes the graph and the controller once, even while a build is still pending', async () => {
    let release!: () => void
    runtime.gate = new Promise<void>((resolve) => { release = resolve })
    const { host } = makeHost()
    const manager = new PostProcessManager(host as never)
    manager.setup()
    expect(manager.getGraphInfo().pending).toBe(true)

    manager.dispose()
    manager.dispose()
    release()
    await settle(manager)

    // The build finished after dispose: it must not install a graph into a disposed manager.
    expect(runtime.created.every((c) => c.graph.disposed)).toBe(true)
    expect(manager.getGraphInfo().graph).toBeNull()
    expect(host.bloomPipeline).toBeNull()
  })
})
