import { Color3, Color4, PointLight, Scene, Vector3 } from '@babylonjs/core'
import type { DirectionalLight } from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { GameConfig } from '../config'
import type { AccessibilityConfig } from '../game-elements/accessibility-config'
import type { TrackThemeProfile } from '../game-elements/track-theme-profiles'
import { FOG_STATES, LIGHTING, LIGHTING_STATES, SURFACES, TEMPERATURE, color, pulse } from '../game-elements/visual-language'
import { TrackAmbientEffects } from './track-ambient-effects'

export class AtmosphereController {
  private scene: Scene
  private bloomPipeline: DefaultRenderingPipeline | null
  private trackAmbientEffects: TrackAmbientEffects
  private accessibility: AccessibilityConfig

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
  private activeTrackProfile: TrackThemeProfile | null = null
  private trackAtmosphereActive = false
  private targetTrackBloom = 0.5
  private targetTrackVignette = 0.4
  private targetTrackKeyIntensity = 1.2
  private trackFlickerScale = 1

  constructor(
    scene: Scene,
    bloomPipeline: DefaultRenderingPipeline | null,
    trackAmbientEffects: TrackAmbientEffects,
    accessibility: AccessibilityConfig
  ) {
    this.scene = scene
    this.bloomPipeline = bloomPipeline
    this.trackAmbientEffects = trackAmbientEffects
    this.accessibility = accessibility
  }

  setBloomPipeline(pipeline: DefaultRenderingPipeline | null): void {
    this.bloomPipeline = pipeline
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

  registerSceneLights(keyLight: DirectionalLight, rimLight: DirectionalLight, bounceLight: PointLight): void {
    this.keyLight = keyLight
    this.rimLight = rimLight
    this.bounceLight = bounceLight
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

      if (this.shouldEnableTrackAmbientEffects()) {
        this.trackAmbientEffects.applyProfile(profile)
      } else {
        this.trackAmbientEffects.applyProfile(null)
      }
      return
    }

    this.trackAmbientEffects.applyProfile(null)
    const fogState = FOG_STATES[this.currentAtmosphereState] || FOG_STATES['IDLE']
    this.targetFogDensity = fogState.density
    this.targetFogColor = color(fogState.color)
  }

  getTrackHitColor(): string | null {
    return this.activeTrackProfile?.particles.hitPrimary ?? null
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

  updateTrackAmbientEffects(dt: number): void {
    this.trackFlickerScale = this.trackAmbientEffects.update(dt)
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

  private shouldEnableTrackAmbientEffects(): boolean {
    if (this.accessibility.reducedMotion) return false
    if (GameConfig.accessibility.photosensitiveMode) return false
    return this.accessibility.effectIntensity > 0
  }
}
