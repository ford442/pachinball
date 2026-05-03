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
  DynamicTexture,
  Mesh,
  Animation,
  ArcRotateCamera,
  ParticleSystem,
} from '@babylonjs/core'
import type { DirectionalLight } from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { CabinetLight, ShardParticle } from '../game-elements/types'
import {
  PALETTE,
  INTENSITY,
  STATE_COLORS,
  TEMPERATURE,
  LIGHTING_STATES,
  FOG_STATES,
  LIGHTING,
  color,
  emissive,
  pulse,
  lerpColor,
  QualityTier,
} from '../game-elements/visual-language'
import { EffectsConfig, BallType } from '../config'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { DEFAULT_ACCESSIBILITY, type AccessibilityConfig } from '../game-elements/accessibility-config'
import { ParticleEffects } from './effects-particles'
import { LightingEffects } from './effects-lighting'
import { CameraEffects } from './effects-camera'
import { AudioEffects } from './effects-audio'
import { ShardEffects } from './effects-shards'
import { TrailEffects } from './effects-trails'
import { FloatingNumberEffects } from './effects-floating'
import { RipplesEffects } from './effects-ripples'

// Type for ripple ring tracking
interface RippleRing {
  mesh: Mesh
  material: StandardMaterial
  age: number
  maxAge: number
  initialScale: number
  maxScale: number
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
  private targetFogColor: Color3 = color('#080818')
  private targetKeyColor: Color3 = color(TEMPERATURE.NORMAL)
  private targetRimIntensity: number = LIGHTING.RIM.intensity
  private targetRimColor: Color3 = color('#80bfff')

  // Jackpot Variables
  jackpotTimer = 0
  isJackpotActive = false
  jackpotPhase = 0 // 0=Idle, 1=Breach, 2=Error, 3=Meltdown

  // Solid Gold Pulse Variables
  private isSolidGoldPulseActive = false
  private solidGoldPulseTimer = 0
  private readonly SOLID_GOLD_PULSE_DURATION = 1.5

  // Public getter for lighting mode
  get currentLightingMode(): 'normal' | 'hit' | 'fever' | 'reach' {
    return this.lightingMode
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

  // Ripple rings
  private rippleRings: RippleRing[] = []

  // Impact rings (Animation-based, max 5 at once)

  private readonly maxImpactRings = 5

  // Performance tracking — runtime adaptive tiering
  private lastFpsCheck = 0
  private fpsTrendCounter = 0
  private runtimePerformanceTier: 'high' | 'medium' | 'low' = 'high'

  // Camera reference for screen shake
  private cameraRef: { position: Vector3 } | null = null
  private tableCam: ArcRotateCamera | null = null

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
  private lightingEffects: LightingEffects
  private cameraEffects: CameraEffects | null = null
  private shardEffects: ShardEffects | null = null

  // Slot lighting
  private slotLightMode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot' = 'idle'
  private slotLightTimer = 0

  // Ball particle trails delegated to TrailEffects

  // Impact flash pooled particle system
  private impactFlashPool: ParticleSystem | null = null
  private impactFlashPoolInited = false

  // Quality tier for effect gating
  private qualityTier: QualityTier = QualityTier.HIGH

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
    this.lightingEffects = new LightingEffects(scene)
    if (scene.activeCamera) {
      this.cameraEffects = new CameraEffects(scene.activeCamera)
    }
    this.shardEffects = new ShardEffects(scene, this.shards, this.maxImpactRings)
    this.trailEffects = new TrailEffects(scene)
    this.floatingEffects = new FloatingNumberEffects(scene)
    this.ripplesEffects = new RipplesEffects(scene)

    try {
      this.audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch {
      this.audioCtx = null
    }

    if (this.audioCtx) {
      this.audioEffects = new AudioEffects(this.audioCtx)
    }
  }

  setCabinetColor(colorHex: string): void {
    this.currentCabinetColor = colorHex
  }

  registerCamera(camera: { position: Vector3 }): void {
    this.cameraRef = camera
  }

  registerTableCamera(camera: ArcRotateCamera): void {
    this.tableCam = camera
  }

  registerLCDPostProcess(postProcess: { flashIntensity: number }): void {
    this.lcdPostProcess = postProcess
  }

  registerAccessibility(config: AccessibilityConfig): void {
    this.accessibility = config
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

  triggerScreenPulse(colorHex = '#ffffff', intensity = 0.8, durationMs = 400): void {
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

      // Apply state-based key light intensity
      const lightState = LIGHTING_STATES[this.currentAtmosphereState] || LIGHTING_STATES['IDLE']
      this.keyLight.intensity += (lightState.key - this.keyLight.intensity) * lerpSpeed
    }

    // 3. Rim light drama: intensity and color modulation per state
    if (this.rimLight) {
      this.rimLight.intensity += (this.targetRimIntensity - this.rimLight.intensity) * lerpSpeed
      this.rimLight.diffuse.r += (this.targetRimColor.r - this.rimLight.diffuse.r) * lerpSpeed
      this.rimLight.diffuse.g += (this.targetRimColor.g - this.rimLight.diffuse.g) * lerpSpeed
      this.rimLight.diffuse.b += (this.targetRimColor.b - this.rimLight.diffuse.b) * lerpSpeed
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
    const baseColor = this.currentCabinetColor
    const accentColor = lerpColor(baseColor, PALETTE.WHITE, 0.3).toHexString()

    // Unified LED strips using current map theme color
    const stripConfigs = [
      {
        pos: new Vector3(-12.5, 1.5, 5),
        size: { width: 0.2, height: 2.5, depth: 32 },
        color: baseColor,
        intensity: INTENSITY.NORMAL,
      },
      {
        pos: new Vector3(13.5, 1.5, 5),
        size: { width: 0.2, height: 2.5, depth: 32 },
        color: baseColor,
        intensity: INTENSITY.NORMAL,
      },
      {
        pos: new Vector3(0.75, 5.5, 5),
        size: { width: 26, height: 0.2, depth: 32 },
        color: accentColor,
        intensity: INTENSITY.AMBIENT,
      },
      // Lower accent strips
      {
        pos: new Vector3(-12.5, -1, 5),
        size: { width: 0.3, height: 0.1, depth: 32 },
        color: accentColor,
        intensity: INTENSITY.AMBIENT,
      },
      {
        pos: new Vector3(13.5, -1, 5),
        size: { width: 0.3, height: 0.1, depth: 32 },
        color: accentColor,
        intensity: INTENSITY.AMBIENT,
      },
      // Backbox edge strips
      {
        pos: new Vector3(0, 8, 28),
        size: { width: 28, height: 0.15, depth: 0.15 },
        color: baseColor,
        intensity: INTENSITY.NORMAL,
      },
      {
        pos: new Vector3(0, 8, 22),
        size: { width: 28, height: 0.15, depth: 0.15 },
        color: accentColor,
        intensity: INTENSITY.AMBIENT,
      },
    ]

    stripConfigs.forEach((config, idx) => {
      const strip = MeshBuilder.CreateBox(
        `ledStrip${idx}`,
        { width: config.size.width, height: config.size.height, depth: config.size.depth },
        this.scene
      )
      strip.position.copyFrom(config.pos)

      const mat = new StandardMaterial(`ledStripMat${idx}`, this.scene)
      mat.emissiveColor = emissive(config.color, config.intensity)
      mat.alpha = Math.min(0.8, config.intensity)
      strip.material = mat

      // Offset light slightly inward for better playfield coverage
      const lightPos = config.pos.clone()
      lightPos.x *= 0.8
      const light = new PointLight(`stripLight${idx}`, lightPos, this.scene)
      light.diffuse = color(config.color)
      light.intensity = config.intensity
      light.range = 20
      light.shadowEnabled = false

      this.cabinetLights.push({ mesh: strip, material: mat, pointLight: light })
    })
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
    this.isJackpotActive = true
    this.jackpotTimer = 0
    this.jackpotPhase = 1
    this.playBeep(100) // Deep sub-bass start
  }

  updateJackpotSequence(): void {
    if (!this.isJackpotActive) return

    const dt = 0.016 // approximate dt
    this.jackpotTimer += dt

    // Phase 1: Breach (0-2s)
    if (this.jackpotTimer < 2.0) {
      this.jackpotPhase = 1
      if (Math.random() < 0.1) this.playBeep(800) // Alarm siren
    }
    // Phase 2: Critical Error (2-5s)
    else if (this.jackpotTimer < 5.0) {
      this.jackpotPhase = 2
      const pitch = 200 + (this.jackpotTimer - 2.0) * 200 // Rising pitch
      if (Math.random() < 0.2) this.playBeep(pitch)
    }
    // Phase 3: Meltdown (5-10s)
    else if (this.jackpotTimer < 10.0) {
      if (this.jackpotPhase !== 3) {
        // One-shot explosion sound simulation
        this.playBeep(50)
      }
      this.jackpotPhase = 3
    }
    // End
    else {
      this.isJackpotActive = false
      this.jackpotPhase = 0
      this.lightingMode = 'normal'
    }
  }

  startSolidGoldPulse(): void {
    this.isSolidGoldPulseActive = true
    this.solidGoldPulseTimer = 0
    this.bloomEnergy = 2.5
    this.playBeep(1200)

    // Vignette flash (smooth, not strobe — safe for photosensitive users)
    this.flashVignette(PALETTE.GOLD, 600)

    // Camera shake (respect reduced motion)
    if (!this.accessibility.reducedMotion) {
      this.addCameraShake(0.04)
    }
  }

  private updateSolidGoldPulse(dt: number): void {
    if (!this.isSolidGoldPulseActive) return

    this.solidGoldPulseTimer += dt
    this.bloomEnergy = Math.max(0, 2.5 * (1 - this.solidGoldPulseTimer / this.SOLID_GOLD_PULSE_DURATION))

    if (this.solidGoldPulseTimer >= this.SOLID_GOLD_PULSE_DURATION) {
      this.isSolidGoldPulseActive = false
      this.solidGoldPulseTimer = 0
    }
  }

  updateCabinetLighting(): void {
    const time = performance.now() * 0.001

    if (this.isJackpotActive) {
      this.updateJackpotSequence()
    } else if (this.isSolidGoldPulseActive) {
      this.updateSolidGoldPulse(0.016)
    } else if (this.lightingTimer > 0) {
      const dt = 0.016
      this.lightingTimer -= dt
      if (this.lightingTimer <= 0) {
        this.lightingMode = 'normal'
      }
    }

    this.cabinetLights.forEach((light, idx) => {
      let targetColor: Color3
      let intensity = INTENSITY.NORMAL

      // Unified state-based lighting using Visual Language
      if (this.isJackpotActive) {
        if (this.jackpotPhase === 1) {
          // Breach: Pulsing alert red
          const p = pulse(time, 4, 0.2, 1.0)
          targetColor = emissive(STATE_COLORS.REACH, p * INTENSITY.FLASH)
          intensity = INTENSITY.FLASH
        } else if (this.jackpotPhase === 2) {
          // Critical: Strobing gold - SAFETY: Use accessibility-controlled flash frequency
          // CRITICAL SAFETY: Flash frequency capped at 2Hz (was unsafe 60Hz)
          const flashFreq = this.accessibility.flashFrequencyMax // 2Hz max for safety
          const strobe = (Math.sin(time * Math.PI * 2 * flashFreq) + 1) * 0.5
          targetColor = emissive(PALETTE.GOLD, strobe * INTENSITY.BURST)
          intensity = INTENSITY.BURST
        } else {
          // Meltdown: Rainbow wave
          const hue = (time * 0.5 + idx * 0.1) % 1
          targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0).scale(INTENSITY.HIGH)
          intensity = INTENSITY.HIGH
        }
      } else if (this.isSolidGoldPulseActive) {
        // Solid Gold Pulse: warm gold → magenta fade
        const progress = this.solidGoldPulseTimer / this.SOLID_GOLD_PULSE_DURATION
        const fade = 1 - progress
        const goldColor = emissive(PALETTE.GOLD, INTENSITY.HIGH * fade)
        const magentaColor = emissive(PALETTE.MAGENTA, INTENSITY.HIGH * fade * 0.6)
        targetColor = Color3.Lerp(goldColor, magentaColor, Math.sin(progress * Math.PI))
        intensity = INTENSITY.HIGH * fade
      } else {
        switch (this.lightingMode) {
          case 'hit': {
            // Decay flash over time
            const dt = 0.016
            this.hitFlashIntensity = Math.max(0, this.hitFlashIntensity - dt * 5)
            const flashBoost = 1 + this.hitFlashIntensity * 2
            const flashColor = lerpColor(this.currentCabinetColor, PALETTE.WHITE, 0.5).toHexString()
            targetColor = emissive(flashColor, INTENSITY.FLASH * flashBoost)
            intensity = INTENSITY.FLASH * flashBoost
            break
          }
          case 'reach':
            // Pulsing alert
            targetColor = emissive(STATE_COLORS.REACH, pulse(time, 2, 0.3, INTENSITY.HIGH))
            intensity = INTENSITY.HIGH
            break
          case 'fever': {
            // Rainbow pulse
            const hue = (time * 2 + idx * 0.3) % 1
            targetColor = Color3.FromHSV(hue * 360, 0.8, 1.0)
            intensity = INTENSITY.HIGH + Math.sin(time * 10) * 0.5
            break
          }
          case 'normal':
          default: {
            // Breathing current map color - unified idle state
            const breath = pulse(time, 0.7, INTENSITY.AMBIENT, INTENSITY.NORMAL)
            targetColor = emissive(this.currentCabinetColor, breath)
            intensity = breath
            break
          }
        }
      }

      light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, 0.016 * 10)
      light.pointLight.diffuse = light.material.emissiveColor
      light.pointLight.intensity = intensity
    })

    // Update decorative materials (plastics) with unified colors
    this.decorativeLights.forEach((mat) => {
      if (this.isJackpotActive) {
        if (this.jackpotPhase === 3) {
          // Rainbow meltdown
          const hue = (time * 2) % 1
          mat.emissiveColor = Color3.FromHSV(hue * 360, 1.0, INTENSITY.HIGH)
        } else {
          // Red alert
          mat.emissiveColor = emissive(STATE_COLORS.REACH, INTENSITY.HIGH)
        }
      } else if (this.isSolidGoldPulseActive) {
        const progress = this.solidGoldPulseTimer / this.SOLID_GOLD_PULSE_DURATION
        const fade = 1 - progress
        mat.emissiveColor = emissive(PALETTE.GOLD, INTENSITY.HIGH * fade)
      } else if (this.lightingMode === 'fever') {
        // Gold fever
        mat.emissiveColor = emissive(PALETTE.GOLD, pulse(time, 2, INTENSITY.NORMAL, INTENSITY.HIGH))
      } else if (this.lightingMode === 'reach') {
        // Alert pulse
        mat.emissiveColor = emissive(STATE_COLORS.REACH, pulse(time, 5, 0.3, INTENSITY.HIGH))
      } else {
        // Idle magenta tint
        mat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.AMBIENT)
      }
    })
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

  playReelStop(reelIndex: number): void {
    this.audioEffects?.playReelStop(reelIndex)
  }

  playSlotWin(multiplier: number): void {
    this.audioEffects?.playSlotWin(multiplier)
  }

  playSlotJackpot(): void {
    this.audioEffects?.playSlotJackpot()
  }

  playNearMiss(): void {
    this.audioEffects?.playNearMiss()
  }

  setSlotLightingMode(mode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'): void {
    this.slotLightMode = mode
    this.slotLightTimer = 0
  }

  updateSlotLighting(): void {
    if (this.slotLightMode === 'idle') return

    const dt = 0.016
    this.slotLightTimer += dt
    const time = performance.now() * 0.001

    this.cabinetLights.forEach((light, idx) => {
      let targetColor: Color3
      let intensity = INTENSITY.NORMAL

      switch (this.slotLightMode) {
        case 'spin': {
          // Rapid rainbow chase
          const hue = (time * 5 + idx * 0.3) % 1
          targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0)
          intensity = INTENSITY.HIGH
          break
        }

        case 'stop': {
          // Quick flash white - SAFETY: Use safe frequency
          // CRITICAL SAFETY: Flash frequency limited by accessibility config
          const flashFreq = Math.min(5, this.accessibility.flashFrequencyMax * 2.5) // Max 5Hz, scales with accessibility
          const flash = Math.sin(time * Math.PI * 2 * flashFreq) > 0
          targetColor = flash ? Color3.White() : emissive(PALETTE.GOLD, INTENSITY.AMBIENT)
          intensity = flash ? INTENSITY.FLASH : INTENSITY.NORMAL
          break
        }

        case 'win':
          // Pulsing gold
          targetColor = emissive(PALETTE.GOLD, pulse(time, 3, INTENSITY.NORMAL, INTENSITY.HIGH))
          intensity = INTENSITY.HIGH
          break

        case 'jackpot': {
          // Intense strobing rainbow
          const jackpotHue = (time * 10 + idx * 0.2) % 1
          targetColor = Color3.FromHSV(jackpotHue * 360, 1.0, 1.0)
          intensity = INTENSITY.BURST
          break
        }

        default:
          targetColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
      }

      light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, dt * 15)
      light.pointLight.diffuse = light.material.emissiveColor
      light.pointLight.intensity = intensity
    })
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
    // Clear all effects
    this.clearFeverTrails()
    this.shards.forEach((s) => {
      s.mesh.dispose()
      s.material.dispose()
    })
    this.shards = []
    this.rippleRings.forEach((r) => {
      r.mesh.dispose()
      r.material.dispose()
    })
    this.rippleRings = []
    this.cabinetLights.forEach((l) => {
      l.mesh.dispose()
      l.pointLight.dispose()
    })
    this.cabinetLights = []
    this.transitionFlashOverlay?.dispose()
    this.transitionFlashMat?.dispose()

    this.particleEffects.dispose()
    this.lightingEffects.dispose()
    this.cameraEffects?.dispose()
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
    const flashColor = color || (intensity === 'jackpot' ? '#ff0088' : '#00d9ff')
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
    if (!this.trailEffects) return

    // Gating is preserved here (accessibility + feature flag)
    if (!this.areEnhancedEffectsEnabled() || !EffectsConfig.enableFeverTrail) {
      this.trailEffects.clearFeverTrails()
      return
    }

    this.trailEffects.updateFeverTrails(ballBodies, isFever, dt)
  }

  // Fever trail logic delegated to TrailEffects

  triggerStateTransitionFlash(
    _fromState: 'normal' | 'hit' | 'fever' | 'reach',
    toState: 'normal' | 'hit' | 'fever' | 'reach'
  ): void {
    if (!this.areEnhancedEffectsEnabled() || !EffectsConfig.enableStateTransitionFlashes) return

    // Get color for transition
    const flashColor = this.getTransitionColor(toState)

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

  private getTransitionColor(state: 'normal' | 'hit' | 'fever' | 'reach'): Color3 {
    switch (state) {
      case 'hit':
        return emissive(PALETTE.WHITE, INTENSITY.FLASH)
      case 'reach':
        return emissive(STATE_COLORS.REACH, INTENSITY.HIGH)
      case 'fever':
        return emissive(STATE_COLORS.FEVER, INTENSITY.HIGH)
      case 'normal':
      default:
        return emissive(PALETTE.CYAN, INTENSITY.NORMAL)
    }
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

    // Original updates
    this.updateShards(dt)
    this.updateBloom()
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

    // Update sub-systems
    this.particleEffects.update()
    this.lightingEffects.update(dt)
    this.cameraEffects?.update(dt)
  }

  // Delegate methods to sub-systems
  initBumperSparkPool(size: number = 12): void {
    this.particleEffects.initBumperSparkPool(size)
  }

  spawnBumperSpark(position: Vector3, color?: string): void {
    this.particleEffects.spawnBumperSpark(position, color)
  }

  spawnTrail(): void {
    this.particleEffects.spawnTrail()
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
    if (!this.impactFlashPoolInited) {
      this.initImpactFlashPool()
    }
    if (!this.impactFlashPool) return

    const ps = this.impactFlashPool
    ps.emitter = worldPosition

    // Determine particle count based on intensity and quality tier
    let count: number
    if (this.qualityTier === QualityTier.LOW) {
      count = 10
    } else {
      count = intensity >= 1.0 ? 60 : 25
    }

    // Colors: bright white core fading to accent color
    const accent = Color4.FromHexString(colorHex + 'FF')
    ps.color1 = new Color4(1, 1, 1, 1)
    ps.color2 = accent
    ps.colorDead = new Color4(accent.r, accent.g, accent.b, 0)

    ps.manualEmitCount = count
    ps.start()

    // Stop emission after burst; particles live only 0.1s
    setTimeout(() => {
      ps.stop()
    }, 100)
  }

  private initImpactFlashPool(): void {
    if (this.impactFlashPoolInited) return
    this.impactFlashPoolInited = true

    const ps = new ParticleSystem('impactFlashPool', 100, this.scene)

    // Create a simple radial gradient particle texture
    const size = 64
    const tex = new DynamicTexture('impactFlashTex', size, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)')
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    tex.update()
    ps.particleTexture = tex

    ps.minSize = 0.05
    ps.maxSize = 0.15
    ps.minLifeTime = 0.1
    ps.maxLifeTime = 0.1
    ps.emitRate = 0
    ps.blendMode = ParticleSystem.BLENDMODE_ADD
    ps.gravity = Vector3.Zero()
    ps.direction1 = new Vector3(-1, -1, -1)
    ps.direction2 = new Vector3(1, 1, 1)
    ps.minEmitPower = 2
    ps.maxEmitPower = 4
    ps.updateSpeed = 0.016

    this.impactFlashPool = ps
  }
}
