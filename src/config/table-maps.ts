/**
 * Table map registry — pure data, no Babylon or shader dependencies (#441).
 *
 * Moved out of `src/shaders/lcd-table.ts` so low layers (game-elements, adventure,
 * replay) can read map definitions without importing a shader module.
 */

/**
 * LCD Table Map Definitions
 * Each map defines the visual theme for the LCD playfield
 */
export type TableMapType = string

/** The table map a fresh session, challenge link or replay falls back to. Always a `TABLE_MAPS` key. */
export const DEFAULT_TABLE_MAP_ID: BuiltInTableMapId = 'neon-helix'
export type WorldMode = 'fixed' | 'dynamic'

export interface TableMapConfig {
  name: string
  baseColor: string      // Primary phosphor color (hex)
  accentColor: string    // Secondary glow color (hex)
  scanlineIntensity: number
  pixelGridIntensity: number
  subpixelIntensity: number
  glowIntensity: number
  backgroundPattern: 'hex' | 'grid' | 'circuit' | 'data-flow' | 'none'
  animationSpeed: number
  musicTrackId?: string
  playfieldImage?: string
  playfieldVideo?: string
  shaderUrl?: string
  adventureGoals?: string[]
  mode?: WorldMode       // 'fixed' (default) or 'dynamic' scrolling world
  worldLength?: number   // Total length of dynamic world (if mode is 'dynamic')
}

const BUILTIN_TABLE_MAPS = {
  'neon-helix': {
    name: 'Neon Helix',
    baseColor: '#00d9ff',
    accentColor: '#ff00aa',
    scanlineIntensity: 0.2,
    pixelGridIntensity: 0.6,
    subpixelIntensity: 0.35,
    glowIntensity: 1.3,
    backgroundPattern: 'hex',
    animationSpeed: 0.5,
  },
  'pachinko-hall': {
    name: 'Pachinko Hall',
    baseColor: '#ffdd00',
    accentColor: '#ff66cc',
    scanlineIntensity: 0.18,
    pixelGridIntensity: 0.55,
    subpixelIntensity: 0.3,
    glowIntensity: 1.45,
    backgroundPattern: 'grid',
    animationSpeed: 0.7,
  },
  'cyber-core': {
    name: 'Cyber Core',
    baseColor: '#8800ff',
    accentColor: '#00d9ff',
    scanlineIntensity: 0.25,
    pixelGridIntensity: 0.5,
    subpixelIntensity: 0.3,
    glowIntensity: 1.1,
    backgroundPattern: 'circuit',
    animationSpeed: 0.3,
  },
  'quantum-grid': {
    name: 'Quantum Grid',
    baseColor: '#00ff44',
    accentColor: '#ffffff',
    scanlineIntensity: 0.15,
    pixelGridIntensity: 0.7,
    subpixelIntensity: 0.4,
    glowIntensity: 1.5,
    backgroundPattern: 'grid',
    animationSpeed: 1.0,
  },
  'singularity-well': {
    name: 'Singularity Well',
    baseColor: '#ff4400',
    accentColor: '#ff0000',
    scanlineIntensity: 0.3,
    pixelGridIntensity: 0.4,
    subpixelIntensity: 0.25,
    glowIntensity: 1.6,
    backgroundPattern: 'data-flow',
    animationSpeed: 0.8,
  },
  'glitch-spire': {
    name: 'Glitch Spire',
    baseColor: '#ff00aa',
    accentColor: '#ffffff',
    scanlineIntensity: 0.35,
    pixelGridIntensity: 0.4,
    subpixelIntensity: 0.45,
    glowIntensity: 1.4,
    backgroundPattern: 'circuit',
    animationSpeed: 2.0,
  },
  'matrix-core': {
    name: 'Matrix Core',
    baseColor: '#00ff00',
    accentColor: '#003300',
    scanlineIntensity: 0.12,
    pixelGridIntensity: 0.65,
    subpixelIntensity: 0.2,
    glowIntensity: 1.2,
    backgroundPattern: 'data-flow',
    animationSpeed: 0.6,
  },
  'cyan-void': {
    name: 'Cyan Void',
    baseColor: '#00ffff',
    accentColor: '#0088ff',
    scanlineIntensity: 0.2,
    pixelGridIntensity: 0.5,
    subpixelIntensity: 0.3,
    glowIntensity: 1.1,
    backgroundPattern: 'none',
    animationSpeed: 0.2,
  },
  'magenta-dream': {
    name: 'Magenta Dream',
    baseColor: '#ff00ff',
    accentColor: '#aa00ff',
    scanlineIntensity: 0.25,
    pixelGridIntensity: 0.45,
    subpixelIntensity: 0.32,
    glowIntensity: 1.3,
    backgroundPattern: 'hex',
    animationSpeed: 0.4,
  },
} satisfies Record<string, TableMapConfig>

/** Ids of the maps that ship with the game (always present in `TABLE_MAPS`). */
export type BuiltInTableMapId = keyof typeof BUILTIN_TABLE_MAPS

/**
 * Runtime registry. Seeded with the built-ins; `registerMap` and `LCDTableState`
 * add backend-fetched and temporary maps to it, so it is deliberately mutable.
 */
export const TABLE_MAPS: Record<string, TableMapConfig> = { ...BUILTIN_TABLE_MAPS }

/**
 * Register a dynamic map at runtime (e.g. fetched from backend).
 */
export function registerMap(id: string, config: TableMapConfig): void {
  TABLE_MAPS[id] = config
}
