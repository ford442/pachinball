/**
 * Display System Types
 * 
 * Core types and enums for the backbox display system.
 * Extracted from display.ts for modularity.
 */

import type { Mesh, StandardMaterial, ShaderMaterial, Texture, VideoTexture } from '@babylonjs/core'

/** Display mode - controls the base media pipeline */
export enum DisplayMode {
  /** Procedural reels + shader grid only (no external media) */
  SHADER_ONLY = 'shader_only',
  /** Static image over shader background */
  REELS_ONLY = 'reels_only',
  /** Looping video (optionally over shader background) */
  VIDEO_ONLY = 'video_only',
  /** All layers active - video/image + shader + reels */
  HYBRID = 'hybrid',
}

/** Display states that can trigger different media */
export enum DisplayState {
  IDLE = 'idle',
  REACH = 'reach',
  FEVER = 'fever',
  JACKPOT = 'jackpot',
  ADVENTURE = 'adventure',
}

/** A display layer with its associated resources */
export interface DisplayLayer {
  mesh?: Mesh
  material?: StandardMaterial | ShaderMaterial
  texture?: Texture | VideoTexture
  visible: boolean
  zIndex: number
}

/** Main display configuration */
export interface DisplayConfig {
  mode: DisplayMode
  width: number
  height: number
  resolution: number
}

/** Slot reel state */
export interface SlotReel {
  symbols: string[]
  position: number
  speed: number
  stopping: boolean
  targetSymbol: string
}

/** Blend modes for image layers */
export type ImageBlendMode = 'normal' | 'additive' | 'multiply'

/** Media configuration for a specific display state */
export interface StateMediaConfig {
  /** Path to video file (relative to public/) */
  videoPath?: string
  /** Path to image file (relative to public/) */
  imagePath?: string
  /** If true, shader grid is visible behind media */
  showShaderBackground?: boolean
  /** If true, slot reels are visible behind media */
  showReels?: boolean
  /** Opacity of the media layer (0.0 - 1.0) */
  opacity?: number
  /** Custom shader parameters for this state */
  shaderParams?: {
    /** Grid animation speed multiplier */
    speed?: number
    /** Grid color as hex string */
    color?: string
  }
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

/** Default CRT preset for story mode */
export const CRT_PRESETS: Record<string, CRTEffectParams> = {
  STORY: {
    scanlineIntensity: 0.3,
    curvature: 0.02,
    vignette: 0.4,
    chromaticAberration: 0.5,
    glow: 0.3,
    noise: 0.1,
    flicker: 0.05,
  },
  RETRO: {
    scanlineIntensity: 0.5,
    curvature: 0.05,
    vignette: 0.6,
    chromaticAberration: 0.8,
    glow: 0.5,
    noise: 0.2,
    flicker: 0.1,
  },
  SUBTLE: {
    scanlineIntensity: 0.15,
    curvature: 0.01,
    vignette: 0.2,
    chromaticAberration: 0.3,
    glow: 0.15,
    noise: 0.05,
    flicker: 0.02,
  },
}
