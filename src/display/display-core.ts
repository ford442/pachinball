/**
 * Display System Core
 * 
 * Main DisplaySystem orchestrator that coordinates all display layers.
 * Extracted and refactored from display.ts for modularity.
 */

import { MeshBuilder, Vector3, type Scene, type Mesh, TransformNode } from '@babylonjs/core'
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
import { DisplayPhysicalLayer } from './display-physical'
import { DisplayLcdOverlayLayer } from './display-lcd-overlay'
import { DisplayStateMachine } from './display-state-machine'
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

  // Layer managers (PLAN.md §1 stack)
  private physicalLayer: DisplayPhysicalLayer
  private shaderLayer: DisplayShaderLayer
  private reelsLayer: DisplayReelsLayer
  private videoLayer: DisplayVideoLayer
  private imageLayer: DisplayImageLayer
  private lcdOverlayLayer: DisplayLcdOverlayLayer
  private stateMachine: DisplayStateMachine

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

  // Live text rendered on the LCD overlay (Layer 3)
  private trackThemePrimary: string = PALETTE.CYAN
  private trackThemeAccent: string = PALETTE.GOLD

  // Drain / ball-lost flash mode state machine
  private _displayMode: 'normal' | 'drain' = 'normal'
  private _drainTimer = 0
  private _flashCycleTime = 0
  private _currentSplashIndex = 0

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
    this.stateMachine = new DisplayStateMachine(this.config.transitions?.fadeDuration ?? 0.35)
    this.physicalLayer = new DisplayPhysicalLayer(scene, this.config, this.qualityTier)
    this.shaderLayer = new DisplayShaderLayer(scene, this.config)
    this.shaderLayer.setAccessibilityScanlineFactor?.(this.accessibility.scanlineIntensity)
    this.reelsLayer = new DisplayReelsLayer(scene, this.config)
    this.videoLayer = new DisplayVideoLayer(scene, this.config)
    this.imageLayer = new DisplayImageLayer(scene, this.config)
    this.lcdOverlayLayer = new DisplayLcdOverlayLayer(scene, this.config, this.qualityTier)
    this.lcdOverlayLayer.setAccessibility(
      this.accessibility.reducedMotion,
      this.accessibility.flashFrequencyMax <= 1
    )
    this.lcdOverlayLayer.setDisplayOverlay(this.overlay)

  }

  public getQualityTier(): QualityTier {
    return this.qualityTier
  }

  setAccessibility(accessibility: AccessibilityConfig): void {
    this.accessibility = accessibility
    this.shaderLayer.setAccessibilityScanlineFactor?.(accessibility.scanlineIntensity)
    this.lcdOverlayLayer.setAccessibility(
      accessibility.reducedMotion,
      accessibility.flashFrequencyMax <= 1
    )
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

    // Attach layer meshes to the backbox root (back → front)
    this.physicalLayer.createLayer(backboxRoot, this.config)
    this.shaderLayer.createLayer(backboxRoot)
    this.shaderLayer.setCRTEffectEnabled(false)
    this.reelsLayer.createLayer(backboxRoot, this.config)
    this.videoLayer.createLayer(backboxRoot, this.config)
    this.imageLayer.createLayer(backboxRoot, this.config)
    this.lcdOverlayLayer.createLayer(backboxRoot, this.config)
    this.lcdOverlayLayer.setTrackTheme(this.trackThemePrimary, this.trackThemeAccent)

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
  }

  /** Wire an EffectsSystem for the fresnel rim glow during FEVER. */
  setEffectsSystem(effects: EffectsSystem): void {
    this._effectsSystem = effects
    if (this.borderGlow) {
      this.borderGlow.setEffectsSystem(effects)
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
    this.lcdOverlayLayer.setDrainMode(true, this._flashCycleTime, this._currentSplashIndex)
  }

  /**
   * Returns true while the drain/ball-lost animated overlay is active.
   * Useful for callers that need to suppress other UI updates during the sequence.
   */
  public isDrainReactionActive(): boolean {
    return this._displayMode === 'drain'
  }

  /**
   * Main update loop
   */
  update(dt: number, jackpotPhase?: number): void {
    this.globalTime += dt
    this.jackpotPhase = jackpotPhase ?? 0

    const transition = this.stateMachine.update(dt)
    this.lcdOverlayLayer.setBlend(transition.blend)

    // Cross-fade main media during state transitions
    const mediaOpacity = 0.7 + transition.blend * 0.3
    this.videoLayer.setOpacity(mediaOpacity)
    this.imageLayer.setOpacity(mediaOpacity)

    // Parallax Z-axis breathing per layer
    this.physicalLayer.updateParallax(this.globalTime)
    this.shaderLayer.updateParallax(this.globalTime)
    this.reelsLayer.updateParallax(this.globalTime)
    this.videoLayer.updateParallax(this.globalTime)
    this.imageLayer.updateParallax(this.globalTime)

    this.physicalLayer.update(dt, this.currentState)
    this.lcdOverlayLayer.update(dt, this.currentState, this.jackpotPhase)

    this.slotMachine?.update(dt)

    this.shaderLayer.update(dt, this.currentState, this.jackpotPhase)
    this.reelsLayer.update(dt, this.currentState)
    this.videoLayer.update()

    this.borderGlow?.update(dt)

    if (this.overlay.isActive()) {
      this.overlay.update(dt)
    }

    if (this._displayMode === 'drain') {
      this._drainTimer -= dt
      this._flashCycleTime += dt
      const newIndex = Math.floor(this._flashCycleTime / 0.3) % 2
      if (!this.isPhotosafeMode() || newIndex !== this._currentSplashIndex) {
        this._currentSplashIndex = newIndex
        this.lcdOverlayLayer.setDrainMode(true, this._flashCycleTime, this._currentSplashIndex)
      }
      if (this._drainTimer <= 0) {
        this._displayMode = 'normal'
        this._drainTimer = 0
        this._flashCycleTime = 0
        this.lcdOverlayLayer.setDrainMode(false)
      }
    }

    if (this._temporaryTextTimer > 0) {
      this._temporaryTextTimer -= dt
      if (this._temporaryTextTimer <= 0 && !this._bonusTallyAnimating) {
        this._temporaryText = ''
        this.lcdOverlayLayer.setTemporaryText('')
      }
    }

    if (this._bonusTallyAnimating) {
      const animDurationS = 1.5
      const step = Math.max(1, Math.ceil(this._bonusTallyTarget * dt / animDurationS))
      this._bonusTallyDisplay = Math.min(this._bonusTallyTarget, this._bonusTallyDisplay + step)
      this._temporaryText = `BONUS ${Math.round(this._bonusTallyDisplay)}`
      this.lcdOverlayLayer.setTemporaryText(this._temporaryText)
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
    const changed = this.stateMachine.requestState(state)
    this.jackpotPhase = jackpotPhase
    if (!changed && this.currentState === state) return

    console.log(`[Display] State change: ${this.currentState} -> ${state}`)
    this.currentState = state

    const media = getStateConfig(this.config, state)

    this.shaderLayer.setBackgroundVisible(media.showShaderBackground ?? true)
    this.reelsLayer.setVisible(media.showReels ?? true)
    this.physicalLayer.setVisible(media.showShaderBackground ?? true)

    if (media.shaderParams) {
      this.shaderLayer.setShaderParams(media.shaderParams)
    }

    if (media.videoPath) {
      this.videoLayer.loadVideo(media.videoPath)
      this.videoLayer.setVisible(true)
    } else {
      this.videoLayer.setVisible(false)
    }

    if (media.imagePath) {
      this.imageLayer.loadImage(media.imagePath, media.opacity ?? 1.0)
      this.imageLayer.setVisible(true)
    } else {
      this.imageLayer.setVisible(false)
    }

    if (!media.videoPath && !media.imagePath) {
      this.shaderLayer.setBackgroundVisible(true)
      this.reelsLayer.setVisible(true)
    }

    this.physicalLayer.onStateChange(state)
    this.shaderLayer.onStateChange(state)
    this.reelsLayer.onStateChange(state)
    this.videoLayer.onStateChange(state)
    this.lcdOverlayLayer.onStateChange(state)
    this.borderGlow?.onDisplaySet(state)

    const lightingMode = this.lightingModeForState(state)
    this._effectsSystem?.setLightingMode(lightingMode, lightingMode === 'reach' ? 2.5 : lightingMode === 'fever' ? 4.0 : 0)
  }

  private lightingModeForState(state: DisplayState): 'normal' | 'reach' | 'fever' | 'hit' {
    switch (state) {
      case DisplayState.REACH:
      case DisplayState.PORTAL_OPEN:
      case DisplayState.ESCAPE:
        return 'reach'
      case DisplayState.FEVER:
      case DisplayState.JACKPOT:
        return 'fever'
      default:
        return 'normal'
    }
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
    this.lcdOverlayLayer.setStoryText(text)
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
    this.lcdOverlayLayer.setTrackText(`♪ ${trackName}  [${bar}]`)
  }

  setTrackTheme(primaryHex: string, accentHex?: string): void {
    this.trackThemePrimary = primaryHex
    this.trackThemeAccent = accentHex ?? primaryHex
    this.lcdOverlayLayer.setTrackTheme(primaryHex, accentHex)
  }

  /**
   * Check if using WGSL shaders
   */
  isUsingWGSL(): boolean {
    return this.useWGSL
  }

  // ============================================================================
  // SLOT MACHINE
  // ============================================================================

  /**
   * Configure the slot machine with settings
   */
  public configureSlotMachine(config: Partial<import('./slot-types').SlotMachineConfig>): void {
    this.slotMachine?.configure(config)
  }

  /**
   * Wire a live score provider for HYBRID / SCORE activation gating.
   */
  public setSlotScoreProvider(provider: () => number): void {
    this.slotMachine?.setScoreProvider(provider)
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
        this.lcdOverlayLayer.setTemporaryText(this._temporaryText)
      }
    })

    bus.on('ball:save:triggered', () => {
      this._temporaryText = 'BALL SAVED'
      this._temporaryTextTimer = 2.0
      this.lcdOverlayLayer.setTemporaryText(this._temporaryText)
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
    this.physicalLayer.dispose()
    this.shaderLayer.dispose()
    this.reelsLayer.dispose()
    this.videoLayer.dispose()
    this.imageLayer.dispose()
    this.lcdOverlayLayer.dispose()
  }
}
