/**
 * Game Renderer — Camera, post-processing, lighting, and environment setup.
 *
 * Extracted from game.ts to keep the orchestrator lean.
 */

import {
  FreeCamera,
  TargetCamera,
  Color3,
  Color4,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
  MirrorTexture,
  StandardMaterial,
  RenderTargetTexture,
  DirectionalLight,
  PointLight,
  ShadowGenerator,
} from '@babylonjs/core'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { DepthOfFieldEffectBlurLevel } from '@babylonjs/core/PostProcesses/depthOfFieldEffect'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline'
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess'
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
import { SceneOptimizer, SceneOptimizerOptions } from '@babylonjs/core/Misc/sceneOptimizer'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'

import {
  SURFACES,
  LIGHTING,
  color,
  detectQualityTier,
  INTENSITY,
  QualityTier,
  type AccessibilityConfig,
} from '../game-elements'
import { getMaterialLibrary } from '../materials'
import { GameConfig } from '../config'
import type { EventBus } from './event-bus'

export interface RendererHost {
  readonly engine: Engine | WebGPUEngine
  readonly scene: Scene
  readonly accessibility: AccessibilityConfig
  qualityTier: QualityTier
  isCameraFollowMode: boolean
  cameraFollowTransition: number
  readonly cameraFollowTransitionSpeed: number
  tableCam: TargetCamera | null
  bloomPipeline: DefaultRenderingPipeline | null
  shadowGenerator: ShadowGenerator | null
  mirrorTexture: MirrorTexture | null
  tableRenderTarget: RenderTargetTexture | null
  headRenderTarget: RenderTargetTexture | null
  keyLight: DirectionalLight | null
  rimLight: DirectionalLight | null
  bounceLight: PointLight | null
  scanlineIntensity: number
  showDebugUI: boolean
  sceneInstrumentation: SceneInstrumentation | null
  engineInstrumentation: EngineInstrumentation | null
  eventBus?: EventBus
}

export class GameRenderer {
  private readonly host: RendererHost
  private _resizeObserver: ResizeObserver | null = null
  private _sceneOptimizer: SceneOptimizer | null = null
  private _lastResizeWidth = 0
  private _lastResizeHeight = 0

  // Bloom kick decay state
  private _bloomBaseWeight = 0.25
  private _bloomKickAmount = 0
  private _bloomKickTimer = 0
  private _bloomKickDuration = 0

  // Camera shake decay state
  private _shakeIntensity = 0
  private _shakeTimer = 0
  private _shakeDuration = 0
  private _baseCameraPosition = new Vector3(0, 16, -21)

  // EventBus unsub handles
  private _unsubBloom: (() => void) | null = null
  private _unsubShake: (() => void) | null = null

  constructor(host: RendererHost) {
    this.host = host
  }

  /** Create locked cabinet camera for physical VPin playfield LCD. */
  setupCamera(): void {
    const { scene } = this.host
    if (!scene) return

    const camera = new FreeCamera('cabinetCamera', new Vector3(0, 16, -21), scene)
    camera.setTarget(new Vector3(0, 2, 6))
    camera.fov = 0.85

    this.host.tableCam = camera
    scene.activeCamera = camera
    scene.activeCameras = [camera]
  }

  /** Setup bloom, FXAA, tone-mapping, DoF, and scanlines. */
  setupPostProcessing(): void {
    const { scene, tableCam, qualityTier } = this.host
    if (!scene || !tableCam) return

    // Debug: skip all post-processing via URL flag
    if (new URLSearchParams(window.location.search).has('nopp')) {
      console.log('[GameRenderer] Post-processing disabled via ?nopp=1')
      return
    }

    // IBL is wired up by setupEnvironmentLighting() via matLib.loadEnvironmentTexture(),
    // which calls CubeTexture.CreateFromPrefilteredData('textures/environment.env', scene)
    // and assigns it to scene.environmentTexture. PBR materials (ball, flippers, rails)
    // sample from that map so they get real reflections — here we layer the cinematic
    // ACES tonemap + bloom on top.

    const { accessibility } = this.host
    const reducedMotion = accessibility?.reducedMotion ?? GameConfig.camera.reducedMotion
    const effectIntensity = accessibility?.effectIntensity ?? 1.0

    const bloom = new DefaultRenderingPipeline('pachinbloom', true, scene, [tableCam])
    this.host.bloomPipeline = bloom

    const bloomSafe = !reducedMotion && effectIntensity > 0
    const baseWeight = 0.25
    bloom.bloomEnabled = bloomSafe
    bloom.bloomKernel = 64
    bloom.bloomScale = 0.5
    bloom.bloomWeight = baseWeight * effectIntensity * INTENSITY.ACTIVE
    bloom.bloomThreshold = 0.75
    bloom.fxaaEnabled = true
    bloom.imageProcessing.toneMappingEnabled = true
    bloom.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    bloom.imageProcessing.contrast = 1.1
    bloom.imageProcessing.exposure = 1.0
    bloom.imageProcessing.vignetteEnabled = !reducedMotion
    bloom.imageProcessing.vignetteWeight = 0.4
    bloom.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0)
    bloom.imageProcessing.colorCurvesEnabled = true
    if (bloom.imageProcessing.colorCurves) {
      bloom.imageProcessing.colorCurves.globalHue = 5
      bloom.imageProcessing.colorCurves.globalSaturation = 15
    }
    bloom.sharpenEnabled = !reducedMotion
    bloom.sharpen.edgeAmount = 0.3

    if (qualityTier === QualityTier.LOW) {
      bloom.bloomKernel = 16
      bloom.bloomScale = 0.2
      bloom.bloomWeight = Math.min(bloom.bloomWeight, 0.12)
      bloom.sharpenEnabled = false
    } else if (qualityTier === QualityTier.MEDIUM) {
      bloom.bloomKernel = 32
      bloom.bloomScale = 0.35
      bloom.bloomWeight = Math.min(bloom.bloomWeight, 0.25)
    }

    if (!GameConfig.camera.reducedMotion) {
      bloom.depthOfFieldEnabled = true
      bloom.depthOfField.focusDistance = 2500
      bloom.depthOfField.fStop = 2.4
      bloom.depthOfFieldBlurLevel =
        qualityTier === QualityTier.HIGH
          ? DepthOfFieldEffectBlurLevel.High
          : DepthOfFieldEffectBlurLevel.Low
    }

    // Skip MRT-based post-processes when running on SwiftShader to avoid
    // GL_INVALID_OPERATION: Active draw buffers with missing fragment shader outputs
    const isSwiftShader = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gl = (this.host.engine as any)._gl as WebGLRenderingContext | null
      if (!gl) return false
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (!debugInfo) return false
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string
      return renderer?.toLowerCase().includes('swiftshader') ?? false
    })()

    // SSAO
    if (!isSwiftShader && !GameConfig.camera.reducedMotion) {
      const isHigh = qualityTier === QualityTier.HIGH
      const ssao = new SSAO2RenderingPipeline('ssao', scene, {
        ssaoRatio: isHigh ? 1.0 : 0.5,
        blurRatio: isHigh ? 1.0 : 0.5,
      })
      ssao.radius = 1.5
      ssao.totalStrength = 0.6
      ssao.base = 0.5
      ssao.samples = isHigh ? 32 : 16
      ssao.maxZ = 50
      ssao.minZAspect = 0.5
      scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', [tableCam])
    }

    // SSR
    if (!isSwiftShader && qualityTier === QualityTier.HIGH && !GameConfig.camera.reducedMotion) {
      const ssr = new SSRRenderingPipeline('ssr', scene, [tableCam])
      ssr.step = 0.5
      ssr.reflectionSpecularFalloffExponent = 3
      ssr.strength = 0.6
      ssr.thickness = 0.1
      ssr.selfCollisionNumSkip = 1
      ssr.enableSmoothReflections = true
      ssr.enableAutomaticThicknessComputation = true
    }

    // Motion blur
    if (!isSwiftShader && qualityTier === QualityTier.HIGH && !GameConfig.camera.reducedMotion) {
      const motionBlur = new MotionBlurPostProcess('motionBlur', scene, 1.0, tableCam)
      motionBlur.motionStrength = 0.15
      motionBlur.motionBlurSamples = 16
    }

    // Capture baseline bloom weight for kick decay
    this._bloomBaseWeight = bloom.bloomWeight

    // EventBus subscriptions — bloom kick and camera shake
    const { eventBus } = this.host
    if (eventBus) {
      this._unsubBloom = eventBus.on('effect:bloom', ({ intensity, duration }) => {
        if (!bloomSafe) return
        this._bloomKickAmount = Math.max(this._bloomKickAmount, intensity)
        this._bloomKickDuration = duration ?? 0.4
        this._bloomKickTimer = this._bloomKickDuration
      })

      this._unsubShake = eventBus.on('effect:shake', ({ amount, duration }) => {
        const shakeEnabled = accessibility?.cameraShakeEnabled ?? true
        if (!shakeEnabled || reducedMotion) return
        const maxIntensity = accessibility?.maxCameraShakeIntensity ?? 1.0
        const clamped = Math.min(amount, maxIntensity)
        if (clamped <= 0) return
        this._shakeIntensity = Math.max(this._shakeIntensity, clamped)
        this._shakeDuration = duration ?? 0.3
        this._shakeTimer = this._shakeDuration
      })
    }

    // Per-frame decay for bloom kick and camera shake
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() * 0.001

      // Bloom kick decay
      if (this._bloomKickTimer > 0 && this.host.bloomPipeline) {
        this._bloomKickTimer -= dt
        const t = Math.max(this._bloomKickTimer / this._bloomKickDuration, 0)
        this.host.bloomPipeline.bloomWeight = this._bloomBaseWeight + this._bloomKickAmount * t
        if (this._bloomKickTimer <= 0) {
          this._bloomKickTimer = 0
          this.host.bloomPipeline.bloomWeight = this._bloomBaseWeight
        }
      }

      // Camera shake decay
      if (this._shakeTimer > 0 && this.host.tableCam) {
        this._shakeTimer -= dt
        const t = Math.max(this._shakeTimer / this._shakeDuration, 0)
        const amp = this._shakeIntensity * t * 0.15
        const cam = this.host.tableCam
        cam.position.x = this._baseCameraPosition.x + (Math.random() - 0.5) * amp
        cam.position.y = this._baseCameraPosition.y + (Math.random() - 0.5) * amp * 0.5
        cam.position.z = this._baseCameraPosition.z + (Math.random() - 0.5) * amp * 0.3
        if (this._shakeTimer <= 0) {
          this._shakeTimer = 0
          cam.position.copyFrom(this._baseCameraPosition)
        }
      }
    })
  }

  /** Setup key, rim, bounce, and fill lights + shadow generator. */
  setupLighting(): void {
    const { scene, qualityTier } = this.host
    if (!scene) return

    // Environment lighting
    this.setupEnvironmentLighting()

    // Fill hemisphere
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0.2, 1, 0.1), scene)
    hemiLight.intensity = LIGHTING.FILL.intensity
    hemiLight.diffuse = color(LIGHTING.FILL.color)
    hemiLight.groundColor = color(SURFACES.VOID)

    // Key light with shadows
    const keyLight = new DirectionalLight('keyLight', new Vector3(-0.6, -0.8, 0.2), scene)
    keyLight.intensity = LIGHTING.KEY.intensity
    keyLight.diffuse = color(LIGHTING.KEY.color)
    keyLight.position = new Vector3(-15, 25, -15)
    this.host.keyLight = keyLight

    const shadowMapSize = qualityTier === QualityTier.HIGH ? 4096 : 2048
    const shadowGenerator = new ShadowGenerator(shadowMapSize, keyLight)
    shadowGenerator.useBlurExponentialShadowMap = true
    shadowGenerator.blurKernel = 28
    shadowGenerator.setDarkness(0.3)
    shadowGenerator.bias = 0.0005
    shadowGenerator.normalBias = 0.02
    if (qualityTier === QualityTier.HIGH) {
      shadowGenerator.usePercentageCloserFiltering = true
      shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH
    }
    this.host.shadowGenerator = shadowGenerator

    // Rim light
    const rimLight = new DirectionalLight('rimLight', new Vector3(0.2, -0.3, 0.9), scene)
    rimLight.intensity = LIGHTING.RIM.intensity
    rimLight.diffuse = color(LIGHTING.RIM.color)
    rimLight.position = new Vector3(5, 12, -25)
    this.host.rimLight = rimLight

    // Bounce light
    const bounceLight = new PointLight('bounceLight', new Vector3(0, -2, 5), scene)
    bounceLight.intensity = LIGHTING.BOUNCE.intensity
    bounceLight.diffuse = color(LIGHTING.BOUNCE.color)
    bounceLight.range = 20
    this.host.bounceLight = bounceLight
  }

  private setupEnvironmentLighting(): void {
    const { scene, engine } = this.host
    if (!scene) return
    const matLib = getMaterialLibrary(scene)
    this.host.qualityTier = detectQualityTier(engine)
    matLib.qualityTier = this.host.qualityTier
    matLib.loadEnvironmentTexture()
  }

  /** Create dark arcade room environment. */
  createRoomEnvironment(): void {
    const { scene } = this.host
    if (!scene) return

    const floor = MeshBuilder.CreateGround('arcadeFloor', { width: 120, height: 120 }, scene)
    floor.position.y = -5
    const floorMat = new StandardMaterial('arcadeFloorMat', scene)
    floorMat.diffuseColor = Color3.FromHexString('#08080c')
    floorMat.specularColor = Color3.FromHexString('#151520')
    floorMat.roughness = 0.9
    floor.material = floorMat

    const backWall = MeshBuilder.CreatePlane('arcadeBackWall', { width: 100, height: 50 }, scene)
    backWall.position.set(0, 12, 40)
    backWall.rotation.x = Math.PI
    const wallMat = new StandardMaterial('arcadeWallMat', scene)
    wallMat.diffuseColor = Color3.FromHexString('#050508')
    wallMat.roughness = 1.0
    backWall.material = wallMat

    const ambientGlow = new HemisphericLight('ambientGlow', new Vector3(0, 1, -1), scene)
    ambientGlow.intensity = 0.15
    ambientGlow.diffuse = Color3.FromHexString('#1a1a3e')
    ambientGlow.groundColor = Color3.FromHexString('#0a0a12')

    console.log('[GameRenderer] Room environment created')
  }

  /** Setup ResizeObserver for canvas resize handling. */
  setupResizeObserver(): void {
    const canvas = this.host.engine.getRenderingCanvas()
    if (!canvas) return

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        // Guard: skip if size is zero or hasn't meaningfully changed (> 1px threshold).
        // engine.resize() writes canvas.width/height which can mutate CSS layout size on
        // canvases without explicit CSS dimensions, re-triggering this observer infinitely.
        if (
          width > 0 && height > 0 &&
          (Math.abs(width - this._lastResizeWidth) > 1 || Math.abs(height - this._lastResizeHeight) > 1)
        ) {
          this._lastResizeWidth = width
          this._lastResizeHeight = height
          this.host.engine.resize()
          console.log(`[GameRenderer] Canvas resized: ${Math.round(width)}x${Math.round(height)}`)
        }
      }
    })

    this._resizeObserver.observe(canvas)
    console.log('[GameRenderer] ResizeObserver initialized')
  }

  /** Setup proper DPR handling with Math.round(). */
  setupDPRHandling(): void {
    const canvas = this.host.engine.getRenderingCanvas()
    if (!canvas) return

    const dpr = Math.round(window.devicePixelRatio || 1)
    if (
      canvas.width !== canvas.clientWidth * dpr ||
      canvas.height !== canvas.clientHeight * dpr
    ) {
      this.host.engine.resize()
    }

    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mediaQuery.addEventListener('change', () => {
      const newDpr = Math.round(window.devicePixelRatio || 1)
      console.log(`[GameRenderer] DPR changed: ${newDpr}`)
      this.host.engine.resize()
    })
  }

  /** Start adaptive quality optimizer targeting 55 fps. */
  setupSceneOptimizer(): void {
    const { scene } = this.host
    if (!scene) return

    // Debug: disable scene optimizer via URL flag
    if (new URLSearchParams(window.location.search).has('noopt')) {
      console.log('[GameRenderer] SceneOptimizer disabled via ?noopt=1')
      return
    }

    const options = SceneOptimizerOptions.ModerateDegradationAllowed(55)
    this._sceneOptimizer = new SceneOptimizer(scene, options)
    this._sceneOptimizer.onSuccessObservable.add(() => {
      console.log('[SceneOptimizer] Target FPS reached – optimizations applied')
    })
    this._sceneOptimizer.onFailureObservable.add(() => {
      console.warn('[SceneOptimizer] Could not reach target FPS after all optimizations')
    })
    this._sceneOptimizer.start()
    console.log('[SceneOptimizer] Adaptive quality optimizer started (target: 55 fps)')
  }

  /** Initialize debug instrumentation when HUD becomes visible. */
  initializeDebugInstrumentation(): void {
    const { scene, engine } = this.host
    if (!scene) return
    if (!this.host.sceneInstrumentation) {
      this.host.sceneInstrumentation = new SceneInstrumentation(scene)
      this.host.sceneInstrumentation.captureActiveMeshesEvaluationTime = false
      this.host.sceneInstrumentation.captureRenderTargetsRenderTime = false
      this.host.sceneInstrumentation.captureFrameTime = true
      this.host.sceneInstrumentation.captureInterFrameTime = false
    }
    if (!this.host.engineInstrumentation) {
      this.host.engineInstrumentation = new EngineInstrumentation(engine)
      this.host.engineInstrumentation.captureGPUFrameTime = false
      this.host.engineInstrumentation.captureShaderCompilationTime = false
    }
  }

  disposeDebugInstrumentation(): void {
    this.host.sceneInstrumentation?.dispose()
    this.host.sceneInstrumentation = null
    this.host.engineInstrumentation?.dispose()
    this.host.engineInstrumentation = null
  }

  dispose(): void {
    this._unsubBloom?.()
    this._unsubBloom = null
    this._unsubShake?.()
    this._unsubShake = null

    this._sceneOptimizer?.dispose()
    this._sceneOptimizer = null

    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }

    this.host.bloomPipeline?.dispose()
    this.host.bloomPipeline = null

    this.host.mirrorTexture?.dispose()
    this.host.mirrorTexture = null

    this.host.tableRenderTarget?.dispose()
    this.host.tableRenderTarget = null

    this.host.headRenderTarget?.dispose()
    this.host.headRenderTarget = null

    this.host.shadowGenerator?.dispose()
    this.host.shadowGenerator = null
  }
}
