/**
 * Display System Core
 * 
 * Main DisplaySystem orchestrator that coordinates all display layers.
 * Extracted and refactored from display.ts for modularity.
 */

import { MeshBuilder, Vector3, DynamicTexture, StandardMaterial, Color3, type Scene, type Mesh, TransformNode } from '@babylonjs/core'
import type { Engine, WebGPUEngine } from '@babylonjs/core'

import {
  DisplayState,
  type DisplayConfig,
  DEFAULT_DISPLAY_CONFIG,
  getStateConfig,
} from '../game-elements/display-config'
import { QualityTier } from '../game-elements/visual-language'
import {
  type AccessibilityConfig,
  detectAccessibility,
} from '../game-elements/accessibility-config'
import { DisplayShaderLayer } from './display-shader'
import { DisplayReelsLayer } from './display-reels'
import { DisplayVideoLayer } from './display-video'
import { DisplayImageLayer } from './display-image'
import { BackboxBorderGlow } from './display-border-glow'
import type { EventBus } from '../game/event-bus'

export class DisplaySystem {
  private scene: Scene
  private config: DisplayConfig
  private useWGSL = false
  private qualityTier: QualityTier = QualityTier.MEDIUM
  private accessibility: AccessibilityConfig

  // Layer managers
  private shaderLayer: DisplayShaderLayer
  private reelsLayer: DisplayReelsLayer
  private videoLayer: DisplayVideoLayer
  private imageLayer: DisplayImageLayer

  // Border glow
  private borderGlow: BackboxBorderGlow | null = null

  // State
  private currentState: DisplayState = DisplayState.IDLE
  private jackpotPhase = 0
  private globalTime = 0

  // Backbox position (kept for future use)
  private backboxPosition: Vector3 | null = null

  // Live text overlay (story + track info) rendered onto the backbox
  private textMesh: Mesh | null = null
  private textTexture: DynamicTexture | null = null
  private textMaterial: StandardMaterial | null = null
  private storyText = ''
  private trackText = ''

  constructor(
    scene: Scene,
    engine: Engine | WebGPUEngine,
    config?: Partial<DisplayConfig>,
    qualityTier?: QualityTier,
    accessibility?: AccessibilityConfig
  ) {
    this.scene = scene
    this.config = { ...DEFAULT_DISPLAY_CONFIG, ...config }
    this.qualityTier = qualityTier ?? QualityTier.MEDIUM
    this.accessibility = accessibility ?? detectAccessibility()

    // Detect WebGPU/WGSL support
    this.useWGSL =
      engine.getClassName() === 'WebGPUEngine' ||
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
    // Disable CRT curve/scanlines — virtual backbox is a crisp modern LCD
    this.shaderLayer.setCRTEffectEnabled(false)
    this.reelsLayer.createLayer(backboxRoot, this.config)
    this.videoLayer.createLayer(backboxRoot, this.config)
    this.imageLayer.createLayer(backboxRoot, this.config)

    // Initialise border glow on the cabinet backbox mesh (built by cabinet preset).
    // The mesh is named 'cabinetBackbox' in all four cabinet presets.
    const backboxMesh = this.scene.getMeshByName('cabinetBackbox') as Mesh | null
    this.borderGlow = new BackboxBorderGlow(backboxMesh, this.scene, this.qualityTier, this.accessibility)
    // Apply the current state immediately so the glow colour is correct from the start.
    this.borderGlow.onDisplaySet(this.currentState)

    this.createTextOverlay(backboxRoot)
  }

  private createTextOverlay(parent: TransformNode): void {
    const w = this.config.width
    const h = this.config.height
    const texW = 1024
    const texH = Math.round(texW * (h / w))

    this.textTexture = new DynamicTexture('displayTextTex', { width: texW, height: texH }, this.scene, false)
    this.textTexture.hasAlpha = true

    const mat = new StandardMaterial('displayTextMat', this.scene)
    mat.diffuseTexture = this.textTexture
    mat.opacityTexture = this.textTexture
    mat.emissiveTexture = this.textTexture
    mat.emissiveColor = Color3.White()
    mat.disableLighting = true
    mat.backFaceCulling = false
    this.textMaterial = mat

    const plane = MeshBuilder.CreatePlane('displayText', { width: w, height: h }, this.scene)
    plane.parent = parent
    plane.rotation.y = Math.PI
    plane.position.z = 0.25
    plane.material = mat
    this.textMesh = plane

    this.redrawTextOverlay()
  }

  private redrawTextOverlay(): void {
    if (!this.textTexture) return
    const ctx = this.textTexture.getContext() as CanvasRenderingContext2D
    const canvas = ctx.canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (this.storyText) {
      ctx.fillStyle = '#7fe9ff'
      ctx.font = 'bold 56px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = '#00bfff'
      ctx.shadowBlur = 18
      this.wrapText(ctx, this.storyText, canvas.width / 2, canvas.height * 0.4, canvas.width * 0.9, 64)
    }

    if (this.trackText) {
      ctx.shadowBlur = 10
      ctx.fillStyle = '#ffe16a'
      ctx.font = 'bold 40px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.trackText, canvas.width / 2, canvas.height * 0.82)
    }

    this.textTexture.update(false)
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ): void {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) lines.push(line)

    const startY = y - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight))
  }

  /**
   * Main update loop
   */
  update(dt: number, jackpotPhase?: number): void {
    this.globalTime += dt
    this.jackpotPhase = jackpotPhase ?? 0

    // Parallax Z-axis breathing per layer (subtle depth oscillation)
    this.shaderLayer.updateParallax(this.globalTime)
    this.reelsLayer.updateParallax(this.globalTime)
    this.videoLayer.updateParallax(this.globalTime)
    this.imageLayer.updateParallax(this.globalTime)

    // Update all layers
    this.shaderLayer.update(dt, this.currentState, this.jackpotPhase)
    this.reelsLayer.update(dt, this.currentState)
    this.videoLayer.update()

    // Border glow animation
    this.borderGlow?.update(dt)
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

    // Notify border glow of state change
    this.borderGlow?.onDisplaySet(state)
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
   * Set CRT effect parameters
   */
  setCRTEffectParams(params: Partial<{
    scanlineIntensity: number
    curvature: number
    vignette: number
    chromaticAberration: number
    glow: number
    noise: number
    flicker: number
  }>): void {
    this.shaderLayer.setCRTEffectParams(params)
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
    this.storyText = text
    this.redrawTextOverlay()
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
    const pct = Math.max(0, Math.min(1, progress))
    const bar = '█'.repeat(Math.round(pct * 10)).padEnd(10, '░')
    this.trackText = `♪ ${trackName}  [${bar}]`
    this.redrawTextOverlay()
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
   * Subscribe to event bus events.
   * DisplaySystem self-manages display state changes via the `display:set` event.
   */
  subscribeToEvents(bus: EventBus): void {
    bus.on('display:set', (state: DisplayState) => {
      this.setDisplayState(state)
    })
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.borderGlow?.dispose()
    this.shaderLayer.dispose()
    this.reelsLayer.dispose()
    this.videoLayer.dispose()
    this.imageLayer.dispose()
    this.textTexture?.dispose()
    this.textMaterial?.dispose()
    this.textMesh?.dispose()
    this.textTexture = null
    this.textMaterial = null
    this.textMesh = null
  }
}
