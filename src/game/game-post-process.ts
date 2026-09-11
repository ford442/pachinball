/**
 * Post-processing pipeline management — bloom/FXAA/tonemap setup, quality-tier
 * knobs, HIGH-only heavy effects (DoF/SSAO/SSR/motion blur), the WebGPU
 * uniform-buffer overflow guard, and the bloom-kick/camera-shake decay loop.
 *
 * Extracted from GameRenderer to keep that orchestrator under the house line limit.
 */

import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { DepthOfFieldEffectBlurLevel } from '@babylonjs/core/PostProcesses/depthOfFieldEffect'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline'
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import {
  applyBloomPipelineProfile,
  downgradePostProcessTier,
  isUniformBufferLimitError,
  isWebGPUEngine,
  recordPostProcessTierDegrade,
  resolveWebGPUPostProcessProfile,
  type WebGPUPostProcessProfile,
} from './webgpu-post-process-profile'
import { MinimalBloomPipeline } from '../effects/minimal-bloom-pipeline'
import { QualityTier, INTENSITY } from '../game-elements'
import { getMaterialLibrary } from '../materials'
import { GameConfig } from '../config'
import type { RendererHost } from './game-renderer'

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

  private _ssaoPipeline: SSAO2RenderingPipeline | null = null
  private _ssrPipeline: SSRRenderingPipeline | null = null
  private _motionBlur: MotionBlurPostProcess | null = null
  private _isSwiftShader = false
  private _postProcessProfile: WebGPUPostProcessProfile | null = null
  private _webgpuErrorListener: ((event: Event) => void) | null = null

  constructor(host: RendererHost) {
    this.host = host
  }

  /** Setup bloom, FXAA, tone-mapping, DoF, and scanlines. */
  setup(): void {
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

    const useMinimalBloom =
      this._postProcessProfile.tier === 'bloom-only' ||
      this._postProcessProfile.tier === 'conservative'

    if (useMinimalBloom) {
      const minimal = new MinimalBloomPipeline(scene, [tableCam])
      this.host.bloomPipeline = minimal
      this.host.postProcessDegraded = true
      console.warn(
        `[GameRenderer] WebGPU post-process tier: ${this._postProcessProfile.tier} (${this._postProcessProfile.reason})`,
      )
      this.attachWebGPUUniformBufferGuard()
    } else {
      // Defer pipeline build until profile toggles are applied on full DefaultRenderingPipeline.
      const bloom = new DefaultRenderingPipeline('pachinbloom', true, scene, [tableCam], false)
      this.host.bloomPipeline = bloom
      applyBloomPipelineProfile(bloom, this._postProcessProfile, reducedMotion)
      this.attachWebGPUUniformBufferGuard()
    }

    const bloom = this.host.bloomPipeline
    if (!bloom) return

    const bloomSafe = !reducedMotion && effectIntensity > 0
    const baseWeight = 0.25
    if (!useMinimalBloom) {
      const fullBloom = bloom as DefaultRenderingPipeline
      fullBloom.bloomEnabled = bloomSafe
      fullBloom.bloomKernel = 64
      fullBloom.bloomScale = 0.5
      fullBloom.bloomWeight = baseWeight * effectIntensity * INTENSITY.ACTIVE
      fullBloom.bloomThreshold = 0.75
      if (fullBloom.imageProcessingEnabled && fullBloom.imageProcessing) {
        fullBloom.imageProcessing.toneMappingEnabled = true
        fullBloom.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
        fullBloom.imageProcessing.contrast = 1.1
        fullBloom.imageProcessing.exposure = 1.0
        fullBloom.imageProcessing.vignetteWeight = 0.4
        fullBloom.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0)
        if (fullBloom.imageProcessing.colorCurvesEnabled && fullBloom.imageProcessing.colorCurves) {
          fullBloom.imageProcessing.colorCurves.globalHue = 5
          fullBloom.imageProcessing.colorCurves.globalSaturation = 15
        }
      }
      if (fullBloom.sharpenEnabled) {
        fullBloom.sharpen.edgeAmount = 0.3
      }
      fullBloom.prepare()
    } else {
      bloom.bloomEnabled = bloomSafe
      bloom.bloomKernel = 64
      bloom.bloomScale = 0.5
      bloom.bloomWeight = baseWeight * effectIntensity * INTENSITY.ACTIVE
      bloom.bloomThreshold = 0.75
      bloom.prepare()
    }

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

    // DoF / SSAO / SSR / motion blur are HIGH-only (mobile boot caps at MEDIUM).
    this._isSwiftShader = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gl = (this.host.engine as any)._gl as WebGLRenderingContext | null
      if (!gl) return false
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (!debugInfo) return false
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string
      return renderer?.toLowerCase().includes('swiftshader') ?? false
    })()

    this.applyHeavyPostProcesses(qualityTier, reducedMotion)

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
   * Updates bloom knobs and toggles HIGH-only heavy post-process.
   */
  applyQualityTier(tier: QualityTier): void {
    const { scene, bloomPipeline, accessibility } = this.host
    if (!scene || !bloomPipeline) {
      this.host.qualityTier = tier
      return
    }

    this.host.qualityTier = tier
    this.host.effects?.setQualityTier(tier)
    getMaterialLibrary(scene).qualityTier = tier

    const reducedMotion = accessibility?.reducedMotion ?? GameConfig.camera.reducedMotion
    const effectIntensity = accessibility?.effectIntensity ?? 1.0
    const baseWeight = 0.25 * effectIntensity * INTENSITY.ACTIVE

    bloomPipeline.bloomEnabled = !reducedMotion && effectIntensity > 0
    bloomPipeline.bloomThreshold = 0.75

    const profile = this._postProcessProfile ?? resolveWebGPUPostProcessProfile(this.host.engine)
    if (bloomPipeline instanceof DefaultRenderingPipeline) {
      applyBloomPipelineProfile(bloomPipeline, profile, reducedMotion)
      if (profile.tier !== 'full') {
        bloomPipeline.prepare()
      }
    }

    if (tier === QualityTier.LOW) {
      bloomPipeline.bloomKernel = 16
      bloomPipeline.bloomScale = 0.2
      bloomPipeline.bloomWeight = Math.min(baseWeight, 0.12)
      bloomPipeline.sharpenEnabled = false
    } else if (tier === QualityTier.MEDIUM) {
      bloomPipeline.bloomKernel = 32
      bloomPipeline.bloomScale = 0.35
      bloomPipeline.bloomWeight = Math.min(baseWeight, 0.25)
    } else {
      bloomPipeline.bloomKernel = 64
      bloomPipeline.bloomScale = 0.5
      bloomPipeline.bloomWeight = baseWeight
    }

    this.applyHeavyPostProcesses(tier, reducedMotion)
    console.log(`[GameRenderer] Quality tier applied: ${tier}`)
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

  private applyHeavyPostProcesses(qualityTier: QualityTier, reducedMotion: boolean): void {
    const { scene, tableCam } = this.host
    if (!scene || !tableCam) return

    const allowHeavy =
      qualityTier === QualityTier.HIGH && !reducedMotion && !this._isSwiftShader

    // DoF lives on the default pipeline
    const bloom = this.host.bloomPipeline
    if (bloom instanceof DefaultRenderingPipeline) {
      if (allowHeavy) {
        try {
          bloom.depthOfFieldEnabled = true
          bloom.depthOfField.focusDistance = 2500
          bloom.depthOfField.fStop = 2.4
          bloom.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.High
        } catch (err) {
          bloom.depthOfFieldEnabled = false
          this.host.postProcessDegraded = true
          console.warn('[GameRenderer] MRT post-process unavailable; DoF failed', err)
        }
      } else {
        bloom.depthOfFieldEnabled = false
      }
    }

    if (allowHeavy) {
      if (!this._ssaoPipeline) {
        try {
          const ssao = new SSAO2RenderingPipeline('ssao', scene, {
            ssaoRatio: 1.0,
            blurRatio: 1.0,
          })
          ssao.radius = 1.5
          ssao.totalStrength = 0.6
          ssao.base = 0.5
          ssao.samples = 32
          ssao.maxZ = 50
          ssao.minZAspect = 0.5
          scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', [tableCam])
          this._ssaoPipeline = ssao
        } catch (err) {
          this.host.postProcessDegraded = true
          console.warn('[GameRenderer] MRT post-process unavailable; SSAO failed', err)
        }
      }

      if (!this._ssrPipeline) {
        this._ssrPipeline = new SSRRenderingPipeline('ssr', scene, [tableCam])
        this._ssrPipeline.step = 0.5
        this._ssrPipeline.reflectionSpecularFalloffExponent = 3
        this._ssrPipeline.strength = 0.6
        this._ssrPipeline.thickness = 0.1
        this._ssrPipeline.selfCollisionNumSkip = 1
        this._ssrPipeline.enableSmoothReflections = true
        this._ssrPipeline.enableAutomaticThicknessComputation = true
      }

      if (!this._motionBlur) {
        this._motionBlur = new MotionBlurPostProcess('motionBlur', scene, 1.0, tableCam)
        this._motionBlur.motionStrength = 0.15
        this._motionBlur.motionBlurSamples = 16
      }
    } else {
      this.disposeHeavyPostProcesses()
    }
  }

  private attachWebGPUUniformBufferGuard(): void {
    if (!isWebGPUEngine(this.host.engine) || this._webgpuErrorListener) return

    const device = (this.host.engine as WebGPUEngine)._device
    if (!device) return

    this._webgpuErrorListener = (event: Event) => {
      const gpuEvent = event as GPUUncapturedErrorEvent
      const message = gpuEvent.error?.message ?? String(gpuEvent.error)
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

      if (nextTier === 'none') {
        this.disposeBloomPipeline()
        return
      }

      if (!this.host.bloomPipeline || !(this.host.bloomPipeline instanceof DefaultRenderingPipeline)) return

      const reducedMotion = this.host.accessibility?.reducedMotion ?? GameConfig.camera.reducedMotion
      applyBloomPipelineProfile(this.host.bloomPipeline, this._postProcessProfile, reducedMotion)
      this.host.bloomPipeline.prepare()
    }

    device.addEventListener('uncapturederror', this._webgpuErrorListener)
  }

  private disposeBloomPipeline(): void {
    if (!this.host.bloomPipeline) return
    this.host.bloomPipeline.dispose()
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

  private disposeHeavyPostProcesses(): void {
    const { scene, tableCam } = this.host
    if (this._ssaoPipeline && scene && tableCam) {
      try {
        scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('ssao', [tableCam])
      } catch {
        // Pipeline may already be detached
      }
      this._ssaoPipeline.dispose()
      this._ssaoPipeline = null
    }
    if (this._ssrPipeline) {
      this._ssrPipeline.dispose()
      this._ssrPipeline = null
    }
    if (this._motionBlur) {
      this._motionBlur.dispose()
      this._motionBlur = null
    }
  }

  dispose(): void {
    this.detachWebGPUUniformBufferGuard()
    this._postProcessProfile = null

    this._unsubBloom?.()
    this._unsubBloom = null
    this._unsubShake?.()
    this._unsubShake = null

    this.disposeBloomPipeline()
    this.disposeHeavyPostProcesses()
  }
}
