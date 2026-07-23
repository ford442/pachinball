// Main EffectsSystem orchestrator
import { Mesh, PBRMaterial, Scene, StandardMaterial, Texture, Vector3 } from '@babylonjs/core'
import type { AbstractMesh, Color3, DirectionalLight, PointLight, TargetCamera } from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { CabinetLight, ShardParticle } from '../game-elements/types'
import { PALETTE, QualityTier } from '../game-elements/visual-language'
import { BallType, EffectsConfig } from '../config'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { DEFAULT_ACCESSIBILITY, type AccessibilityConfig } from '../game-elements/accessibility-config'
import type { TrackThemeProfile } from '../game-elements/track-theme-profiles'
import { ParticleEffects } from './effects-particles'
import { TrackAmbientEffects } from './track-ambient-effects'
import { LightingEffects } from './effects-lighting'
import { CameraEffects } from './effects-camera'
import { AudioEffects } from './effects-audio'
import { ShardEffects } from './effects-shards'
import { TrailEffects } from './effects-trails'
import { FloatingNumberEffects } from './effects-floating'
import { RipplesEffects } from './effects-ripples'
import { JackpotSequenceController } from './effects-jackpot'
import { createSharedParticleTexture } from './effects-utils'
import {
  createCabinetLighting,
  updateCabinetLighting,
  updateSlotLighting,
  type CabinetState,
} from './effects-cabinet'
import { ImpactEffects } from './effects-impact'
import { AtmosphereController } from './effects-atmosphere'
import { ScreenEffectsController } from './effects-screen'
import { FresnelRimController } from './effects-fresnel-rim'
import { RuntimePerformanceController } from './effects-performance'
import type { EventBus } from '../game/event-bus'
import type { BallManager } from '../game-elements/ball-manager'

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

  private jackpotSequenceController: JackpotSequenceController

  private trailEffects: TrailEffects | null = null
  private floatingEffects: FloatingNumberEffects | null = null
  private ripplesEffects: RipplesEffects | null = null

  private readonly maxImpactRings = 5

  private accessibility: AccessibilityConfig = DEFAULT_ACCESSIBILITY

  private particleEffects: ParticleEffects
  private trackAmbientEffects: TrackAmbientEffects
  private lightingEffects: LightingEffects
  private cameraEffects: CameraEffects | null = null
  private shardEffects: ShardEffects | null = null
  private atmosphereController: AtmosphereController
  private screenEffectsController: ScreenEffectsController
  private fresnelRimController: FresnelRimController
  private performanceController: RuntimePerformanceController

  private slotLightMode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot' = 'idle'
  private slotLightTimer = 0

  private impactEffects: ImpactEffects | null = null

  private qualityTier: QualityTier = QualityTier.HIGH

  private _eventBus: EventBus | null = null
  private _eventUnsubscribers: Array<() => void> = []

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

  constructor(
    scene: Scene,
    bloomPipeline: DefaultRenderingPipeline | null,
    accessibility?: AccessibilityConfig
  ) {
    this.scene = scene
    this.bloomPipeline = bloomPipeline
    this.accessibility = accessibility ?? DEFAULT_ACCESSIBILITY

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

    this.atmosphereController = new AtmosphereController(scene, bloomPipeline, this.trackAmbientEffects, this.accessibility)
    this.performanceController = new RuntimePerformanceController(scene, bloomPipeline, this.particleEffects)
    this.screenEffectsController = new ScreenEffectsController({
      scene,
      bloomPipeline,
      accessibility: this.accessibility,
      isEnhancedEffectsEnabled: () => this.performanceController.areEnhancedEffectsEnabled(),
    })
    this.fresnelRimController = new FresnelRimController(this.qualityTier)

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
    this.atmosphereController.setTrackThemeProfile(profile)
    if (profile) {
      this.currentCabinetColor = profile.particles.hitPrimary
    }
  }

  getTrackHitColor(): string | null {
    return this.atmosphereController.getTrackHitColor()
  }

  registerCamera(camera: { position: Vector3 }): void {
    this.screenEffectsController.registerCamera(camera)
  }

  registerTableCamera(camera: TargetCamera): void {
    this.screenEffectsController.registerTableCamera(camera)
  }

  registerLCDPostProcess(postProcess: { flashIntensity: number }): void {
    this.screenEffectsController.registerLCDPostProcess(postProcess)
  }

  registerAccessibility(config: AccessibilityConfig): void {
    this.accessibility = config
    this.atmosphereController.registerAccessibility(config)
    this.screenEffectsController.registerAccessibility(config)
  }

  registerSceneLights(keyLight: DirectionalLight, rimLight: DirectionalLight, bounceLight: PointLight): void {
    this.atmosphereController.registerSceneLights(keyLight, rimLight, bounceLight)
  }

  addCameraShake(intensity: number): void {
    this.screenEffectsController.addCameraShake(intensity)
  }

  flashVignette(colorHex: string, durationMs = 300): void {
    this.screenEffectsController.flashVignette(colorHex, durationMs)
  }

  triggerScreenPulse(colorHex: string = PALETTE.WHITE, intensity = 0.8, durationMs = 400): void {
    this.screenEffectsController.triggerScreenPulse(colorHex, intensity, durationMs)
  }

  updateCameraShake(dt: number): void {
    this.screenEffectsController.updateCameraShake(dt)
  }

  setAtmosphereState(state: string): void {
    this.atmosphereController.setAtmosphereState(state)
  }

  updateAtmosphere(dt: number, ballPos?: Vector3): void {
    this.atmosphereController.updateAtmosphere(dt, ballPos)
  }

  registerDecorativeMaterial(mat: StandardMaterial | PBRMaterial): void {
    this.decorativeLights.push(mat)
  }

  createCabinetLighting(): void {
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

    if (previousMode !== mode) {
      this.triggerStateTransitionFlash(previousMode, mode)
    }
  }

  playBeep(freq: number): void { this.audioEffects?.playBeep(freq) }
  playSlotSpinStart(): void { this.audioEffects?.playSlotSpinStart() }
  playMagSpinCharge(duration = 1.2): void { this.audioEffects?.playMagSpinCharge(duration) }
  playMagSpinRelease(): void { this.audioEffects?.playMagSpinRelease() }
  playReelStop(reelIndex: number): void { this.audioEffects?.playReelStop(reelIndex) }
  playSlotWin(multiplier: number): void { this.audioEffects?.playSlotWin(multiplier) }
  playSlotJackpot(): void { this.audioEffects?.playSlotJackpot() }
  playJackpotAlarm(): void { this.audioEffects?.playJackpotAlarm() }
  playJackpotTurbine(duration?: number): void { this.audioEffects?.playJackpotTurbine(duration) }
  playJackpotExplosion(): void { this.audioEffects?.playJackpotExplosion() }
  playNearMiss(): void { this.audioEffects?.playNearMiss() }

  setSlotLightingMode(mode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'): void {
    this.slotLightMode = mode
    this.slotLightTimer = 0
  }

  updateSlotLighting(): void {
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
      })
    }

    for (const unsub of this._eventUnsubscribers) unsub()
    this._eventUnsubscribers = []
    this._eventBus = null

    this.fresnelRimController.dispose()

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

    this.screenEffectsController.dispose()
    this.particleEffects.dispose()
    this.trackAmbientEffects.dispose()
    this.lightingEffects.dispose()
    this.cameraEffects?.dispose()
    this.impactEffects?.dispose()
  }

  createParticleTexture(): Texture {
    return createSharedParticleTexture(this.scene)
  }

  getRuntimePerformanceTier(): 'high' | 'medium' | 'low' {
    return this.performanceController.getRuntimePerformanceTier()
  }

  getActiveParticleCount(): number {
    return this.particleEffects.getActiveSystemCount()
  }

  forcePerformanceTierReview(): void {
    this.performanceController.forcePerformanceTierReview()
  }

  spawnEnhancedBumperImpact(pos: Vector3, intensity: 'light' | 'medium' | 'heavy' = 'medium'): void {
    this.spawnShardBurst(pos)

    if (!this.performanceController.areEnhancedEffectsEnabled() || !EffectsConfig.enableEnhancedBumperImpact) {
      this.setBloomEnergy(2.0)
      return
    }

    const bloomEnergy = EffectsConfig.bumperImpact.bloomEnergy[intensity]
    this.setBloomEnergy(bloomEnergy)

    if (EffectsConfig.screenShake.enabled) {
      this.screenEffectsController.triggerScreenShake(intensity)
    }

    this.spawnRippleRings(pos, intensity)
  }

  triggerCabinetShake(
    intensity: 'light' | 'medium' | 'heavy' | 'jackpot' = 'medium',
    color?: string
  ): void {
    this.screenEffectsController.triggerCabinetShake(intensity, color)
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
    const trailsEnabled = this.performanceController.areEnhancedEffectsEnabled() && EffectsConfig.enableFeverTrail
    this.trailEffects?.updateFeverTrails(ballBodies, isFever, dt, trailsEnabled)
  }

  triggerStateTransitionFlash(
    fromState: 'normal' | 'hit' | 'fever' | 'reach',
    toState: 'normal' | 'hit' | 'fever' | 'reach'
  ): void {
    this.screenEffectsController.triggerStateTransitionFlash(fromState, toState)
  }

  update(
    dt: number,
    ballBodies?: { translation: () => { x: number; y: number; z: number }; handle: number }[],
    isFever?: boolean
  ): void {
    this.performanceController.checkPerformance(dt)

    this.updateJackpotSequence(dt)

    this.updateShards(dt)
    this.updateBloom()
    this.updateSolidGoldPulse(dt)
    this.updateCabinetLighting()
    this.updateSlotLighting()

    this.screenEffectsController.updateScreenShake()
    this.updateRippleRings(dt)
    if (ballBodies && isFever !== undefined) {
      this.updateFeverTrails(ballBodies, isFever, dt)
    }
    this.screenEffectsController.updateTransitionFlash(dt)
    this.screenEffectsController.updateVignetteFlash(dt)

    this.screenEffectsController.updateCameraShake(dt)

    this.fresnelRimController.update(dt)

    this.atmosphereController.updateTrackAmbientEffects(dt)
    this.particleEffects.update()
    this.lightingEffects.update(dt)
    this.cameraEffects?.update(dt)
  }

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

  spawnJackpotBurst(position: Vector3): void {
    this.particleEffects.spawnJackpotBurst(position)
  }

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
    this.atmosphereController.setBloomPipeline(pipeline)
    this.screenEffectsController.setBloomPipeline(pipeline)
    this.performanceController.setBloomPipeline(pipeline)
  }

  setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier
    this.fresnelRimController.setQualityTier(tier)
  }

  setEventBus(eventBus: EventBus): void {
    for (const unsub of this._eventUnsubscribers) unsub()
    this._eventUnsubscribers = []
    this._eventBus = eventBus

    this.fresnelRimController.setEventBus(eventBus)

    this._eventUnsubscribers.push(
      eventBus.on('effect:slot:lighting', ({ mode }) => {
        this.setSlotLightingMode(mode)
      })
    )
  }

  setBallMeshProvider(provider: Pick<BallManager, 'getBallMeshesByType'>): void {
    this.fresnelRimController.setBallMeshProvider(provider)
  }

  setFresnelRimEffect(mesh: AbstractMesh, rimColor: Color3, peakIntensity: number): void {
    this.fresnelRimController.setFresnelRimEffect(mesh, rimColor, peakIntensity)
  }

  clearFresnelRimEffect(mesh: AbstractMesh): void {
    this.fresnelRimController.clearFresnelRimEffect(mesh)
  }

  addBallTrail(body: RAPIER.RigidBody, mesh: Mesh, ballType: BallType): void {
    this.trailEffects?.addBallTrail(body, mesh, ballType)
  }

  removeBallTrail(body: RAPIER.RigidBody): void {
    this.trailEffects?.removeBallTrail(body)
  }

  updateTrails(balls: { body: RAPIER.RigidBody; mesh: Mesh; type: BallType }[]): void {
    this.trailEffects?.updateTrails(balls, this.qualityTier)
  }

  triggerImpactFlash(worldPosition: Vector3, intensity: number, colorHex = '#44aaff'): void {
    this.impactEffects?.triggerImpactFlash(worldPosition, intensity, colorHex)
  }
}
