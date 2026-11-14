/**
 * Display System Core
 * 
 * Main DisplaySystem orchestrator that coordinates all display layers.
 * Extracted and refactored from display.ts for modularity.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import {
  DisplayState,
  type DisplayConfig,
  type CRTEffectParams,
  DEFAULT_DISPLAY_CONFIG,
  getStateConfig,
} from './display-types'
import { PALETTE, QualityTier } from '../game-elements/visual-language'
import { type AccessibilityConfig, detectAccessibility } from '../game-elements/accessibility-config'
import { DisplayShaderLayer } from './display-shader'
import { DisplayReelsLayer, type ReelsRenderTelemetrySnapshot } from './display-reels'
import { SlotMachine } from './slot-machine'
import { DisplayVideoLayer } from './display-video'
import { DisplayImageLayer } from './display-image'
import type { DisplayCharacterLayer } from './display-character'
import { DisplayPhysicalLayer } from './display-physical'
import { DisplayLcdOverlayLayer } from './display-lcd-overlay'
import { DisplayStateMachine } from './display-state-machine'
import { BackboxBorderGlow } from './display-border-glow'
import type { EventBus } from '../core/event-bus'
import type { EffectsSystem } from '../effects/effects-core'
import { DisplayOverlay } from './display-overlay'
import { DisplayBackboxGraph, type BackboxGraphReport } from './display-backbox-graph'
import { CharacterTakeLoader } from './display-character-take'
import { LcdTransientText } from './display-lcd-text'
import { applyStateMedia, lightingModeForState } from './display-state-presentation'
import type { BackboxFrameGraph } from './backbox-frame-graph'
import type { StaticSceneGate } from '../core/static-scene-gate'
import { isSoftwareRasterizer } from '../engine/software-rasterizer'

export type { BackboxGraphStatus, BackboxGraphReport } from './display-backbox-graph'

export interface DisplaySystemOptions {
  /** `?nopp=1`: the backbox graph is the composite and nothing else (no CRT, no jackpot pass). */
  noPostProcess?: boolean
}

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
  // The character take (lazily imported on the first non-empty characterLayer, off the entry chunk).
  private readonly characterTake: CharacterTakeLoader
  private get characterLayer(): DisplayCharacterLayer | null {
    return this.characterTake.layer
  }
  private backboxRoot: TransformNode | null = null
  private lcdOverlayLayer: DisplayLcdOverlayLayer
  private stateMachine: DisplayStateMachine

  // Backbox Frame Graph (#461): the layers above composed into one texture on one plane.
  // Lazily imported, like the character layer, so its Babylon tasks stay off the entry chunk.
  private readonly backbox: DisplayBackboxGraph
  /** The built graph (null until it exists); read by the e2e probes (`display.backboxGraph`). */
  get backboxGraph(): BackboxFrameGraph | null {
    return this.backbox.getGraph()
  }

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

  // Drain reaction, temporary text and the bonus tally (Layer 3 LCD text)
  private readonly lcdText: LcdTransientText

  // Slot machine mini-game (created when event bus is wired)
  private slotMachine: SlotMachine | null = null

  constructor(
    scene: Scene,
    engine: Engine | WebGPUEngine,
    config?: Partial<DisplayConfig>,
    qualityTier?: QualityTier,
    accessibility?: AccessibilityConfig,
    options: DisplaySystemOptions = {}
  ) {
    this.scene = scene
    this.config = { ...DEFAULT_DISPLAY_CONFIG, ...config }
    this.qualityTier = qualityTier ?? QualityTier.MEDIUM
    this.accessibility = accessibility ?? detectAccessibility()

    // Detect WebGPU/WGSL support
    this.useWGSL = engine.isWebGPU

    // Initialize layer managers
    this.stateMachine = new DisplayStateMachine(this.config.transitions?.fadeDuration ?? 0.35)
    this.physicalLayer = new DisplayPhysicalLayer(scene, this.config, this.qualityTier)
    this.shaderLayer = new DisplayShaderLayer(scene, this.config)
    this.shaderLayer.setAccessibilityScanlineFactor?.(this.accessibility.scanlineIntensity)
    this.reelsLayer = new DisplayReelsLayer(scene, this.config)
    this.videoLayer = new DisplayVideoLayer(scene, this.config)
    this.imageLayer = new DisplayImageLayer(scene, this.config)
    this.lcdOverlayLayer = new DisplayLcdOverlayLayer(scene, this.config, this.qualityTier)
    this.lcdOverlayLayer.setAccessibility(this.accessibility.reducedMotion, this.accessibility.flashFrequencyMax <= 1)
    this.lcdOverlayLayer.setDisplayOverlay(this.overlay)
    this.lcdText = new LcdTransientText(this.lcdOverlayLayer, () => this.isPhotosafeMode())
    this.characterTake = new CharacterTakeLoader({
      scene,
      config: this.config,
      getAccessibility: () => this.accessibility,
      getBackboxRoot: () => this.backboxRoot,
      lcdOverlayLayer: this.lcdOverlayLayer,
    })
    this.backbox = new DisplayBackboxGraph({
      scene,
      config: this.config,
      qualityTier: this.qualityTier,
      noPostProcess: options.noPostProcess ?? false,
      softwareRaster: isSoftwareRasterizer(engine),
      getAccessibility: () => this.accessibility,
      layers: {
        physical: this.physicalLayer,
        shader: this.shaderLayer,
        reels: this.reelsLayer,
        video: this.videoLayer,
        image: this.imageLayer,
        lcd: this.lcdOverlayLayer,
        getCharacter: () => this.characterLayer,
      },
    })
  }

  public getQualityTier(): QualityTier {
    return this.qualityTier
  }

  setAccessibility(accessibility: AccessibilityConfig): void {
    this.accessibility = accessibility
    this.shaderLayer.setAccessibilityScanlineFactor?.(accessibility.scanlineIntensity)
    this.lcdOverlayLayer.setAccessibility(accessibility.reducedMotion, accessibility.flashFrequencyMax <= 1)
    this.characterLayer?.setAccessibility(accessibility.reducedMotion, accessibility.flashFrequencyMax <= 1)
    this.backbox.syncPlan()
  }

  /** Thawed when the backbox graph moves layer meshes off the scene camera's layer mask. */
  setStaticSceneGate(gate: Pick<StaticSceneGate, 'invalidate'> | null): void {
    this.backbox.setStaticSceneGate(gate)
  }

  /** The backbox graph's plan and, once built, its node list (debug HUD, e2e). */
  getBackboxGraphInfo(): BackboxGraphReport {
    return this.backbox.getInfo()
  }

  /** Create the backbox display at the specified position */
  createBackbox(position: Vector3): void {
    this.backboxPosition = position.clone()
    // Use void expression to suppress "declared but never read" warning
    void this.backboxPosition

    // Create root transform node for the backbox hierarchy
    const backboxRoot = new TransformNode('backboxRoot', this.scene)
    backboxRoot.position = position.clone()

    // Attach layer meshes to the backbox root (back → front)
    this.physicalLayer.createLayer(backboxRoot, this.config)
    this.shaderLayer.createLayer(backboxRoot)
    this.shaderLayer.setCRTEffectEnabled(false)
    this.reelsLayer.createLayer(backboxRoot, this.config)
    this.videoLayer.createLayer(backboxRoot, this.config)
    this.imageLayer.createLayer(backboxRoot, this.config)
    this.backboxRoot = backboxRoot
    this.characterLayer?.createLayer(backboxRoot, this.config)
    // setDisplayState skips the state already current, so the boot (IDLE / attract) take is requested here.
    this.characterTake.requestTake(getStateConfig(this.config, this.currentState).characterLayer ?? '', this.currentState)
    this.lcdOverlayLayer.createLayer(backboxRoot, this.config)
    this.lcdOverlayLayer.setTrackTheme(this.trackThemePrimary, this.trackThemeAccent)

    // One composite of every layer above, on the one plane the scene camera sees.
    this.backbox.start(backboxRoot)

    // Initialise border glow on the cabinet backbox mesh (built by cabinet preset).
    // It lights the cabinet frame (a scene mesh around the glass), so it is not a graph layer.
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

  /** Trigger the "Drain / Ball Lost" display reaction (call it when a ball enters the drain zone). */
  public triggerDrainReaction(): void {
    this.lcdText.triggerDrainReaction()
  }

  /** True while the drain / ball-lost overlay is active (callers may suppress other UI meanwhile). */
  public isDrainReactionActive(): boolean {
    return this.lcdText.isDrainReactionActive()
  }

  /** Main update loop */
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
    this.characterLayer?.update(dt)
    this.lcdOverlayLayer.update(dt, this.currentState, this.jackpotPhase)

    this.slotMachine?.update(dt)

    this.shaderLayer.update(dt, this.currentState, this.jackpotPhase)
    this.reelsLayer.update(dt, this.currentState)
    this.videoLayer.update()

    this.borderGlow?.update(dt)

    if (this.overlay.isActive()) {
      this.overlay.update(dt)
    }

    this.lcdText.update(dt)
  }

  /** Returns true when reduced motion or a low flash-frequency cap is requested. */
  private isPhotosafeMode(): boolean {
    return this.accessibility.reducedMotion || this.accessibility.flashFrequencyMax <= 1
  }

  /** Set the current display state */
  setDisplayState(state: DisplayState, jackpotPhase = 0): void {
    const changed = this.stateMachine.requestState(state)
    this.jackpotPhase = jackpotPhase
    if (!changed && this.currentState === state) return

    console.log(`[Display] State change: ${this.currentState} -> ${state}`)
    this.currentState = state

    const media = getStateConfig(this.config, state)

    applyStateMedia(
      { shader: this.shaderLayer, reels: this.reelsLayer, physical: this.physicalLayer, video: this.videoLayer, image: this.imageLayer },
      media,
    )

    this.characterTake.requestTake(media.characterLayer ?? '', state)

    this.physicalLayer.onStateChange(state)
    this.shaderLayer.onStateChange(state)
    this.reelsLayer.onStateChange(state)
    this.videoLayer.onStateChange(state)
    this.lcdOverlayLayer.onStateChange(state)
    this.borderGlow?.onDisplaySet(state)

    const lightingMode = lightingModeForState(state)
    this._effectsSystem?.setLightingMode(lightingMode, lightingMode === 'reach' ? 2.5 : lightingMode === 'fever' ? 4.0 : 0)
  }

  /** Get the current display state */
  getDisplayState(): DisplayState {
    return this.currentState
  }

  /** Trigger slot machine spin */
  triggerSlotSpin(): void {
    this.reelsLayer.startSpin()
  }

  /** Set video source URL */
  setVideoSource(url: string): void {
    this.videoLayer.loadVideo(url)
  }

  /** Enable/disable CRT effect */
  setCRTEffectEnabled(enabled: boolean): void {
    this.shaderLayer.setCRTEffectEnabled(enabled)
  }

  /** Set CRT effect parameters */
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

  /** Load and play a story video from URL */
  loadAndPlayVideo(url: string): void {
    if (!url) {
      console.log('[Display] No video URL provided, skipping video playback')
      return
    }
    this.videoLayer.loadVideo(url)
  }

  /** Set story text for adventure mode */
  setStoryText(text: string): void {
    this.lcdOverlayLayer.setStoryText(text)
  }

  /** Show zone entry story */
  showZoneStory(zoneName: string, storyText: string, videoUrl?: string, enableCRT = true): void {
    console.log(`[Display] Zone entry: ${zoneName}`)
    this.setStoryText(storyText)

    if (videoUrl) {
      this.loadAndPlayVideo(videoUrl)
    }

    this.setCRTEffectEnabled(enableCRT)
  }

  /** Trigger a CRT flash effect */
  triggerCRTFlash(): void {
    // Flash effect implementation
    console.log('[Display] CRT flash triggered')
  }

  /** Set track info for adventure mode */
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

  /** Check if using WGSL shaders */
  isUsingWGSL(): boolean {
    return this.useWGSL
  }

  // Slot machine and reels

  /** Configure the slot machine with settings */
  public configureSlotMachine(config: Partial<import('./slot-types').SlotMachineConfig>): void {
    this.slotMachine?.configure(config)
  }

  /** Wire a live score provider for HYBRID / SCORE activation gating. */
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

  /** Start a slot machine spin. */
  public startSlotSpin(): void {
    this.slotMachine?.forceSpin()
  }

  /** Force the next spin to land on the supplied symbols (debug / tests). */
  public setSlotDebugForce(symbols: import('./slot-types').SlotSymbol[]): void {
    this.slotMachine?.setDebugForceResult(symbols)
  }

  /** Enable debug-gated canvas reel draw/upload telemetry (#261 Phase 1). */
  public setReelsTelemetryEnabled(enabled: boolean): void {
    this.reelsLayer.setTelemetryEnabled(enabled)
  }

  public resetReelsTelemetry(): void {
    this.reelsLayer.resetTelemetry()
  }

  public getReelsTelemetry(): ReelsRenderTelemetrySnapshot {
    return this.reelsLayer.getTelemetry()
  }

  public isReelsSpinning(): boolean {
    return this.reelsLayer.isSpinning()
  }

  /** Start a long benchmark spin for reel draw/upload telemetry (debug / tests; bypasses slot-machine gating). */
  public debugStartReelsBenchmarkSpin(): void {
    this.reelsLayer.startBenchmarkSpin()
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

    this.lcdText.subscribeToEvents(bus)
  }

  /** Dispose all resources */
  dispose(): void {
    this.backbox.dispose()
    this.slotMachine?.dispose()
    this.borderGlow?.dispose()
    this.physicalLayer.dispose()
    this.shaderLayer.dispose()
    this.reelsLayer.dispose()
    this.videoLayer.dispose()
    this.imageLayer.dispose()
    this.characterTake.dispose()
    this.lcdOverlayLayer.dispose()
  }

  /** The character take URL currently requested and whether it has loaded (tests / e2e). */
  getCharacterTakeState(): { url: string; active: boolean } {
    return this.characterTake.getState()
  }
}
