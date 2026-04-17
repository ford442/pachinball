/**
 * Display System Configuration
 * 
 * This file defines the configuration structure for the backbox/head display
 * media pipeline. It supports multiple display modes, state-based content
 * switching, and extensible media playlists.
 */

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
}

/** Blend modes for image layers */
export type ImageBlendMode = 'normal' | 'additive' | 'multiply';

/** 
 * Media configuration for a specific display state.
 * Allows different media to play during different game states.
 */
export interface StateMediaConfig {
  /** 
   * Path to video file (relative to public/)
   * Set to empty string to disable video for this state
   */
  videoPath?: string;
  
  /**
   * Path to image file (relative to public/)
   * Used as fallback if video fails, or as overlay
   */
  imagePath?: string;
  
  /**
   * If true, shader grid is visible behind media
   * If false, media covers the shader (black background)
   */
  showShaderBackground?: boolean;
  
  /**
   * If true, slot reels are visible behind media
   * If false, media covers the reels
   */
  showReels?: boolean;
  
  /**
   * Opacity of the media layer (0.0 - 1.0)
   */
  opacity?: number;
  
  /**
   * Custom shader parameters for this state
   */
  shaderParams?: {
    /** Grid animation speed multiplier */
    speed?: number;
    /** Grid color as hex string */
    color?: string;
  };
}

/**
 * Main display configuration interface
 * 
 * Example usage:
 * ```typescript
 * const config: DisplayConfig = {
 *   mode: DisplayMode.HYBRID,
 *   defaultMedia: {
 *     videoPath: '/backbox/attract-loop.mp4',
 *     imagePath: '/backbox/attract-fallback.png',
 *     showShaderBackground: true,
 *     showReels: false,
 *   },
 *   stateMedia: {
 *     [DisplayState.JACKPOT]: {
 *       videoPath: '/backbox/jackpot-explosion.mp4',
 *       showShaderBackground: false,
 *       shaderParams: { speed: 20, color: '#ff00ff' },
 *     },
 *     [DisplayState.ADVENTURE]: {
 *       imagePath: '/backbox/adventure-overlay.png',
 *       showReels: false,
 *       shaderParams: { speed: 1, color: '#00aa00' },
 *     },
 *   },
 * };
 * ```
 */
export interface DisplayConfig {
  /** Base display mode */
  mode: DisplayMode;

  /** Physical width of the backbox display */
  width: number;

  /** Physical height of the backbox display */
  height: number;

  /** Texture resolution */
  resolution: number;
  
  /** 
   * Default media configuration (IDLE state and fallback)
   * If not provided, uses shader-only
   */
  defaultMedia?: StateMediaConfig;
  
  /**
   * Per-state media overrides
   * When state changes, these settings merge with defaultMedia
   */
  stateMedia?: Partial<Record<DisplayState, StateMediaConfig>>;
  
  /**
   * Global image settings
   */
  imageSettings?: {
    /** Default blend mode for images */
    blendMode?: ImageBlendMode;
    /** Default opacity for images */
    defaultOpacity?: number;
  };
  
  /**
   * Global video settings
   */
  videoSettings?: {
    /** If true, video loops automatically */
    loop?: boolean;
    /** If true, video starts muted (required for autoplay) */
    muted?: boolean;
    /** Timeout in ms before giving up on video load */
    loadTimeout?: number;
  };
  
  /**
   * Transition settings between states
   */
  transitions?: {
    /** Duration of crossfade between media (seconds) */
    fadeDuration?: number;
    /** If true, shader color transitions smoothly */
    animateShaderParams?: boolean;
  };
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
};

/**
 * Legacy config adapter
 * Converts old GameConfig.backbox format to new DisplayConfig
 */
export function adaptLegacyConfig(legacyConfig: {
  attractVideoPath?: string;
  videoReplacesReels?: boolean;
  attractImagePath?: string;
  imageOpacity?: number;
  imageBlendMode?: ImageBlendMode;
}): DisplayConfig {
  const hasVideo = legacyConfig.attractVideoPath && legacyConfig.attractVideoPath.trim() !== '';
  const hasImage = legacyConfig.attractImagePath && legacyConfig.attractImagePath.trim() !== '';
  
  let mode = DisplayMode.SHADER_ONLY;
  if (hasVideo) mode = DisplayMode.VIDEO;
  else if (hasImage) mode = DisplayMode.IMAGE;
  
  return {
    mode,
    width: 20,
    height: 12,
    resolution: 512,
    defaultMedia: {
      videoPath: legacyConfig.attractVideoPath || '',
      imagePath: legacyConfig.attractImagePath || '',
      showShaderBackground: true,
      showReels: !legacyConfig.videoReplacesReels,
      opacity: legacyConfig.imageOpacity ?? 0.85,
    },
    imageSettings: {
      blendMode: legacyConfig.imageBlendMode ?? 'normal',
      defaultOpacity: legacyConfig.imageOpacity ?? 0.85,
    },
  };
}

/**
 * Merge state-specific config with default config
 */
export function getStateConfig(
  baseConfig: DisplayConfig,
  state: DisplayState
): StateMediaConfig {
  const defaultMedia = baseConfig.defaultMedia ?? DEFAULT_DISPLAY_CONFIG.defaultMedia!;
  const stateOverride = baseConfig.stateMedia?.[state];
  
  return {
    ...defaultMedia,
    ...stateOverride,
    shaderParams: {
      ...defaultMedia.shaderParams,
      ...stateOverride?.shaderParams,
    },
  };
}
