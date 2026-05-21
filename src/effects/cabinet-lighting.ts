/**
 * Cabinet Reactive Lighting System
 *
 * Premium RGB-style lighting that reacts to game state and events.
 * Supports edge lighting, under-cabinet glow, and screen border effects.
 */

import { Color3, PointLight, Vector3, type Scene } from '@babylonjs/core'
import type { EventBus } from '../game/event-bus'
import { DisplayState } from '../game-elements/display-config'
import { PALETTE, color, QualityTier } from '../game-elements/visual-language'

export interface CabinetLightingConfig {
  enableEdgeLighting: boolean
  enableUnderCabinetGlow: boolean
  enableScreenBorder: boolean
  qualityTier: QualityTier
}

interface LightingState {
  currentColor: Color3
  targetColor: Color3
  intensity: number
  targetIntensity: number
  pulsePhase: number
}

export class CabinetLighting {
  private scene: Scene
  private config: CabinetLightingConfig
  private enabled = true

  // Edge lighting (4 corner/edge lights)
  private edgeLights: PointLight[] = []
  private edgeLightingState: LightingState = {
    currentColor: new Color3(0.2, 0.3, 0.8),
    targetColor: new Color3(0.2, 0.3, 0.8),
    intensity: 0.5,
    targetIntensity: 0.5,
    pulsePhase: 0,
  }

  // Under-cabinet glow
  private underCabinetLight: PointLight | null = null
  private underCabinetState: LightingState = {
    currentColor: new Color3(0.8, 0.2, 0.8),
    targetColor: new Color3(0.8, 0.2, 0.8),
    intensity: 0.3,
    targetIntensity: 0.3,
    pulsePhase: 0,
  }

  // State tracking
  private currentDisplayState: DisplayState = DisplayState.IDLE
  private eventBurstTime = 0
  private eventBurstDuration = 0.6 // seconds

  constructor(scene: Scene, config: CabinetLightingConfig) {
    this.scene = scene
    this.config = config
    this.initializeLights()
  }

  /**
   * Initialize all cabinet lights
   */
  private initializeLights(): void {
    if (!this.config.enableEdgeLighting && !this.config.enableUnderCabinetGlow) {
      return
    }

    // Edge lights: positioned at cabinet corners/edges
    if (this.config.enableEdgeLighting) {
      this.createEdgeLights()
    }

    // Under-cabinet glow
    if (this.config.enableUnderCabinetGlow && this.config.qualityTier !== QualityTier.LOW) {
      this.createUnderCabinetLight()
    }
  }

  /**
   * Create RGB edge lighting strips
   */
  private createEdgeLights(): void {
    const positions = [
      new Vector3(-12, 8, 15),  // Left edge
      new Vector3(12, 8, 15),   // Right edge
      new Vector3(0, 12, 15),   // Top edge
      new Vector3(0, 2, 15),    // Front edge (low)
    ]

    for (const pos of positions) {
      const light = new PointLight(`edgeLight_${this.edgeLights.length}`, pos, this.scene)
      light.intensity = 0.8
      light.range = 25
      light.diffuse = new Color3(0.2, 0.3, 0.8)

      // High quality: additional specular influence
      if (this.config.qualityTier === QualityTier.HIGH) {
        light.specular = new Color3(1, 1, 1)
      }

      this.edgeLights.push(light)
    }
  }

  /**
   * Create under-cabinet glow light
   */
  private createUnderCabinetLight(): void {
    this.underCabinetLight = new PointLight('underCabinetGlow', new Vector3(0, -2, 8), this.scene)
    this.underCabinetLight.intensity = 0.4
    this.underCabinetLight.range = 30
    this.underCabinetLight.diffuse = new Color3(0.8, 0.2, 0.8)
  }

  /**
   * Subscribe to game events
   */
  subscribeToEvents(eventBus: EventBus): void {
    // Display state changes
    eventBus.on('display:set', (state: DisplayState) => {
      this.onDisplayStateChange(state)
    })

    // Event reactions
    eventBus.on('fever:start', () => this.triggerEventBurst('FEVER'))
    eventBus.on('jackpot:start', () => this.triggerEventBurst('JACKPOT'))
    eventBus.on('adventure:start', () => this.triggerEventBurst('ADVENTURE'))
  }

  /**
   * Handle display state changes
   */
  private onDisplayStateChange(state: DisplayState): void {
    this.currentDisplayState = state
    this.updateLightingForState()
  }

  /**
   * Update lighting based on current game and display state
   */
  private updateLightingForState(): void {
    let edgeColor = new Color3(0.2, 0.3, 0.8) // Default: blue
    let edgeIntensity = 0.5
    let underColor = new Color3(0.8, 0.2, 0.8)
    let underIntensity = 0.3

    // Color scheme based on display state
    switch (this.currentDisplayState) {
      case DisplayState.IDLE:
        edgeColor = new Color3(0.2, 0.3, 0.8) // Deep blue
        edgeIntensity = 0.4
        underColor = new Color3(0.3, 0.4, 0.9)
        underIntensity = 0.2
        break

      case DisplayState.FEVER:
        edgeColor = new Color3(1.0, 0.6, 0.0) // Warm gold/orange
        edgeIntensity = 0.9
        underColor = new Color3(1.0, 0.5, 0.0)
        underIntensity = 0.6
        break

      case DisplayState.JACKPOT:
        edgeColor = color(PALETTE.CYAN) // Bright cyan
        edgeIntensity = 1.0
        underColor = new Color3(0.0, 0.8, 1.0)
        underIntensity = 0.8
        break

      case DisplayState.REACH:
        edgeColor = new Color3(0.9, 0.3, 0.9) // Magenta
        edgeIntensity = 0.7
        underColor = new Color3(0.9, 0.3, 0.9)
        underIntensity = 0.5
        break

      case DisplayState.ADVENTURE:
        edgeColor = color(PALETTE.PURPLE) // Rich purple
        edgeIntensity = 0.8
        underColor = new Color3(0.2, 0.8, 1.0) // Cyan accent
        underIntensity = 0.4
        break
    }

    // Update state targets
    this.edgeLightingState.targetColor = edgeColor
    this.edgeLightingState.targetIntensity = edgeIntensity
    this.underCabinetState.targetColor = underColor
    this.underCabinetState.targetIntensity = underIntensity
  }

  /**
   * Trigger event-based lighting burst
   */
  private triggerEventBurst(event: string): void {
    if (!this.enabled) return

    this.eventBurstTime = 0

    // Bright flash intensity based on event type
    let flashIntensity = 1.5

    if (event === 'JACKPOT') {
      flashIntensity = 1.8
    } else if (event === 'FEVER') {
      flashIntensity = 1.6
    }

    // Boost intensity for burst
    this.edgeLightingState.targetIntensity = Math.max(
      this.edgeLightingState.targetIntensity,
      flashIntensity
    )
  }

  /**
   * Update lighting each frame
   */
  update(dt: number): void {
    if (!this.enabled) return

    // Update edge lighting
    this.updateLightingState(this.edgeLightingState, this.edgeLights, dt)

    // Update under-cabinet light
    if (this.underCabinetLight) {
      this.updateLightingState(this.underCabinetState, [this.underCabinetLight], dt)
    }

    // Decay event burst
    if (this.eventBurstTime < this.eventBurstDuration) {
      this.eventBurstTime += dt
      const burstAlpha = 1 - this.eventBurstTime / this.eventBurstDuration
      const burstIntensity = burstAlpha * 0.3 // Decay intensity

      for (const light of this.edgeLights) {
        light.intensity = Math.max(light.intensity - burstIntensity * dt, 0)
      }
    }
  }

  /**
   * Update a lighting state with smooth transitions and pulsing
   */
  private updateLightingState(
    state: LightingState,
    lights: PointLight[],
    dt: number
  ): void {
    // Smooth color transition
    const colorLerpSpeed = 3 // transitions per second
    state.currentColor.r += (state.targetColor.r - state.currentColor.r) * colorLerpSpeed * dt
    state.currentColor.g += (state.targetColor.g - state.currentColor.g) * colorLerpSpeed * dt
    state.currentColor.b += (state.targetColor.b - state.currentColor.b) * colorLerpSpeed * dt

    // Smooth intensity transition
    const intensityLerpSpeed = 2
    state.intensity += (state.targetIntensity - state.intensity) * intensityLerpSpeed * dt

    // Pulsing animation
    state.pulsePhase += dt * 2 // Adjust speed
    const pulseFactor = Math.sin(state.pulsePhase) * 0.3 + 0.7 // 0.4 to 1.0 range

    // Apply to lights
    for (const light of lights) {
      light.diffuse = state.currentColor.clone()
      light.intensity = state.intensity * pulseFactor
    }
  }

  /**
   * Enable/disable all lighting
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    for (const light of this.edgeLights) {
      light.intensity = enabled ? 0.8 : 0
    }
    if (this.underCabinetLight) {
      this.underCabinetLight.intensity = enabled ? 0.4 : 0
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    for (const light of this.edgeLights) {
      light.dispose()
    }
    this.edgeLights = []

    if (this.underCabinetLight) {
      this.underCabinetLight.dispose()
      this.underCabinetLight = null
    }
  }
}
