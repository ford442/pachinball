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
import { PALETTE, QualityTier } from '../game-elements/visual-language'
import {
  type AccessibilityConfig,
  detectAccessibility,
} from '../game-elements/accessibility-config'
import { DisplayShaderLayer } from './display-shader'
import { DisplayReelsLayer } from './display-reels'
import { SlotMachine } from './slot-machine'
import { DisplayVideoLayer } from './display-video'
import { DisplayImageLayer } from './display-image'
import { BackboxBorderGlow } from './display-border-glow'
import type { CRTEffectParams } from './display-types'
import type { EventBus } from '../game/event-bus'
import type { EffectsSystem } from '../effects/effects-core'
import { DisplayOverlay } from './display-overlay'

export class DisplaySystem {
  public readonly overlay = new DisplayOverlay()

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

  // EffectsSystem reference for fresnel rim wiring
  private _effectsSystem: EffectsSystem | null = null

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
  private trackThemePrimary: string = PALETTE.CYAN
  private trackThemeAccent: string = PALETTE.GOLD

  // Drain / ball-lost flash mode state machine
  private _displayMode: 'normal' | 'drain' = 'normal'
  private _drainTimer = 0
  private _flashCycleTime = 0
  private _currentSplashIndex = 0
  private _splashImages: HTMLImageElement[] = []

  // Temporary text overlay (combo multiplier, ball save, bonus tally)
  private _temporaryText = ''
  private _temporaryTextTimer = 0

  // Bonus tally count-up animation
  private _bonusTallyTarget = 0
  private _bonusTallyDisplay = 0
  private _bonusTallyAnimating = false

  // Slot machine mini-game (created when event bus is wired)
  private slotMachine: SlotMachine | null = null

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
    this.shaderLayer.setAccessibilityScanlineFactor?.(this.accessibility.scanlineIntensity)
    this.reelsLayer = new DisplayReelsLayer(scene, this.config)
    this.videoLayer = new DisplayVideoLayer(scene, this.config)
    this.imageLayer = new DisplayImageLayer(scene, this.config)

  }

  public getQualityTier(): QualityTier {
    return this.qualityTier
  }

  setAccessibility(accessibility: AccessibilityConfig): void {
    this.accessibility = accessibility
    this.shaderLayer.setAccessibilityScanlineFactor?.(accessibility.scanlineIntensity)
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
    // Wire EffectsSystem if already set (set in scene_rendering before createBackbox runs)
    if (this._effectsSystem) {
      this.borderGlow.setEffectsSystem(this._effectsSystem)
    }
    // Apply the current state immediately so the glow colour is correct from the start.
    this.borderGlow.onDisplaySet(this.currentState)

    this.createTextOverlay(backboxRoot)
    this._preloadSplashImages()
  }

  /** Wire an EffectsSystem for the fresnel rim glow during FEVER. */
  setEffectsSystem(effects: EffectsSystem): void {
    this._effectsSystem = effects
    // If borderGlow already exists (late wiring), propagate immediately.
    if (this.borderGlow) {
      this.borderGlow.setEffectsSystem(effects)
    }
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

  private _preloadSplashImages(): void {
    const paths = ['/assets/backbox/splash1.png', '/assets/backbox/splash2.png']
    for (const path of paths) {
      const img = new Image()
      img.onerror = () => console.warn(`[Display] Failed to load splash image: ${path}`)
      img.src = path
      this._splashImages.push(img)
    }
  }

  /**
   * Trigger the "Drain / Ball Lost" display reaction.
   * Call this from the physics loop when a ball enters the drain zone.
   */
  public triggerDrainReaction(): void {
    this._displayMode = 'drain'
    this._drainTimer = 2.0
    this._flashCycleTime = 0
    this._currentSplashIndex = 0
    this.redrawTextOverlay()
  }

  /**
   * Returns true while the drain/ball-lost animated overlay is active.
   * Useful for callers that need to suppress other UI updates during the sequence.
   */
  public isDrainReactionActive(): boolean {
    return this._displayMode === 'drain'
  }

  private redrawTextOverlay(): void {
    if (!this.textTexture) return
    const ctx = this.textTexture.getContext() as CanvasRenderingContext2D
    const canvas = ctx.canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (this._displayMode === 'drain') {
      const photosafe = this.isPhotosafeMode()

      // Draw cycling splash image (if loaded) — skip cycling in photosafe mode
      const splashIdx = photosafe ? 0 : this._currentSplashIndex
      const img = this._splashImages[splashIdx]
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      } else {
        // Fallback solid background when image is not yet loaded
        ctx.fillStyle = splashIdx === 0 ? '#14003c' : '#3c0014'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      // Neon pulse box + "BALL LOST" — alpha/glow driven by sine wave on _flashCycleTime.
      // In photosensitive/reduced-motion mode, use static alpha/glow instead.
      const pulse = photosafe ? 0.5 : (Math.sin(this._flashCycleTime * Math.PI * 4) + 1) / 2
      const alpha = 0.55 + pulse * 0.45
      const glow = photosafe ? 12 : 8 + pulse * 40

      const cx = canvas.width / 2
      const cy = canvas.height / 2
      const boxW = canvas.width * 0.78
      const boxH = canvas.height * 0.30

      // Glowing border box
      ctx.save()
      ctx.strokeStyle = `rgba(255, 40, 40, ${alpha})`
      ctx.lineWidth = 6
      ctx.shadowColor = `rgba(255, 0, 0, ${alpha})`
      ctx.shadowBlur = glow
      ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH)
      ctx.restore()

      // "BALL LOST" text
      ctx.save()
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.font = 'bold 96px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = `rgba(255, 60, 60, ${alpha})`
      ctx.shadowBlur = glow
      ctx.fillText('BALL LOST', cx, cy)
      ctx.restore()

      // Render DisplayOverlay on top
      this.overlay.render(ctx, canvas.width, canvas.height, this.currentState)

      this.textTexture.update(false)
      return
    }

    // Normal mode

    if (this._temporaryText) {
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 72px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = '#00d9ff'
      ctx.shadowBlur = 24
      ctx.fillText(this._temporaryText, canvas.width / 2, canvas.height / 2)
    }

    if (this.storyText && !this._temporaryText) {
      ctx.fillStyle = this.trackThemePrimary
      ctx.font = 'bold 56px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = this.trackThemePrimary
      ctx.shadowBlur = 18
      this.wrapText(ctx, this.storyText, canvas.width / 2, canvas.height * 0.4, canvas.width * 0.9, 64)
    }

    if (this.trackText && !this._temporaryText) {
      ctx.shadowBlur = 10
      ctx.fillStyle = this.trackThemeAccent
      ctx.font = 'bold 40px "Courier New", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.trackText, canvas.width / 2, canvas.height * 0.82)
    }

    // Render DisplayOverlay on top
    this.overlay.render(ctx, canvas.width, canvas.height, this.currentState)

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

    // Update slot machine *before* reels so stop requests reach the spring layer
    this.slotMachine?.update(dt)

    // Update all layers
    this.shaderLayer.update(dt, this.currentState, this.jackpotPhase)
    this.reelsLayer.update(dt, this.currentState)
    this.videoLayer.update()

    // Border glow animation
    this.borderGlow?.update(dt)

    // Update DisplayOverlay
    if (this.overlay.isActive()) {
      this.overlay.update(dt)
      this.redrawTextOverlay()
    }

    // Drain mode: tick timer, cycle splash, animate overlay, then restore normal mode
    if (this._displayMode === 'drain') {
      this._drainTimer -= dt
      this._flashCycleTime += dt
      const newIndex = Math.floor(this._flashCycleTime / 0.3) % 2
      // Normal mode: redraw every frame for smooth neon-pulse animation.
      // Photosafe mode: redraw only when the splash image switches (~3 Hz is enough for a static frame).
      if (!this.isPhotosafeMode() || newIndex !== this._currentSplashIndex) {
        this._currentSplashIndex = newIndex
        this.redrawTextOverlay()
      }
      if (this._drainTimer <= 0) {
        this._displayMode = 'normal'
        this._drainTimer = 0
        this._flashCycleTime = 0
        this.redrawTextOverlay()
      }
    }

    // Temporary text overlay timer
    if (this._temporaryTextTimer > 0) {
      this._temporaryTextTimer -= dt
      if (this._temporaryTextTimer <= 0 && !this._bonusTallyAnimating) {
        this._temporaryText = ''
        this.redrawTextOverlay()
      }
    }

    // Bonus tally count-up animation
    if (this._bonusTallyAnimating) {
      const animDurationS = 1.5
      const step = Math.max(1, Math.ceil(this._bonusTallyTarget * dt / animDurationS))
      this._bonusTallyDisplay = Math.min(this._bonusTallyTarget, this._bonusTallyDisplay + step)
      this._temporaryText = `BONUS ${Math.round(this._bonusTallyDisplay)}`
      this.redrawTextOverlay()
      if (this._bonusTallyDisplay >= this._bonusTallyTarget) {
        this._bonusTallyAnimating = false
        this._temporaryTextTimer = 2.0
      }
    }
  }

  /** Returns true when reduced motion or a low flash-frequency cap is requested. */
  private isPhotosafeMode(): boolean {
    return this.accessibility.reducedMotion || this.accessibility.flashFrequencyMax <= 1
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
  setCRTEffectParams(params: Partial<CRTEffectParams>): void {
    this.shaderLayer.setCRTEffectParams(params)
  }

  setScanlineWeight(weight: number): void {
    this.shaderLayer.setScanlineWeight(weight)
  }

  setPlayerScanlineEnabled(enabled: boolean): void {
    this.shaderLayer.setPlayerScanlineEnabled(enabled)
  }

  setScanlineIntensityMultiplier(multiplier: number): void {
    this.shaderLayer.setScanlineIntensityMultiplier(multiplier)
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

  setTrackTheme(primaryHex: string, accentHex?: string): void {
    this.trackThemePrimary = primaryHex
    this.trackThemeAccent = accentHex ?? primaryHex
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
  public configureSlotMachine(config: Partial<import('./slot-types').SlotMachineConfig>): void {
    this.slotMachine?.configure(config)
  }

  /**
   * Set callback for slot machine events.
   * @deprecated Slot events are now emitted on the EventBus; subscribe there.
   */
  public setSlotEventCallback(_callback: (event: string, data: unknown) => void): void {
    // Slot events are typed EventBus events; this stub is kept for API compatibility.
  }

  /**
   * Determine if slot machine should activate based on score.
   * Note: activation is normally handled automatically on REACH/FEVER.
   */
  public shouldActivateSlotMachine(score: number): boolean {
    return this.slotMachine?.tryActivate(score) ?? false
  }

  /**
   * Start a slot machine spin.
   */
  public startSlotSpin(): void {
    this.slotMachine?.forceSpin()
  }

  /**
   * Force the next spin to land on the supplied symbols (debug / tests).
   */
  public setSlotDebugForce(symbols: import('./slot-types').SlotSymbol[]): void {
    this.slotMachine?.setDebugForceResult(symbols)
  }

  /**
   * Subscribe to event bus events.
   * DisplaySystem self-manages display state changes via the `display:set` event.
   */
  subscribeToEvents(bus: EventBus): void {
    if (!this.slotMachine) {
      this.slotMachine = new SlotMachine(this.reelsLayer, bus)
    }
    this.slotMachine.subscribeToEvents()

    bus.on('display:set', (state: DisplayState) => {
      this.setDisplayState(state)
    })

    bus.on('combo:multiplier:changed', (data) => {
      if (data.multiplier > 1) {
        this._temporaryText = `MULTIPLIER x${data.multiplier}`
        this._temporaryTextTimer = 1.5
        this.redrawTextOverlay()
      }
    })

    bus.on('ball:save:triggered', () => {
      this._temporaryText = 'BALL SAVED'
      this._temporaryTextTimer = 2.0
      this.redrawTextOverlay()
    })

    bus.on('bonus:tally:start', (data) => {
      this._bonusTallyTarget = data.totalBonus
      this._bonusTallyDisplay = 0
      this._bonusTallyAnimating = true
    })

    bus.on('bonus:tally:complete', () => {
      this._bonusTallyAnimating = false
      this._temporaryTextTimer = 2.0
    })
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.slotMachine?.dispose()
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
