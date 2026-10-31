/**
 * Post-processing management — the quality-tier knobs, the WebGPU uniform-buffer overflow guard,
 * and the bloom-kick/camera-shake decay loop. The passes themselves are nodes of the scene
 * Frame Graph (`scene-frame-graph.ts`, #461 Slice B); this class decides which nodes exist
 * (`planSceneGraph()`, from the tier in `webgpu-post-process-profile.ts`) and keeps the graph in step
 * with quality, accessibility and runtime degrades.
 *
 * Extracted from GameRenderer to keep that orchestrator under the house line limit.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
// The Frame Graph chunk (lazy, src/frame-graph-runtime.ts) and the glTF loader both use these three
// Babylon modules. The old pipeline's static prepass imports used to keep them in the boot chunk;
// without that, each would become a small shared chunk of its own (and a new precache entry).
import '@babylonjs/core/Materials/Textures/renderTargetTexture'
import '@babylonjs/core/Materials/Textures/multiRenderTarget'
import '@babylonjs/core/Meshes/meshBlendingTag'
import {
  downgradePostProcessTier,
  isUniformBufferLimitError,
  isWebGPUEngine,
  recordPostProcessTierDegrade,
  resolveWebGPUPostProcessProfile,
  type WebGPUPostProcessProfile,
} from './webgpu-post-process-profile'
import {
  BLOOM_QUALITY_PROFILE,
  HEAVY_POST_MIN_DRAW_BUFFERS,
  planSceneGraph,
  sameSceneGraph,
  type SceneGraphFlags,
  type SceneGraphPlan,
} from './scene-graph-plan'
import { ScenePostController } from './scene-post-controller'
import { isSoftwareRasterizer } from '../engine/software-rasterizer'
import { resolveGpuCapabilities } from '../engine/gpu-capabilities'
import { isMobileUserAgent } from '../engine/engine-options'
import type { SceneFrameGraph, SceneGraphInfo } from './scene-frame-graph'
import { QualityTier, INTENSITY } from '../game-elements'
import { getMaterialLibrary } from '../materials'
import { GameConfig } from '../config'
import type { RendererHost } from './game-renderer'

/** What `getGraphInfo()` reports: the plan always, the built graph once it exists. */
export interface SceneGraphReport {
  plan: SceneGraphPlan | null
  /** True from the first build request until the graph is built, failed, or dropped. */
  pending: boolean
  graph: SceneGraphInfo | null
  error: string | null
}

export class PostProcessManager {
  private readonly host: RendererHost

  // Bloom kick decay state
  private _currentBloomKick = 0
  private _bloomKickDuration = 0
  private _bloomKickTimer = 0

  // Camera shake decay state
  private _currentShakeIntensity = 0
  private _shakeDuration = 0
  private _shakeTimer = 0
  private readonly _baseCameraPosition: Vector3 = new Vector3(0, 16, -21)

  // EventBus unsub handles
  private _unsubBloom: (() => void) | null = null
  private _unsubShake: (() => void) | null = null

  private _postProcessProfile: WebGPUPostProcessProfile | null = null
  /** Software rasteriser: the HIGH-only nodes cost more than it can pay. */
  private _isSwiftShader = false
  private _webgpuErrorListener: ((event: Event) => void) | null = null

  /** The knobs `EffectsSystem` and the tiers write; it outlives any one graph. */
  private controller: ScenePostController | null = null
  private graph: SceneFrameGraph | null = null
  private plan: SceneGraphPlan | null = null
  /** Graph creation and rebuilds run one after another. */
  private graphQueue: Promise<void> = Promise.resolve()
  private pendingBuilds = 0
  private graphError: string | null = null
  private disposed = false
  private heavyWarned = false

  constructor(host: RendererHost) {
    this.host = host
  }

  /** Setup bloom, FXAA, tone-mapping and sharpen as scene graph nodes. */
  setup(): void {
    const { scene, tableCam, qualityTier } = this.host
    if (!scene || !tableCam) return

    // Debug: skip all post-processing via URL flag. The camera renders straight to the canvas.
    if (this.noPostProcess) {
      console.log('[GameRenderer] Post-processing disabled via ?nopp=1')
      return
    }

    // IBL is wired up by setupEnvironmentLighting() via matLib.loadEnvironmentTexture(),
    // which calls CubeTexture.CreateFromPrefilteredData('textures/environment.env', scene)
    // and assigns it to scene.environmentTexture. PBR materials (ball, flippers, rails)
    // sample from that map so they get real reflections — here we layer bloom on top.
    // (The image-processing node keeps ImageProcessingConfiguration's defaults: see the note on
    // ScenePostImageProcessing for why there is no ACES grade here.)

    const { accessibility } = this.host
    const reducedMotion = accessibility?.reducedMotion ?? GameConfig.camera.reducedMotion
    const effectIntensity = accessibility?.effectIntensity ?? 1.0

    this._postProcessProfile = resolveWebGPUPostProcessProfile(this.host.engine)
    // Any tier below `full` is a silent visual downgrade; make it countable.
    recordPostProcessTierDegrade('postprocess-tier-boot', this._postProcessProfile)
    if (this._postProcessProfile.tier === 'none') {
      console.warn(
        `[GameRenderer] WebGPU post-process disabled (${this._postProcessProfile.reason})`,
      )
      this.host.postProcessDegraded = true
      return
    }
    if (this._postProcessProfile.tier !== 'full') {
      this.host.postProcessDegraded = true
      console.warn(
        `[GameRenderer] WebGPU post-process tier: ${this._postProcessProfile.tier} (${this._postProcessProfile.reason})`,
      )
    }

    const controller = new ScenePostController()
    this.controller = controller
    this.host.bloomPipeline = controller
    this.attachWebGPUUniformBufferGuard()

    const bloomSafe = !reducedMotion && effectIntensity > 0
    controller.bloomThreshold = 0.75
    this.applyBloomKnobs(qualityTier, effectIntensity)

    this._isSwiftShader = isSoftwareRasterizer(this.host.engine)
    this.replan()

    // EventBus subscriptions — bloom kick and camera shake
    const { eventBus } = this.host
    if (eventBus) {
      this._unsubBloom = eventBus.on('effect:bloom', ({ intensity, duration }) => {
        if (!bloomSafe) return
        this._currentBloomKick = intensity
        this._bloomKickDuration = duration ?? 0.4
        this._bloomKickTimer = this._bloomKickDuration
      })

      this._unsubShake = eventBus.on('effect:shake', ({ amount, duration }) => {
        if (accessibility?.cameraShakeEnabled === false || reducedMotion) return
        const clamped = Math.min(amount, accessibility?.maxCameraShakeIntensity ?? 0.08)
        if (clamped <= 0) return
        this._currentShakeIntensity = clamped
        this._shakeDuration = duration ?? 0.3
        this._shakeTimer = this._shakeDuration
      })
    }

    // Per-frame decay for bloom kick and camera shake
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() * 0.001

      // Global bloom spike decay
      if (this._bloomKickTimer > 0 && this.host.bloomPipeline) {
        this._bloomKickTimer -= dt
        const progress = Math.max(0, this._bloomKickTimer / this._bloomKickDuration)
        const baselineWeight = 0.25 * (this.host.accessibility?.effectIntensity ?? 1.0)
        this.host.bloomPipeline.bloomWeight = baselineWeight + this._currentBloomKick * progress
      }

      // High-frequency camera shake displacements
      if (this._shakeTimer > 0 && this.host.tableCam) {
        this._shakeTimer -= dt
        const progress = Math.max(0, this._shakeTimer / this._shakeDuration)
        const currentPower = this._currentShakeIntensity * progress

        const offsetX = (Math.random() * 2 - 1) * currentPower
        const offsetY = (Math.random() * 2 - 1) * currentPower

        this.host.tableCam.position.set(
          this._baseCameraPosition.x + offsetX,
          this._baseCameraPosition.y + offsetY,
          this._baseCameraPosition.z
        )

        if (this._shakeTimer <= 0) {
          this.host.tableCam.position.copyFrom(this._baseCameraPosition)
        }
      }
    })
  }

  /**
   * Apply a quality tier at runtime (settings change or auto-drop).
   * Updates the bloom knobs and re-plans the graph (sharpen and the HIGH-only passes follow the tier).
   */
  applyQualityTier(tier: QualityTier): void {
    const { scene, accessibility } = this.host
    if (!scene || !this.controller) {
      this.host.qualityTier = tier
      return
    }

    this.host.qualityTier = tier
    this.host.effects?.setQualityTier(tier)
    getMaterialLibrary(scene).qualityTier = tier

    const effectIntensity = accessibility?.effectIntensity ?? 1.0
    this.controller.bloomThreshold = 0.75
    this.applyBloomKnobs(tier, effectIntensity)
    this.replan()
    console.log(`[GameRenderer] Quality tier applied: ${tier}`)
  }

  /**
   * Accessibility changed (reduced motion, effect intensity): re-plan the graph. Reduced motion
   * drops bloom, sharpen, the vignette and the HIGH-only passes; turning it off brings them back.
   */
  syncAccessibility(): void {
    if (!this.controller) return
    this.applyBloomKnobs(this.host.qualityTier, this.host.accessibility?.effectIntensity ?? 1.0)
    this.replan()
  }

  /** Drop one quality step (HIGH→MEDIUM→LOW). Returns the new tier. */
  dropQualityTierOnce(): QualityTier {
    const current = this.host.qualityTier
    const next =
      current === QualityTier.HIGH
        ? QualityTier.MEDIUM
        : current === QualityTier.MEDIUM
          ? QualityTier.LOW
          : QualityTier.LOW
    if (next !== current) {
      this.applyQualityTier(next)
    }
    return next
  }

  /** The plan, and the graph's own report once it is built (debug HUD, e2e). */
  getGraphInfo(): SceneGraphReport {
    const graph = this.graph?.getInfo() ?? null
    return {
      plan: this.plan,
      // A build the manager queued, or one the graph started itself (a resize, a new bloom scale).
      pending: this.pendingBuilds > 0 || graph?.building === true,
      graph,
      error: this.graphError,
    }
  }

  private get noPostProcess(): boolean {
    return new URLSearchParams(window.location.search).has('nopp')
  }

  /** The bloom knobs for a quality tier: kernel, scale and a weight cap that shrink with it. */
  private applyBloomKnobs(tier: QualityTier, effectIntensity: number): void {
    const controller = this.controller
    if (!controller) return
    const profile = BLOOM_QUALITY_PROFILE[tier]
    const baseWeight = 0.25 * effectIntensity * INTENSITY.ACTIVE
    controller.bloomKernel = profile.kernel
    controller.bloomScale = profile.scale
    controller.bloomWeight = Math.min(baseWeight, profile.maxWeight)
  }

  private planFlags(): SceneGraphFlags {
    const { accessibility, qualityTier } = this.host
    return {
      tier: this._postProcessProfile?.tier ?? 'full',
      quality: qualityTier,
      reducedMotion: accessibility?.reducedMotion ?? GameConfig.camera.reducedMotion,
      effectIntensity: accessibility?.effectIntensity ?? 1.0,
      noPostProcess: this.noPostProcess,
      heavyAvailable: this.heavyAvailable(),
      maxMsaaSamples: resolveGpuCapabilities(this.host.engine).maxMsaaSamples,
      mobile: isMobileUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    }
  }

  /**
   * Whether this context can afford the HIGH-only nodes: not a software rasteriser, and enough draw
   * buffers (and float render targets, for the geometry pass's view depth) for their geometry pass.
   */
  private heavyAvailable(): boolean {
    if (this._isSwiftShader) return false
    const caps = this.host.engine.getCaps()
    const drawBuffers = caps.maxDrawBuffers ?? 0
    const available = drawBuffers >= HEAVY_POST_MIN_DRAW_BUFFERS && caps.textureFloatRender
    if (!available && this.host.qualityTier === QualityTier.HIGH && !this.heavyWarned) {
      this.heavyWarned = true
      console.warn(
        `[GameRenderer] SSAO / SSR / motion blur skipped: ${drawBuffers} draw buffers ` +
          `(need ${HEAVY_POST_MIN_DRAW_BUFFERS}), float render targets ${caps.textureFloatRender ? 'yes' : 'no'}`,
      )
      this.host.postProcessDegraded = true
    }
    return available
  }

  /**
   * Work out which nodes should exist now and bring the graph in line: create it on first need,
   * rebuild it when the node set (or the bloom scale) changed, drop it when nothing is left.
   */
  private replan(): void {
    const controller = this.controller
    if (!controller || this.disposed) return
    const plan = planSceneGraph(this.planFlags())
    const previous = this.plan
    this.plan = plan
    controller.setImageProcessingPresent(plan.nodes.includes('imageProcessing'), plan.vignette)
    // Materials leave image processing to the post-process while that node exists. Set up front, so
    // they compile once rather than again when the graph arrives; the graph keeps it in step after.
    const config = this.host.scene?.imageProcessingConfiguration
    if (config) config.applyByPostProcess = plan.nodes.includes('imageProcessing')

    if (plan.nodes.length === 0) {
      if (previous && previous.nodes.length > 0) this.dropGraph()
      return
    }
    if (this.graph && previous && sameSceneGraph(previous, plan)) return
    this.enqueueGraph(plan)
  }

  private enqueueGraph(plan: SceneGraphPlan): void {
    this.pendingBuilds++
    this.graphQueue = this.graphQueue
      .then(() => this.buildGraph(plan))
      .catch((err: unknown) => this.onGraphFailed(err))
      .then(() => {
        this.pendingBuilds--
      })
  }

  private async buildGraph(plan: SceneGraphPlan): Promise<void> {
    // A newer plan is already queued behind this one: skip to it.
    if (this.plan !== plan || this.disposed) return
    if (this.graph) {
      // A rebuild that fails (a resize, a new bloom scale) leaves the running generation in place.
      try {
        await this.graph.rebuild(plan)
      } catch (err) {
        console.warn('[GameRenderer] Scene graph rebuild failed; keeping the running graph:', err)
        this.graphError = err instanceof Error ? err.message : String(err)
      }
      return
    }
    const { scene, tableCam } = this.host
    const controller = this.controller
    if (!scene || !tableCam || !controller) return
    const { SceneFrameGraph: Graph } = await import('../frame-graph-runtime')
    // Dispose can land while the chunk loads.
    if (this.disposed || this.host.signal.aborted || this.plan !== plan) return
    const graph = await Graph.create(
      {
        scene,
        camera: tableCam,
        controller,
        onMaterialsInvalidated: () => this.host.staticSceneGate?.invalidate('post-process-graph', { materials: true }),
        onRenderPassChanged: () => this.host.staticSceneGate?.invalidate('post-process-render-pass', { materials: true }),
      },
      plan,
    )
    // Disposed, or the plan emptied (a runtime downgrade to `none`), while it compiled.
    if (this.disposed || this.host.signal.aborted || !this.plan || this.plan.nodes.length === 0) {
      graph.dispose()
      return
    }
    this.graph = graph
    this.graphError = null
    console.log(`[GameRenderer] Scene graph built: ${graph.getInfo().nodes.join(' → ')}`)
  }

  /** A graph that cannot be built is tier `none`: the camera renders to the canvas. Countable, like any other degrade. */
  private onGraphFailed(err: unknown): void {
    if (this.disposed) return
    const message = err instanceof Error ? err.message : String(err)
    this.graphError = message
    console.warn('[GameRenderer] Scene graph failed to build; post-processing is off:', err)
    const from = this._postProcessProfile?.tier ?? 'full'
    if (this._postProcessProfile && from !== 'none') {
      this._postProcessProfile = {
        ...this._postProcessProfile,
        tier: 'none',
        reason: `scene graph build failed: ${message}`,
      }
      recordPostProcessTierDegrade('postprocess-tier-runtime', this._postProcessProfile, from)
    }
    this.host.postProcessDegraded = true
    this.dropGraph()
    this.disposeBloomPipeline()
  }

  /** Dispose the graph; the camera goes back to rendering straight to the canvas. */
  private dropGraph(): void {
    const graph = this.graph
    this.graph = null
    graph?.dispose()
    const config = this.host.scene?.imageProcessingConfiguration
    if (config && config.applyByPostProcess) config.applyByPostProcess = false
  }

  private attachWebGPUUniformBufferGuard(): void {
    if (!isWebGPUEngine(this.host.engine) || this._webgpuErrorListener) return

    const device = (this.host.engine as WebGPUEngine)._device
    if (!device) return

    this._webgpuErrorListener = (event: Event) => {
      const gpuEvent = event as GPUUncapturedErrorEvent
      const message = gpuEvent.error?.message ?? 'unknown WebGPU error'
      if (!isUniformBufferLimitError(message)) return

      const currentTier = this._postProcessProfile?.tier ?? 'full'
      const nextTier = downgradePostProcessTier(currentTier)
      if (!nextTier) return

      console.warn(
        `[GameRenderer] WebGPU uniform-buffer overflow — downgrading post-process ${currentTier} → ${nextTier}`,
      )
      this._postProcessProfile = {
        ...(this._postProcessProfile ?? resolveWebGPUPostProcessProfile(this.host.engine)),
        tier: nextTier,
        reason: `runtime validation: ${message}`,
      }
      recordPostProcessTierDegrade(
        'postprocess-tier-runtime',
        this._postProcessProfile,
        currentTier,
      )
      this.host.postProcessDegraded = true

      // Rebuild the graph at the lower tier; `none` has no nodes, so that drops it and the camera
      // renders straight to the canvas.
      this.replan()
      if (nextTier === 'none') {
        this.dropGraph()
        this.disposeBloomPipeline()
      }
    }

    device.addEventListener('uncapturederror', this._webgpuErrorListener)
  }

  private disposeBloomPipeline(): void {
    const controller = this.controller
    if (!controller) return
    this.controller = null
    controller.dispose()
    this.host.bloomPipeline = null
    this.host.effects?.setPipeline(null)
  }

  private detachWebGPUUniformBufferGuard(): void {
    if (!this._webgpuErrorListener || !isWebGPUEngine(this.host.engine)) {
      this._webgpuErrorListener = null
      return
    }

    const device = (this.host.engine as WebGPUEngine)._device
    device?.removeEventListener('uncapturederror', this._webgpuErrorListener)
    this._webgpuErrorListener = null
  }

  dispose(): void {
    this.disposed = true
    this.detachWebGPUUniformBufferGuard()
    this._postProcessProfile = null

    this._unsubBloom?.()
    this._unsubBloom = null
    this._unsubShake?.()
    this._unsubShake = null

    this.dropGraph()
    this.disposeBloomPipeline()
    this.plan = null
  }
}
