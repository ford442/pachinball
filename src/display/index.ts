/**
 * Display System Module
 * 
 * Barrel export for the display system components.
 * Replaces the monolithic display.ts with modular components.
 */

// Types
export {
  DisplayMode,
  DisplayState,
  type DisplayConfig,
  type DisplayLayer,
  type SlotReel,
  type StateMediaConfig,
  type MediaLayerState,
  type PresentationState,
  type CRTEffectParams,
  CRT_PRESETS,
} from './display-types'

// Core system
export { DisplaySystem } from './display-core'

// Layer managers
export { DisplayShaderLayer } from './display-shader'
export { DisplayReelsLayer } from './display-reels'
export { DisplayVideoLayer } from './display-video'
