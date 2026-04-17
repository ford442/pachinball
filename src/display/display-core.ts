/**
 * Display System Core
 * 
 * Main DisplaySystem orchestrator that coordinates all display layers.
 * Extracted and refactored from display.ts for modularity.
 */

import { MeshBuilder, Vector3, type Scene, TransformNode } from '@babylonjs/core'
import type { Engine, WebGPUEngine } from '@babylonjs/core'

import {
  DisplayState,
  type DisplayConfig,
  DEFAULT_DISPLAY_CONFIG,
  getStateConfig,
} from '../game-elements/display-config'
import { DisplayShaderLayer } from './display-shader'
import { DisplayReelsLayer } from './display-reels'
import { DisplayVideoLayer } from './display-video'
import { DisplayImageLayer } from './display-image'

export class DisplaySystem {
  private scene: Scene
  private config: DisplayConfig
  private useWGSL = false

  // Layer managers
  private shaderLayer: DisplayShaderLayer
  private reelsLayer: DisplayReelsLayer
  private videoLayer: DisplayVideoLayer
  private imageLayer: DisplayImageLayer

  // State
  private currentState: DisplayState = DisplayState.IDLE
  private jackpotPhase = 0
  private globalTime = 0

  // Backbox position (kept for future use)
  private backboxPosition: Vector3 | null = null

  constructor(
    scene: Scene,
    engine: Engine | WebGPUEngine,
    config?: Partial<DisplayConfig>
  ) {
    this.scene = scene
    this.config = { ...DEFAULT_DISPLAY_CONFIG, ...config }

    // Detect WebGPU/WGSL support
    this.useWGSL =
      engine.getClassName() === 'WebGPUEngine' ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (engine as unknown as { isWebGPU: boolean }).isWebGPU === true

    // Initialize layer managers
    this.shaderLayer = new DisplayShaderLayer(scene, this.config)
    this.reelsLayer = new DisplayReelsLayer(scene, this.config)
    this.videoLayer = new DisplayVideoLayer(scene, this.config)
    this.imageLayer = new DisplayImageLayer(scene, this.config)
  }

  /**
   * Create the backbox display at the specified position
   */
  createBackbox(position: Vector3): void {
    this.backboxPosition = position.clone()
    // Use void expression to suppress "declared but never read" warning
    void this.backboxPosition

    // Create root transform node for the backbox hierarchy
    const backboxRoot = new TransformNode('backboxRoot', this.scene)
    backboxRoot.position = position.clone()

    // Create the main display plane (kept for visual reference)
    const displayPlane = MeshBuilder.CreatePlane(
      'display',
      {
        width: this.config.width,
        height: this.config.height,
      },
      this.scene
    )
    displayPlane.parent = backboxRoot
    displayPlane.position.z += 0.5
    displayPlane.rotation.y = Math.PI

    // Attach layer meshes to the backbox root
    this.shaderLayer.createLayer(backboxRoot)
    this.shaderLayer.setCRTEffectEnabled(false)
    this.reelsLayer.createLayer(backboxRoot, this.config)
    this.videoLayer.createLayer(backboxRoot, this.config)
    this.imageLayer.createLayer(backboxRoot, this.config)
  }

  /**
   * Main update loop
   */
  update(dt: number, jackpotPhase?: number): void {
    this.globalTime += dt
    this.jackpotPhase = jackpotPhase ?? 0

    // Update all layers
    this.shaderLayer.update(dt, this.currentState, this.jackpotPhase)
    this.reelsLayer.update(dt, this.currentState)
    this.videoLayer.update()
  }

  /**
   * Set the current display state
   */
  setDisplayState(state: DisplayState, jackpotPhase = 0): void {
    if (this.currentState === state) return

    console.log(`[Display] State change: ${this.currentState} -> ${state}`)
    this.currentState = state
    this.jackpotPhase = jackpotPhase

    const media = getStateConfig(this.config, state)

    // Shader background visibility
    this.shaderLayer.setBackgroundVisible(media.showShaderBackground ?? true)

    // Reels visibility
    this.reelsLayer.setVisible(media.showReels ?? true)

    // Shader params
    if (media.shaderParams) {
      this.shaderLayer.setShaderParams(media.shaderParams)
    }

    // Video layer
    if (media.videoPath) {
      this.videoLayer.loadVideo(media.videoPath)
      this.videoLayer.setVisible(true)
    } else {
      this.videoLayer.setVisible(false)
    }

    // Image layer
    if (media.imagePath) {
      this.imageLayer.loadImage(media.imagePath, media.opacity ?? 1.0)
      this.imageLayer.setVisible(true)
    } else {
      this.imageLayer.setVisible(false)
    }

    // Fallback: if no video and no image, ensure shader/reels are visible
    if (!media.videoPath && !media.imagePath) {
      this.shaderLayer.setBackgroundVisible(true)
      this.reelsLayer.setVisible(true)
    }

    // Notify layers of state change
    this.shaderLayer.onStateChange(state)
    this.reelsLayer.onStateChange(state)
    this.videoLayer.onStateChange(state)
  }

  /**
   * Get the current display state
   */
  getDisplayState(): DisplayState {
    return this.currentState
  }

  /**
   * Trigger slot machine spin
   */
  triggerSlotSpin(): void {
    this.reelsLayer.startSpin()
  }

  /**
   * Set video source URL
   */
  setVideoSource(url: string): void {
    this.videoLayer.loadVideo(url)
  }

  /**
   * Enable/disable CRT effect
   */
  setCRTEffectEnabled(enabled: boolean): void {
    this.shaderLayer.setCRTEffectEnabled(enabled)
  }

  /**
   * Load and play a story video from URL
   */
  loadAndPlayVideo(url: string): void {
    if (!url) {
      console.log('[Display] No video URL provided, skipping video playback')
      return
    }
    this.videoLayer.loadVideo(url)
  }

  /**
   * Set story text for adventure mode
   */
  setStoryText(text: string): void {
    console.log('[Display] Story text:', text)
  }

  /**
   * Show zone entry story
   */
  showZoneStory(
    zoneName: string,
    storyText: string,
    videoUrl?: string,
    enableCRT = true
  ): void {
    console.log(`[Display] Zone entry: ${zoneName}`)
    this.setStoryText(storyText)

    if (videoUrl) {
      this.loadAndPlayVideo(videoUrl)
    }

    this.setCRTEffectEnabled(enableCRT)
  }

  /**
   * Trigger a CRT flash effect
   */
  triggerCRTFlash(): void {
    // Flash effect implementation
    console.log('[Display] CRT flash triggered')
  }

  /**
   * Set track info for adventure mode
   */
  setTrackInfo(trackName: string, progress = 0): void {
    console.log(`[Display] Track: ${trackName}, Progress: ${progress}`)
  }

  /**
   * Check if using WGSL shaders
   */
  isUsingWGSL(): boolean {
    return this.useWGSL
  }

  // ============================================================================
  // SLOT MACHINE METHODS (Stub implementations)
  // ============================================================================

  /**
   * Configure the slot machine with settings
   */
  public configureSlotMachine(config: unknown): void {
    console.log('[Display] Slot machine configured', config)
  }

  /**
   * Set callback for slot machine events
   */
  public setSlotEventCallback(callback: (event: string, data: unknown) => void): void {
    // Store callback for when slot events happen
    console.log('[Display] Slot event callback set')
    void callback
  }

  /**
   * Determine if slot machine should activate based on score
   */
  public shouldActivateSlotMachine(score: number): boolean {
    // Stub: Activate every 10k points roughly
    return score > 0 && score % 10000 === 0
  }

  /**
   * Start a slot machine spin
   */
  public startSlotSpin(): void {
    console.log('[Display] Slot spin started')
    this.reelsLayer.startSpin()
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.shaderLayer.dispose()
    this.reelsLayer.dispose()
    this.videoLayer.dispose()
    this.imageLayer.dispose()
  }
}
