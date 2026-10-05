/**
 * Display System Types
 *
 * Core types, enums and default configuration for the backbox display system.
 * `DisplayState` / `DisplayMode` live here (not in game-elements) so the kernel
 * event bus and every display consumer share one home (#441). Babylon types are
 * imported type-only, so this module has no runtime Babylon dependency.
 */

import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { VideoTexture } from '@babylonjs/core/Materials/Textures/videoTexture'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'

/** Display mode - controls the base media pipeline */
export enum DisplayMode {
  /** Procedural reels + shader grid only (no external media) */
  SHADER_ONLY = 'shader-only',
  /** Static image over shader background */
  IMAGE = 'image',
  /** Looping video (optionally over shader background) */
  VIDEO = 'video',
  /** All layers active - video/image + shader + reels */
  HYBRID = 'hybrid',
}

/** Display states that can trigger different media */
export enum DisplayState {
  IDLE = 'idle',
  REACH = 'reach',
  FEVER = 'fever',
  ADVENTURE = 'adventure',
  JACKPOT = 'jackpot',
  /** Exit portal is live — success path. Cyan wormhole treatment. */
  PORTAL_OPEN = 'portal_open',
  /** Time-out escape portal. Redder, urgent treatment. */
  ESCAPE = 'escape',
}

/** Blend modes for image layers */
export type ImageBlendMode = 'normal' | 'additive' | 'multiply'

/** 
 * Media configuration for a specific display state.
 * Allows different media to play during different game states.
 */
export interface StateMediaConfig {
  /** 
   * Path to video file (relative to public/)
   * Set to empty string to disable video for this state
   */
  videoPath?: string
  
  /**
   * Path to image file (relative to public/)
   * Used as fallback if video fails, or as overlay
   */
  imagePath?: string
  
  /**
   * If true, shader grid is visible behind media
   * If false, media covers the shader (black background)
   */
  showShaderBackground?: boolean
  
  /**
   * If true, slot reels are visible behind media
   * If false, media covers the reels
   */
  showReels?: boolean
  
  /**
   * Opacity of the media layer (0.0 - 1.0)
   */
  opacity?: number

  /**
   * Optional per-state character / physical-drum take (video or poster image).
   * When unset or load fails, the LCD overlay emoji walk-by remains the fallback.
   */
  characterLayer?: string
  
  /**
   * Custom shader parameters for this state
   */
  shaderParams?: {
    /** Grid animation speed multiplier */
    speed?: number
    /** Grid color as hex string */
    color?: string
  }
}

/**
 * Main display configuration interface
 * 
 * Example usage:
 * ```typescript
 * const config: DisplayConfig = {
 *   mode: DisplayMode.HYBRID,
 *   defaultMedia: {
 *     videoPath: 'backbox/attract-loop.mp4',
 *     imagePath: 'backbox/attract-fallback.png',
 *     showShaderBackground: true,
 *     showReels: false,
 *   },
 *   stateMedia: {
 *     [DisplayState.JACKPOT]: {
 *       videoPath: 'backbox/jackpot-explosion.mp4',
 *       showShaderBackground: false,
 *       shaderParams: { speed: 20, color: '#ff00ff' },
 *     },
 *     [DisplayState.ADVENTURE]: {
 *       imagePath: 'backbox/adventure-overlay.png',
 *       showReels: false,
 *       shaderParams: { speed: 1, color: '#00aa00' },
 *     },
 *   },
 * }
 * ```
 */
export interface DisplayConfig {
  /** Base display mode */
  mode: DisplayMode

  /** Physical width of the backbox display */
  width: number

  /** Physical height of the backbox display */
  height: number

  /** Texture resolution */
  resolution: number
  
  /** 
   * Default media configuration (IDLE state and fallback)
   * If not provided, uses shader-only
   */
  defaultMedia?: StateMediaConfig
  
  /**
   * Per-state media overrides
   * When state changes, these settings merge with defaultMedia
   */
  stateMedia?: Partial<Record<DisplayState, StateMediaConfig>>
  
  /**
   * Global image settings
   */
  imageSettings?: {
    /** Default blend mode for images */
    blendMode?: ImageBlendMode
    /** Default opacity for images */
    defaultOpacity?: number
  }
  
  /**
   * Global video settings
   */
  videoSettings?: {
    /** If true, video loops automatically */
    loop?: boolean
    /** If true, video starts muted (required for autoplay) */
    muted?: boolean
    /** Timeout in ms before giving up on video load */
    loadTimeout?: number
  }
  
  /**
   * Transition settings between states
   */
  transitions?: {
    /** Duration of crossfade between media (seconds) */
    fadeDuration?: number
    /** If true, shader color transitions smoothly */
    animateShaderParams?: boolean
  }
}

/**
 * Default display configuration
 * Used when no config is provided or as base for partial configs
 */
export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  mode: DisplayMode.SHADER_ONLY,
  width: 20,
  height: 12,
  resolution: 512,
  defaultMedia: {
    videoPath: '',
    imagePath: '',
    showShaderBackground: true,
    showReels: true,
    opacity: 1.0,
    shaderParams: {
      speed: 0.5,
      color: '#00ffd9',
    },
  },
  stateMedia: {
    [DisplayState.REACH]: {
      showShaderBackground: true,
      showReels: true,
      shaderParams: { speed: 5.0, color: '#ff0055' },
    },
    [DisplayState.FEVER]: {
      showShaderBackground: true,
      showReels: true,
      shaderParams: { speed: 10.0, color: '#ffd700' },
    },
    [DisplayState.JACKPOT]: {
      showShaderBackground: true,
      showReels: false,
      shaderParams: { speed: 20.0, color: '#ff00ff' },
    },
    [DisplayState.ADVENTURE]: {
      showShaderBackground: true,
      showReels: false,
      shaderParams: { speed: 1.0, color: '#00aa00' },
    },
    [DisplayState.PORTAL_OPEN]: {
      showShaderBackground: true,
      showReels: false,
      shaderParams: { speed: 18.0, color: '#00d9ff' },
    },
    [DisplayState.ESCAPE]: {
      showShaderBackground: true,
      showReels: false,
      shaderParams: { speed: 10.0, color: '#ff4400' },
    },
  },
  imageSettings: {
    blendMode: 'normal',
    defaultOpacity: 0.85,
  },
  videoSettings: {
    loop: true,
    muted: true,
    loadTimeout: 5000,
  },
  transitions: {
    fadeDuration: 0.3,
    animateShaderParams: true,
  },
}

/**
 * Legacy config adapter
 * Converts old GameConfig.backbox format to new DisplayConfig
 */
export function adaptLegacyConfig(legacyConfig: {
  attractVideoPath?: string
  videoReplacesReels?: boolean
  attractImagePath?: string
  imageOpacity?: number
  imageBlendMode?: ImageBlendMode
  jackpotVideoPath?: string
  feverVideoPath?: string
  reachVideoPath?: string
  adventureVideoPath?: string
  jackpotImagePath?: string
  feverImagePath?: string
  reachImagePath?: string
  adventureImagePath?: string
  idleCharacterPath?: string
  reachCharacterPath?: string
  feverCharacterPath?: string
  jackpotCharacterPath?: string
}): DisplayConfig {
  const hasVideo = legacyConfig.attractVideoPath && legacyConfig.attractVideoPath.trim() !== ''
  const hasImage = legacyConfig.attractImagePath && legacyConfig.attractImagePath.trim() !== ''
  
  let mode = DisplayMode.SHADER_ONLY
  if (hasVideo) mode = DisplayMode.VIDEO
  else if (hasImage) mode = DisplayMode.IMAGE
  
  return {
    mode,
    width: 20,
    height: 12,
    resolution: 512,
    defaultMedia: {
      videoPath: legacyConfig.attractVideoPath || '',
      imagePath: legacyConfig.attractImagePath || '',
      characterLayer: legacyConfig.idleCharacterPath || '',
      showShaderBackground: true,
      showReels: !legacyConfig.videoReplacesReels,
      opacity: legacyConfig.imageOpacity ?? 0.85,
    },
    stateMedia: {
      [DisplayState.REACH]: {
        videoPath: legacyConfig.reachVideoPath || '',
        imagePath: legacyConfig.reachImagePath || '',
        characterLayer: legacyConfig.reachCharacterPath || '',
        showShaderBackground: true,
        showReels: true,
        opacity: 0.95,
        shaderParams: { speed: 5.0, color: '#ff0055' },
      },
      [DisplayState.FEVER]: {
        videoPath: legacyConfig.feverVideoPath || '',
        imagePath: legacyConfig.feverImagePath || '',
        characterLayer: legacyConfig.feverCharacterPath || '',
        showShaderBackground: true,
        showReels: true,
        opacity: 0.95,
        shaderParams: { speed: 10.0, color: '#ffd700' },
      },
      [DisplayState.JACKPOT]: {
        videoPath: legacyConfig.jackpotVideoPath || '',
        imagePath: legacyConfig.jackpotImagePath || '',
        characterLayer: legacyConfig.jackpotCharacterPath || '',
        showShaderBackground: true,
        showReels: false,
        opacity: 1.0,
        shaderParams: { speed: 20.0, color: '#ff00ff' },
      },
      [DisplayState.ADVENTURE]: {
        videoPath: legacyConfig.adventureVideoPath || '',
        imagePath: legacyConfig.adventureImagePath || '',
        showShaderBackground: true,
        showReels: false,
        opacity: 0.9,
        shaderParams: { speed: 1.0, color: '#00aa00' },
      },
      [DisplayState.PORTAL_OPEN]: {
        showShaderBackground: true,
        showReels: false,
        shaderParams: { speed: 18.0, color: '#00d9ff' },
      },
      [DisplayState.ESCAPE]: {
        showShaderBackground: true,
        showReels: false,
        shaderParams: { speed: 10.0, color: '#ff4400' },
      },
    },
    imageSettings: {
      blendMode: legacyConfig.imageBlendMode ?? 'normal',
      defaultOpacity: legacyConfig.imageOpacity ?? 0.85,
    },
  }
}

/**
 * Merge state-specific config with default config
 */
export function getStateConfig(
  baseConfig: DisplayConfig,
  state: DisplayState
): StateMediaConfig {
  const defaultMedia = baseConfig.defaultMedia ?? DEFAULT_DISPLAY_CONFIG.defaultMedia!
  const stateOverride = baseConfig.stateMedia?.[state]
  
  return {
    ...defaultMedia,
    ...stateOverride,
    shaderParams: {
      ...defaultMedia.shaderParams,
      ...stateOverride?.shaderParams,
    },
  }
}

/** A display layer with its associated resources */
export interface DisplayLayer {
  mesh?: Mesh
  material?: StandardMaterial | ShaderMaterial
  texture?: Texture | VideoTexture
  visible: boolean
  zIndex: number
}

/** Slot reel state */
export interface SlotReel {
  symbols: string[]
  position: number
  speed: number
  stopping: boolean
  targetSymbol: string
}

/** Media layer state tracking */
export interface MediaLayerState {
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

/** Current presentation state */
export interface PresentationState {
  displayState: DisplayState
  mediaConfig: StateMediaConfig
  transitionProgress: number
  isTransitioning: boolean
}

/** CRT effect parameters */
export interface CRTEffectParams {
  scanlineIntensity: number
  curvature: number
  vignette: number
  chromaticAberration: number
  glow: number
  noise: number
  flicker: number
}

export type CRTPresetName = 'MODERN_LCD' | 'STORY' | 'RETRO' | 'SUBTLE' | 'OFF'

/** Default CRT preset for story mode */
export const CRT_PRESETS: Record<CRTPresetName, CRTEffectParams> = {
  MODERN_LCD: {
    scanlineIntensity: 0.15,
    curvature: 0.0,
    vignette: 0.1,
    chromaticAberration: 0.0,
    glow: 0.6,
    noise: 0.0,
    flicker: 0.0,
  },
  STORY: {
    scanlineIntensity: 0.55,
    curvature: 0.02,
    vignette: 0.4,
    chromaticAberration: 0.5,
    glow: 0.3,
    noise: 0.1,
    flicker: 0.05,
  },
  RETRO: {
    scanlineIntensity: 0.90,
    curvature: 0.05,
    vignette: 0.6,
    chromaticAberration: 0.8,
    glow: 0.5,
    noise: 0.2,
    flicker: 0.1,
  },
  SUBTLE: {
    scanlineIntensity: 0.30,
    curvature: 0.01,
    vignette: 0.2,
    chromaticAberration: 0.3,
    glow: 0.15,
    noise: 0.05,
    flicker: 0.02,
  },
  OFF: {
    scanlineIntensity: 0.0,
    curvature: 0.0,
    vignette: 0.0,
    chromaticAberration: 0.0,
    glow: 0.0,
    noise: 0.0,
    flicker: 0.0,
  },
}
