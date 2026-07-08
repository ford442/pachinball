/**
 * Premium per-track theme profiles — materials, atmosphere, particles, and cabinet.
 * CYBER_CORE is the reference implementation (Cyber-Shock electric neon).
 */

import type { VisualThemeColor } from './visual-language'
import { PALETTE, SURFACES } from './visual-language'

export type TrackMaterialRole = 'structure' | 'accent' | 'energy' | 'glow'

export type TrackAmbientStyle =
  | 'none'
  | 'electric-arc'
  | 'neon-flicker'
  | 'underwater-caustic'
  | 'ghost-mist'
  | 'pixel-scan'

export interface TrackAtmosphereProfile {
  fogDensity: number
  fogColor: string
  keyLightColor: string
  keyLightIntensity: number
  rimColor: string
  rimIntensity: number
  bloomWeight: number
  vignetteWeight: number
}

export interface TrackThemeProfile {
  trackId: string
  label: string
  /** Palette tokens for table-shell theming (bumpers, flippers, LCD). */
  palette: {
    primary: VisualThemeColor
    accent: VisualThemeColor
    surfaceTint: keyof typeof SURFACES
  }
  /** Adventure geometry material slots. */
  materials: Record<TrackMaterialRole, string>
  /** Cabinet neon trim + interior light hex. */
  cabinet: { primary: string; accent: string }
  atmosphere: TrackAtmosphereProfile
  particles: {
    hitPrimary: string
    hitAccent: string
    ambient: TrackAmbientStyle
  }
  /** Use PBR wireframe for structure ramps (premium tracks). */
  usePBRStructure?: boolean
}

/** Cyber-Shock — hot magenta, electric cyan arcs, tiger-orange energy pops. */
const CYBER_CORE_PROFILE: TrackThemeProfile = {
  trackId: 'CYBER_CORE',
  label: 'Cyber Shock',
  palette: { primary: 'MAGENTA', accent: 'CYAN', surfaceTint: 'PLAYFIELD_DEEP' },
  materials: {
    structure: '#aa00ff',
    accent: '#00e8ff',
    energy: '#ff7700',
    glow: '#ff00cc',
  },
  cabinet: { primary: '#ff00cc', accent: '#00e8ff' },
  atmosphere: {
    fogDensity: 0.011,
    fogColor: '#120018',
    keyLightColor: '#ff66cc',
    keyLightIntensity: 1.3,
    rimColor: '#00e8ff',
    rimIntensity: 1.45,
    bloomWeight: 0.68,
    vignetteWeight: 0.42,
  },
  particles: {
    hitPrimary: '#ff00cc',
    hitAccent: '#00e8ff',
    ambient: 'electric-arc',
  },
  usePBRStructure: true,
}

/** Placeholder profiles for future premium passes (material slots defined). */
const THEME_PROFILE_STUBS: Record<string, TrackThemeProfile> = {
  NEON_HELIX: {
    trackId: 'NEON_HELIX',
    label: 'Neon Helix',
    palette: { primary: 'CYAN', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD' },
    materials: { structure: PALETTE.CYAN, accent: PALETTE.MAGENTA, energy: PALETTE.GOLD, glow: PALETTE.WHITE },
    cabinet: { primary: PALETTE.CYAN, accent: PALETTE.MAGENTA },
    atmosphere: {
      fogDensity: 0.007,
      fogColor: '#080818',
      keyLightColor: '#66ddff',
      keyLightIntensity: 1.15,
      rimColor: '#ff00aa',
      rimIntensity: 1.1,
      bloomWeight: 0.55,
      vignetteWeight: 0.38,
    },
    particles: { hitPrimary: PALETTE.CYAN, hitAccent: PALETTE.MAGENTA, ambient: 'neon-flicker' },
  },
  QUANTUM_GRID: {
    trackId: 'QUANTUM_GRID',
    label: 'Mega Grid',
    palette: { primary: 'PURPLE', accent: 'WHITE', surfaceTint: 'GLASS' },
    materials: { structure: '#4400ff', accent: '#ffffff', energy: '#00ff88', glow: '#8800ff' },
    cabinet: { primary: '#8800ff', accent: '#ffffff' },
    atmosphere: {
      fogDensity: 0.009,
      fogColor: '#050510',
      keyLightColor: '#aa88ff',
      keyLightIntensity: 1.2,
      rimColor: '#ffffff',
      rimIntensity: 1.0,
      bloomWeight: 0.5,
      vignetteWeight: 0.35,
    },
    particles: { hitPrimary: '#8800ff', hitAccent: '#00ff88', ambient: 'pixel-scan' },
  },
  TIDAL_NEXUS: {
    trackId: 'TIDAL_NEXUS',
    label: 'Tidal Nexus',
    palette: { primary: 'CYAN', accent: 'MATRIX', surfaceTint: 'GLASS' },
    materials: { structure: '#0066aa', accent: '#00ffcc', energy: '#88ddff', glow: '#004466' },
    cabinet: { primary: '#0088ff', accent: '#00ffaa' },
    atmosphere: {
      fogDensity: 0.014,
      fogColor: '#001828',
      keyLightColor: '#66ccff',
      keyLightIntensity: 1.0,
      rimColor: '#00ffaa',
      rimIntensity: 0.9,
      bloomWeight: 0.48,
      vignetteWeight: 0.4,
    },
    particles: { hitPrimary: '#00ccff', hitAccent: '#00ffaa', ambient: 'underwater-caustic' },
  },
  GLITCH_SPIRE: {
    trackId: 'GLITCH_SPIRE',
    label: 'Ghost Spire',
    palette: { primary: 'MATRIX', accent: 'CYAN', surfaceTint: 'GLASS' },
    materials: { structure: '#223322', accent: '#88ffcc', energy: '#aaddff', glow: '#446644' },
    cabinet: { primary: '#88ffcc', accent: '#334433' },
    atmosphere: {
      fogDensity: 0.018,
      fogColor: '#0a1010',
      keyLightColor: '#aaccbb',
      keyLightIntensity: 0.85,
      rimColor: '#88ffdd',
      rimIntensity: 1.2,
      bloomWeight: 0.42,
      vignetteWeight: 0.55,
    },
    particles: { hitPrimary: '#aaddff', hitAccent: '#88ffcc', ambient: 'ghost-mist' },
  },
  PACHINKO_HALL: {
    trackId: 'PACHINKO_HALL',
    label: 'Pachinko Hall',
    palette: { primary: 'GOLD', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD' },
    materials: { structure: '#ffdd00', accent: '#ff66cc', energy: '#00ffff', glow: '#ffd700' },
    cabinet: { primary: '#ffd700', accent: '#ff00aa' },
    atmosphere: {
      fogDensity: 0.008,
      fogColor: '#1a0800',
      keyLightColor: '#ffcc44',
      keyLightIntensity: 1.25,
      rimColor: '#ff66cc',
      rimIntensity: 1.15,
      bloomWeight: 0.62,
      vignetteWeight: 0.36,
    },
    particles: { hitPrimary: '#ffd700', hitAccent: '#ff66cc', ambient: 'neon-flicker' },
  },
}

export const TRACK_THEME_PROFILES: Record<string, TrackThemeProfile> = {
  CYBER_CORE: CYBER_CORE_PROFILE,
  ...THEME_PROFILE_STUBS,
}

export function getTrackThemeProfile(trackId: string): TrackThemeProfile | null {
  return TRACK_THEME_PROFILES[trackId] ?? null
}

export function getTrackMaterialColor(trackId: string, role: TrackMaterialRole): string | null {
  return TRACK_THEME_PROFILES[trackId]?.materials[role] ?? null
}
