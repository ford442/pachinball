// Main EffectsSystem orchestrator
import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Color4,
  PointLight,
  Texture,
  Mesh,
  TargetCamera,
} from '@babylonjs/core'
import type { AbstractMesh, DirectionalLight } from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { CabinetLight, ShardParticle } from '../game-elements/types'
import {
  PALETTE,
  SURFACES,
  TEMPERATURE,
  FOG_STATES,
  LIGHTING_STATES,
  LIGHTING,
  color,
  pulse,
  QualityTier,
  STATE_COLORS,
  INTENSITY,
} from '../game-elements/visual-language'
import { EffectsConfig, BallType, GameConfig } from '../config'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { DEFAULT_ACCESSIBILITY, type AccessibilityConfig } from '../game-elements/accessibility-config'
import { ParticleEffects } from './effects-particles'
import { TrackAmbientEffects } from './track-ambient-effects'
import type { TrackThemeProfile } from '../game-elements/track-theme-profiles'
import { LightingEffects } from './effects-lighting'
import { CameraEffects } from './effects-camera'
import { AudioEffects } from './effects-audio'
import { ShardEffects } from './effects-shards'
import { TrailEffects } from './effects-trails'
import { FloatingNumberEffects } from './effects-floating'
import { RipplesEffects } from './effects-ripples'
import { JackpotSequenceController } from './effects-jackpot'
import { createSharedParticleTexture } from './effects-utils'
import { createCabinetLighting, updateCabinetLighting, updateSlotLighting, getTransitionColor, type CabinetState } from './effects-cabinet'
import { ImpactEffects } from './effects-impact'
import { FresnelRimMaterialPlugin, FRESNEL_RIM_PHASE_FREQ } from './fresnel-rim-plugin'
import type { EventBus } from '../game/event-bus'
import type { BallManager } from '../game-elements/ball-manager'

/** Per-mesh rim tracking handle. */
interface RimHandle {
  plugin: FresnelRimMaterialPlugin
  phase: number
  peakIntensity: number
}

export class EffectsSystem {
  private scene: Scene
  private audioCtx: AudioContext | null = null
  private audioEffects: AudioEffects | null = null
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private bloomEnergy = 0
  private shards: ShardParticle[] = []
  private cabinetLights: CabinetLight[] = []
  private decorativeLights: (StandardMaterial | PBRMaterial)[] = []
  private currentCabinetColor: string = PALETTE.CYAN
  private lightingMode: 'normal' | 'hit' | 'fever' | 'reach' = 'normal'
  private lightingTimer = 0
  private hitFlashIntensity = 0

  // Scene lights for state-based animation
  private keyLight: DirectionalLight | null = null
  private rimLight: DirectionalLight | null = null
  private bounceLight: PointLight | null = null

  // Atmosphere state tracking
  private currentAtmosphereState = 'IDLE'
  private targetFogDensity = 0.005
  private targetFogColor: Color3 = color(SURFACES.PLAYFIELD)
  private targetKeyColor: Color3 = color(TEMPERATURE.NORMAL)
  private targetRimIntensity: number = LIGHTING.RIM.intensity
  private targetRimColor: Color3 = color(LIGHTING.RIM.color)

  // Jackpot sequence controller
  private jackpotSequenceController: JackpotSequenceController

  // Public getter for lighting mode
  get currentLightingMode(): 'normal' | 'hit' | 'fever' | 'reach' {
    return this.lightingMode
  }

  get jackpotTimer(): number {
    return this.jackpotSequenceController.jackpotTimer
  }

  get isJackpotActive(): boolean {
    return this.jackpotSequenceController.isJackpotActive
  }

  get jackpotPhase(): number {
    return this.jackpotSequenceController.jackpotPhase
  }

  private get isSolidGoldPulseActive(): boolean {
    return this.jackpotSequenceController.pulseActive
  }

  private get solidGoldPulseTimer(): number {
    return this.jackpotSequenceController.pulseTimer
  }

  // Screen shake state
  private screenShake = {
    active: false,
    intensity: 0,
    duration: 0,
    timer: 0,
    offset: new Vector3(0, 0, 0),
  }

  // Sub-systems: trail and floating effects
  private trailEffects: TrailEffects | null = null
  private floatingEffects: FloatingNumberEffects | null = null
  private ripplesEffects: RipplesEffects | null = null

  // Impact rings (Animation-based, max 5 at once)

  private readonly maxImpactRings = 5

  // Performance tracking — runtime adaptive tiering
  private lastFpsCheck = 0
  private fpsTrendCounter = 0
  private runtimePerformanceTier: 'high' | 'medium' | 'low' = 'high'

  // Camera reference for screen shake
  private cameraRef: { position: Vector3 } | null = null
  private tableCam: TargetCamera | null = null

  // Camera shake state
  private cameraShakeIntensity = 0
  private cameraShakeDecay = 5.0
  private cameraShakeTime = 0
  private readonly MAX_SHAKE_INTENSITY = 0.08 // Reduced from 0.15 for safety

  // Accessibility config (CRITICAL SAFETY)
  private accessibility: AccessibilityConfig = DEFAULT_ACCESSIBILITY

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

  // Sub-systems
  private particleEffects: ParticleEffects
  private trackAmbientEffects: TrackAmbientEffects
  private activeTrackProfile: TrackThemeProfile | null = null
  private trackAtmosphereActive = false
  private targetTrackBloom = 0.5
  private targetTrackVignette = 0.4
  private targetTrackKeyIntensity = 1.2
  private trackFlickerScale = 1
  private lightingEffects: LightingEffects
  private cameraEffects: CameraEffects | null = null
  private shardEffects: ShardEffects | null = null

  // Slot lighting
  private slotLightMode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot' = 'idle'
  private slotLightTimer = 0

  // Ball particle trails delegated to TrailEffects

  // Impact flash delegated to ImpactEffects
  private impactEffects: ImpactEffects | null = null

  // Quality tier for effect gating
  private qualityTier: QualityTier = QualityTier.HIGH

  // Fresnel rim effect tracking
  private activeRims = new Map<AbstractMesh, RimHandle>()
  private _rimEventUnsubscribers: Array<() => void> = []
  private _eventBus: EventBus | null = null
  // Pre-allocated Color3 for FEVER rim colour (avoid per-call allocation)
  private readonly _feverRimColor: Color3 = Color3.FromHexString(STATE_COLORS.FEVER)

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

  constructor(
    scene: Scene,
    bloomPipeline: DefaultRenderingPipeline | null,
    accessibility?: AccessibilityConfig
  ) {
    this.scene = scene
    this.bloomPipeline = bloomPipeline
    // CRITICAL SAFETY: Use provided accessibility config or detect automatically
    this.accessibility = accessibility ?? DEFAULT_ACCESSIBILITY

    // Initialize sub-systems
    this.particleEffects = new ParticleEffects(scene)
    this.trackAmbientEffects = new TrackAmbientEffects(scene)
    this.lightingEffects = new LightingEffects(scene)
    if (scene.activeCamera) {
      this.cameraEffects = new CameraEffects(scene.activeCamera)
    }
    this.shardEffects = new ShardEffects(scene, this.shards, this.maxImpactRings)
    this.trailEffects = new TrailEffects(scene)
    this.floatingEffects = new FloatingNumberEffects(scene)
    this.ripplesEffects = new RipplesEffects(scene)
    this.impactEffects = new ImpactEffects(scene)

    try {
      this.audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch {
      this.audioCtx = null
    }

    if (this.audioCtx) {
      this.audioEffects = new AudioEffects(this.audioCtx)
    }

    this.jackpotSequenceController = new JackpotSequenceController({
      emitJackpotPhase: (phase) => this._eventBus?.emit('jackpot:phase', { phase }),
      spawnJackpotBurst: (position) => this.spawnJackpotBurst(position),
      playBeep: (freq) => this.playBeep(freq),
      setLightingMode: (mode) => {
        this.lightingMode = mode
      },
      flashVignette: (colorHex, durationMs) => this.flashVignette(colorHex, durationMs),
      addCameraShake: (intensity) => this.addCameraShake(intensity),
      isReducedMotion: () => this.accessibility.reducedMotion,
      setBloomEnergy: (value) => {
        this.bloomEnergy = value
      },
    })
  }

  setCabinetColor(colorHex: string): void {
    this.currentCabinetColor = colorHex
  }

  setTrackThemeProfile(profile: TrackThemeProfile | null): void {
    this.activeTrackProfile = profile
    this.trackAtmosphereActive = profile !== null
    if (profile) {
      this.targetFogDensity = profile.atmosphere.fogDensity
      this.targetFogColor = color(profile.atmosphere.fogColor)
      this.targetKeyColor = color(profile.atmosphere.keyLightColor)
      this.targetRimColor = color(profile.atmosphere.rimColor)
      this.targetRimIntensity = profile.atmosphere.rimIntensity
      this.targetTrackKeyIntensity = profile.atmosphere.keyLightIntensity
      this.targetTrackBloom = profile.atmosphere.bloomWeight
      this.targetTrackVignette = profile.atmosphere.vignetteWeight
      this.currentCabinetColor = profile.particles.hitPrimary
      if (this.shouldEnableTrackAmbientEffects()) {
        this.trackAmbientEffects.applyProfile(profile)
      } else {
        this.trackAmbientEffects.applyProfile(null)
      }
    } else {
      this.trackAmbientEffects.applyProfile(null)
      const fogState = FOG_STATES[this.currentAtmosphereState] || FOG_STATES['IDLE']
      this.targetFogDensity = fogState.density
      this.targetFogColor = color(fogState.color)
    }
  }

  getTrackHitColor(): string | null {
    return this.activeTrackProfile?.particles.hitPrimary ?? null
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

  registerAccessibility(config: AccessibilityConfig): void {
    this.accessibility = config
    this.trackAmbientEffects.setAccessibilityFlags({
      photosensitiveMode: GameConfig.accessibility.photosensitiveMode,
      reducedMotion: config.reducedMotion,
    })
    if (this.activeTrackProfile) {
      this.setTrackThemeProfile(this.activeTrackProfile)
    }
  }

  private shouldEnableTrackAmbientEffects(): boolean {
    if (this.accessibility.reducedMotion) return false
    if (GameConfig.accessibility.photosensitiveMode) return false
    return this.accessibility.effectIntensity > 0
  }

  registerSceneLights(keyLight: DirectionalLight, rimLight: DirectionalLight, bounceLight: PointLight): void {
    this.keyLight = keyLight
    this.rimLight = rimLight
    this.bounceLight = bounceLight
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

  private updateVignetteFlash(dt: number): void {
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

  setAtmosphereState(state: string): void {
    if (state === this.currentAtmosphereState) return
    this.currentAtmosphereState = state

    // Fog targets
    const fogState = FOG_STATES[state] || FOG_STATES['IDLE']
    this.targetFogDensity = fogState.density
    this.targetFogColor = color(fogState.color)

    // Light temperature target
    const tempColor = TEMPERATURE[state as keyof typeof TEMPERATURE] || TEMPERATURE.NORMAL
    this.targetKeyColor = color(tempColor)

    // Rim light drama targets
    const lightState = LIGHTING_STATES[state] || LIGHTING_STATES['IDLE']
    this.targetRimIntensity = lightState.rim
    this.targetRimColor = color(lightState.rimColor)
  }

  updateAtmosphere(dt: number, ballPos?: Vector3): void {
    const lerpSpeed = dt * 2 // Smooth 0.5s transitions
    const time = performance.now() * 0.001

    // 1. State-based fog density & color (smooth lerp)
    if (this.scene.fogMode !== 0) {
      this.scene.fogDensity += (this.targetFogDensity - this.scene.fogDensity) * lerpSpeed
      this.scene.fogColor.r += (this.targetFogColor.r - this.scene.fogColor.r) * lerpSpeed
      this.scene.fogColor.g += (this.targetFogColor.g - this.scene.fogColor.g) * lerpSpeed
      this.scene.fogColor.b += (this.targetFogColor.b - this.scene.fogColor.b) * lerpSpeed
    }

    // 2. Light temperature shift on key light
    if (this.keyLight) {
      this.keyLight.diffuse.r += (this.targetKeyColor.r - this.keyLight.diffuse.r) * lerpSpeed
      this.keyLight.diffuse.g += (this.targetKeyColor.g - this.keyLight.diffuse.g) * lerpSpeed
      this.keyLight.diffuse.b += (this.targetKeyColor.b - this.keyLight.diffuse.b) * lerpSpeed

      const lightState = LIGHTING_STATES[this.currentAtmosphereState] || LIGHTING_STATES['IDLE']
      const targetKey = this.trackAtmosphereActive
        ? this.targetTrackKeyIntensity * this.trackFlickerScale
        : lightState.key
      this.keyLight.intensity += (targetKey - this.keyLight.intensity) * lerpSpeed
    }

    // 3. Rim light drama: intensity and color modulation per state
    if (this.rimLight) {
      this.rimLight.intensity += (this.targetRimIntensity - this.rimLight.intensity) * lerpSpeed
      this.rimLight.diffuse.r += (this.targetRimColor.r - this.rimLight.diffuse.r) * lerpSpeed
      this.rimLight.diffuse.g += (this.targetRimColor.g - this.rimLight.diffuse.g) * lerpSpeed
      this.rimLight.diffuse.b += (this.targetRimColor.b - this.rimLight.diffuse.b) * lerpSpeed
    }

    if (this.trackAtmosphereActive && this.bloomPipeline) {
      const bloomTarget = this.targetTrackBloom * this.trackFlickerScale
      this.bloomPipeline.bloomWeight += (bloomTarget - this.bloomPipeline.bloomWeight) * lerpSpeed
      if (this.bloomPipeline.imageProcessing) {
        this.bloomPipeline.imageProcessing.vignetteWeight +=
          (this.targetTrackVignette - this.bloomPipeline.imageProcessing.vignetteWeight) * lerpSpeed
      }
    }

    // 4. Bounce light proximity response: brighter when ball is near
    if (this.bounceLight && ballPos) {
      const distToBounce = Vector3.Distance(ballPos, this.bounceLight.position)
      const proximityBoost = Math.max(0, 1 - distToBounce / 15) * 0.4
      const targetIntensity = LIGHTING.BOUNCE.intensity + proximityBoost
      this.bounceLight.intensity += (targetIntensity - this.bounceLight.intensity) * dt * 5
    }

    // 5. Breathing clear color: subtle pulsing in idle state
    if (this.currentAtmosphereState === 'IDLE' || this.currentAtmosphereState === 'normal') {
      const breath = pulse(time, 0.25, 0.92, 1.0)
      const base = this.scene.clearColor
      this.scene.clearColor = new Color4(base.r * breath, base.g * breath, base.b * breath, base.a)
    }
  }

  registerDecorativeMaterial(mat: StandardMaterial | PBRMaterial): void {
    this.decorativeLights.push(mat)
  }

  createCabinetLighting(): void {
    // Delegate heavy cabinet lighting construction to effects-cabinet helper
    createCabinetLighting(this.scene, this.cabinetLights, this.currentCabinetColor)
  }

  spawnShardBurst(pos: Vector3, colorHex?: string): void {
    this.shardEffects?.spawnShardBurst(pos, colorHex)
  }

  spawnImpactRing(position: Vector3, normal: Vector3, color: string): void {
    this.shardEffects?.spawnImpactRing(position, normal, color)
  }

  updateShards(dt: number): void {
    this.shardEffects?.updateShards(dt)
  }

  updateBloom(): void {
    if (this.bloomPipeline) {
      this.bloomEnergy = Math.max(0, this.bloomEnergy - 0.016)
      this.bloomPipeline.bloomWeight = 0.1 + this.bloomEnergy * 0.8
    }
  }

  setBloomEnergy(value: number): void {
    this.bloomEnergy = value
  }

  startJackpotSequence(): void {
    this.jackpotSequenceController.startJackpotSequence()
  }

  /**
   * Advance the 10s Cyber-Shock jackpot sequence with real dt.
   * Phases:
   *   1: Breach     (0-2s)  - alarm, cracks, red pulse
   *   2: Critical   (2-5s)  - rising turbine, countdown glitch, white reveal, white/gold strobe
   *   3: Meltdown   (5-10s) - explosion, chrome JACKPOT, shockwaves, rainbow, bumper flash
   */
  updateJackpotSequence(dt: number): void {
    this.jackpotSequenceController.updateJackpotSequence(dt)
  }

  startSolidGoldPulse(): void {
    this.jackpotSequenceController.startSolidGoldPulse()
  }

  private updateSolidGoldPulse(dt: number): void {
    this.jackpotSequenceController.updateSolidGoldPulse(dt)
  }

  updateCabinetLighting(): void {
    // Delegate heavy update logic to effects-cabinet helper, passing a mutable state object
    const state: CabinetState = {
      cabinetLights: this.cabinetLights,
      decorativeLights: this.decorativeLights,
      currentCabinetColor: this.currentCabinetColor,
      lightingMode: this.lightingMode,
      lightingTimer: this.lightingTimer,
      hitFlashIntensity: this.hitFlashIntensity,
      isJackpotActive: this.isJackpotActive,
      jackpotPhase: this.jackpotPhase,
      isSolidGoldPulseActive: this.isSolidGoldPulseActive,
      solidGoldPulseTimer: this.solidGoldPulseTimer,
      slotLightMode: this.slotLightMode,
      slotLightTimer: this.slotLightTimer,
      accessibility: this.accessibility,
      scene: this.scene,
    }

    updateCabinetLighting(state)

    // Sync back any mutated state fields
    this.lightingMode = state.lightingMode
    this.lightingTimer = state.lightingTimer
    this.hitFlashIntensity = state.hitFlashIntensity
    this.slotLightTimer = state.slotLightTimer
  }

  setLightingMode(mode: 'normal' | 'hit' | 'fever' | 'reach', duration = 0): void {
    const previousMode = this.lightingMode
    this.lightingMode = mode
    this.lightingTimer = duration

    if (mode === 'hit') {
      this.hitFlashIntensity = 1.0
    }

    // Trigger state transition flash on significant mode changes
    if (previousMode !== mode) {
      this.triggerStateTransitionFlash(previousMode, mode)
    }
  }

  playBeep(freq: number): void {
    this.audioEffects?.playBeep(freq)
  }

  playSlotSpinStart(): void {
    this.audioEffects?.playSlotSpinStart()
  }

  playMagSpinCharge(duration = 1.2): void {
    this.audioEffects?.playMagSpinCharge(duration)
  }

  playMagSpinRelease(): void {
    this.audioEffects?.playMagSpinRelease()
  }

  playReelStop(reelIndex: number): void {
    this.audioEffects?.playReelStop(reelIndex)
  }

  playSlotWin(multiplier: number): void {
    this.audioEffects?.playSlotWin(multiplier)
  }

  playSlotJackpot(): void {
    this.audioEffects?.playSlotJackpot()
  }

  playJackpotAlarm(): void {
    this.audioEffects?.playJackpotAlarm()
  }

  playJackpotTurbine(duration?: number): void {
    this.audioEffects?.playJackpotTurbine(duration)
  }

  playJackpotExplosion(): void {
    this.audioEffects?.playJackpotExplosion()
  }

  playNearMiss(): void {
    this.audioEffects?.playNearMiss()
  }

  setSlotLightingMode(mode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'): void {
    this.slotLightMode = mode
    this.slotLightTimer = 0
  }

  updateSlotLighting(): void {
    // delegate to helper
    const state: CabinetState = {
      cabinetLights: this.cabinetLights,
      decorativeLights: this.decorativeLights,
      currentCabinetColor: this.currentCabinetColor,
      lightingMode: this.lightingMode,
      lightingTimer: this.lightingTimer,
      hitFlashIntensity: this.hitFlashIntensity,
      isJackpotActive: this.isJackpotActive,
      jackpotPhase: this.jackpotPhase,
      isSolidGoldPulseActive: this.isSolidGoldPulseActive,
      solidGoldPulseTimer: this.solidGoldPulseTimer,
      slotLightMode: this.slotLightMode,
      slotLightTimer: this.slotLightTimer,
      accessibility: this.accessibility,
      scene: this.scene,
    }
    updateSlotLighting(state)
    this.slotLightTimer = state.slotLightTimer
  }

  getAudioContext(): AudioContext | null {
    return this.audioCtx
  }

  dispose(): void {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {
        // Ignore errors on close
      })
    }
    // Unsubscribe event bus listeners
    for (const unsub of this._rimEventUnsubscribers) unsub()
    this._rimEventUnsubscribers = []

    // Disable and clear all fresnel rim handles
    this.activeRims.forEach((handle) => {
      handle.plugin.rimIntensity = 0
      handle.plugin.isEnabled = false
    })
    this.activeRims.clear()

    // Clear all effects
    this.trailEffects?.clearFeverTrails()
    this.shards.forEach((s) => {
      s.mesh.dispose()
      s.material.dispose()
    })
    this.shards = []
    this.ripplesEffects?.clear()
    this.cabinetLights.forEach((l) => {
      l.mesh.dispose()
      l.pointLight.dispose()
    })
    this.cabinetLights = []
    this.transitionFlashOverlay?.dispose()
    this.transitionFlashMat?.dispose()

    this.particleEffects.dispose()
    this.trackAmbientEffects.dispose()
    this.lightingEffects.dispose()
    this.cameraEffects?.dispose()
    this.impactEffects?.dispose()
  }

  createParticleTexture(): Texture {
    return createSharedParticleTexture(this.scene)
  }

  private checkPerformance(dt: number): void {
    if (!EffectsConfig.performance.autoDisableOnLowFps) return

    this.lastFpsCheck += dt
    if (this.lastFpsCheck < EffectsConfig.performance.fpsCheckInterval) return

    this.lastFpsCheck = 0
    const fps = this.scene.getEngine().getFps()
    const targetTier = fps < 40 ? 'low' : fps < 55 ? 'medium' : 'high'

    if (targetTier === this.runtimePerformanceTier) {
      this.fpsTrendCounter = 0
      return
    }

    this.fpsTrendCounter++
    if (this.fpsTrendCounter >= 3) {
      this.setRuntimePerformanceTier(targetTier)
      this.fpsTrendCounter = 0
      console.log(
        `[Performance] Runtime tier changed → ${this.runtimePerformanceTier} (FPS: ${fps.toFixed(1)})`
      )
    }
  }

  private setRuntimePerformanceTier(tier: 'high' | 'medium' | 'low'): void {
    this.runtimePerformanceTier = tier
    this.applyPerformanceTier()
  }

  private applyPerformanceTier(): void {
    if (!this.bloomPipeline) return
    switch (this.runtimePerformanceTier) {
      case 'high':
        this.bloomPipeline.bloomWeight = 0.25
        this.bloomPipeline.bloomScale = 0.5
        this.particleEffects.setMaxParticles(100)
        break
      case 'medium':
        this.bloomPipeline.bloomWeight = 0.15
        this.bloomPipeline.bloomScale = 0.3
        this.particleEffects.setMaxParticles(60)
        break
      case 'low':
        this.bloomPipeline.bloomWeight = 0.08
        this.bloomPipeline.bloomScale = 0.15
        this.particleEffects.setMaxParticles(30)
        break
    }
  }

  getRuntimePerformanceTier(): 'high' | 'medium' | 'low' {
    return this.runtimePerformanceTier
  }

  getActiveParticleCount(): number {
    return this.particleEffects.getActiveSystemCount()
  }

  /** Immediate tier review — used after heavy track switches or particle spikes. */
  forcePerformanceTierReview(): void {
    const fps = this.scene.getEngine().getFps()
    const targetTier = fps < 40 ? 'low' : fps < 55 ? 'medium' : 'high'
    if (targetTier === this.runtimePerformanceTier) return
    this.setRuntimePerformanceTier(targetTier)
    console.log(`[Performance] Forced tier review → ${this.runtimePerformanceTier} (FPS: ${fps.toFixed(1)})`)
  }

  private areEnhancedEffectsEnabled(): boolean {
    if (!EffectsConfig.enableEnhancedEffects) return false
    if (EffectsConfig.enableFallbackMode) return false
    if (this.runtimePerformanceTier === 'low') return false
    return true
  }

  spawnEnhancedBumperImpact(pos: Vector3, intensity: 'light' | 'medium' | 'heavy' = 'medium'): void {
    // Always do base effect
    this.spawnShardBurst(pos)

    // Check if enhanced effects enabled
    if (!this.areEnhancedEffectsEnabled() || !EffectsConfig.enableEnhancedBumperImpact) {
      // Simple fallback bloom
      this.setBloomEnergy(2.0)
      return
    }

    // Enhanced bloom
    const bloomEnergy = EffectsConfig.bumperImpact.bloomEnergy[intensity]
    this.setBloomEnergy(bloomEnergy)

    // Screen shake
    if (EffectsConfig.screenShake.enabled) {
      this.triggerScreenShake(intensity)
    }

    // Ripple rings
    this.spawnRippleRings(pos, intensity)
  }

  triggerCabinetShake(intensity: 'light' | 'medium' | 'heavy' | 'jackpot' = 'medium', color?: string): void {
    // CRITICAL SAFETY: Skip if reduced motion or shake disabled
    if (this.accessibility.reducedMotion || !this.accessibility.cameraShakeEnabled) {
      return
    }

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

  private triggerScreenShake(intensity: 'light' | 'medium' | 'heavy'): void {
    // CRITICAL SAFETY: Skip if reduced motion or shake disabled
    if (this.accessibility.reducedMotion || !this.accessibility.cameraShakeEnabled) {
      return
    }
    if (!this.cameraRef) return

    this.screenShake.active = true
    // CRITICAL SAFETY: Cap intensity at safe maximum
    const baseIntensity = EffectsConfig.screenShake.intensity[intensity]
    this.screenShake.intensity = Math.min(baseIntensity, this.accessibility.maxCameraShakeIntensity)
    this.screenShake.duration = intensity === 'light' ? 0.1 : intensity === 'medium' ? 0.15 : 0.25
    this.screenShake.timer = 0
  }

  private updateScreenShake(): void {
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

  private spawnRippleRings(pos: Vector3, intensity: 'light' | 'medium' | 'heavy'): void {
    this.ripplesEffects?.spawnRippleRings(pos, intensity)
  }

  private updateRippleRings(dt: number): void {
    this.ripplesEffects?.updateRippleRings(dt)
  }

  updateFeverTrails(
    ballBodies: { translation: () => { x: number; y: number; z: number }; handle: number }[],
    isFever: boolean,
    dt: number
  ): void {
    const trailsEnabled = this.areEnhancedEffectsEnabled() && EffectsConfig.enableFeverTrail
    this.trailEffects?.updateFeverTrails(ballBodies, isFever, dt, trailsEnabled)
  }

  // Fever trail logic delegated to TrailEffects

  triggerStateTransitionFlash(
    _fromState: 'normal' | 'hit' | 'fever' | 'reach',
    toState: 'normal' | 'hit' | 'fever' | 'reach'
  ): void {
    if (!this.areEnhancedEffectsEnabled() || !EffectsConfig.enableStateTransitionFlashes) return

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

  private updateTransitionFlash(dt: number): void {
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
    } else {
      // Fade out
      const alpha = Math.max(0, 1 - this.transitionFlash.progress) * EffectsConfig.transitionFlash.maxOpacity
      this.transitionFlashMat.alpha = alpha

      if (this.transitionFlash.progress >= 1) {
        // Complete
        this.transitionFlash.active = false
        this.transitionFlashOverlay.isVisible = false
      }
    }
  }

  update(dt: number, ballBodies?: { translation: () => { x: number; y: number; z: number }; handle: number }[], isFever?: boolean): void {
    // Performance check
    this.checkPerformance(dt)

    // Jackpot sequence phase driver (must run before cabinet/display consume jackpotPhase)
    this.updateJackpotSequence(dt)

    // Original updates
    this.updateShards(dt)
    this.updateBloom()
    // Solid gold pulse timing (keeps bloom curve in sync)
    this.updateSolidGoldPulse(dt)
    this.updateCabinetLighting()
    this.updateSlotLighting()

    // Enhanced updates
    this.updateScreenShake()
    this.updateRippleRings(dt)
    if (ballBodies && isFever !== undefined) {
      this.updateFeverTrails(ballBodies, isFever, dt)
    }
    this.updateTransitionFlash(dt)
    this.updateVignetteFlash(dt)

    // Camera shake (target-based, preserves user control)
    this.updateCameraShake(dt)

    // Advance fresnel rim pulses (no allocations: forEach + direct uniform writes)
    if (this.activeRims.size > 0) {
      this.activeRims.forEach((handle) => {
        handle.phase += dt * FRESNEL_RIM_PHASE_FREQ
        handle.plugin.rimIntensity = ((Math.sin(handle.phase) + 1) * 0.5) * handle.peakIntensity
      })
    }

    // Update sub-systems
    this.trackFlickerScale = this.trackAmbientEffects.update(dt)
    this.particleEffects.update()
    this.lightingEffects.update(dt)
    this.cameraEffects?.update(dt)
  }

  // Delegate methods to sub-systems
  initBumperSparkPool(size: number = 12): void {
    this.particleEffects.initBumperSparkPool(size)
  }

  spawnBumperSpark(position: Vector3, color?: string): void {
    const trackColor = this.getTrackHitColor()
    this.particleEffects.spawnBumperSpark(position, color ?? trackColor ?? undefined)
  }

  spawnTrail(): void {
    this.particleEffects.spawnTrail()
  }

  /**
   * Spawn a dramatic gold/magenta particle explosion (used by jackpot meltdown phase).
   */
  spawnJackpotBurst(position: Vector3): void {
    this.particleEffects.spawnJackpotBurst(position)
  }

  /**
   * Spawn an animated 3D floating score number at a world position.
   * Uses a DynamicTexture on a billboard plane. Self-disposes on completion.
   * Respects a max pool of 8 simultaneous numbers to prevent spam.
   */
  spawnFloatingNumber(value: number, worldPosition: Vector3): void {
    this.floatingEffects?.spawnFloatingNumber(value, worldPosition)
  }

  shakeCamera(config: { intensity: number; duration: number; decay: number }): void {
    this.cameraEffects?.startShake(config)
  }

  updateEnvironmentColor(colorHex: string): void {
    this.lightingEffects.updateEnvironmentColor(colorHex)
  }

  fadeOut(duration: number): void {
    this.lightingEffects.fadeOut(duration)
  }

  setPipeline(pipeline: DefaultRenderingPipeline): void {
    this.bloomPipeline = pipeline
    this.lightingEffects.setPipeline(pipeline)
  }

  setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier
  }

  /**
   * Wire the event bus so EffectsSystem can subscribe to fever:start / fever:end.
   * Call once after both EffectsSystem and BallManager are ready.
   */
  setEventBus(eventBus: EventBus): void {
    // Unsubscribe any previous listeners (idempotent re-wiring)
    for (const unsub of this._rimEventUnsubscribers) unsub()
    this._rimEventUnsubscribers = []
    this._eventBus = eventBus

    this._rimEventUnsubscribers.push(
      eventBus.on('fever:start', () => {
        if (!this._ballMeshProvider) return
        for (const ballType of [BallType.GOLD_PLATED, BallType.SOLID_GOLD]) {
          const meshes = this._ballMeshProvider.getBallMeshesByType(ballType)
          for (const mesh of meshes) {
            this.setFresnelRimEffect(mesh, this._feverRimColor, INTENSITY.FLASH)
          }
        }
      }),
      eventBus.on('fever:end', () => {
        if (!this._ballMeshProvider) return
        for (const ballType of [BallType.GOLD_PLATED, BallType.SOLID_GOLD]) {
          const meshes = this._ballMeshProvider.getBallMeshesByType(ballType)
          for (const mesh of meshes) {
            this.clearFresnelRimEffect(mesh)
          }
        }
      }),

      // Slot machine cabinet lighting sync
      eventBus.on('effect:slot:lighting', ({ mode }) => {
        this.setSlotLightingMode(mode)
      }),
    )
  }

  private _ballMeshProvider: Pick<BallManager, 'getBallMeshesByType'> | null = null

  /**
   * Wire the ball-mesh provider so EffectsSystem can look up gold ball meshes.
   * Call once after BallManager is ready.
   */
  setBallMeshProvider(provider: Pick<BallManager, 'getBallMeshesByType'>): void {
    this._ballMeshProvider = provider
  }

  /**
   * Attach a pulsing fresnel rim to `mesh`'s PBRMaterial.
   * - No-op on LOW quality tier.
   * - No-op if the material is not PBRMaterial.
   * - Idempotent: updating color/intensity on an already-tracked mesh does NOT
   *   reset the pulse phase (prevents "pop" on double fever:start).
   * - Registers an onDisposeObservable listener so a mesh collected mid-FEVER
   *   cannot leak a stale RimHandle.
   */
  setFresnelRimEffect(mesh: AbstractMesh, rimColor: Color3, peakIntensity: number): void {
    if (this.qualityTier === QualityTier.LOW) return
    if (!(mesh.material instanceof PBRMaterial)) return

    const mat = mesh.material

    const existing = this.activeRims.get(mesh)
    if (existing) {
      // Update color and intensity without resetting phase (no pop on re-enter)
      existing.plugin.rimColor.r = rimColor.r
      existing.plugin.rimColor.g = rimColor.g
      existing.plugin.rimColor.b = rimColor.b
      existing.peakIntensity = peakIntensity
      return
    }

    // Reuse an existing plugin on the material (shared-material case — all gold
    // balls share one PBRMaterial instance, so the plugin already exists after
    // the first ball is processed).
    let plugin = mat.pluginManager?.getPlugin<FresnelRimMaterialPlugin>('FresnelRim') ?? null
    if (!plugin) {
      plugin = new FresnelRimMaterialPlugin(mat)
    }
    plugin.rimColor.r = rimColor.r
    plugin.rimColor.g = rimColor.g
    plugin.rimColor.b = rimColor.b
    plugin.isEnabled = true

    const handle: RimHandle = { plugin, phase: 0, peakIntensity }
    this.activeRims.set(mesh, handle)

    // Auto-cleanup if the mesh is disposed mid-FEVER
    mesh.onDisposeObservable.addOnce(() => this.clearFresnelRimEffect(mesh))
  }

  /**
   * Disable and remove the fresnel rim for `mesh`.
   * Only disables the underlying plugin when no other tracked mesh shares it
   * (reference-count guard for shared-material gold balls).
   */
  clearFresnelRimEffect(mesh: AbstractMesh): void {
    const handle = this.activeRims.get(mesh)
    if (!handle) return
    this.activeRims.delete(mesh)

    // Disable the plugin only if no remaining handle still uses it
    let stillUsed = false
    for (const h of this.activeRims.values()) {
      if (h.plugin === handle.plugin) {
        stillUsed = true
        break
      }
    }
    if (!stillUsed) {
      handle.plugin.rimIntensity = 0
      handle.plugin.isEnabled = false
    }
  }

  addBallTrail(body: RAPIER.RigidBody, mesh: Mesh, ballType: BallType): void {
    this.trailEffects?.addBallTrail(body, mesh, ballType)
  }

  /**
   * Remove a ball's particle trail (delegated)
   */
  removeBallTrail(body: RAPIER.RigidBody): void {
    this.trailEffects?.removeBallTrail(body)
  }

  /**
   * Sync ball trails with current ball list, update emit rates per velocity.
   * Call once per frame from the game loop.
   */
  updateTrails(balls: { body: RAPIER.RigidBody; mesh: Mesh; type: BallType }[]): void {
    this.trailEffects?.updateTrails(balls, this.qualityTier)
  }

  /**
   * Trigger a radial impact flash burst at a world position.
   * Uses a single pooled ParticleSystem with manualEmitCount.
   * On LOW quality tier, reduces particle count to 10.
   */
  triggerImpactFlash(worldPosition: Vector3, intensity: number, colorHex = '#44aaff'): void {
    // Delegate to ImpactEffects
    this.impactEffects?.triggerImpactFlash(worldPosition, intensity, colorHex)
  }

}
