/**
 * Scene post-process Frame Graph (#461 Slice B): bloom, image processing, sharpen and FXAA as graph
 * nodes instead of one `DefaultRenderingPipeline`.
 *
 *   scene:render ─▶ [bloom] ─▶ [imageProcessing] ─▶ [sharpen] ─▶ [fxaa] ─▶ canvas
 *
 * Which nodes exist is `planSceneGraph()`'s decision (tier, accessibility, `?nopp=1`). A node that is
 * not in the plan is never built, so on a 12-uniform-buffer adapter the image-processing pass binds
 * nothing at all. Nothing here probes adapter limits or asks for device features.
 *
 * `scene:render` is the scene camera's own render, written to an HDR texture through
 * `camera.outputRenderTarget`, which the graph imports. The scene is NOT rendered by
 * `scene.frameGraph`: Babylon's frame-graph scene path skips the shadow-map and material render
 * targets the camera path gathers (so the key light's shadow map and the mirror would stop being
 * drawn), nulls `scene.activeCamera` every frame, and bypasses the active-mesh freeze
 * (`frozen-active-meshes.ts`). The graph is the post chain only, like the backbox graph is its own
 * graph: it runs once per frame from `scene.onAfterRenderObservable`, after the camera render.
 *
 * Rebuilds are double-buffered. A new generation (a FrameGraph) compiles beside the running one and
 * replaces it in one step, so a resize, a bloom-scale change or a tier downgrade never shows an
 * unprocessed frame. Until the first generation is ready, and whenever the scene optimizer has
 * switched post-processing off, the camera renders straight to the canvas.
 *
 * The scene colour target is ONE `RenderTargetTexture` for the graph's whole life, never one per
 * generation. A camera that renders into a target renders with that target's render-pass id, and a
 * material compiles one variant per pass id: a new target per rebuild recompiles the whole scene,
 * and a scene whose active-mesh list is frozen (`frozen-active-meshes.ts`) never asks for the new
 * variants, so it stays black. A resize builds the next generation against a same-size staging
 * texture and resizes the one target at the moment of the swap.
 *
 * Knobs come from `ScenePostController` (which `EffectsSystem` writes to); only what changed since
 * the last frame is pushed to the nodes.
 */

import '@babylonjs/core/Engines/Extensions/engine.renderTarget'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTarget'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { Constants } from '@babylonjs/core/Engines/constants'
import { FrameGraph } from '@babylonjs/core/FrameGraph/frameGraph'
import { backbufferColorTextureHandle, type FrameGraphTextureHandle } from '@babylonjs/core/FrameGraph/frameGraphTypes'
import type { FrameGraphTask } from '@babylonjs/core/FrameGraph/frameGraphTask'
import { FrameGraphBloomTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/bloomTask'
import { FrameGraphFXAATask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/fxaaTask'
import { FrameGraphImageProcessingTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/imageProcessingTask'
import { FrameGraphSharpenTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/sharpenTask'
import type { RenderTargetWrapper } from '@babylonjs/core/Engines/renderTargetWrapper'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import type { Observer } from '@babylonjs/core/Misc/observable'
import { ThinImageProcessingPostProcess } from '@babylonjs/core/PostProcesses/thinImageProcessingPostProcess'
import type { Scene } from '@babylonjs/core/scene'
import {
  SCENE_HEAVY_NODES,
  sameSceneGraph,
  type SceneGraphNodeId,
  type SceneGraphPlan,
} from './scene-graph-plan'
import { addGeometryPass, createHeavyTask, type GeometryPass } from './scene-heavy-nodes'
import type { ScenePostController, ScenePostOwner } from './scene-post-controller'

/** Rendered frames a new canvas size must hold still before the graph is rebuilt for it. */
export const RESIZE_SETTLE_FRAMES = 8

/**
 * How long a new generation may take to compile before the build is given up. The geometry pass
 * compiles a variant of every material in the scene, which a software rasteriser needs minutes for;
 * the running generation keeps drawing meanwhile, so waiting costs nothing the player can see.
 */
const READY_TIMEOUT_MS = 10_000
const HEAVY_READY_TIMEOUT_MS = 180_000

const SHARPEN_EDGE_AMOUNT = 0.3

export interface SceneFrameGraphOptions {
  scene: Scene
  /** The camera whose render is post-processed. Another active camera renders straight to the canvas. */
  camera: Camera
  controller: ScenePostController
  /**
   * Called before the graph changes whether materials leave image processing to a post-process
   * (`applyByPostProcess`): every material recompiles, which a frozen scene would not pick up.
   */
  onMaterialsInvalidated?: () => void
  /**
   * Called before the camera renders with a render-pass id it has not rendered with yet (the first
   * frame into the target, or the first frame straight to the canvas): a frozen scene must thaw to
   * compile the materials for it.
   */
  onRenderPassChanged?: () => void
}

export interface SceneGraphInfo {
  backend: 'webgpu' | 'webgl2'
  /** `scene:render`, then the built tasks in execution order. */
  nodes: string[]
  /** The plan the running generation was built from. */
  planned: SceneGraphNodeId[]
  omitted: Array<SceneGraphPlan['omitted'][number]>
  width: number
  height: number
  /** The scene colour texture is half float (HDR); otherwise 8-bit. */
  hdr: boolean
  executedFrames: number
  /** Generations swapped in so far: moves whenever the node set, the bloom scale or the size changed. */
  generation: number
  /** The camera is rendering into the graph this frame; false means it renders straight to the canvas. */
  active: boolean
  /** A new generation is compiling. */
  building: boolean
}

/** What the nodes were last given, so a frame only pushes what moved. */
interface Applied {
  bloomWeight: number
  bloomKernel: number
  bloomThreshold: number
  bloomExposure: number
  bloomEnabled: boolean | null
  sharpenEnabled: boolean | null
  imageProcessingVersion: number
}

/** A node of the post chain: reads the previous node's output, and the last one writes the canvas. */
type ChainTask = FrameGraphTask & {
  sourceTexture?: FrameGraphTextureHandle
  targetTexture?: FrameGraphTextureHandle
  readonly outputTexture: FrameGraphTextureHandle
}

/** One compiled graph with the render target it reads. */
interface Generation {
  plan: SceneGraphPlan
  bloomScale: number
  width: number
  height: number
  hdr: boolean
  /** The handle of the imported scene colour; re-pointed at the real target when a staging one was used. */
  sceneHandle: FrameGraphTextureHandle
  /** A same-size stand-in the graph was built against, while the real target has the old size. */
  staging: RenderTargetWrapper | null
  graph: FrameGraph
  bloom: FrameGraphBloomTask | null
  imageProcessing: FrameGraphImageProcessingTask | null
  sharpen: FrameGraphSharpenTask | null
  fxaa: FrameGraphFXAATask | null
  applied: Applied
}

type GenerationRequest = Pick<Generation, 'plan' | 'bloomScale' | 'width' | 'height'>

/** HDR when the context can render to half float (or float), as the old pipeline did. */
function sceneColorType(scene: Scene): number {
  const caps = scene.getEngine().getCaps()
  if (caps.textureHalfFloatRender) return Constants.TEXTURETYPE_HALF_FLOAT
  if (caps.textureFloatRender) return Constants.TEXTURETYPE_FLOAT
  return Constants.TEXTURETYPE_UNSIGNED_BYTE
}

export class SceneFrameGraph implements ScenePostOwner {
  private readonly scene: Scene
  private readonly options: SceneFrameGraphOptions
  private current: Generation | null = null
  /** The scene colour target: one for the graph's life (see the header). */
  private target: RenderTargetTexture | null = null
  /** Render-pass ids the camera has rendered with; a new one thaws the static-scene gate first. */
  private readonly renderedPassIds = new Set<number>()
  /** What the latest build was asked for; ahead of `current` while it compiles. */
  private requested: GenerationRequest | null = null
  private plan: SceneGraphPlan
  /** Builds run one after another; a queued one that is no longer the latest request is skipped. */
  private buildQueue: Promise<void> = Promise.resolve()
  private building = 0
  private disposed = false
  private running = false
  private executedFrames = 0
  private generations = 0
  private canvasWidth = 0
  private canvasHeight = 0
  private canvasStableFrames = 0
  /** The size a build failed at; the canvas watcher does not ask for it again until the size changes. */
  private failedSize: string | null = null
  private beforeObserver: Observer<Scene> | null = null
  private afterObserver: Observer<Scene> | null = null

  private constructor(options: SceneFrameGraphOptions, plan: SceneGraphPlan) {
    this.options = options
    this.scene = options.scene
    this.plan = plan
    options.controller.attach(this)
    this.beforeObserver = this.scene.onBeforeRenderObservable.add(() => this.beforeRender())
    this.afterObserver = this.scene.onAfterRenderObservable.add(() => this.afterRender())
  }

  /** Build the first generation. Rejects (after cleaning up) when it cannot be built. */
  static async create(options: SceneFrameGraphOptions, plan: SceneGraphPlan): Promise<SceneFrameGraph> {
    const graph = new SceneFrameGraph(options, plan)
    try {
      await graph.rebuild(plan)
    } catch (err) {
      graph.dispose()
      throw err
    }
    return graph
  }

  /**
   * Build a generation for `plan` and swap it in. Asking for what is already built (same nodes,
   * scale and size) is a no-op. A failed build leaves the running generation in place.
   */
  async rebuild(plan: SceneGraphPlan): Promise<void> {
    if (this.disposed) return
    this.plan = plan
    const request = this.requestFor(plan)
    if (!request) return
    if (this.requested && this.sameRequest(this.requested, request)) return
    this.requested = request
    await this.enqueueBuild(request)
  }

  /** The bloom scale is part of the built bloom node: build again for the controller's new value. */
  requestRebuild(): void {
    this.rebuild(this.plan).catch((err: unknown) => {
      console.warn('[SceneGraph] Rebuild failed:', err)
    })
  }

  getInfo(): SceneGraphInfo {
    const gen = this.current
    return {
      backend: this.scene.getEngine().isWebGPU ? 'webgpu' : 'webgl2',
      nodes: gen ? ['scene:render', ...gen.graph.tasks.map((t: FrameGraphTask) => t.name)] : [],
      planned: gen ? [...gen.plan.nodes] : [],
      omitted: (gen?.plan ?? this.plan).omitted.map((o) => ({ ...o })),
      width: gen?.width ?? 0,
      height: gen?.height ?? 0,
      hdr: gen?.hdr ?? false,
      executedFrames: this.executedFrames,
      generation: this.generations,
      active: this.running,
      building: this.building > 0,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    if (this.beforeObserver) this.scene.onBeforeRenderObservable.remove(this.beforeObserver)
    if (this.afterObserver) this.scene.onAfterRenderObservable.remove(this.afterObserver)
    this.beforeObserver = null
    this.afterObserver = null
    this.options.controller.attach(null)
    this.bindCamera(null)
    const gen = this.current
    this.current = null
    if (gen) this.disposeGeneration(gen)
    this.target?.dispose()
    this.target = null
    // The image-processing node is gone: materials grade their own output again.
    this.syncMaterialsByPostProcess(false)
  }

  // ── Frame ───────────────────────────────────────────────────────────────────────────────────

  private beforeRender(): void {
    if (this.disposed) return
    this.watchCanvasSize()
    const gen = this.current
    // Post-process the camera this graph was made for, and only while the scene optimizer has not
    // switched post-processing off; anything else renders straight to the canvas.
    const active = gen !== null && this.cameraRenders() && this.scene.postProcessesEnabled
    this.running = active
    this.bindCamera(active ? this.target : null)
  }

  private afterRender(): void {
    if (!this.running || this.disposed) return
    const gen = this.current
    if (!gen) return
    this.applyKnobs(gen)
    // The graph's own passes (the geometry pass) set the engine's render-pass id; leave it as the
    // camera render had it, for whatever reads it after this frame.
    const engine = this.scene.getEngine()
    const passId = engine.currentRenderPassId
    gen.graph.execute()
    engine.currentRenderPassId = passId
    this.executedFrames++
  }

  private cameraRenders(): boolean {
    const { scene } = this
    const { camera } = this.options
    return scene.activeCameras && scene.activeCameras.length > 0
      ? scene.activeCameras.includes(camera)
      : scene.activeCamera === camera
  }

  private bindCamera(target: RenderTargetTexture | null): void {
    const { camera } = this.options
    const current = camera.outputRenderTarget
    // Only ever replace our own target (with nothing, or with itself).
    if (target === null && current !== null && current !== this.target) return
    // The camera is about to render with a render-pass id it has not used yet. Nothing can be frozen
    // before its very first frame, so only a second pass id needs the gate thawed.
    const passId = target ? target.renderPassId : (camera.renderPassId ?? 0)
    if (!this.renderedPassIds.has(passId)) {
      if (this.renderedPassIds.size > 0) this.options.onRenderPassChanged?.()
      this.renderedPassIds.add(passId)
    }
    if (current !== target) camera.outputRenderTarget = target
  }

  /** Push the controller's knobs that moved since the last frame to the nodes that have them. */
  private applyKnobs(gen: Generation): void {
    const { controller } = this.options
    const { applied } = gen

    if (gen.bloom) {
      const bloom = gen.bloom
      if (applied.bloomEnabled !== controller.bloomEnabled) {
        bloom.disabled = !controller.bloomEnabled
        applied.bloomEnabled = controller.bloomEnabled
      }
      if (applied.bloomWeight !== controller.bloomWeight) {
        bloom.bloom.weight = controller.bloomWeight
        applied.bloomWeight = controller.bloomWeight
      }
      const kernel = controller.bloomKernel / this.scene.getEngine().getHardwareScalingLevel()
      if (applied.bloomKernel !== kernel) {
        bloom.bloom.kernel = kernel
        applied.bloomKernel = kernel
      }
      if (applied.bloomThreshold !== controller.bloomThreshold) {
        bloom.bloom.threshold = controller.bloomThreshold
        applied.bloomThreshold = controller.bloomThreshold
      }
      // The highlights bloom extracts follow the exposure, as `DefaultRenderingPipeline` wired them
      // (an exposure flash brightens the glow with the image). Only a graph that has the
      // image-processing node has an exposure to follow.
      const exposure = gen.imageProcessing ? controller.imageProcessingState.exposure : 1
      if (applied.bloomExposure !== exposure) {
        bloom.bloom._downscale._exposure = exposure
        applied.bloomExposure = exposure
      }
    }

    if (gen.sharpen && applied.sharpenEnabled !== controller.sharpenEnabled) {
      gen.sharpen.disabled = !controller.sharpenEnabled
      applied.sharpenEnabled = controller.sharpenEnabled
    }

    if (gen.imageProcessing) {
      const state = controller.imageProcessingState
      if (applied.imageProcessingVersion !== state.version) {
        const ip = gen.imageProcessing.postProcess
        ip.toneMappingEnabled = state.toneMappingEnabled
        ip.toneMappingType = state.toneMappingType
        ip.contrast = state.contrast
        ip.exposure = state.exposure
        ip.colorCurvesEnabled = state.colorCurvesEnabled
        ip.colorGradingEnabled = state.colorGradingEnabled
        ip.vignetteEnabled = state.vignetteEnabled
        ip.vignetteWeight = state.vignetteWeight
        ip.vignetteColor = state.vignetteColor
        ip.vignetteBlendMode = state.vignetteBlendMode
        applied.imageProcessingVersion = state.version
      }
    }
  }

  // ── Canvas size ─────────────────────────────────────────────────────────────────────────────

  /**
   * The graph's textures are fixed-size, so a new canvas size needs a new generation. It waits until
   * the size has held for `RESIZE_SETTLE_FRAMES` frames (a window drag fires a resize per frame);
   * until then the old generation keeps running and its last pass stretches to the canvas.
   */
  private watchCanvasSize(): void {
    const engine = this.scene.getEngine()
    const width = engine.getRenderWidth(true)
    const height = engine.getRenderHeight(true)
    if (width !== this.canvasWidth || height !== this.canvasHeight) {
      this.canvasWidth = width
      this.canvasHeight = height
      this.canvasStableFrames = 0
      return
    }
    if (this.canvasStableFrames < RESIZE_SETTLE_FRAMES) {
      this.canvasStableFrames++
      return
    }
    const gen = this.current
    if (!gen || (gen.width === width && gen.height === height)) return
    if (this.requested && this.requested.width === width && this.requested.height === height) return
    if (this.failedSize === `${width}x${height}`) return
    this.requestRebuild()
  }

  // ── Building ────────────────────────────────────────────────────────────────────────────────

  private requestFor(plan: SceneGraphPlan): GenerationRequest | null {
    const engine = this.scene.getEngine()
    const width = this.canvasWidth > 0 ? this.canvasWidth : engine.getRenderWidth(true)
    const height = this.canvasHeight > 0 ? this.canvasHeight : engine.getRenderHeight(true)
    // A hidden canvas has no size to build for; the next resize asks again.
    if (width <= 0 || height <= 0) return null
    return { plan, bloomScale: this.options.controller.bloomScale, width, height }
  }

  private sameRequest(a: GenerationRequest, b: GenerationRequest): boolean {
    // The bloom scale only shapes a bloom node; without one it cannot change what gets built.
    const scale = (r: GenerationRequest): number => (r.plan.nodes.includes('bloom') ? r.bloomScale : 0)
    return a.width === b.width && a.height === b.height && scale(a) === scale(b) && sameSceneGraph(a.plan, b.plan)
  }

  private enqueueBuild(request: GenerationRequest): Promise<void> {
    const run = this.buildQueue.then(async () => {
      if (this.disposed || this.requested !== request) return
      this.building++
      try {
        await this.buildAndSwap(request)
      } catch (err) {
        // A failed build must not stop the same request being made again, but the canvas watcher
        // must not make it every frame either.
        if (this.requested === request) this.requested = null
        this.failedSize = `${request.width}x${request.height}`
        throw err
      } finally {
        this.building--
      }
    })
    this.buildQueue = run.catch(() => undefined)
    return run
  }

  private async buildAndSwap(request: GenerationRequest): Promise<void> {
    const gen = this.createGeneration(request)
    try {
      await gen.graph.buildAsync(false)
      const heavy = request.plan.nodes.some((n) => SCENE_HEAVY_NODES.includes(n))
      await gen.graph.whenReadyAsync(50, heavy ? HEAVY_READY_TIMEOUT_MS : READY_TIMEOUT_MS)
    } catch (err) {
      this.disposeGeneration(gen)
      throw err
    }
    // Disposed while compiling.
    if (this.disposed) {
      this.disposeGeneration(gen)
      return
    }
    const previous = this.current
    // Before the swap: the materials' state must match the nodes the next frame runs.
    this.syncMaterialsByPostProcess(gen.imageProcessing !== null)
    if (gen.staging) {
      try {
        this.adoptSize(gen)
      } catch (err) {
        // The target may already be resized, so the running generation can no longer read it.
        this.disposeGeneration(gen)
        this.current = null
        if (previous) this.disposeGeneration(previous)
        throw err
      }
    }
    this.failedSize = null
    this.current = gen
    this.generations++
    if (previous) this.disposeGeneration(previous)
    // Disposing the old image-processing task cleared `applyByPostProcess`; the new one needs it.
    this.syncMaterialsByPostProcess(gen.imageProcessing !== null)
  }

  /**
   * A generation built at a new size was compiled against a staging texture. Resize the one scene
   * colour target (same object, so the same render-pass id) and point the graph at it. This runs
   * between frames, in the same task as the swap, so no frame sees either graph half-way.
   */
  private adoptSize(gen: Generation): void {
    const target = this.target
    const staging = gen.staging
    if (!target || !staging) return
    target.resize({ width: gen.width, height: gen.height })
    const internal = target.getInternalTexture()
    if (!internal) throw new Error('[SceneFrameGraph] Scene colour texture was not recreated')
    gen.graph.textureManager.importTexture('scene:render', internal, gen.sceneHandle)
    staging.dispose()
    gen.staging = null
  }

  private createGeneration(request: GenerationRequest): Generation {
    const { scene } = this
    const { controller } = this.options
    const engine = scene.getEngine()
    const type = sceneColorType(scene)
    const hdr = type !== Constants.TEXTURETYPE_UNSIGNED_BYTE

    // The one scene colour target. Not in the optimizer's reach: `scale()` would resize it to a
    // square and strand the graph.
    if (!this.target) {
      this.target = new RenderTargetTexture('sceneColor', { width: request.width, height: request.height }, scene, {
        generateMipMaps: false,
        generateDepthBuffer: true,
        generateStencilBuffer: engine.isStencilEnable,
        type,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      })
      this.target.disableRescaling()
    }
    const target = this.target
    const sizeChanged = target.getRenderWidth() !== request.width || target.getRenderHeight() !== request.height
    // The target keeps its size until the swap; this generation is compiled against a stand-in.
    const staging = sizeChanged
      ? engine.createRenderTargetTexture(
          { width: request.width, height: request.height },
          {
            generateMipMaps: false,
            generateDepthBuffer: false,
            generateStencilBuffer: false,
            type,
            format: Constants.TEXTUREFORMAT_RGBA,
            samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            label: 'sceneColor staging',
          },
        )
      : null

    const graph = new FrameGraph(scene)
    const gen: Generation = {
      ...request,
      hdr,
      sceneHandle: -1,
      staging,
      graph,
      bloom: null,
      imageProcessing: null,
      sharpen: null,
      fxaa: null,
      applied: {
        bloomWeight: Number.NaN,
        bloomKernel: Number.NaN,
        bloomThreshold: Number.NaN,
        bloomExposure: Number.NaN,
        bloomEnabled: null,
        sharpenEnabled: null,
        imageProcessingVersion: -1,
      },
    }

    try {
      const internal = staging ? staging.texture : target.getInternalTexture()
      if (!internal) throw new Error('[SceneFrameGraph] Scene colour texture was not created')
      gen.sceneHandle = graph.textureManager.importTexture('scene:render', internal)
      let previous: FrameGraphTextureHandle = gen.sceneHandle
      const last = request.plan.nodes.at(-1)

      // One geometry pass feeds every HIGH-only node.
      const heavyNodes = request.plan.nodes.filter((n) => SCENE_HEAVY_NODES.includes(n))
      const geometry: GeometryPass | null =
        heavyNodes.length > 0
          ? addGeometryPass(graph, scene, this.options.camera, heavyNodes, { width: request.width, height: request.height })
          : null

      for (const node of request.plan.nodes) {
        let task: ChainTask
        switch (node) {
          case 'ssao':
          case 'ssr':
          case 'motionBlur': {
            if (!geometry) throw new Error(`[SceneFrameGraph] "${node}" has no geometry pass`)
            task = createHeavyTask(node, graph, scene, this.options.camera, geometry, type)
            break
          }
          case 'bloom': {
            const bloom = new FrameGraphBloomTask(
              'scene:bloom',
              graph,
              controller.bloomWeight,
              controller.bloomKernel / engine.getHardwareScalingLevel(),
              controller.bloomThreshold,
              hdr,
              request.bloomScale,
            )
            gen.bloom = bloom
            task = bloom
            break
          }
          case 'imageProcessing': {
            // The scene's own configuration, as the pipeline used: constructing the post-process on it
            // is what tells materials to leave tone mapping and grading to this node.
            const ip = new FrameGraphImageProcessingTask(
              'scene:imageProcessing',
              graph,
              new ThinImageProcessingPostProcess('scene:imageProcessing', engine, {
                imageProcessingConfiguration: scene.imageProcessingConfiguration,
                scene,
              }),
            )
            // Its knobs come from the controller every frame.
            gen.imageProcessing = ip
            task = ip
            break
          }
          case 'sharpen': {
            const sharpen = new FrameGraphSharpenTask('scene:sharpen', graph)
            sharpen.postProcess.edgeAmount = SHARPEN_EDGE_AMOUNT
            gen.sharpen = sharpen
            task = sharpen
            break
          }
          case 'fxaa': {
            const fxaa = new FrameGraphFXAATask('scene:fxaa', graph)
            gen.fxaa = fxaa
            task = fxaa
            break
          }
        }
        task.sourceTexture = previous
        if (node === last) task.targetTexture = backbufferColorTextureHandle
        graph.addTask(task)
        previous = task.outputTexture
      }
    } catch (err) {
      this.disposeGeneration(gen)
      throw err
    }
    return gen
  }

  private disposeGeneration(gen: Generation): void {
    gen.graph.dispose()
    gen.staging?.dispose()
    gen.staging = null
  }

  /**
   * Whether materials leave image processing to the post-process. True exactly while an
   * image-processing node exists; `ThinImageProcessingPostProcess` sets it on construction and
   * clears it on dispose, so it is re-asserted whenever generations swap.
   */
  private syncMaterialsByPostProcess(byPostProcess: boolean): void {
    const config = this.scene.imageProcessingConfiguration
    if (config.applyByPostProcess === byPostProcess) return
    this.options.onMaterialsInvalidated?.()
    config.applyByPostProcess = byPostProcess
  }
}
