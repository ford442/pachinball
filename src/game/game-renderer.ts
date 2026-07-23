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
  PALETTE,
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
  postProcessDegraded: boolean
}

export class GameRenderer {
  private readonly host: RendererHost
  private _resizeObserver: ResizeObserver | null = null
  private _sceneOptimizer: SceneOptimizer | null = null
  private _lastResizeWidth = 0
  private _lastResizeHeight = 0

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
      try {
        bloom.depthOfFieldEnabled = true
        bloom.depthOfField.focusDistance = 2500
        bloom.depthOfField.fStop = 2.4
        bloom.depthOfFieldBlurLevel =
          qualityTier === QualityTier.HIGH
            ? DepthOfFieldEffectBlurLevel.High
            : DepthOfFieldEffectBlurLevel.Low
      } catch (err) {
        bloom.depthOfFieldEnabled = false
        this.host.postProcessDegraded = true
        console.warn('[GameRenderer] MRT post-process unavailable; running bloom-only (DoF failed)', err)
      }
    }

    // Skip MRT-based post-processes when running on SwiftShader (WebGL) to avoid
    // GL_INVALID_OPERATION: Active draw buffers with missing fragment shader outputs.
    // WebGPU adapters that still fail validation are handled via try/catch below.
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
      try {
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
      } catch (err) {
        this.host.postProcessDegraded = true
        console.warn('[GameRenderer] MRT post-process unavailable; running bloom-only (SSAO failed)', err)
      }
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

    // ========================================================================
    // NEXUS CASCADE — DRAMATIC ARCADE ENVIRONMENT
    // Makes the entire cabinet feel like it belongs in a legendary 2025 cyber-arcade.
    // All elements are pure emissive geometry — zero performance or physics cost.
    // Layered to interact gorgeously with ACES tonemap + heavy bloom.
    // ========================================================================

    // --------------------------------------------------------------------
    // MULTI-LAYER CABINET UNDERGLOW (the machine looks like it's hovering on pure neon)
    // --------------------------------------------------------------------
    // Deep base wash (cyan)
    const underBase = MeshBuilder.CreateBox('underBase', { width: 36, height: 0.18, depth: 49 }, scene)
    underBase.position.set(0.75, -5.05, 5)
    const ubMat = new StandardMaterial('underBaseMat', scene)
    ubMat.diffuseColor = Color3.Black()
    ubMat.emissiveColor = color(PALETTE.CYAN).scale(0.18)
    ubMat.disableLighting = true
    underBase.material = ubMat

    // Hot inner core (magenta — gives the signature "premium machine" bloom kick)
    const underCore = MeshBuilder.CreateBox('underCore', { width: 26, height: 0.09, depth: 38 }, scene)
    underCore.position.set(0.75, -4.95, 5)
    const ucMat = new StandardMaterial('underCoreMat', scene)
    ucMat.diffuseColor = Color3.Black()
    ucMat.emissiveColor = color(PALETTE.MAGENTA).scale(0.55)
    ucMat.disableLighting = true
    ucMat.alpha = 0.9
    underCore.material = ucMat

    // Gold edge "plasma" trim (very thin, high intensity)
    const underEdge = MeshBuilder.CreateBox('underEdge', { width: 38, height: 0.05, depth: 51 }, scene)
    underEdge.position.set(0.75, -4.88, 5)
    const ueMat = new StandardMaterial('underEdgeMat', scene)
    ueMat.diffuseColor = Color3.Black()
    ueMat.emissiveColor = color(PALETTE.GOLD).scale(0.75)
    ueMat.disableLighting = true
    underEdge.material = ueMat

    // Side floor "spill" washes (classic arcade footlight feel)
    const leftSpill = MeshBuilder.CreateBox('spillL', { width: 1.6, height: 0.07, depth: 42 }, scene)
    leftSpill.position.set(-14.2, -4.55, 5)
    const spillLMat = new StandardMaterial('spillLMat', scene)
    spillLMat.diffuseColor = Color3.Black()
    spillLMat.emissiveColor = color(PALETTE.CYAN).scale(0.35)
    spillLMat.disableLighting = true
    leftSpill.material = spillLMat

    const rightSpill = MeshBuilder.CreateBox('spillR', { width: 1.6, height: 0.07, depth: 42 }, scene)
    rightSpill.position.set(15.7, -4.55, 5)
    const spillRMat = new StandardMaterial('spillRMat', scene)
    spillRMat.diffuseColor = Color3.Black()
    spillRMat.emissiveColor = color(PALETTE.MAGENTA).scale(0.32)
    spillRMat.disableLighting = true
    rightSpill.material = spillRMat

    // --------------------------------------------------------------------
    // VERTICAL ARCADE PILLARS (the cabinet is framed by the environment)
    // --------------------------------------------------------------------
    const pillarMat = new StandardMaterial('arcadePillarMat', scene)
    pillarMat.diffuseColor = Color3.Black()
    pillarMat.emissiveColor = color(PALETTE.CYAN).scale(0.65)
    pillarMat.disableLighting = true

    const pillarPositions = [
      new Vector3(-22, 4, -18), new Vector3(22, 4, -18),
      new Vector3(-22, 4, 28),  new Vector3(22, 4, 28),
      new Vector3(-22, 9, 8),   new Vector3(22, 9, 8)
    ]
    pillarPositions.forEach((pos, i) => {
      const p = MeshBuilder.CreateCylinder(`arcadePillar${i}`, { height: 18, diameter: 0.9, tessellation: 6 }, scene)
      p.position = pos
      p.material = pillarMat
      // Subtle inner core for extra bloom depth
      const core = MeshBuilder.CreateCylinder(`pillarCore${i}`, { height: 18.2, diameter: 0.35 }, scene)
      core.position = pos
      core.material = new StandardMaterial(`pillarCoreMat${i}`, scene)
      ;(core.material as StandardMaterial).emissiveColor = color(PALETTE.MAGENTA).scale(0.4)
      ;(core.material as StandardMaterial).disableLighting = true
    })

    // --------------------------------------------------------------------
    // CEILING NEON TUBES (classic dark arcade atmosphere)
    // --------------------------------------------------------------------
    const ceilingMat = new StandardMaterial('ceilingNeonMat', scene)
    ceilingMat.diffuseColor = Color3.Black()
    ceilingMat.emissiveColor = color(PALETTE.GOLD).scale(0.5)
    ceilingMat.disableLighting = true

    for (let i = 0; i < 3; i++) {
      const tube = MeshBuilder.CreateCylinder(`ceilingTube${i}`, { height: 28, diameter: 0.22, tessellation: 5 }, scene)
      tube.rotation.x = Math.PI / 2
      tube.position.set(-14 + i * 14, 17, 6)
      tube.material = ceilingMat
    }

    // --------------------------------------------------------------------
    // BACK WALL CYBER MOTIFS (the machine lives inside a living digital world)
    // --------------------------------------------------------------------
    // Large faint grid "window" behind the cabinet
    const gridPanel = MeshBuilder.CreatePlane('backGrid', { width: 42, height: 22 }, scene)
    gridPanel.position.set(0, 13, 39.4)
    gridPanel.rotation.x = Math.PI
    const gridMat = new StandardMaterial('backGridMat', scene)
    gridMat.diffuseColor = Color3.FromHexString('#0a0a18')
    gridMat.emissiveColor = color(PALETTE.PURPLE).scale(0.25)
    gridMat.disableLighting = true
    gridPanel.material = gridMat

    // Vertical data "waterfall" lines on the back wall
    for (let i = 0; i < 7; i++) {
      const line = MeshBuilder.CreateBox(`dataFall${i}`, { width: 0.18, height: 19, depth: 0.06 }, scene)
      line.position.set(-15 + i * 5.2, 11, 39.5)
      const dlMat = new StandardMaterial(`dataFallMat${i}`, scene)
      dlMat.emissiveColor = color(i % 2 ? PALETTE.CYAN : PALETTE.MAGENTA).scale(0.55)
      dlMat.disableLighting = true
      line.material = dlMat
    }

    // Signature "NEXUS" style back-wall logo accent (abstract geometric)
    const logo = MeshBuilder.CreateTorus('backLogo', { diameter: 7, thickness: 0.25, tessellation: 24 }, scene)
    logo.position.set(0, 18, 39.3)
    logo.rotation.x = Math.PI
    const logoMat = new StandardMaterial('backLogoMat', scene)
    logoMat.emissiveColor = color(PALETTE.GOLD).scale(0.85)
    logoMat.disableLighting = true
    logo.material = logoMat

    console.log('[GameRenderer] Nexus Cascade arcade environment created — cabinet now feels legendary')
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
