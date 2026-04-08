/**
 * Display System - Media + Game State Presentation
 * 
 * A layered media presentation system for the pinball backbox display.
 * Supports video, images, procedural reels, and shader backgrounds with
 * state-based content switching.
 * 
 * Architecture:
 * - Layer 0: Procedural slot reels (deepest)
 * - Layer 1: Shader grid background
 * - Layer 2: Video (optional)
 * - Layer 3: Static image (optional)
 * - Layer 4: UI overlay with scanlines (front)
 * 
 * Media Pipeline:
 * 1. Config determines base mode (shader-only, image, video, hybrid)
 * 2. Game state can trigger media switches
 * 3. Fallback chain: video -> image -> reels
 * 4. All layers can be toggled independently
 */

import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture,
  VideoTexture,
  ShaderMaterial,
  ShaderLanguage,
} from '@babylonjs/core'
import { numberScrollShader } from '../shaders/numberScroll'
import { jackpotOverlayShader } from '../shaders/jackpotOverlay'
import { crtEffectShader, CRT_PRESETS, type CRTEffectParams } from '../shaders/crt-effect'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { Mesh } from '@babylonjs/core'
import {
  DisplayMode,
  DisplayState,
  type DisplayConfig,
  type StateMediaConfig,
  DEFAULT_DISPLAY_CONFIG,
  adaptLegacyConfig,
  getStateConfig,
} from './display-config'
import { GameConfig } from '../config'
import { color } from './visual-language'
import type {
  SlotMachineConfig,
  SlotMachineState,
  SlotEventType,
} from './types'
import { SlotActivationMode as SlotModeEnum, SlotSpinState as SpinStateEnum } from './types'

function lerp(start: number, end: number, t: number): number {
  return start * (1 - t) + end * t
}

function hexToColor3(hex: string): Color3 {
  return color(hex)
}

/** 
 * Media layer state tracking
 */
interface MediaLayerState {
  video: {
    loaded: boolean
    playing: boolean
    error: boolean
  }
  image: {
    loaded: boolean
    error: boolean
  }
}

/**
 * Current presentation state
 */
interface PresentationState {
  displayState: DisplayState
  mediaConfig: StateMediaConfig
  transitionProgress: number
  isTransitioning: boolean
}

export class DisplaySystem {
  private scene: Scene
  private useWGSL = false
  private config: DisplayConfig
  
  // Core state
  private currentState: PresentationState
  private layerState: MediaLayerState = {
    video: { loaded: false, playing: false, error: false },
    image: { loaded: false, error: false },
  }

  // Backbox position cache (for reactive layer reloads)
  private backboxPos: Vector3 | null = null
  private backboxScreenZ = 0

  // Currently loaded media paths (to detect state changes)
  private currentVideoPath = ''
  private currentImagePath = ''
  
  // Timers
  private stateTimer = 0
  private globalTime = 0
  
  // Track/story info (for Adventure mode)
  private currentStoryText = 'LINK ESTABLISHED'
  private currentTrackName = ''
  private trackProgress = 0
  private trackTransitionAlpha = 1.0
  
  // Visual layers (back to front)
  private layers: {
    reels: Mesh | null
    shader: Mesh | null
    video: Mesh | null
    crtEffect: Mesh | null
    image: Mesh | null
    overlay: Mesh | null
  } = { reels: null, shader: null, video: null, crtEffect: null, image: null, overlay: null }
  
  // Materials
  private reelMaterials: ShaderMaterial[] = []
  private reelOffsets: number[] = [0, 0, 0]
  private reelSpeeds: number[] = [0, 0, 0]
  private shaderMaterial: ShaderMaterial | null = null
  private jackpotShader: ShaderMaterial | null = null
  private standardOverlayMat: StandardMaterial | null = null
  private videoMaterial: StandardMaterial | null = null
  private imageMaterial: StandardMaterial | null = null
  private crtMaterial: ShaderMaterial | null = null
  
  // Textures
  private overlayTexture: DynamicTexture | null = null
  private slotTexture: DynamicTexture | null = null
  private videoTexture: VideoTexture | null = null
  
  // Slot machine state - LEGACY (kept for compatibility)
  private slotSymbols = ['7️⃣', '💎', '🍒', '🔔', '🍇', '⭐']
  private slotReels = [0, 0, 0]
  private slotSpeeds = [0, 0, 0]
  private slotMode = 0
  private slotStopTimer = 0
  
  // CRT Effect state
  private crtEffectActive = false
  private crtEffectTime = 0
  private crtEffectParams: CRTEffectParams = CRT_PRESETS.STORY
  
  // ============================================================================
  // ENHANCED SLOT MACHINE SYSTEM
  // ============================================================================
  
  /** Slot machine configuration */
  private slotConfig: SlotMachineConfig = {
    activationMode: SlotModeEnum.HYBRID,
    chancePercent: 0.3, // 30% chance
    scoreThreshold: 10000, // Every 10,000 points
    minSpinDuration: 1.0,
    maxSpinDuration: 3.0,
    reels: [
      { baseSpeed: 8, speedVariance: 2, stopDelay: 0 },
      { baseSpeed: 10, speedVariance: 3, stopDelay: 0.2 },
      { baseSpeed: 6, speedVariance: 1.5, stopDelay: 0.4 },
    ],
    winCombinations: [
      { symbol: '7️⃣', count: 3, multiplier: 10, isJackpot: true, name: 'JACKPOT' },
      { symbol: '💎', count: 3, multiplier: 5, isJackpot: false, name: 'Diamond Rush' },
      { symbol: '🔔', count: 3, multiplier: 3, isJackpot: false, name: 'Lucky Bells' },
      { symbol: '🍒', count: 3, multiplier: 2, isJackpot: false, name: 'Cherry Pick' },
      { symbol: '7️⃣', count: 2, multiplier: 2, isJackpot: false, name: 'Double Seven' },
    ],
    enableSounds: true,
    enableLightEffects: true,
  }
  
  /** Current slot machine state */
  private slotMachine: SlotMachineState = {
    spinState: SpinStateEnum.IDLE,
    stateTimer: 0,
    spinDuration: 2,
    reelSpeeds: [0, 0, 0],
    targetPositions: [0, 0, 0],
    reelsStopped: [false, false, false],
    finalSymbols: ['', '', ''],
    lastWin: null,
    spinsSinceJackpot: 0,
    slotScore: 0,
  }
  
  /** Callback for slot events (sound, scoring, etc.) */
  private onSlotEvent: ((event: SlotEventType, data?: unknown) => void) | null = null
  
  /** Last score checkpoint for threshold activation */
  private lastScoreCheckpoint = 0
  
  /** Current jackpot phase for display effects */
  private jackpotPhase = 0

  constructor(
    scene: Scene,
    engine: Engine | WebGPUEngine,
    config?: Partial<DisplayConfig>
  ) {
    this.scene = scene
    this.useWGSL = engine.getClassName() === 'WebGPUEngine' || 
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (engine as any).isWebGPU === true
    
    // Merge provided config with defaults, or use legacy adapter
    if (config) {
      this.config = { ...DEFAULT_DISPLAY_CONFIG, ...config }
    } else {
      // Adapt from legacy GameConfig
      this.config = adaptLegacyConfig(GameConfig.backbox)
    }
    
    // Initialize state
    this.currentState = {
      displayState: DisplayState.IDLE,
      mediaConfig: getStateConfig(this.config, DisplayState.IDLE),
      transitionProgress: 1.0,
      isTransitioning: false,
    }
  }

  // ============================================================================
  // SETUP & INITIALIZATION
  // ============================================================================

  createBackbox(pos: Vector3): void {
    const screenZ = pos.z + 0.5

    // Cache position for reactive reloads on state change
    this.backboxPos = pos
    this.backboxScreenZ = screenZ
    
    // Create reels immediately (procedural - fast)
    this.createReelsLayer(pos, screenZ)
    this.createShaderLayer(pos, screenZ)
    this.createOverlayLayer(pos, screenZ)
    this.createFrameStructure(pos)
    
    // Apply initial visibility based on config
    this.applyLayerVisibility(this.currentState.mediaConfig)
    
    // DEFER: Video/Image load after gameplay starts
    requestAnimationFrame(() => {
      this.createVideoLayer(pos, screenZ)
      this.createImageLayer(pos, screenZ)
      this.createCRTEffectLayer(pos, screenZ)
    })
  }

  private createFrameStructure(pos: Vector3): void {
    const frameMat = new StandardMaterial('frameMat', this.scene)
    frameMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
    frameMat.roughness = 0.6

    const chromeMat = new StandardMaterial('chromeMat', this.scene)
    chromeMat.diffuseColor = new Color3(0.8, 0.8, 0.9)
    chromeMat.specularColor = new Color3(1, 1, 1)
    chromeMat.roughness = 0.1

    const accentMat = new StandardMaterial('accentMat', this.scene)
    accentMat.diffuseColor = Color3.FromHexString('#00d9ff')
    accentMat.emissiveColor = Color3.FromHexString('#00d9ff').scale(0.4)

    // Main frame
    const frame = MeshBuilder.CreateBox('backboxFrame', { width: 24, height: 16, depth: 4 }, this.scene)
    frame.position.copyFrom(pos)
    frame.position.z -= 1
    frame.material = frameMat

    // Side pillars
    const leftPillar = MeshBuilder.CreateBox('leftPillar', { width: 2, height: 16, depth: 4.2 }, this.scene)
    leftPillar.position.set(pos.x - 11, pos.y, pos.z - 1)
    leftPillar.material = chromeMat

    const rightPillar = MeshBuilder.CreateBox('rightPillar', { width: 2, height: 16, depth: 4.2 }, this.scene)
    rightPillar.position.set(pos.x + 11, pos.y, pos.z - 1)
    rightPillar.material = chromeMat

    // Header
    const header = MeshBuilder.CreateBox('header', { width: 24, height: 2.5, depth: 4.2 }, this.scene)
    header.position.set(pos.x, pos.y + 7, pos.z - 1)
    header.material = chromeMat

    // Inner bezel
    const innerBezel = MeshBuilder.CreateBox('innerBezel', { width: 21, height: 13, depth: 0.5 }, this.scene)
    innerBezel.position.set(pos.x, pos.y, pos.z + 0.8)
    const innerBezelMat = new StandardMaterial('innerBezelMat', this.scene)
    innerBezelMat.diffuseColor = new Color3(0, 0, 0)
    innerBezelMat.emissiveColor = Color3.FromHexString('#ff0055').scale(0.1)
    innerBezel.material = innerBezelMat

    // Screen glass
    const screenGlass = MeshBuilder.CreateBox('screenGlass', { width: 20.2, height: 12.2, depth: 0.1 }, this.scene)
    screenGlass.position.set(pos.x, pos.y, pos.z + 1.2)
    const glassMat = new StandardMaterial('glassMat', this.scene)
    glassMat.diffuseColor = new Color3(0.9, 0.95, 1)
    glassMat.alpha = 0.15
    glassMat.specularColor = new Color3(1, 1, 1)
    glassMat.roughness = 0.05
    screenGlass.material = glassMat

    // LED strips
    this.createLEDStrip('topLED', pos.x, pos.y + 6.2, pos.z + 1.3, 18, 0.15, accentMat)
    this.createLEDStrip('bottomLED', pos.x, pos.y - 6.2, pos.z + 1.3, 18, 0.15, accentMat)
    this.createLEDStrip('leftLED', pos.x - 9.8, pos.y, pos.z + 1.3, 0.15, 12, accentMat)
    this.createLEDStrip('rightLED', pos.x + 9.8, pos.y, pos.z + 1.3, 0.15, 12, accentMat)
  }

  private createLEDStrip(name: string, x: number, y: number, z: number, w: number, h: number, mat: StandardMaterial): void {
    const led = MeshBuilder.CreateBox(name, { width: w, height: h, depth: 0.2 }, this.scene)
    led.position.set(x, y, z)
    led.material = mat
  }

  // ============================================================================
  // LAYER CREATION
  // ============================================================================

  private createReelsLayer(pos: Vector3, screenZ: number): void {
    if (this.useWGSL) {
      const gap = 7
      const numTexture = new Texture('./reel.png', this.scene)
      numTexture.wrapU = Texture.CLAMP_ADDRESSMODE
      numTexture.wrapV = Texture.WRAP_ADDRESSMODE

      for (let i = 0; i < 3; i++) {
        const reel = MeshBuilder.CreatePlane(`reel_${i}`, { width: 6, height: 10 }, this.scene)
        reel.position.set(pos.x + (i - 1) * gap, pos.y, screenZ - 0.3)
        reel.rotation.y = Math.PI

        const mat = new ShaderMaterial(`reelMat_${i}`, this.scene, {
          vertexSource: numberScrollShader.vertex,
          fragmentSource: numberScrollShader.fragment,
        }, {
          attributes: ['position', 'uv'],
          uniforms: ['worldViewProjection', 'uOffset', 'uSpeed', 'uColor'],
          samplers: ['myTexture', 'myTextureSampler'],
          shaderLanguage: ShaderLanguage.WGSL,
        })

        mat.setTexture('myTexture', numTexture)
        mat.setFloat('uOffset', 0)
        mat.setFloat('uSpeed', 0)
        mat.setColor3('uColor', new Color3(1, 0.8, 0.2))

        reel.material = mat
        this.reelMaterials.push(mat)
      }
      // Store reference to first reel as the reels layer
      this.layers.reels = this.scene.getMeshByName('reel_0') as Mesh | null
    } else {
      const mainDisplay = MeshBuilder.CreatePlane('backboxScreen', { width: 20, height: 12 }, this.scene)
      mainDisplay.position.set(pos.x, pos.y, screenZ - 0.3)
      mainDisplay.rotation.y = Math.PI

      const screenMat = new StandardMaterial('screenMat', this.scene)
      this.slotTexture = new DynamicTexture('slotTex', { width: 1024, height: 512 }, this.scene, true)
      this.slotTexture.hasAlpha = true
      screenMat.diffuseTexture = this.slotTexture
      screenMat.emissiveColor = Color3.White()
      mainDisplay.material = screenMat
      this.layers.reels = mainDisplay
    }
  }

  private createShaderLayer(pos: Vector3, screenZ: number): void {
    const bgLayer = MeshBuilder.CreatePlane('backboxBg', { width: 20, height: 12 }, this.scene)
    bgLayer.position.set(pos.x, pos.y, screenZ - 0.5)
    bgLayer.rotation.y = Math.PI

    const cyberShader = new ShaderMaterial('cyberBg', this.scene, {
      vertexSource: `
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 worldViewProjection;
        varying vec2 vUV;
        void main() {
          gl_Position = worldViewProjection * vec4(position, 1.0);
          vUV = uv;
        }
      `,
      fragmentSource: `
        uniform float time;
        uniform float speed;
        uniform vec3 colorTint;
        varying vec2 vUV;
        void main() {
          float t = time * speed;
          float gridX = step(0.95, fract(vUV.x * 20.0 + sin(t*0.5)*0.5));
          float gridY = step(0.95, fract(vUV.y * 10.0 + t));
          vec3 base = colorTint * 0.2;
          vec3 lines = colorTint * (gridX + gridY) * 0.8;
          float alpha = 0.05 + (gridX + gridY) * 0.4;
          gl_FragColor = vec4(base + lines, alpha);
        }
      `,
    }, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'time', 'speed', 'colorTint'],
      needAlphaBlending: true,
    })

    this.shaderMaterial = cyberShader
    bgLayer.material = cyberShader
    this.layers.shader = bgLayer
  }

  private disposeVideoLayer(): void {
    try {
      if (this.videoTexture?.video) {
        const videoEl = this.videoTexture.video as HTMLVideoElement
        try {
          videoEl.pause()
          videoEl.src = ''
          videoEl.load() // Force resource release
        } catch {
          // Ignore video element errors during cleanup
        }
        try {
          videoEl.remove() // Remove from DOM
        } catch {
          // Ignore DOM removal errors
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this.videoTexture as any).video = null
      }
      this.videoTexture?.dispose()
      this.videoMaterial?.dispose()
      this.layers.video?.dispose()
    } catch (err) {
      console.warn('[Display] Error during video layer disposal:', err)
    } finally {
      // Always reset state even if disposal fails
      this.videoTexture = null
      this.videoMaterial = null
      this.layers.video = null
      this.layerState.video = { loaded: false, playing: false, error: false }
    }
  }

  private disposeImageLayer(): void {
    this.imageMaterial?.diffuseTexture?.dispose()
    this.imageMaterial?.dispose()
    this.layers.image?.dispose()
    this.layers.image = null
    this.imageMaterial = null
    this.layerState.image = { loaded: false, error: false }
  }

  private createVideoLayer(pos: Vector3, screenZ: number): void {
    const config = this.currentState.mediaConfig
    if (!config.videoPath || this.config.mode === DisplayMode.SHADER_ONLY) {
      return
    }

    const videoPath = config.videoPath
    console.log(`[Display] Loading video: ${videoPath}`)

    // Create video element
    const videoEl = document.createElement('video')
    videoEl.src = videoPath
    videoEl.loop = this.config.videoSettings?.loop ?? true
    videoEl.muted = this.config.videoSettings?.muted ?? true
    videoEl.playsInline = true
    videoEl.crossOrigin = 'anonymous'
    videoEl.preload = 'auto'
    videoEl.style.display = 'none'
    document.body.appendChild(videoEl)

    // Create texture
    let videoTexture: VideoTexture
    try {
      videoTexture = new VideoTexture(
        'backboxVideoTex',
        videoEl,
        this.scene,
        false,
        true,
        VideoTexture.TRILINEAR_SAMPLINGMODE,
        { autoPlay: false, autoUpdateTexture: true }
      )
    } catch (err) {
      console.warn('[Display] Failed to create VideoTexture:', err)
      videoEl.remove()
      this.layerState.video.error = true
      return
    }

    // Create mesh
    const videoPlane = MeshBuilder.CreatePlane('backboxVideo', { width: 20, height: 12 }, this.scene)
    videoPlane.position.set(pos.x, pos.y, screenZ - 0.35)
    videoPlane.rotation.y = Math.PI

    const mat = new StandardMaterial('backboxVideoMat', this.scene)
    mat.diffuseTexture = videoTexture
    mat.emissiveTexture = videoTexture
    mat.emissiveColor = Color3.White()
    mat.backFaceCulling = false
    mat.disableLighting = true

    videoPlane.material = mat
    this.layers.video = videoPlane
    this.videoMaterial = mat
    this.videoTexture = videoTexture

    // Event handlers
    videoEl.addEventListener('canplay', () => {
      videoEl.play().then(() => {
        console.log('[Display] Video playing')
        this.layerState.video.loaded = true
        this.layerState.video.playing = true
        this.applyLayerVisibility(this.currentState.mediaConfig)
      }).catch(() => {
        console.warn('[Display] Video autoplay blocked')
        this.layerState.video.error = true
        this.disposeVideoLayer()
        this.applyLayerVisibility(this.currentState.mediaConfig)
      })
    })

    videoEl.addEventListener('error', () => {
      console.warn('[Display] Video failed to load')
      this.layerState.video.error = true
      this.disposeVideoLayer()
      this.applyLayerVisibility(this.currentState.mediaConfig)
    })

    // Timeout fallback
    const timeout = this.config.videoSettings?.loadTimeout ?? 5000
    setTimeout(() => {
      if (!this.layerState.video.loaded && !this.layerState.video.error) {
        console.warn('[Display] Video load timeout')
        this.layerState.video.error = true
        this.disposeVideoLayer()
        this.applyLayerVisibility(this.currentState.mediaConfig)
      }
    }, timeout)
  }

  private createImageLayer(pos: Vector3, screenZ: number): void {
    const config = this.currentState.mediaConfig
    const mode = this.config.mode
    
    // Skip if shader-only mode or no image path
    if (mode === DisplayMode.SHADER_ONLY || !config.imagePath) {
      return
    }

    const imagePath = config.imagePath
    console.log(`[Display] Loading image: ${imagePath}`)

    const imagePlane = MeshBuilder.CreatePlane('backboxImage', { width: 20, height: 12 }, this.scene)
    imagePlane.position.set(pos.x, pos.y, screenZ - 0.4)
    imagePlane.rotation.y = Math.PI

    const mat = new StandardMaterial('backboxImageMat', this.scene)
    const texture = new Texture(imagePath, this.scene, true, false)

    texture.onLoadObservable.add(() => {
      console.log(`[Display] Image loaded: ${imagePath}`)
      this.layerState.image.loaded = true
      
      const blendMode = this.config.imageSettings?.blendMode ?? 'normal'
      const opacity = config.opacity ?? this.config.imageSettings?.defaultOpacity ?? 0.85

      if (blendMode === 'additive') {
        mat.emissiveColor = Color3.White()
        mat.disableLighting = true
      } else if (blendMode === 'multiply') {
        mat.diffuseColor = new Color3(opacity, opacity, opacity)
      } else {
        mat.diffuseTexture = texture
        mat.emissiveTexture = texture
        mat.emissiveColor = new Color3(opacity, opacity, opacity)
        mat.diffuseColor = new Color3(opacity, opacity, opacity)
      }
      mat.alpha = opacity
    })

    // Error handling via timeout (Texture doesn't have onLoadErrorObservable)
    setTimeout(() => {
      if (!texture.isReady() && !this.layerState.image.loaded) {
        console.warn(`[Display] Image failed: ${imagePath}`)
        this.layerState.image.error = true
        imagePlane.dispose()
        mat.dispose()
      }
    }, this.config.videoSettings?.loadTimeout ?? 5000)

    mat.backFaceCulling = false
    mat.diffuseTexture = texture
    
    imagePlane.material = mat
    this.layers.image = imagePlane
    this.imageMaterial = mat
  }

  /**
   * Create CRT effect layer that sits on top of video for retro monitor look
   */
  private createCRTEffectLayer(pos: Vector3, screenZ: number): void {
    // Create a full-screen quad for CRT post-processing effect
    const crtPlane = MeshBuilder.CreatePlane('backboxCRTEffect', { width: 20, height: 12 }, this.scene)
    crtPlane.position.set(pos.x, pos.y, screenZ - 0.25)
    crtPlane.rotation.y = Math.PI
    crtPlane.isVisible = false // Hidden by default

    // Create CRT shader material
    const crtMat = new ShaderMaterial('crtMat', this.scene, {
      vertexSource: crtEffectShader.vertex,
      fragmentSource: crtEffectShader.fragment,
    }, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'uTime', 'uScanlineIntensity', 'uCurvature', 'uVignette', 'uChromaticAberration', 'uGlow', 'uNoise', 'uFlicker'],
      samplers: ['textureSampler'],
      needAlphaBlending: false,
    })

    // Set default params
    crtMat.setFloat('uTime', 0)
    crtMat.setFloat('uScanlineIntensity', this.crtEffectParams.scanlineIntensity)
    crtMat.setFloat('uCurvature', this.crtEffectParams.curvature)
    crtMat.setFloat('uVignette', this.crtEffectParams.vignette)
    crtMat.setFloat('uChromaticAberration', this.crtEffectParams.chromaticAberration)
    crtMat.setFloat('uGlow', this.crtEffectParams.glow)
    crtMat.setFloat('uNoise', this.crtEffectParams.noise)
    crtMat.setFloat('uFlicker', this.crtEffectParams.flicker)

    crtPlane.material = crtMat
    this.layers.crtEffect = crtPlane
    this.crtMaterial = crtMat
  }

  private createOverlayLayer(pos: Vector3, screenZ: number): void {
    const overlay = MeshBuilder.CreatePlane('backboxOverlay', { width: 20, height: 12 }, this.scene)
    overlay.position.set(pos.x, pos.y, screenZ - 0.05)
    overlay.rotation.y = Math.PI

    this.overlayTexture = new DynamicTexture('overlayTex', 512, this.scene, true)
    this.overlayTexture.hasAlpha = true

    this.standardOverlayMat = new StandardMaterial('overlayMat', this.scene)
    this.standardOverlayMat.diffuseTexture = this.overlayTexture
    this.standardOverlayMat.emissiveColor = Color3.White()
    this.standardOverlayMat.alpha = 0.99

    this.jackpotShader = new ShaderMaterial('jackpotMat', this.scene, {
      vertexSource: jackpotOverlayShader.vertex,
      fragmentSource: jackpotOverlayShader.fragment,
    }, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'uTime', 'uPhase', 'uGlitchIntensity', 'uCrackProgress', 'uShockwaveRadius'],
      samplers: ['myTexture'],
      needAlphaBlending: true,
    })
    this.jackpotShader.setTexture('myTexture', this.overlayTexture)

    overlay.material = this.standardOverlayMat
    this.layers.overlay = overlay
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  setDisplayState(newState: DisplayState, jackpotPhase = 0): void {
    if (this.currentState.displayState === newState) return

    console.log(`[Display] State change: ${this.currentState.displayState} -> ${newState}`)

    // Get new media config
    const newConfig = getStateConfig(this.config, newState)
    
    // Update current state
    this.currentState = {
      displayState: newState,
      mediaConfig: newConfig,
      transitionProgress: 0,
      isTransitioning: true,
    }

    this.stateTimer = 0
    this.jackpotPhase = jackpotPhase

    // Apply layer visibility changes
    this.applyLayerVisibility(newConfig)

    // Update slot mode
    this.updateSlotModeForState(newState)

    // Switch overlay material for jackpot
    if (this.layers.overlay) {
      if (newState === DisplayState.JACKPOT && this.jackpotShader) {
        this.layers.overlay.material = this.jackpotShader
      } else if (this.standardOverlayMat) {
        this.layers.overlay.material = this.standardOverlayMat
      }
    }
  }

  private updateSlotModeForState(state: DisplayState): void {
    switch (state) {
      case DisplayState.REACH:
        this.slotMode = 1
        this.slotSpeeds = [5, 5, 5]
        this.slotStopTimer = 2
        break
      case DisplayState.FEVER:
      case DisplayState.JACKPOT:
        this.slotMode = 2
        this.slotReels = [0.1, 0.4, 0.7]
        this.slotSpeeds = [2, 3, 4]
        break
      case DisplayState.ADVENTURE:
        this.slotMode = 0
        this.slotSpeeds = [0, 0, 0]
        break
      default:
        this.slotMode = 0
        this.slotSpeeds = [0, 0, 0]
    }
  }

  private applyLayerVisibility(config: StateMediaConfig): void {
    // Reels visibility
    if (this.layers.reels) {
      this.layers.reels.isVisible = config.showReels !== false
    }

    // Shader visibility  
    if (this.layers.shader) {
      this.layers.shader.isVisible = config.showShaderBackground !== false
    }

    const newVideoPath = (config.videoPath || '').trim()
    const newImagePath = (config.imagePath || '').trim()

    // Video layer: reload if path changed
    if (newVideoPath !== this.currentVideoPath) {
      this.currentVideoPath = newVideoPath
      if (this.layers.video || this.videoTexture) {
        this.disposeVideoLayer()
      }
      if (newVideoPath && this.backboxPos) {
        this.createVideoLayer(this.backboxPos, this.backboxScreenZ)
      }
    }

    // Image layer: reload if path changed
    if (newImagePath !== this.currentImagePath) {
      this.currentImagePath = newImagePath
      if (this.layers.image || this.imageMaterial) {
        this.disposeImageLayer()
      }
      if (newImagePath && this.backboxPos) {
        this.createImageLayer(this.backboxPos, this.backboxScreenZ)
      }
    }

    // Video visibility
    const wantsVideo = newVideoPath !== ''
    if (this.layers.video) {
      this.layers.video.isVisible = wantsVideo && this.layerState.video.playing
    }

    // Image visibility
    if (this.layers.image) {
      const wantsImage = newImagePath !== ''
      this.layers.image.isVisible = wantsImage && this.layerState.image.loaded && (!this.layerState.video.playing || this.config.mode === DisplayMode.HYBRID)
    }

    // Apply opacity
    if (this.videoMaterial && config.opacity !== undefined) {
      this.videoMaterial.alpha = config.opacity
      this.videoMaterial.emissiveColor = new Color3(config.opacity, config.opacity, config.opacity)
    }
    if (this.imageMaterial && config.opacity !== undefined) {
      this.imageMaterial.alpha = config.opacity
      const blendMode = this.config.imageSettings?.blendMode
      if (blendMode === 'normal') {
        this.imageMaterial.emissiveColor = new Color3(config.opacity, config.opacity, config.opacity)
        this.imageMaterial.diffuseColor = new Color3(config.opacity, config.opacity, config.opacity)
      }
    }
  }

  getDisplayState(): DisplayState {
    return this.currentState.displayState
  }

  // ============================================================================
  // MEDIA CONTROLS
  // ============================================================================

  playVideo(): void {
    if (this.videoTexture?.video && !this.layerState.video.playing) {
      this.videoTexture.video.play().catch(() => {})
      this.layerState.video.playing = true
    }
  }

  pauseVideo(): void {
    if (this.videoTexture?.video) {
      this.videoTexture.video.pause()
      this.layerState.video.playing = false
    }
  }

  setVideoOpacity(opacity: number): void {
    if (this.videoMaterial) {
      const clamped = Math.max(0, Math.min(1, opacity))
      this.videoMaterial.alpha = clamped
      this.videoMaterial.emissiveColor = new Color3(clamped, clamped, clamped)
    }
  }

  setImageOpacity(opacity: number): void {
    if (this.imageMaterial) {
      const clamped = Math.max(0, Math.min(1, opacity))
      this.imageMaterial.alpha = clamped
      this.imageMaterial.emissiveColor = new Color3(clamped, clamped, clamped)
      this.imageMaterial.diffuseColor = new Color3(clamped, clamped, clamped)
    }
  }

  setStoryText(text: string): void {
    this.currentStoryText = text
    this.updateOverlay()
  }

  /**
   * Load and play a story video from URL
   * Gracefully handles missing videos by logging a warning and continuing
   */
  loadAndPlayVideo(url: string): void {
    if (!url) {
      console.log('[Display] No video URL provided, skipping video playback')
      return
    }
    
    if (this.videoTexture?.video) {
      try {
        const videoEl = this.videoTexture.video as HTMLVideoElement
        videoEl.src = url
        videoEl.load()
        this.playVideo()
      } catch (err) {
        console.warn('[Display] Failed to load video:', url, err)
        // Continue without video - game should not crash
      }
    } else {
      console.log('[Display] Video texture not available, skipping video playback')
    }
  }

  /**
   * Trigger CRT flash effect on the backbox
   */
  triggerCRTFlash(): void {
    // Flash the overlay white then fade back
    if (this.standardOverlayMat) {
      const originalColor = this.standardOverlayMat.emissiveColor.clone()
      this.standardOverlayMat.emissiveColor = new Color3(1, 1, 1)
      setTimeout(() => {
        if (this.standardOverlayMat) {
          this.standardOverlayMat.emissiveColor = originalColor
        }
      }, 100)
    }
  }

  /**
   * Show zone entry story with video and CRT effect
   * Called when entering a new zone in Dynamic Adventure Mode
   */
  showZoneStory(zoneName: string, storyText: string, videoUrl?: string, enableCRT = true): void {
    console.log(`[Display] Zone entry: ${zoneName}`)
    
    // Update story text
    this.currentStoryText = storyText
    this.currentTrackName = zoneName
    this.trackTransitionAlpha = 0
    
    // Load and play video if provided
    if (videoUrl) {
      this.loadAndPlayVideo(videoUrl)
    }
    
    // Enable/disable CRT effect
    this.setCRTEffectEnabled(enableCRT)
    
    // Trigger flash effect
    this.triggerCRTFlash()
    
    // Update overlay
    this.updateOverlay()
  }

  /**
   * Enable/disable CRT effect overlay
   */
  setCRTEffectEnabled(enabled: boolean): void {
    this.crtEffectActive = enabled
    if (this.layers.crtEffect) {
      this.layers.crtEffect.isVisible = enabled
    }
    
    // When CRT is enabled on video, we need to use the video texture in the CRT shader
    if (enabled && this.crtMaterial && this.videoTexture) {
      this.crtMaterial.setTexture('textureSampler', this.videoTexture)
    }
  }

  /**
   * Set CRT effect parameters
   */
  setCRTEffectParams(params: Partial<CRTEffectParams>): void {
    this.crtEffectParams = { ...this.crtEffectParams, ...params }
    
    if (this.crtMaterial) {
      this.crtMaterial.setFloat('uScanlineIntensity', this.crtEffectParams.scanlineIntensity)
      this.crtMaterial.setFloat('uCurvature', this.crtEffectParams.curvature)
      this.crtMaterial.setFloat('uVignette', this.crtEffectParams.vignette)
      this.crtMaterial.setFloat('uChromaticAberration', this.crtEffectParams.chromaticAberration)
      this.crtMaterial.setFloat('uGlow', this.crtEffectParams.glow)
      this.crtMaterial.setFloat('uNoise', this.crtEffectParams.noise)
      this.crtMaterial.setFloat('uFlicker', this.crtEffectParams.flicker)
    }
  }

  setTrackInfo(trackName: string, progress = 0): void {
    this.currentTrackName = trackName
    this.trackProgress = Math.max(0, Math.min(1, progress))
    this.trackTransitionAlpha = 0
  }

  // ============================================================================
  // UPDATE LOOP
  // ============================================================================

  update(dt: number, jackpotPhase = 0): void {
    this.globalTime += dt
    this.stateTimer += dt
    this.jackpotPhase = jackpotPhase

    // Handle transitions
    if (this.currentState.isTransitioning) {
      const fadeDuration = this.config.transitions?.fadeDuration ?? 0.3
      this.currentState.transitionProgress += dt / fadeDuration
      
      if (this.currentState.transitionProgress >= 1) {
        this.currentState.transitionProgress = 1
        this.currentState.isTransitioning = false
      }
    }

    // Animate track transition
    if (this.trackTransitionAlpha < 1) {
      this.trackTransitionAlpha = Math.min(1, this.trackTransitionAlpha + dt * 2.5)
    }

    // Update shader
    this.updateShader()

    // Update jackpot shader
    if (this.currentState.displayState === DisplayState.JACKPOT) {
      this.updateJackpotShader()
    }

    // Update CRT effect shader
    if (this.crtEffectActive && this.crtMaterial) {
      this.crtEffectTime += dt
      this.crtMaterial.setFloat('uTime', this.crtEffectTime)
    }

    // Update enhanced slot machine
    this.updateSlotMachine(dt)

    // Update legacy slots for rendering (unless in Adventure mode)
    if (this.currentState.displayState !== DisplayState.ADVENTURE) {
      this.updateSlots(dt)
    }

    // Update overlay
    this.updateOverlay()
  }

  private updateShader(): void {
    if (!this.shaderMaterial) return

    const config = this.currentState.mediaConfig
    const params = config.shaderParams

    this.shaderMaterial.setFloat('time', this.globalTime)
    this.shaderMaterial.setFloat('speed', params?.speed ?? 0.5)
    this.shaderMaterial.setColor3('colorTint', hexToColor3(params?.color ?? '#00ffd9'))
  }

  private updateJackpotShader(): void {
    if (!this.jackpotShader) return

    this.jackpotShader.setFloat('uTime', this.globalTime)
    this.jackpotShader.setInt('uPhase', this.jackpotPhase)

    let glitch = 0
    let crack = 0
    let shock = 0

    if (this.jackpotPhase === 1) {
      glitch = 0.1
      crack = Math.min(1, this.stateTimer * 0.5)
    } else if (this.jackpotPhase === 2) {
      glitch = 0.5
      crack = 1
    } else if (this.jackpotPhase === 3) {
      shock = (this.stateTimer - 5) * 0.5
    }

    this.jackpotShader.setFloat('uGlitchIntensity', glitch)
    this.jackpotShader.setFloat('uCrackProgress', crack)
    this.jackpotShader.setFloat('uShockwaveRadius', shock)
  }

  private updateSlots(dt: number): void {
    if (this.useWGSL) {
      this.updateWGSLReels(dt)
    } else {
      this.updateCanvasReels(dt)
    }

    // Handle slot mode transitions
    if (this.slotMode === 1) {
      this.slotStopTimer -= dt
      if (this.slotStopTimer <= 0) {
        this.slotMode = 2
        this.slotSpeeds = [0, 5, 5]
      }
    }

    if (this.slotMode === 2 && this.currentState.displayState === DisplayState.REACH) {
      const stopped = this.useWGSL
        ? this.reelSpeeds.every(s => s === 0)
        : this.slotSpeeds.every(s => s === 0)
      
      if (stopped) {
        this.setDisplayState(DisplayState.FEVER)
      }
    }

    if (this.currentState.displayState === DisplayState.FEVER && this.stateTimer > 6) {
      this.setDisplayState(DisplayState.IDLE)
    }
  }

  private updateWGSLReels(dt: number): void {
    for (let i = 0; i < 3; i++) {
      const mat = this.reelMaterials[i]

      if (this.slotMode === 1) {
        this.reelSpeeds[i] = lerp(this.reelSpeeds[i], 8, dt * 2)
      } else if (this.slotMode === 2) {
        const symbolHeight = 1 / 6
        this.reelSpeeds[i] = Math.max(0.5, this.reelSpeeds[i] - dt * 4)

        if (this.reelSpeeds[i] <= 1) {
          const targetIndex = Math.round(this.reelOffsets[i] / symbolHeight)
          const targetOffset = targetIndex * symbolHeight
          const diff = targetOffset - this.reelOffsets[i]

          if (Math.abs(diff) < 0.005) {
            this.reelOffsets[i] = targetOffset
            this.reelSpeeds[i] = 0
          } else {
            this.reelSpeeds[i] = diff * 10
          }
        }
      }

      this.reelOffsets[i] += this.reelSpeeds[i] * dt
      mat.setFloat('uOffset', this.reelOffsets[i])
      mat.setFloat('uSpeed', Math.abs(this.reelSpeeds[i]))
    }
  }

  private updateCanvasReels(dt: number): void {
    if (!this.slotTexture) return

    for (let i = 0; i < 3; i++) {
      this.slotReels[i] += this.slotSpeeds[i] * dt
      this.slotReels[i] %= 1

      if (this.slotMode === 2 && this.slotSpeeds[i] > 0 && this.slotSpeeds[i] < 0.5) {
        const snap = Math.round(this.slotReels[i] * this.slotSymbols.length) / this.slotSymbols.length
        if (Math.abs(this.slotReels[i] - snap) < 0.01) {
          this.slotReels[i] = snap
          this.slotSpeeds[i] = 0
        }
      }
    }

    this.drawSlots()
  }

  private drawSlots(): void {
    if (!this.slotTexture) return

    const ctx = this.slotTexture.getContext() as CanvasRenderingContext2D
    const w = 1024
    const h = 512

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    const reelW = w / 3
    ctx.font = 'bold 140px Orbitron, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let i = 0; i < 3; i++) {
      const centerX = i * reelW + reelW / 2
      const offset = this.slotReels[i]
      const totalSyms = this.slotSymbols.length
      const rawIdx = offset * totalSyms
      const baseIdx = Math.floor(rawIdx)
      const subOffset = rawIdx - baseIdx

      for (let row = -1; row <= 1; row++) {
        let symIdx = (baseIdx - row) % totalSyms
        if (symIdx < 0) symIdx += totalSyms
        const symbol = this.slotSymbols[symIdx]
        const y = h / 2 + row * 180 + subOffset * 180

        ctx.fillStyle = this.slotMode === 0 && row === 0 ? '#fff' : '#888'
        if (this.currentState.displayState === DisplayState.FEVER && row === 0) {
          ctx.fillStyle = '#ff0'
          ctx.shadowBlur = 40
          ctx.shadowColor = '#fa0'
        } else {
          ctx.shadowBlur = 0
        }
        ctx.fillText(symbol, centerX, y)
      }
    }

    this.slotTexture.update()
  }

  private updateOverlay(): void {
    if (!this.overlayTexture) return

    const ctx = this.overlayTexture.getContext() as CanvasRenderingContext2D
    const w = 512
    const h = 512
    ctx.clearRect(0, 0, w, h)

    const time = this.globalTime
    const state = this.currentState.displayState

    switch (state) {
      case DisplayState.ADVENTURE:
        this.drawAdventureOverlay(ctx, w, h, time)
        break
      case DisplayState.IDLE:
        this.drawIdleOverlay(ctx, w, h, time)
        break
      case DisplayState.REACH:
        this.drawReachOverlay(ctx, w, h, time)
        break
      case DisplayState.FEVER:
        this.drawFeverOverlay(ctx, w, h)
        break
      case DisplayState.JACKPOT:
        this.drawJackpotOverlay(ctx, w, h)
        break
    }

    // Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 2)
    }

    this.overlayTexture.update()
  }

  private drawAdventureOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const alpha = this.trackTransitionAlpha

    // Live feed box
    ctx.strokeStyle = `rgba(0, 255, 0, ${0.5 * alpha})`
    ctx.lineWidth = 4
    ctx.strokeRect(40, 40, w - 80, h - 160)

    // REC indicator
    if (Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = 'red'
      ctx.beginPath()
      ctx.arc(60, 60, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.font = '20px Orbitron'
      ctx.fillText('LIVE', 80, 66)
    }

    // Track name
    if (this.currentTrackName) {
      ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`
      ctx.font = 'bold 24px Orbitron'
      ctx.textAlign = 'center'
      ctx.shadowBlur = 12
      ctx.shadowColor = '#0ff'
      ctx.fillText(this.currentTrackName, w / 2, 80)
      ctx.shadowBlur = 0
    }

    // Progress bar
    if (this.trackProgress > 0) {
      ctx.fillStyle = `rgba(0, 255, 0, ${0.2 * alpha})`
      ctx.fillRect(60, 100, w - 120, 8)
      ctx.fillStyle = `rgba(0, 255, 255, ${0.8 * alpha})`
      ctx.fillRect(60, 100, (w - 120) * this.trackProgress, 8)
    }

    // Story text
    ctx.fillStyle = `rgba(204, 255, 204, ${alpha})`
    ctx.font = '28px Orbitron'
    ctx.textAlign = 'center'
    ctx.shadowBlur = 10
    ctx.shadowColor = '#0f0'
    ctx.fillText(this.currentStoryText, w / 2, h - 60)
    ctx.shadowBlur = 0
  }

  private drawIdleOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    if (Math.floor(time) % 5 === 0) {
      ctx.fillStyle = 'rgba(0, 255, 255, 0.1)'
      const x = (time * 50) % w
      ctx.fillRect(x, h / 2 - 20, 40, 40)
      ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'
      ctx.font = '20px Orbitron'
      ctx.fillText('SYSTEM READY', x + 20, h / 2 + 40)
    }
  }

  private drawReachOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const flash = Math.sin(time * 10) > 0
    if (flash) {
      ctx.fillStyle = 'rgba(255, 0, 85, 0.8)'
      ctx.font = 'bold 60px Orbitron, Arial'
      ctx.textAlign = 'center'
      ctx.shadowBlur = 20
      ctx.shadowColor = '#f05'
      ctx.fillText('REACH!', w / 2, h / 2)
    }

    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, 150 + Math.sin(time * 5) * 20, 0, Math.PI * 2)
    ctx.stroke()
  }

  private drawFeverOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(255, 215, 0, 1)'
    ctx.font = 'bold 70px Orbitron, Arial'
    ctx.textAlign = 'center'
    ctx.shadowBlur = 30
    ctx.shadowColor = '#ffd700'
    ctx.fillText('FEVER MODE', w / 2, h / 2)
    ctx.shadowBlur = 0
  }

  private drawJackpotOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h)

    let phase = 0
    if (this.stateTimer < 2) phase = 1
    else if (this.stateTimer < 5) phase = 2
    else phase = 3

    ctx.textAlign = 'center'

    if (phase === 1) {
      ctx.fillStyle = 'red'
      ctx.font = 'bold 60px Orbitron'
      ctx.fillText('WARNING', w / 2, h / 2 - 40)
      ctx.font = '30px Orbitron'
      ctx.fillText('CORE UNSTABLE', w / 2, h / 2 + 40)
    } else if (phase === 2) {
      const countdown = Math.ceil(5 - this.stateTimer)
      ctx.fillStyle = 'white'
      ctx.font = 'bold 150px Orbitron'
      ctx.fillText(String(countdown), w / 2, h / 2 + 50)
    } else if (phase === 3) {
      ctx.fillStyle = '#FFD700'
      ctx.font = 'bold 80px Orbitron'
      ctx.shadowBlur = 50
      ctx.shadowColor = 'white'
      ctx.fillText('JACKPOT', w / 2, h / 2)
      ctx.shadowBlur = 0
    }
  }

  // ============================================================================
  // ENHANCED SLOT MACHINE METHODS
  // ============================================================================

  /**
   * Set callback for slot machine events
   */
  setSlotEventCallback(callback: (event: import('./types').SlotEventType, data?: unknown) => void): void {
    this.onSlotEvent = callback
  }

  /**
   * Configure slot machine settings
   */
  configureSlotMachine(config: Partial<SlotMachineConfig>): void {
    this.slotConfig = { ...this.slotConfig, ...config }
  }

  /**
   * Check if slot machine should activate based on current mode and score
   */
  shouldActivateSlotMachine(currentScore: number): boolean {
    const mode = this.slotConfig.activationMode
    
    switch (mode) {
      case SlotModeEnum.ALWAYS:
        return true
        
      case SlotModeEnum.CHANCE: {
        const chance = Math.random() < this.slotConfig.chancePercent
        if (chance) {
          this.emitSlotEvent('activation-chance', { mode: 'chance' })
        } else {
          this.emitSlotEvent('activation-denied', { mode: 'chance', percent: this.slotConfig.chancePercent })
        }
        return chance
      }
        
      case SlotModeEnum.SCORE: {
        const scoreDiff = currentScore - this.lastScoreCheckpoint
        if (scoreDiff >= this.slotConfig.scoreThreshold) {
          this.lastScoreCheckpoint = currentScore
          this.emitSlotEvent('activation-chance', { mode: 'score', threshold: this.slotConfig.scoreThreshold })
          return true
        }
        return false
      }
        
      case SlotModeEnum.HYBRID: {
        // Check score threshold first, then chance
        const hybridScoreDiff = currentScore - this.lastScoreCheckpoint
        if (hybridScoreDiff >= this.slotConfig.scoreThreshold) {
          const hybridChance = Math.random() < this.slotConfig.chancePercent
          if (hybridChance) {
            this.lastScoreCheckpoint = currentScore
            this.emitSlotEvent('activation-chance', { mode: 'hybrid-score', threshold: this.slotConfig.scoreThreshold })
            return true
          }
        }
        return false
      }
        
      default:
        return true
    }
  }

  /**
   * Start a new slot machine spin
   */
  startSlotSpin(): void {
    if (this.slotMachine.spinState !== SpinStateEnum.IDLE && 
        this.slotMachine.spinState !== SpinStateEnum.STOPPED) {
      return // Already spinning
    }

    // Random spin duration between min and max
    const duration = this.slotConfig.minSpinDuration + 
      Math.random() * (this.slotConfig.maxSpinDuration - this.slotConfig.minSpinDuration)
    
    // Random target positions for each reel
    const targetPositions: number[] = []
    const finalSymbols: string[] = []
    
    for (let i = 0; i < 3; i++) {
      // Random symbol index
      const symbolIndex = Math.floor(Math.random() * this.slotSymbols.length)
      // Convert to normalized position (0-1)
      const position = symbolIndex / this.slotSymbols.length
      targetPositions.push(position)
      finalSymbols.push(this.slotSymbols[symbolIndex])
    }

    // Variable reel speeds with variance
    const reelSpeeds = this.slotConfig.reels.map(reel => {
      const variance = (Math.random() - 0.5) * 2 * reel.speedVariance
      return reel.baseSpeed + variance
    })

    this.slotMachine = {
      ...this.slotMachine,
      spinState: SpinStateEnum.SPINNING,
      stateTimer: 0,
      spinDuration: duration,
      reelSpeeds,
      targetPositions,
      reelsStopped: [false, false, false],
      finalSymbols,
      lastWin: null,
    }

    // Set legacy slot mode for compatibility
    this.slotMode = 1
    this.slotSpeeds = reelSpeeds

    this.emitSlotEvent('spin-start', { 
      duration, 
      speeds: reelSpeeds,
      targets: finalSymbols 
    })
  }

  /**
   * Update slot machine state - called from main update loop
   */
  private updateSlotMachine(dt: number): void {
    const slot = this.slotMachine
    
    if (slot.spinState === SpinStateEnum.IDLE || 
        slot.spinState === SpinStateEnum.STOPPED) {
      return
    }

    slot.stateTimer += dt

    // Check if it's time to start stopping reels
    if (slot.spinState === SpinStateEnum.SPINNING) {
      if (slot.stateTimer >= slot.spinDuration) {
        slot.spinState = SpinStateEnum.STOPPING
        this.emitSlotEvent('spin-stop', { duration: slot.stateTimer })
      }
    }

    // Handle stopping phase - stop reels one by one with delays
    if (slot.spinState === SpinStateEnum.STOPPING) {
      for (let i = 0; i < 3; i++) {
        if (!slot.reelsStopped[i]) {
          const stopTime = this.slotConfig.reels[i].stopDelay
          if (slot.stateTimer >= slot.spinDuration + stopTime) {
            slot.reelsStopped[i] = true
            this.slotSpeeds[i] = 0 // Stop this reel
            this.emitSlotEvent('reel-stop', { reel: i, symbol: slot.finalSymbols[i] })
            
            // Check if all reels stopped
            if (slot.reelsStopped.every(stopped => stopped)) {
              slot.spinState = SpinStateEnum.STOPPED
              this.checkWinCombination()
            }
          }
        }
      }
    }

    // Update legacy reel speeds for rendering
    for (let i = 0; i < 3; i++) {
      if (!slot.reelsStopped[i]) {
        // Gradually slow down as we approach stop time
        const timeUntilStop = (slot.spinDuration + this.slotConfig.reels[i].stopDelay) - slot.stateTimer
        if (timeUntilStop < 0.5 && timeUntilStop > 0) {
          // Slow down
          this.slotSpeeds[i] = slot.reelSpeeds[i] * (timeUntilStop / 0.5)
        }
      }
    }

    // Update legacy slot mode for compatibility
    if (slot.spinState === SpinStateEnum.SPINNING) {
      this.slotMode = 1
    } else if (slot.spinState === SpinStateEnum.STOPPING || 
               slot.spinState === SpinStateEnum.STOPPED) {
      this.slotMode = 2
    }
  }

  /**
   * Check for winning combinations after reels stop
   */
  private checkWinCombination(): void {
    const symbols = this.slotMachine.finalSymbols
    
    // Check each winning combination
    for (const combo of this.slotConfig.winCombinations) {
      const matchingCount = symbols.filter(s => s === combo.symbol).length
      
      if (matchingCount >= combo.count) {
        this.slotMachine.lastWin = combo
        this.slotMachine.spinsSinceJackpot = 0
        this.slotMachine.slotScore += combo.multiplier * 100
        
        if (combo.isJackpot) {
          this.slotMachine.spinState = SpinStateEnum.JACKPOT
          this.emitSlotEvent('jackpot', { 
            combination: combo,
            symbols,
            score: combo.multiplier * 100 
          })
        } else {
          this.emitSlotEvent('win', { 
            combination: combo,
            symbols,
            score: combo.multiplier * 100 
          })
        }
        return
      }
    }

    // Check for near miss (2 matching symbols of jackpot symbol)
    const jackpotSymbol = this.slotConfig.winCombinations.find(c => c.isJackpot)?.symbol
    if (jackpotSymbol) {
      const jackpotCount = symbols.filter(s => s === jackpotSymbol).length
      if (jackpotCount === 2) {
        this.emitSlotEvent('near-miss', { symbols, count: 2, symbol: jackpotSymbol })
      }
    }

    this.slotMachine.spinsSinceJackpot++
  }

  /**
   * Get current slot machine state for external access
   */
  getSlotMachineState(): SlotMachineState {
    return { ...this.slotMachine }
  }

  /**
   * Get slot machine configuration
   */
  getSlotConfig(): SlotMachineConfig {
    return { ...this.slotConfig }
  }

  /**
   * Reset slot machine state
   */
  resetSlotMachine(): void {
    this.slotMachine = {
      spinState: SpinStateEnum.IDLE,
      stateTimer: 0,
      spinDuration: 2,
      reelSpeeds: [0, 0, 0],
      targetPositions: [0, 0, 0],
      reelsStopped: [false, false, false],
      finalSymbols: ['', '', ''],
      lastWin: null,
      spinsSinceJackpot: 0,
      slotScore: 0,
    }
    this.lastScoreCheckpoint = 0
  }

  /**
   * Emit slot event through callback
   */
  private emitSlotEvent(event: import('./types').SlotEventType, data?: unknown): void {
    if (this.onSlotEvent) {
      this.onSlotEvent(event, data)
    }
  }

  /**
   * Check if currently in jackpot state from slot machine
   */
  isSlotJackpot(): boolean {
    return this.slotMachine.spinState === SpinStateEnum.JACKPOT
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  dispose(): void {
    this.disposeVideoLayer()
    
    this.layers.image?.dispose()
    this.imageMaterial?.dispose()
    
    this.layers.reels?.dispose()
    this.layers.shader?.dispose()
    this.layers.overlay?.dispose()
    
    this.overlayTexture?.dispose()
    this.slotTexture?.dispose()
    
    this.reelMaterials.forEach(m => m.dispose())
    this.reelMaterials = []
  }
}

// Re-export types for convenience
export { DisplayMode, DisplayState, type DisplayConfig, type StateMediaConfig }
