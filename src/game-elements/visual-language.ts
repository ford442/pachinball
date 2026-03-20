/**
 * Visual Language System - Unified Design System for Pachinball
 * 
 * This file defines the complete visual language for the game, ensuring
 * consistency across all subsystems: materials, lighting, effects, and UI.
 * 
 * Design Philosophy:
 * - CYBER/ARCADE/SCI-FI identity
 * - Dark structural surfaces with vibrant energy accents
 * - Consistent color temperature: cool blues/cyans vs warm magenta/gold
 * - Layered readability: background < interactive < highlight < energy
 */

import { Color3 } from '@babylonjs/core'

// ============================================================================
// COLOR PALETTE - Single source of truth
// ============================================================================

/** Primary accent colors - used for energy states and interactive elements */
export const PALETTE = {
  /** Primary cyan - main interactive color, neutral/idle state */
  CYAN: '#00d9ff',
  
  /** Magenta/Pink - secondary accent, jackpot/reward states */
  MAGENTA: '#ff00aa',
  
  /** Purple - deep energy, feeders, special elements */
  PURPLE: '#8800ff',
  
  /** Gold/Yellow - fever mode, high energy, success */
  GOLD: '#ffd700',
  
  /** Red/Orange - danger, warning, reach state */
  ALERT: '#ff4400',
  
  /** Green - adventure mode, matrix/cyberpunk aesthetic */
  MATRIX: '#00ff44',
  
  /** White - pure energy, flash effects */
  WHITE: '#ffffff',
  
  /** Ambient dark blue - subtle emissive, background elements */
  AMBIENT: '#001133',
} as const

/** Surface colors - structural and non-emissive materials */
export const SURFACES = {
  /** Pure black - deepest cabinet areas */
  VOID: '#050505',
  
  /** Near-black - cabinet panels, structural */
  DARK: '#0a0a0a',
  
  /** Dark grey - brushed metal, rails */
  METAL_DARK: '#151515',
  
  /** Medium grey - chrome, polished metal */
  METAL_LIGHT: '#888888',
  
  /** Playfield base - dark with slight blue tint */
  PLAYFIELD: '#080818',
  
  /** Glass/smoked surfaces */
  GLASS: '#001122',
} as const

// ============================================================================
// INTENSITY LEVELS - Consistent emissive power
// ============================================================================

/** Standardized emissive intensity multipliers */
export const INTENSITY: Record<string, number> = {
  /** Subtle ambient glow - background elements */
  AMBIENT: 0.2,
  
  /** Normal operational glow - always-on elements */
  NORMAL: 0.5,
  
  /** Active state - interactive elements engaged */
  ACTIVE: 1.0,
  
  /** High energy - fever, jackpot, special modes */
  HIGH: 1.5,
  
  /** Maximum flash - impacts, transitions */
  FLASH: 2.0,
  
  /** Bloom threshold kick - brief spikes */
  BURST: 3.0,
}

// ============================================================================
// STATE COLOR MAPPING - Consistent state visualization
// ============================================================================

/** Color mapping for game states - ensures all systems use same colors */
export const STATE_COLORS = {
  /** Idle/Normal - cyan */
  IDLE: PALETTE.CYAN,
  
  /** Reach - alert red/orange */
  REACH: PALETTE.ALERT,
  
  /** Fever - gold */
  FEVER: PALETTE.GOLD,
  
  /** Jackpot - magenta/purple gradient */
  JACKPOT: PALETTE.MAGENTA,
  
  /** Adventure - matrix green */
  ADVENTURE: PALETTE.MATRIX,
  
  /** Warning/Danger - deep red */
  WARNING: '#ff0000',
} as const

/** Shader color values pre-converted for display system */
export const STATE_SHADER_COLORS = {
  IDLE: '#00ffd9',      // Slightly adjusted for shader visibility
  REACH: '#ff0055',
  FEVER: '#ffd700',
  JACKPOT: '#ff00ff',
  ADVENTURE: '#00aa00',
} as const

// ============================================================================
// MATERIAL PRESETS - Standardized PBR values
// ============================================================================

/** Standard roughness values by surface type */
export const ROUGHNESS = {
  MIRROR: 0.05,
  POLISHED: 0.15,
  SMOOTH: 0.25,
  SATIN: 0.4,
  MATTE: 0.6,
  ROUGH: 0.9,
} as const

/** Standard metallic values */
export const METALLIC = {
  NON_METAL: 0.0,
  LOW: 0.2,
  MID: 0.5,
  HIGH: 0.9,
  FULL: 1.0,
} as const

/** Clear coat presets */
export const CLEARCOAT = {
  NONE: { enabled: false, intensity: 0, roughness: 0 },
  GLASS: { enabled: true, intensity: 1.0, roughness: 0.1 },
  POLISHED: { enabled: true, intensity: 0.4, roughness: 0.1 },
  SCREEN: { enabled: true, intensity: 0.4, roughness: 0.1 },
  PIN: { enabled: true, intensity: 0.3, roughness: 0.15 },
  PLAYFIELD: { enabled: true, intensity: 0.4, roughness: 0.1 },
  WAXED: { enabled: true, intensity: 0.5, roughness: 0.05 },
} as const

// ============================================================================
// QUALITY TIERS - Hardware-adaptive material quality
// ============================================================================

export enum QualityTier {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/** Per-tier environment intensity scaling */
export const TIER_ENV_INTENSITY: Record<QualityTier, number> = {
  [QualityTier.LOW]: 0.0,
  [QualityTier.MEDIUM]: 0.6,
  [QualityTier.HIGH]: 1.2,
}

/** Per-tier procedural texture resolution */
export const TIER_TEXTURE_SIZE: Record<QualityTier, number> = {
  [QualityTier.LOW]: 256,
  [QualityTier.MEDIUM]: 512,
  [QualityTier.HIGH]: 1024,
}

// ============================================================================
// STATE MATERIAL PROFILES - Animate surface properties per state
// ============================================================================

export const STATE_PROFILES: Record<string, { emissive: number; roughness: number; metallic: number }> = {
  IDLE: { emissive: 0.5, roughness: 0.4, metallic: 0.5 },
  REACH: { emissive: 1.0, roughness: 0.6, metallic: 0.3 },
  FEVER: { emissive: 1.5, roughness: 0.1, metallic: 0.9 },
  JACKPOT: { emissive: 2.0, roughness: 0.05, metallic: 1.0 },
  ADVENTURE: { emissive: 1.0, roughness: 0.3, metallic: 0.6 },
}

// ============================================================================
// CATEGORY DEFINITIONS - Visual hierarchy
// ============================================================================

/**
 * Visual categories for consistent treatment across all game objects.
 * Each category has defined material, color, and intensity rules.
 */
export const CATEGORIES = {
  /** Structural: Cabinet, walls, non-interactive geometry */
  STRUCTURAL: {
    albedo: SURFACES.DARK,
    roughness: ROUGHNESS.MATTE,
    metallic: METALLIC.LOW,
    emissive: null,
    clearcoat: CLEARCOAT.NONE,
  },
  
  /** Metallic: Rails, trim, chrome details */
  METALLIC: {
    albedo: SURFACES.METAL_LIGHT,
    roughness: ROUGHNESS.POLISHED,
    metallic: METALLIC.FULL,
    emissive: null,
    clearcoat: CLEARCOAT.POLISHED,
  },
  
  /** Playfield: The game surface */
  PLAYFIELD: {
    albedo: SURFACES.PLAYFIELD,
    roughness: ROUGHNESS.SMOOTH,
    metallic: METALLIC.MID,
    emissive: PALETTE.PURPLE,
    emissiveIntensity: INTENSITY.AMBIENT,
    clearcoat: CLEARCOAT.SCREEN,
    alpha: 0.92,
  },
  
  /** Interactive: Bumpers, targets, flippers - player-touchable */
  INTERACTIVE: {
    albedo: PALETTE.CYAN,
    roughness: ROUGHNESS.SATIN,
    metallic: METALLIC.MID,
    emissive: PALETTE.CYAN,
    emissiveIntensity: INTENSITY.NORMAL,
    clearcoat: CLEARCOAT.POLISHED,
  },
  
  /** Energy: Holograms, beams, power effects */
  ENERGY: {
    albedo: '#000000',
    roughness: ROUGHNESS.MIRROR,
    metallic: METALLIC.FULL,
    emissive: PALETTE.CYAN,
    emissiveIntensity: INTENSITY.HIGH,
    clearcoat: CLEARCOAT.NONE,
    wireframe: true,
  },
  
  /** Display: Backbox, screen elements */
  DISPLAY: {
    albedo: SURFACES.VOID,
    roughness: ROUGHNESS.MATTE,
    metallic: METALLIC.NON_METAL,
    emissive: PALETTE.CYAN,
    emissiveIntensity: INTENSITY.NORMAL,
    clearcoat: CLEARCOAT.NONE,
  },
  
  /** Glass: Transparent barriers, tubes */
  GLASS: {
    albedo: SURFACES.GLASS,
    roughness: ROUGHNESS.SMOOTH,
    metallic: METALLIC.LOW,
    emissive: PALETTE.CYAN,
    emissiveIntensity: INTENSITY.AMBIENT,
    clearcoat: CLEARCOAT.GLASS,
    alpha: 0.35,
    ior: 1.4,
  },
  
  /** Alert: Warning states, danger zones */
  ALERT: {
    albedo: PALETTE.ALERT,
    roughness: ROUGHNESS.SATIN,
    metallic: METALLIC.MID,
    emissive: PALETTE.ALERT,
    emissiveIntensity: INTENSITY.HIGH,
    clearcoat: CLEARCOAT.NONE,
  },
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Convert hex string to Babylon Color3 */
export function color(hex: string): Color3 {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  return new Color3(r, g, b)
}

/** Get emissive color with intensity applied */
export function emissive(hex: string, intensity: number = INTENSITY.NORMAL): Color3 {
  return color(hex).scale(intensity)
}

/** Get state color for any game state */
export function stateColor(state: keyof typeof STATE_COLORS): string {
  return STATE_COLORS[state]
}

/** Get state color with intensity for emissive */
export function stateEmissive(
  state: keyof typeof STATE_COLORS,
  intensity: number = INTENSITY.NORMAL
): Color3 {
  return emissive(STATE_COLORS[state], intensity)
}

/** Get shader-formatted color for a state */
export function stateShaderColor(state: keyof typeof STATE_SHADER_COLORS): string {
  return STATE_SHADER_COLORS[state]
}

/** Lerp between two hex colors */
export function lerpColor(hexA: string, hexB: string, t: number): Color3 {
  const a = color(hexA)
  const b = color(hexB)
  return Color3.Lerp(a, b, t)
}

/** Pulse animation value for emissive (0-1 range) */
export function pulse(time: number, speed: number = 1, min: number = 0.2, max: number = 1): number {
  const sine = Math.sin(time * speed * Math.PI * 2)
  return min + (sine * 0.5 + 0.5) * (max - min)
}

/** Strobe animation (on/off) */
export function strobe(time: number, frequency: number): boolean {
  return Math.sin(time * frequency * Math.PI * 2) > 0
}

// ============================================================================
// FEEDER COLOR SYSTEM - Consistent feeder visual identity
// ============================================================================

export const FEEDER_STYLES = {
  /** MagSpin - cyan/blue energy */
  MAG_SPIN: {
    base: PALETTE.CYAN,
    active: '#00ffff',
    locked: PALETTE.PURPLE,
    release: PALETTE.MAGENTA,
  },
  
  /** NanoLoom - green/teal bio-tech */
  NANO_LOOM: {
    base: PALETTE.MATRIX,
    active: '#00ffff',
    weave: '#00ffaa',
    chaos: PALETTE.MAGENTA,
  },
  
  /** PrismCore - rainbow/multi-color */
  PRISM_CORE: {
    base: PALETTE.GOLD,
    stages: ['#00ff00', '#ffff00', '#ff0000', '#ffffff'] as const,
  },
  
  /** GaussCannon - orange/industrial */
  GAUSS_CANNON: {
    base: '#ff8800',
    charge: '#ffff00',
    fire: '#ffffff',
  },
  
  /** QuantumTunnel - purple/cyan portal */
  QUANTUM_TUNNEL: {
    input: PALETTE.PURPLE,
    output: PALETTE.CYAN,
    charge: PALETTE.WHITE,
  },
} as const

// ============================================================================
// LIGHTING PRESETS
// ============================================================================

export const LIGHTING = {
  /** Key light - warm main illumination */
  KEY: {
    color: '#fff4e6',
    intensity: 1.2,
  },

  /** Fill light - cool ambient */
  FILL: {
    color: '#b3c8e6',
    intensity: 0.25,
  },

  /** Rim light - cool edge definition */
  RIM: {
    color: '#80bfff',
    intensity: 0.8,
  },

  /** Bounce light - subtle fill from playfield */
  BOUNCE: {
    color: PALETTE.PURPLE,
    intensity: 0.3,
  },
} as const

// ============================================================================
// LIGHT TEMPERATURE - Color temperature presets per game state
// ============================================================================

/** Key light color temperatures for emotional state shifts */
export const TEMPERATURE = {
  NORMAL: '#fff4e6',   // Warm 3200K - neutral gameplay
  FEVER:  '#ffddaa',   // Warmer 2700K - energized intensity
  REACH:  '#e6f4ff',   // Cool 6500K - tense alertness
  JACKPOT: '#ffcccc',  // Warm red - triumphant warmth
  ADVENTURE: '#ccffee', // Teal - otherworldly exploration
} as const

// ============================================================================
// LIGHTING STATES - Per-state intensity profiles for key/fill/rim lights
// ============================================================================

export const LIGHTING_STATES: Record<string, { key: number; fill: number; rim: number; rimColor: string }> = {
  IDLE:      { key: 1.2,  fill: 0.25, rim: 0.8,  rimColor: '#80bfff' },
  REACH:     { key: 1.0,  fill: 0.15, rim: 1.6,  rimColor: '#ff4400' },
  FEVER:     { key: 1.4,  fill: 0.30, rim: 1.2,  rimColor: '#ffd700' },
  JACKPOT:   { key: 1.5,  fill: 0.40, rim: 1.8,  rimColor: '#ff00aa' },
  ADVENTURE: { key: 1.1,  fill: 0.20, rim: 1.0,  rimColor: '#00ff44' },
}

// ============================================================================
// FOG STATES - Per-state fog parameters for atmospheric depth
// ============================================================================

export const FOG_STATES: Record<string, { density: number; color: string }> = {
  IDLE:      { density: 0.005, color: '#080818' },
  REACH:     { density: 0.008, color: '#1a0500' },
  FEVER:     { density: 0.006, color: '#1a1000' },
  JACKPOT:   { density: 0.010, color: '#1a0010' },
  ADVENTURE: { density: 0.004, color: '#001a08' },
}

// ============================================================================
// ADVENTURE MODE - Track-specific visual themes
// ============================================================================

export const ADVENTURE_THEMES = {
  NEON_HELIX: { primary: PALETTE.CYAN, secondary: PALETTE.MAGENTA },
  CYBER_CORE: { primary: PALETTE.PURPLE, secondary: PALETTE.CYAN },
  QUANTUM_GRID: { primary: PALETTE.MATRIX, secondary: PALETTE.WHITE },
  SINGULARITY_WELL: { primary: '#ff0000', secondary: '#000000' },
  GLITCH_SPIRE: { primary: PALETTE.ALERT, secondary: PALETTE.WHITE },
  RETRO_WAVE_HILLS: { primary: '#ff00ff', secondary: '#00ffff' },
  CHRONO_CORE: { primary: '#ffd700', secondary: '#ff4500' },
  HYPER_DRIFT: { primary: PALETTE.CYAN, secondary: PALETTE.WHITE },
  PACHINKO_SPIRE: { primary: PALETTE.GOLD, secondary: PALETTE.MAGENTA },
  ORBITAL_JUNKYARD: { primary: '#888888', secondary: '#ff6600' },
  FIREWALL_BREACH: { primary: PALETTE.ALERT, secondary: PALETTE.GOLD },
  CPU_CORE: { primary: '#00ff00', secondary: PALETTE.CYAN },
  CRYO_CHAMBER: { primary: '#00ffff', secondary: '#ffffff' },
  BIO_HAZARD_LAB: { primary: '#88ff00', secondary: '#ff0000' },
  GRAVITY_FORGE: { primary: '#ff8800', secondary: '#444444' },
  TIDAL_NEXUS: { primary: '#0088ff', secondary: '#00ff88' },
  DIGITAL_ZEN_GARDEN: { primary: '#00ffaa', secondary: PALETTE.PURPLE },
  SYNTHWAVE_SURF: { primary: '#ff00aa', secondary: '#00ffff' },
  SOLAR_FLARE: { primary: '#ffff00', secondary: '#ff4400' },
  PRISM_PATHWAY: { primary: PALETTE.GOLD, secondary: PALETTE.CYAN },
  MAGNETIC_STORAGE: { primary: '#4488ff', secondary: '#ff4488' },
  NEURAL_NETWORK: { primary: PALETTE.MATRIX, secondary: PALETTE.GOLD },
  NEON_STRONGHOLD: { primary: PALETTE.CYAN, secondary: PALETTE.PURPLE },
  CASINO_HEIST: { primary: PALETTE.GOLD, secondary: PALETTE.MAGENTA },
  TESLA_TOWER: { primary: '#88ccff', secondary: PALETTE.PURPLE },
  NEON_SKYLINE: { primary: PALETTE.MAGENTA, secondary: PALETTE.CYAN },
  POLYCHROME_VOID: { primary: PALETTE.WHITE, secondary: PALETTE.PURPLE },
} as const

// ============================================================================
// SHADER INTEGRATION
// ============================================================================

/** Get reel/slot shader color for a state */
export function getReelShaderColor(state: keyof typeof STATE_SHADER_COLORS): Color3 {
  return color(STATE_SHADER_COLORS[state])
}

/** Get grid shader parameters for a state */
export function getGridShaderParams(state: keyof typeof STATE_SHADER_COLORS) {
  const colorHex = STATE_SHADER_COLORS[state]
  const speeds = {
    IDLE: 0.5,
    REACH: 5.0,
    FEVER: 10.0,
    JACKPOT: 20.0,
    ADVENTURE: 1.0,
  }
  return {
    color: colorHex,
    speed: speeds[state],
  }
}
