import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TargetCamera,
  Vector3,
} from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { EffectsConfig } from '../config'
import { DEFAULT_ACCESSIBILITY, type AccessibilityConfig } from '../game-elements/accessibility-config'
import { PALETTE } from '../game-elements/visual-language'
import { getTransitionColor } from './effects-cabinet'

type LightingMode = 'normal' | 'hit' | 'fever' | 'reach'

interface ScreenEffectsControllerOptions {
  scene: Scene
  bloomPipeline: DefaultRenderingPipeline | null
  accessibility: AccessibilityConfig
  isEnhancedEffectsEnabled: () => boolean
}

export class ScreenEffectsController {
  private scene: Scene
  private bloomPipeline: DefaultRenderingPipeline | null
  private accessibility: AccessibilityConfig
  private isEnhancedEffectsEnabled: () => boolean

  // Screen shake state
  private screenShake = {
    active: false,
    intensity: 0,
    duration: 0,
    timer: 0,
    offset: new Vector3(0, 0, 0),
  }

  // Camera reference for screen shake
  private cameraRef: { position: Vector3 } | null = null
  private tableCam: TargetCamera | null = null

  // Camera shake state
  private cameraShakeIntensity = 0
  private cameraShakeDecay = 5.0
  private cameraShakeTime = 0
  private readonly MAX_SHAKE_INTENSITY = 0.08 // Reduced from 0.15 for safety

  // Vignette flash state for cabinet-shake secret bonus
  private vignetteFlash = {
    active: false,
    timer: 0,
    duration: 0.3,
    originalWeight: 0.4,
    originalColor: new Color4(0, 0, 0, 0),
    originalBlendMode: 0,
  }

  // Screen pulse state for zone transitions
  private screenPulse = {
    active: false,
    timer: 0,
    duration: 0.5,
    intensity: 1.0,
    color: new Color3(1, 1, 1),
  }

  // LCD post-process reference for screen effects
  private lcdPostProcess: { flashIntensity: number } | null = null

  // Transition flash
  private transitionFlashOverlay: Mesh | null = null
  private transitionFlashMat: StandardMaterial | null = null
  private transitionFlash = {
    active: false,
    progress: 0,
    duration: EffectsConfig.transitionFlash.duration,
    color: Color3.White(),
    direction: 'in' as 'in' | 'out',
  }

  constructor(options: ScreenEffectsControllerOptions) {
    this.scene = options.scene
    this.bloomPipeline = options.bloomPipeline
    this.accessibility = options.accessibility
    this.isEnhancedEffectsEnabled = options.isEnhancedEffectsEnabled
  }

  setBloomPipeline(pipeline: DefaultRenderingPipeline | null): void {
    this.bloomPipeline = pipeline
  }

  registerAccessibility(config: AccessibilityConfig): void {
    this.accessibility = config ?? DEFAULT_ACCESSIBILITY
  }

  registerCamera(camera: { position: Vector3 }): void {
    this.cameraRef = camera
  }

  registerTableCamera(camera: TargetCamera): void {
    this.tableCam = camera
  }

  registerLCDPostProcess(postProcess: { flashIntensity: number }): void {
    this.lcdPostProcess = postProcess
  }

  addCameraShake(intensity: number): void {
    // Respect user accessibility preferences
    if (this.accessibility?.cameraShakeEnabled === false) return

    // Cap at safe maximum intensity
    const safeIntensity = Math.min(intensity, this.MAX_SHAKE_INTENSITY)
    this.cameraShakeIntensity = Math.min(this.cameraShakeIntensity + safeIntensity, this.MAX_SHAKE_INTENSITY)
    this.cameraShakeTime = performance.now() * 0.001
  }

  flashVignette(colorHex: string, durationMs = 300): void {
    if (!this.bloomPipeline?.imageProcessing) return
    const ip = this.bloomPipeline.imageProcessing

    if (!this.vignetteFlash.active) {
      this.vignetteFlash.originalWeight = ip.vignetteWeight
      this.vignetteFlash.originalColor = ip.vignetteColor.clone()
      this.vignetteFlash.originalBlendMode = ip.vignetteBlendMode
    }

    this.vignetteFlash.active = true
    this.vignetteFlash.timer = 0
    this.vignetteFlash.duration = durationMs / 1000

    ip.vignetteEnabled = true
    ip.vignetteBlendMode = 1 // Additive

    const c = Color3.FromHexString(colorHex)
    ip.vignetteColor = new Color4(c.r, c.g, c.b, 1)
    ip.vignetteWeight = 1.5
  }

  triggerScreenPulse(colorHex: string = PALETTE.WHITE, intensity = 0.8, durationMs = 400): void {
    // LCD post-process flash (if available)
    if (this.lcdPostProcess) {
      this.lcdPostProcess.flashIntensity = intensity
    }

    // Bloom pipeline flash (if available)
    if (this.bloomPipeline?.imageProcessing) {
      this.screenPulse.active = true
      this.screenPulse.timer = 0
      this.screenPulse.duration = durationMs / 1000
      this.screenPulse.intensity = intensity
      this.screenPulse.color = Color3.FromHexString(colorHex)

      // Boost exposure temporarily
      const ip = this.bloomPipeline.imageProcessing
      ip.exposure = 1.0 + intensity * 0.5
    }

    // Also trigger vignette flash for cabinet feel
    this.flashVignette(colorHex, durationMs)
  }

  updateVignetteFlash(dt: number): void {
    if (!this.vignetteFlash.active || !this.bloomPipeline?.imageProcessing) return

    this.vignetteFlash.timer += dt
    const progress = this.vignetteFlash.timer / this.vignetteFlash.duration

    if (progress >= 1) {
      const ip = this.bloomPipeline.imageProcessing
      ip.vignetteWeight = this.vignetteFlash.originalWeight
      ip.vignetteColor = this.vignetteFlash.originalColor
      ip.vignetteBlendMode = this.vignetteFlash.originalBlendMode
      this.vignetteFlash.active = false
      return
    }

    const fade = 1 - progress
    this.bloomPipeline.imageProcessing.vignetteWeight =
      this.vignetteFlash.originalWeight + (1.5 - this.vignetteFlash.originalWeight) * fade
  }

  updateCameraShake(dt: number): void {
    if (this.cameraShakeIntensity <= 0 || !this.tableCam) return

    // Enforce safe maximum intensity
    const intensity = Math.min(this.cameraShakeIntensity, this.MAX_SHAKE_INTENSITY)

    // Use smooth sine waves instead of random for less jarring motion
    this.cameraShakeTime += dt
    const shakeX = Math.sin(this.cameraShakeTime * 20) * intensity * 0.7
    const shakeY = Math.cos(this.cameraShakeTime * 15) * intensity * 0.5
    const shakeZ = Math.sin(this.cameraShakeTime * 25) * intensity * 0.3

    // Apply to target, not position (preserves user control)
    this.tableCam.target.addInPlace(new Vector3(shakeX, shakeY, shakeZ))

    // Decay intensity with quick settling (5.0/sec)
    this.cameraShakeIntensity = Math.max(0, this.cameraShakeIntensity - dt * this.cameraShakeDecay)
  }

  triggerStateTransitionFlash(_fromState: LightingMode, toState: LightingMode): void {
    if (!this.isEnhancedEffectsEnabled() || !EffectsConfig.enableStateTransitionFlashes) return

    // Get color for transition
    const flashColor = getTransitionColor(toState)

    // Initialize overlay if needed
    if (!this.transitionFlashOverlay) {
      this.createTransitionFlashOverlay()
    }

    this.transitionFlash.active = true
    this.transitionFlash.progress = 0
    this.transitionFlash.duration = EffectsConfig.transitionFlash.duration
    this.transitionFlash.color = flashColor
    this.transitionFlash.direction = 'in'

    if (this.transitionFlashMat) {
      this.transitionFlashMat.emissiveColor = flashColor
      this.transitionFlashOverlay!.isVisible = true
    }
  }

  updateTransitionFlash(dt: number): void {
    if (!this.transitionFlash.active || !this.transitionFlashOverlay || !this.transitionFlashMat) return

    this.transitionFlash.progress += dt / this.transitionFlash.duration

    if (this.transitionFlash.direction === 'in') {
      // Fade in
      const alpha = Math.min(1, this.transitionFlash.progress) * EffectsConfig.transitionFlash.maxOpacity
      this.transitionFlashMat.alpha = alpha

      if (this.transitionFlash.progress >= 1) {
        // Switch to fade out
        this.transitionFlash.direction = 'out'
        this.transitionFlash.progress = 0
      }
      return
    }

    // Fade out
    const alpha = Math.max(0, 1 - this.transitionFlash.progress) * EffectsConfig.transitionFlash.maxOpacity
    this.transitionFlashMat.alpha = alpha

    if (this.transitionFlash.progress >= 1) {
      // Complete
      this.transitionFlash.active = false
      this.transitionFlashOverlay.isVisible = false
    }
  }

  triggerScreenShake(intensity: 'light' | 'medium' | 'heavy'): void {
    // CRITICAL SAFETY: Skip if reduced motion or shake disabled
    if (this.accessibility.reducedMotion || !this.accessibility.cameraShakeEnabled) return
    if (!this.cameraRef) return

    this.screenShake.active = true
    // CRITICAL SAFETY: Cap intensity at safe maximum
    const baseIntensity = EffectsConfig.screenShake.intensity[intensity]
    this.screenShake.intensity = Math.min(baseIntensity, this.accessibility.maxCameraShakeIntensity)
    this.screenShake.duration = intensity === 'light' ? 0.1 : intensity === 'medium' ? 0.15 : 0.25
    this.screenShake.timer = 0
  }

  updateScreenShake(): void {
    if (!this.screenShake.active || !this.cameraRef) return

    const dt = 0.016
    this.screenShake.timer += dt

    if (this.screenShake.timer >= this.screenShake.duration) {
      // Reset camera offset
      if (this.screenShake.offset.length() > 0) {
        this.cameraRef.position.subtractInPlace(this.screenShake.offset)
      }
      this.screenShake.active = false
      this.screenShake.offset.set(0, 0, 0)
      return
    }

    // Remove previous offset
    this.cameraRef.position.subtractInPlace(this.screenShake.offset)

    // Calculate new shake with decay
    const progress = this.screenShake.timer / this.screenShake.duration
    const decay = Math.pow(EffectsConfig.screenShake.decay, progress * 10)
    const currentIntensity = this.screenShake.intensity * decay

    // Random offset
    this.screenShake.offset.set(
      (Math.random() - 0.5) * currentIntensity,
      (Math.random() - 0.5) * currentIntensity,
      (Math.random() - 0.5) * currentIntensity
    )

    this.cameraRef.position.addInPlace(this.screenShake.offset)
  }

  triggerCabinetShake(
    intensity: 'light' | 'medium' | 'heavy' | 'jackpot' = 'medium',
    color?: string
  ): void {
    // CRITICAL SAFETY: Skip if reduced motion or shake disabled
    if (this.accessibility.reducedMotion || !this.accessibility.cameraShakeEnabled) return

    // Map intensity to shake values
    const shakeIntensity =
      {
        light: 0.02,
        medium: 0.04,
        heavy: 0.06,
        jackpot: 0.08,
      }[intensity]

    // Add camera shake
    this.addCameraShake(shakeIntensity)

    // Flash vignette with color
    const flashColor = color || (intensity === 'jackpot' ? '#ff0088' : PALETTE.CYAN)
    const flashDuration = intensity === 'jackpot' ? 500 : intensity === 'heavy' ? 300 : 200
    this.flashVignette(flashColor, flashDuration)

    console.log(`[Effects] Cabinet shake triggered: ${intensity}`)
  }

  dispose(): void {
    this.transitionFlashOverlay?.dispose()
    this.transitionFlashMat?.dispose()
  }

  private createTransitionFlashOverlay(): void {
    // Create a full-screen quad positioned in front of cameras
    this.transitionFlashOverlay = MeshBuilder.CreatePlane(
      'transitionFlash',
      { width: 100, height: 100 },
      this.scene
    )

    this.transitionFlashOverlay.position.set(0.75, 5, -50)
    this.transitionFlashOverlay.rotation.y = Math.PI

    this.transitionFlashMat = new StandardMaterial('transitionFlashMat', this.scene)
    this.transitionFlashMat.emissiveColor = Color3.White()
    this.transitionFlashMat.alpha = 0
    this.transitionFlashMat.disableLighting = true
    this.transitionFlashOverlay.material = this.transitionFlashMat
    this.transitionFlashOverlay.isVisible = false

    // Ensure it renders on top
    this.transitionFlashOverlay.renderingGroupId = 1
  }
}
