/**
 * Zone Registry - Configuration for Dynamic Adventure Mode zones
 *
 * Each zone defines:
 * - Story video URL and narrative text
 * - Color theme (neon, interior lights, ball material)
 * - Music track ID
 * - Transition type (major/minor - affects shake intensity)
 */

import { AdventureTrackType } from './adventure-mode-builder'

export interface ZoneConfig {
  /** Zone identifier */
  id: AdventureTrackType
  /** Display name */
  name: string
  /** Story narrative text (shown on backbox) */
  storyText: string
  /** Video URL for backbox (optional) */
  videoUrl?: string
  /** Music track ID to cross-fade to */
  musicTrackId: string
  /** Primary color (cabinet neon, ball) */
  primaryColor: string
  /** Secondary/accent color */
  accentColor: string
  /** Interior lighting color */
  interiorColor: string
  /** Whether this is a major transition (triggers stronger shake/pulse) */
  isMajorTransition: boolean
  /** Glow intensity for materials (0-2) */
  glowIntensity: number
}

/**
 * Zone configurations for all adventure tracks
 * These define the thematic elements when entering each zone
 */
export const ZONE_REGISTRY: Record<AdventureTrackType, ZoneConfig> = {
  [AdventureTrackType.NEON_HELIX]: {
    id: AdventureTrackType.NEON_HELIX,
    name: 'Neon Helix',
    storyText: 'ENTERING: NEON HELIX\n\nThe spiral descent begins...',
    videoUrl: '/videos/zones/neon_helix_intro.mp4',
    musicTrackId: 'neon-helix',
    primaryColor: '#00d9ff',
    accentColor: '#ff00aa',
    interiorColor: '#00ffff',
    isMajorTransition: true,
    glowIntensity: 1.3,
  },
  [AdventureTrackType.CYBER_CORE]: {
    id: AdventureTrackType.CYBER_CORE,
    name: 'Cyber Core',
    storyText: 'ENTERING: CYBER CORE\n\nDescending into the digital depths...',
    videoUrl: '/videos/zones/cyber_core_intro.mp4',
    musicTrackId: 'cyber-core',
    primaryColor: '#8800ff',
    accentColor: '#00d9ff',
    interiorColor: '#aa44ff',
    isMajorTransition: true,
    glowIntensity: 1.1,
  },
  [AdventureTrackType.QUANTUM_GRID]: {
    id: AdventureTrackType.QUANTUM_GRID,
    name: 'Quantum Grid',
    storyText: 'ENTERING: QUANTUM GRID\n\nNavigate the probability maze...',
    videoUrl: '/videos/zones/quantum_grid_intro.mp4',
    musicTrackId: 'quantum-grid',
    primaryColor: '#00ff44',
    accentColor: '#ffffff',
    interiorColor: '#88ffaa',
    isMajorTransition: true,
    glowIntensity: 1.5,
  },
  [AdventureTrackType.SINGULARITY_WELL]: {
    id: AdventureTrackType.SINGULARITY_WELL,
    name: 'Singularity Well',
    storyText: 'WARNING: GRAVITY ANOMALY\n\nApproaching event horizon...',
    videoUrl: '/videos/zones/singularity_intro.mp4',
    musicTrackId: 'singularity-well',
    primaryColor: '#ff4400',
    accentColor: '#ff0000',
    interiorColor: '#ff6622',
    isMajorTransition: true,
    glowIntensity: 1.6,
  },
  [AdventureTrackType.GLITCH_SPIRE]: {
    id: AdventureTrackType.GLITCH_SPIRE,
    name: 'Glitch Spire',
    storyText: 'ALERT: REALITY UNSTABLE\n\nGlitch corruption detected...',
    videoUrl: '/videos/zones/glitch_spire_intro.mp4',
    musicTrackId: 'glitch-spire',
    primaryColor: '#ff00aa',
    accentColor: '#ffffff',
    interiorColor: '#ff88cc',
    isMajorTransition: true,
    glowIntensity: 1.4,
  },
  [AdventureTrackType.RETRO_WAVE_HILLS]: {
    id: AdventureTrackType.RETRO_WAVE_HILLS,
    name: 'Retro Wave Hills',
    storyText: 'ENTERING: RETRO WAVE\n\nCruise the neon sunset...',
    videoUrl: '/videos/zones/retrowave_intro.mp4',
    musicTrackId: 'retrowave-hills',
    primaryColor: '#ff66aa',
    accentColor: '#00ccff',
    interiorColor: '#ff88cc',
    isMajorTransition: false,
    glowIntensity: 1.2,
  },
  [AdventureTrackType.CHRONO_CORE]: {
    id: AdventureTrackType.CHRONO_CORE,
    name: 'Chrono Core',
    storyText: 'TEMPORAL ANOMALY\n\nTime flows differently here...',
    videoUrl: '/videos/zones/chrono_intro.mp4',
    musicTrackId: 'chrono-core',
    primaryColor: '#00ffcc',
    accentColor: '#ff6600',
    interiorColor: '#44ffdd',
    isMajorTransition: true,
    glowIntensity: 1.3,
  },
  [AdventureTrackType.HYPER_DRIFT]: {
    id: AdventureTrackType.HYPER_DRIFT,
    name: 'Hyper Drift',
    storyText: 'HYPER VELOCITY\n\nHold on tight...',
    videoUrl: '/videos/zones/hyper_drift_intro.mp4',
    musicTrackId: 'hyper-drift',
    primaryColor: '#66ffff',
    accentColor: '#ff3366',
    interiorColor: '#88ffff',
    isMajorTransition: false,
    glowIntensity: 1.5,
  },
  [AdventureTrackType.PACHINKO_SPIRE]: {
    id: AdventureTrackType.PACHINKO_SPIRE,
    name: 'Pachinko Spire',
    storyText: 'ENTERING: PACHINKO SPIRE\n\nThe vertical descent awaits...',
    videoUrl: '/videos/zones/pachinko_spire_intro.mp4',
    musicTrackId: 'pachinko-spire',
    primaryColor: '#ffcc00',
    accentColor: '#ff2244',
    interiorColor: '#ffdd44',
    isMajorTransition: true,
    glowIntensity: 1.4,
  },
  [AdventureTrackType.ORBITAL_JUNKYARD]: {
    id: AdventureTrackType.ORBITAL_JUNKYARD,
    name: 'Orbital Junkyard',
    storyText: 'ORBITAL DEBRIS FIELD\n\nNavigate the scrap sector...',
    videoUrl: '/videos/zones/junkyard_intro.mp4',
    musicTrackId: 'orbital-junkyard',
    primaryColor: '#aaaaaa',
    accentColor: '#ff6600',
    interiorColor: '#cccccc',
    isMajorTransition: true,
    glowIntensity: 0.9,
  },
  [AdventureTrackType.FIREWALL_BREACH]: {
    id: AdventureTrackType.FIREWALL_BREACH,
    name: 'Firewall Breach',
    storyText: 'WARNING: SECURITY BREACH\n\nIntrusion detected...',
    videoUrl: '/videos/zones/firewall_intro.mp4',
    musicTrackId: 'firewall-breach',
    primaryColor: '#ff0000',
    accentColor: '#ffaa00',
    interiorColor: '#ff4444',
    isMajorTransition: true,
    glowIntensity: 1.7,
  },
  [AdventureTrackType.CPU_CORE]: {
    id: AdventureTrackType.CPU_CORE,
    name: 'CPU Core',
    storyText: 'ENTERING: CPU CORE\n\nThe central processor awaits...',
    videoUrl: '/videos/zones/cpu_intro.mp4',
    musicTrackId: 'cpu-core',
    primaryColor: '#00ff00',
    accentColor: '#88ff00',
    interiorColor: '#44ff44',
    isMajorTransition: true,
    glowIntensity: 1.3,
  },
  [AdventureTrackType.CRYO_CHAMBER]: {
    id: AdventureTrackType.CRYO_CHAMBER,
    name: 'Cryo Chamber',
    storyText: 'CRYOGENIC ZONE\n\nTemperature dropping...',
    videoUrl: '/videos/zones/cryo_intro.mp4',
    musicTrackId: 'cryo-chamber',
    primaryColor: '#00ccff',
    accentColor: '#ffffff',
    interiorColor: '#88ddff',
    isMajorTransition: true,
    glowIntensity: 1.2,
  },
  [AdventureTrackType.BIO_HAZARD_LAB]: {
    id: AdventureTrackType.BIO_HAZARD_LAB,
    name: 'Bio Hazard Lab',
    storyText: 'BIOHAZARD WARNING\n\nToxic materials present...',
    videoUrl: '/videos/zones/biohazard_intro.mp4',
    musicTrackId: 'bio-hazard',
    primaryColor: '#44ff00',
    accentColor: '#ffcc00',
    interiorColor: '#66ff22',
    isMajorTransition: true,
    glowIntensity: 1.4,
  },
  [AdventureTrackType.GRAVITY_FORGE]: {
    id: AdventureTrackType.GRAVITY_FORGE,
    name: 'Gravity Forge',
    storyText: 'GRAVITY FORGE\n\nHeavy industry sector...',
    videoUrl: '/videos/zones/forge_intro.mp4',
    musicTrackId: 'gravity-forge',
    primaryColor: '#ff6600',
    accentColor: '#ffcc00',
    interiorColor: '#ff8844',
    isMajorTransition: true,
    glowIntensity: 1.5,
  },
  [AdventureTrackType.TIDAL_NEXUS]: {
    id: AdventureTrackType.TIDAL_NEXUS,
    name: 'Tidal Nexus',
    storyText: 'TIDAL NEXUS\n\nFlow with the current...',
    videoUrl: '/videos/zones/tidal_intro.mp4',
    musicTrackId: 'tidal-nexus',
    primaryColor: '#0088ff',
    accentColor: '#00ffcc',
    interiorColor: '#44aaff',
    isMajorTransition: false,
    glowIntensity: 1.2,
  },
  [AdventureTrackType.DIGITAL_ZEN_GARDEN]: {
    id: AdventureTrackType.DIGITAL_ZEN_GARDEN,
    name: 'Digital Zen Garden',
    storyText: 'ZEN GARDEN\n\nFind your center...',
    videoUrl: '/videos/zones/zen_intro.mp4',
    musicTrackId: 'zen-garden',
    primaryColor: '#88ffaa',
    accentColor: '#ff88aa',
    interiorColor: '#aaffcc',
    isMajorTransition: false,
    glowIntensity: 0.8,
  },
  [AdventureTrackType.SYNTHWAVE_SURF]: {
    id: AdventureTrackType.SYNTHWAVE_SURF,
    name: 'Synthwave Surf',
    storyText: 'SURF THE WAVES\n\nCatch the perfect break...',
    videoUrl: '/videos/zones/surf_intro.mp4',
    musicTrackId: 'synthwave-surf',
    primaryColor: '#ff88cc',
    accentColor: '#00ddff',
    interiorColor: '#ffaadd',
    isMajorTransition: false,
    glowIntensity: 1.1,
  },
  [AdventureTrackType.SOLAR_FLARE]: {
    id: AdventureTrackType.SOLAR_FLARE,
    name: 'Solar Flare',
    storyText: 'WARNING: SOLAR FLARE\n\nRadiation levels high...',
    videoUrl: '/videos/zones/solar_intro.mp4',
    musicTrackId: 'solar-flare',
    primaryColor: '#ffaa00',
    accentColor: '#ff4400',
    interiorColor: '#ffcc44',
    isMajorTransition: true,
    glowIntensity: 1.6,
  },
  [AdventureTrackType.PRISM_PATHWAY]: {
    id: AdventureTrackType.PRISM_PATHWAY,
    name: 'Prism Pathway',
    storyText: 'PRISM PATHWAY\n\nLight refracts infinitely...',
    videoUrl: '/videos/zones/prism_intro.mp4',
    musicTrackId: 'prism-path',
    primaryColor: '#ff00ff',
    accentColor: '#00ffff',
    interiorColor: '#ff88ff',
    isMajorTransition: true,
    glowIntensity: 1.5,
  },
  [AdventureTrackType.MAGNETIC_STORAGE]: {
    id: AdventureTrackType.MAGNETIC_STORAGE,
    name: 'Magnetic Storage',
    storyText: 'MAGNETIC STORAGE\n\nData streams flowing...',
    videoUrl: '/videos/zones/magnetic_intro.mp4',
    musicTrackId: 'magnetic',
    primaryColor: '#aa44ff',
    accentColor: '#00ff88',
    interiorColor: '#cc88ff',
    isMajorTransition: false,
    glowIntensity: 1.2,
  },
  [AdventureTrackType.NEURAL_NETWORK]: {
    id: AdventureTrackType.NEURAL_NETWORK,
    name: 'Neural Network',
    storyText: 'NEURAL NETWORK\n\nSynaptic pathways active...',
    videoUrl: '/videos/zones/neural_intro.mp4',
    musicTrackId: 'neural',
    primaryColor: '#ff66aa',
    accentColor: '#aa66ff',
    interiorColor: '#ff99cc',
    isMajorTransition: true,
    glowIntensity: 1.3,
  },
  [AdventureTrackType.NEON_STRONGHOLD]: {
    id: AdventureTrackType.NEON_STRONGHOLD,
    name: 'Neon Stronghold',
    storyText: 'NEON STRONGHOLD\n\nThe fortress awaits...',
    videoUrl: '/videos/zones/stronghold_intro.mp4',
    musicTrackId: 'stronghold',
    primaryColor: '#00aaff',
    accentColor: '#ff00cc',
    interiorColor: '#44ccff',
    isMajorTransition: true,
    glowIntensity: 1.4,
  },
  [AdventureTrackType.CASINO_HEIST]: {
    id: AdventureTrackType.CASINO_HEIST,
    name: 'Casino Heist',
    storyText: 'CASINO HEIST\n\nHigh stakes ahead...',
    videoUrl: '/videos/zones/casino_intro.mp4',
    musicTrackId: 'casino',
    primaryColor: '#ffcc00',
    accentColor: '#ff0044',
    interiorColor: '#ffdd44',
    isMajorTransition: true,
    glowIntensity: 1.5,
  },
  [AdventureTrackType.TESLA_TOWER]: {
    id: AdventureTrackType.TESLA_TOWER,
    name: 'Tesla Tower',
    storyText: 'TESLA TOWER\n\nHigh voltage zone...',
    videoUrl: '/videos/zones/tesla_intro.mp4',
    musicTrackId: 'tesla',
    primaryColor: '#aa66ff',
    accentColor: '#00ffff',
    interiorColor: '#cc99ff',
    isMajorTransition: true,
    glowIntensity: 1.6,
  },
  [AdventureTrackType.NEON_SKYLINE]: {
    id: AdventureTrackType.NEON_SKYLINE,
    name: 'Neon Skyline',
    storyText: 'NEON SKYLINE\n\nThe city never sleeps...',
    videoUrl: '/videos/zones/skyline_intro.mp4',
    musicTrackId: 'skyline',
    primaryColor: '#0088ff',
    accentColor: '#ff00aa',
    interiorColor: '#44aaff',
    isMajorTransition: true,
    glowIntensity: 1.3,
  },
  [AdventureTrackType.POLYCHROME_VOID]: {
    id: AdventureTrackType.POLYCHROME_VOID,
    name: 'Polychrome Void',
    storyText: 'THE POLYCHROME VOID\n\nBeyond the spectrum...',
    videoUrl: '/videos/zones/polychrome_intro.mp4',
    musicTrackId: 'polychrome',
    primaryColor: '#ffffff',
    accentColor: '#ff00ff',
    interiorColor: '#f0f0f0',
    isMajorTransition: true,
    glowIntensity: 1.4,
  },
}

/**
 * Get zone configuration by track type
 */
export function getZoneConfig(trackType: AdventureTrackType): ZoneConfig {
  return ZONE_REGISTRY[trackType]
}

/**
 * Check if a transition between two zones is major
 * (either source or destination is a major transition zone)
 */
export function isMajorTransition(from: AdventureTrackType | null, to: AdventureTrackType): boolean {
  if (!from) return true // First entry is always major
  const fromConfig = ZONE_REGISTRY[from]
  const toConfig = ZONE_REGISTRY[to]
  return (fromConfig?.isMajorTransition ?? false) || (toConfig?.isMajorTransition ?? false)
}

/**
 * Get shake intensity for a zone transition
 */
export function getTransitionShakeIntensity(from: AdventureTrackType | null, to: AdventureTrackType): number {
  if (isMajorTransition(from, to)) {
    return 0.6 // Strong shake for major transitions
  }
  return 0.25 // Subtle shake for minor transitions
}
