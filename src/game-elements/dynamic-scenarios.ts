/**
 * Dynamic Adventure Mode - Example Scenarios
 * 
 * Three complete themed scenarios with:
 * - Unique visuals (LCD colors, lighting, materials)
 * - Zone-specific mechanics
 * - Backbox story sequences
 * - Thematic music and audio
 */

import { Vector3 } from '@babylonjs/core'
import type { ZoneTrigger } from './path-mechanics'

// =============================================================================
// SCENARIO CONFIGURATION TYPES
// =============================================================================

export interface ScenarioZone {
  id: string
  name: string
  position: { x: number; z: number }
  width: number
  depth: number
  mapConfig: {
    baseColor: string
    accentColor: string
    scanlineIntensity: number
    glowIntensity: number
    backgroundPattern: 'hex' | 'grid' | 'radial' | 'waves' | 'dots'
    animationSpeed: number
  }
  mechanics: ZoneTrigger[]
  storyText: string
  videoUrl?: string
  musicTrack: string
}

export interface DynamicScenario {
  id: string
  name: string
  description: string
  theme: 'samurai' | 'cyber-noir' | 'quantum' | 'fantasy' | 'retro'
  zones: ScenarioZone[]
  globalLighting: {
    ambientColor: string
    keyLightColor: string
    rimLightColor: string
  }
  ballTrailColor: string
}

// =============================================================================
// SCENARIO 1: SAMURAI REALM
// =============================================================================

export const SAMURAI_REALM_SCENARIO: DynamicScenario = {
  id: 'samurai-realm',
  name: 'Samurai Realm',
  description: 'Ancient Japan meets neon cyberpunk. Navigate through pagoda gates and sakura storms.',
  theme: 'samurai',
  zones: [
    {
      id: 'bamboo-forest',
      name: 'Bamboo Forest',
      position: { x: 0, z: -10 },
      width: 20,
      depth: 30,
      mapConfig: {
        baseColor: '#2d5a27', // Bamboo green
        accentColor: '#ff6b9d', // Sakura pink
        scanlineIntensity: 0.15,
        glowIntensity: 0.8,
        backgroundPattern: 'waves',
        animationSpeed: 0.3,
      },
      mechanics: [
        {
          minZ: -15,
          maxZ: -10,
          mechanicType: 'gate',
          config: {
            gateWidth: 6,
            cycleDuration: 3,
            position: new Vector3(0, 0, -12),
          },
        },
        {
          minZ: -8,
          maxZ: -5,
          mechanicType: 'pegs',
          config: {
            pegCount: 12,
            clusterRadius: 4,
            position: new Vector3(2, 0, -6),
          },
        },
      ],
      storyText: 'Enter the bamboo forest... ancient spirits watch your path.',
      musicTrack: 'samurai-ambient',
    },
    {
      id: 'pagoda-gates',
      name: 'Pagoda Gates',
      position: { x: 0, z: -40 },
      width: 20,
      depth: 25,
      mapConfig: {
        baseColor: '#8b0000', // Imperial red
        accentColor: '#ffd700', // Gold
        scanlineIntensity: 0.2,
        glowIntensity: 1.0,
        backgroundPattern: 'hex',
        animationSpeed: 0.5,
      },
      mechanics: [
        {
          minZ: -45,
          maxZ: -40,
          mechanicType: 'gate',
          config: {
            gateWidth: 8,
            openHeight: 3,
            cycleDuration: 4,
            position: new Vector3(0, 0, -42),
          },
        },
        {
          minZ: -38,
          maxZ: -35,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 5,
            pullStrength: 15,
            position: new Vector3(-3, 0, -36),
          },
        },
        {
          minZ: -33,
          maxZ: -30,
          mechanicType: 'spinner',
          config: {
            spinnerRadius: 2.5,
            launchForce: 25,
            position: new Vector3(3, 0, -31),
          },
        },
      ],
      storyText: 'The pagoda gates stand before you... prove your honor.',
      videoUrl: '/backbox/samurai-gates.mp4',
      musicTrack: 'samurai-action',
    },
    {
      id: 'sakura-storm',
      name: 'Sakura Storm',
      position: { x: 0, z: -70 },
      width: 25,
      depth: 30,
      mapConfig: {
        baseColor: '#ff69b4', // Hot pink
        accentColor: '#ffffff', // White petals
        scanlineIntensity: 0.1,
        glowIntensity: 1.2,
        backgroundPattern: 'radial',
        animationSpeed: 0.8,
      },
      mechanics: [
        {
          minZ: -75,
          maxZ: -70,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 45,
            launchForce: 30,
            position: new Vector3(0, 0, -72),
          },
        },
        {
          minZ: -68,
          maxZ: -65,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 6,
            pullStrength: 20,
            liftForce: 10,
            position: new Vector3(0, 0, -66),
          },
        },
        {
          minZ: -63,
          maxZ: -60,
          mechanicType: 'pegs',
          config: {
            pegCount: 16,
            clusterRadius: 5,
            activationScore: 3000,
            position: new Vector3(0, 0, -61),
          },
        },
      ],
      storyText: 'The sakura storm rages... find serenity in chaos.',
      musicTrack: 'samurai-climax',
    },
  ],
  globalLighting: {
    ambientColor: '#1a0f0a', // Warm dark
    keyLightColor: '#ffcc88', // Sunset gold
    rimLightColor: '#ff6b9d', // Sakura pink
  },
  ballTrailColor: '#ff6b9d',
}

// =============================================================================
// SCENARIO 2: CYBER NOIR
// =============================================================================

export const CYBER_NOIR_SCENARIO: DynamicScenario = {
  id: 'cyber-noir',
  name: 'Cyber Noir',
  description: 'Rain-soaked streets and neon shadows. A detective story in chrome and rain.',
  theme: 'cyber-noir',
  zones: [
    {
      id: 'rainy-streets',
      name: 'Rainy Streets',
      position: { x: 0, z: -10 },
      width: 20,
      depth: 30,
      mapConfig: {
        baseColor: '#1a1a2e', // Midnight blue
        accentColor: '#00d4aa', // Neon teal
        scanlineIntensity: 0.25,
        glowIntensity: 0.9,
        backgroundPattern: 'grid',
        animationSpeed: 0.4,
      },
      mechanics: [
        {
          minZ: -15,
          maxZ: -10,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 4,
            pullStrength: 12,
            position: new Vector3(-2, 0, -12),
          },
        },
        {
          minZ: -8,
          maxZ: -5,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 35,
            launchForce: 20,
            position: new Vector3(2, 0, -6),
          },
        },
      ],
      storyText: 'The rain never stops in Sector 7... watch your step.',
      musicTrack: 'noir-ambient',
    },
    {
      id: 'neon-alley',
      name: 'Neon Alley',
      position: { x: 0, z: -40 },
      width: 15,
      depth: 25,
      mapConfig: {
        baseColor: '#2d1b4e', // Purple shadow
        accentColor: '#ff00ff', // Hot magenta
        scanlineIntensity: 0.3,
        glowIntensity: 1.3,
        backgroundPattern: 'dots',
        animationSpeed: 0.6,
      },
      mechanics: [
        {
          minZ: -45,
          maxZ: -40,
          mechanicType: 'gate',
          config: {
            gateWidth: 5,
            closedHeight: 1.5,
            cycleDuration: 2.5,
            position: new Vector3(0, 0, -42),
          },
        },
        {
          minZ: -38,
          maxZ: -35,
          mechanicType: 'spinner',
          config: {
            spinnerRadius: 2,
            launchForce: 20,
            spinSpeed: 10,
            position: new Vector3(0, 0, -36),
          },
        },
        {
          minZ: -33,
          maxZ: -30,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 5,
            pullStrength: 18,
            position: new Vector3(0, 0, -31),
          },
        },
      ],
      storyText: 'Neon signs flicker... someone is watching.',
      videoUrl: '/backbox/noir-alley.mp4',
      musicTrack: 'noir-tension',
    },
    {
      id: 'chrome-district',
      name: 'Chrome District',
      position: { x: 0, z: -70 },
      width: 25,
      depth: 30,
      mapConfig: {
        baseColor: '#0a0a0a', // Black chrome
        accentColor: '#00ffff', // Cyan neon
        scanlineIntensity: 0.35,
        glowIntensity: 1.5,
        backgroundPattern: 'hex',
        animationSpeed: 1.0,
      },
      mechanics: [
        {
          minZ: -75,
          maxZ: -70,
          mechanicType: 'spinner',
          config: {
            spinnerRadius: 3,
            launchForce: 35,
            spinSpeed: 12,
            position: new Vector3(-4, 0, -72),
          },
        },
        {
          minZ: -70,
          maxZ: -65,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 50,
            launchForce: 28,
            position: new Vector3(0, 0, -67),
          },
        },
        {
          minZ: -63,
          maxZ: -60,
          mechanicType: 'pegs',
          config: {
            pegCount: 20,
            clusterRadius: 6,
            activationScore: 5000,
            position: new Vector3(0, 0, -61),
          },
        },
      ],
      storyText: 'The Chrome District... where souls are uploaded and dreams are deleted.',
      musicTrack: 'noir-climax',
    },
  ],
  globalLighting: {
    ambientColor: '#0a0a12', // Cold dark
    keyLightColor: '#4a5568', // Steel blue
    rimLightColor: '#ff00ff', // Neon magenta
  },
  ballTrailColor: '#00ffff',
}

// =============================================================================
// SCENARIO 3: QUANTUM DREAM
// =============================================================================

export const QUANTUM_DREAM_SCENARIO: DynamicScenario = {
  id: 'quantum-dream',
  name: 'Quantum Dream',
  description: 'Reality bends and fractals bloom. Navigate through impossible geometries.',
  theme: 'quantum',
  zones: [
    {
      id: 'fractal-garden',
      name: 'Fractal Garden',
      position: { x: 0, z: -10 },
      width: 20,
      depth: 30,
      mapConfig: {
        baseColor: '#4b0082', // Indigo
        accentColor: '#00ff88', // Electric green
        scanlineIntensity: 0.2,
        glowIntensity: 1.0,
        backgroundPattern: 'radial',
        animationSpeed: 0.5,
      },
      mechanics: [
        {
          minZ: -15,
          maxZ: -10,
          mechanicType: 'pegs',
          config: {
            pegCount: 8,
            clusterRadius: 3,
            position: new Vector3(0, 0, -12),
          },
        },
        {
          minZ: -8,
          maxZ: -5,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 6,
            pullStrength: 25,
            liftForce: 12,
            position: new Vector3(0, 0, -6),
          },
        },
      ],
      storyText: 'Reality fragments... the garden grows in impossible directions.',
      musicTrack: 'quantum-ambient',
    },
    {
      id: 'probability-waves',
      name: 'Probability Waves',
      position: { x: 0, z: -40 },
      width: 25,
      depth: 25,
      mapConfig: {
        baseColor: '#1a0033', // Deep purple
        accentColor: '#ff6600', // Quantum orange
        scanlineIntensity: 0.15,
        glowIntensity: 1.1,
        backgroundPattern: 'waves',
        animationSpeed: 0.9,
      },
      mechanics: [
        {
          minZ: -45,
          maxZ: -40,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 60,
            launchForce: 35,
            position: new Vector3(-3, 0, -42),
          },
        },
        {
          minZ: -42,
          maxZ: -38,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 60,
            launchForce: 35,
            position: new Vector3(3, 0, -40),
          },
        },
        {
          minZ: -38,
          maxZ: -35,
          mechanicType: 'spinner',
          config: {
            spinnerRadius: 2.5,
            launchForce: 30,
            spinSpeed: 8,
            position: new Vector3(0, 0, -36),
          },
        },
      ],
      storyText: 'Probability collapses... choose your path wisely.',
      videoUrl: '/backbox/quantum-waves.mp4',
      musicTrack: 'quantum-tension',
    },
    {
      id: 'singularity-core',
      name: 'Singularity Core',
      position: { x: 0, z: -70 },
      width: 30,
      depth: 30,
      mapConfig: {
        baseColor: '#000000', // Void black
        accentColor: '#ffffff', // White hot
        scanlineIntensity: 0.4,
        glowIntensity: 2.0,
        backgroundPattern: 'radial',
        animationSpeed: 1.5,
      },
      mechanics: [
        {
          minZ: -75,
          maxZ: -70,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 8,
            pullStrength: 35,
            liftForce: 15,
            position: new Vector3(0, 0, -72),
          },
        },
        {
          minZ: -70,
          maxZ: -65,
          mechanicType: 'gate',
          config: {
            gateWidth: 10,
            openHeight: 5,
            closedHeight: 0.5,
            cycleDuration: 5,
            position: new Vector3(0, 0, -67),
          },
        },
        {
          minZ: -63,
          maxZ: -60,
          mechanicType: 'pegs',
          config: {
            pegCount: 24,
            clusterRadius: 7,
            activationScore: 10000,
            position: new Vector3(0, 0, -61),
          },
        },
      ],
      storyText: 'The singularity awaits... transcend or be absorbed.',
      musicTrack: 'quantum-climax',
    },
  ],
  globalLighting: {
    ambientColor: '#0d001a', // Void purple
    keyLightColor: '#9933ff', // Electric purple
    rimLightColor: '#00ff88', // Quantum green
  },
  ballTrailColor: '#ff6600',
}

// =============================================================================
// SCENARIO 4: MOVIE GANGSTER (Film Noir)
// =============================================================================

export const MOVIE_GANGSTER_SCENARIO: DynamicScenario = {
  id: 'movie-gangster',
  name: 'Movie Gangster',
  description: 'Step into a black-and-white crime saga. Smoke-filled speakeasies, bullet-riddled alleyways, and the golden glow of streetlamps.',
  theme: 'cyber-noir',
  zones: [
    {
      id: 'speakeasy',
      name: 'The Speakeasy',
      position: { x: 0, z: -10 },
      width: 20,
      depth: 25,
      mapConfig: {
        baseColor: '#2a2a2a', // Deep charcoal
        accentColor: '#c9a227', // Gold/amber
        scanlineIntensity: 0.15,
        glowIntensity: 0.7,
        backgroundPattern: 'dots',
        animationSpeed: 0.3,
      },
      mechanics: [
        {
          minZ: -15,
          maxZ: -10,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 5,
            pullStrength: 12,
            position: new Vector3(0, 0, -12),
          },
        },
        {
          minZ: -8,
          maxZ: -5,
          mechanicType: 'pegs',
          config: {
            pegCount: 10,
            clusterRadius: 4,
            position: new Vector3(-2, 0, -6),
          },
        },
      ],
      storyText: 'The speakeasy door creaks open... the password is luck.',
      videoUrl: '/backbox/speakeasy_intro.mp4',
      musicTrack: 'noir-jazz',
    },
    {
      id: 'rainy-alley',
      name: 'Rainy Alley',
      position: { x: 0, z: -40 },
      width: 15,
      depth: 25,
      mapConfig: {
        baseColor: '#1a1a1a', // Almost black
        accentColor: '#ffffff', // Streetlamp white
        scanlineIntensity: 0.2,
        glowIntensity: 0.9,
        backgroundPattern: 'grid',
        animationSpeed: 0.5,
      },
      mechanics: [
        {
          minZ: -45,
          maxZ: -40,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 40,
            launchForce: 22,
            position: new Vector3(0, 0, -42),
          },
        },
        {
          minZ: -38,
          maxZ: -35,
          mechanicType: 'spinner',
          config: {
            spinnerRadius: 2.5,
            launchForce: 20,
            spinSpeed: 6,
            position: new Vector3(2, 0, -36),
          },
        },
      ],
      storyText: 'Footsteps echo in the alley... watch your back.',
      videoUrl: '/backbox/alley_chase.mp4',
      musicTrack: 'noir-tension',
    },
    {
      id: 'bank-heist',
      name: 'The Big Score',
      position: { x: 0, z: -70 },
      width: 25,
      depth: 30,
      mapConfig: {
        baseColor: '#0f1419', // Midnight blue-black
        accentColor: '#ffd700', // Gold bars
        scanlineIntensity: 0.25,
        glowIntensity: 1.2,
        backgroundPattern: 'hex',
        animationSpeed: 0.7,
      },
      mechanics: [
        {
          minZ: -75,
          maxZ: -70,
          mechanicType: 'gate',
          config: {
            gateWidth: 8,
            openHeight: 4,
            closedHeight: 0.5,
            cycleDuration: 5,
            position: new Vector3(0, 0, -72),
          },
        },
        {
          minZ: -70,
          maxZ: -65,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 6,
            pullStrength: 20,
            liftForce: 8,
            position: new Vector3(-3, 0, -67),
          },
        },
        {
          minZ: -63,
          maxZ: -60,
          mechanicType: 'pegs',
          config: {
            pegCount: 20,
            clusterRadius: 6,
            activationScore: 8000,
            position: new Vector3(0, 0, -61),
          },
        },
      ],
      storyText: 'The vault awaits... crack it open or walk away.',
      videoUrl: '/backbox/vault_crack.mp4',
      musicTrack: 'noir-climax',
    },
  ],
  globalLighting: {
    ambientColor: '#0a0a0a', // Near black
    keyLightColor: '#e8dcc0', // Sepia/warm white
    rimLightColor: '#c9a227', // Gold rim
  },
  ballTrailColor: '#ffd700',
}

// =============================================================================
// SCENARIO 5: FANTASY REALM
// =============================================================================

export const FANTASY_REALM_SCENARIO: DynamicScenario = {
  id: 'fantasy-realm',
  name: 'Fantasy Realm',
  description: 'Enter a world of magic and dragons. Crystal caves, enchanted forests, and the dragon\'s lair await.',
  theme: 'fantasy',
  zones: [
    {
      id: 'crystal-cave',
      name: 'Crystal Cave',
      position: { x: 0, z: -10 },
      width: 20,
      depth: 25,
      mapConfig: {
        baseColor: '#4b0082', // Indigo
        accentColor: '#00ffff', // Cyan crystals
        scanlineIntensity: 0.2,
        glowIntensity: 1.0,
        backgroundPattern: 'radial',
        animationSpeed: 0.4,
      },
      mechanics: [
        {
          minZ: -15,
          maxZ: -10,
          mechanicType: 'pegs',
          config: {
            pegCount: 12,
            clusterRadius: 5,
            position: new Vector3(0, 0, -12),
          },
        },
        {
          minZ: -8,
          maxZ: -5,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 4,
            pullStrength: 15,
            liftForce: 5,
            position: new Vector3(3, 0, -6),
          },
        },
      ],
      storyText: 'The crystals hum with ancient magic... listen closely.',
      videoUrl: '/backbox/crystal_cave.mp4',
      musicTrack: 'fantasy-mystical',
    },
    {
      id: 'enchanted-forest',
      name: 'Enchanted Forest',
      position: { x: 0, z: -40 },
      width: 25,
      depth: 30,
      mapConfig: {
        baseColor: '#228b22', // Forest green
        accentColor: '#ff69b4', // Fairy pink
        scanlineIntensity: 0.15,
        glowIntensity: 1.1,
        backgroundPattern: 'waves',
        animationSpeed: 0.6,
      },
      mechanics: [
        {
          minZ: -45,
          maxZ: -40,
          mechanicType: 'spinner',
          config: {
            spinnerRadius: 3,
            launchForce: 25,
            spinSpeed: 8,
            position: new Vector3(-3, 0, -42),
          },
        },
        {
          minZ: -38,
          maxZ: -35,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 50,
            launchForce: 28,
            position: new Vector3(0, 0, -36),
          },
        },
        {
          minZ: -33,
          maxZ: -30,
          mechanicType: 'magnet',
          config: {
            fieldRadius: 5,
            pullStrength: 18,
            position: new Vector3(3, 0, -31),
          },
        },
      ],
      storyText: 'Fairies dance between the trees... catch them if you can.',
      videoUrl: '/backbox/enchanted_forest.mp4',
      musicTrack: 'fantasy-whimsical',
    },
    {
      id: 'dragon-lair',
      name: "Dragon's Lair",
      position: { x: 0, z: -75 },
      width: 30,
      depth: 35,
      mapConfig: {
        baseColor: '#8b0000', // Dark red
        accentColor: '#ff4500', // Fire orange
        scanlineIntensity: 0.3,
        glowIntensity: 1.5,
        backgroundPattern: 'radial',
        animationSpeed: 1.0,
      },
      mechanics: [
        {
          minZ: -80,
          maxZ: -75,
          mechanicType: 'gate',
          config: {
            gateWidth: 10,
            openHeight: 5,
            closedHeight: 0.5,
            cycleDuration: 4,
            position: new Vector3(0, 0, -77),
          },
        },
        {
          minZ: -75,
          maxZ: -70,
          mechanicType: 'jumppad',
          config: {
            launchAngle: 55,
            launchForce: 35,
            position: new Vector3(0, 0, -72),
          },
        },
        {
          minZ: -68,
          maxZ: -65,
          mechanicType: 'pegs',
          config: {
            pegCount: 24,
            clusterRadius: 7,
            activationScore: 12000,
            position: new Vector3(0, 0, -66),
          },
        },
      ],
      storyText: 'The dragon awakens... brave the flames for treasure!',
      videoUrl: '/backbox/dragon_lair.mp4',
      musicTrack: 'fantasy-epic',
    },
  ],
  globalLighting: {
    ambientColor: '#1a0a2e', // Deep purple
    keyLightColor: '#ffcc66', // Golden sunlight
    rimLightColor: '#00ffff', // Magic cyan
  },
  ballTrailColor: '#ff4500',
}

// =============================================================================
// SCENARIO REGISTRY
// =============================================================================

export const DYNAMIC_SCENARIOS: Record<string, DynamicScenario> = {
  'samurai-realm': SAMURAI_REALM_SCENARIO,
  'cyber-noir': CYBER_NOIR_SCENARIO,
  'quantum-dream': QUANTUM_DREAM_SCENARIO,
  'movie-gangster': MOVIE_GANGSTER_SCENARIO,
  'fantasy-realm': FANTASY_REALM_SCENARIO,
}

export function getScenario(id: string): DynamicScenario | undefined {
  return DYNAMIC_SCENARIOS[id]
}

export function getAllScenarios(): DynamicScenario[] {
  return Object.values(DYNAMIC_SCENARIOS)
}

export function getScenarioIds(): string[] {
  return Object.keys(DYNAMIC_SCENARIOS)
}

// =============================================================================
// MODE TOGGLE
// =============================================================================

export type GameMode = 'fixed' | 'dynamic'

export interface ModeToggleState {
  currentMode: GameMode
  currentScenario: string | null
  isTransitioning: boolean
}

export function createDefaultModeState(): ModeToggleState {
  return {
    currentMode: 'fixed',
    currentScenario: null,
    isTransitioning: false,
  }
}

export function toggleGameMode(state: ModeToggleState): ModeToggleState {
  const newMode: GameMode = state.currentMode === 'fixed' ? 'dynamic' : 'fixed'
  return {
    ...state,
    currentMode: newMode,
    isTransitioning: true,
  }
}

export function setScenario(state: ModeToggleState, scenarioId: string): ModeToggleState {
  return {
    ...state,
    currentScenario: scenarioId,
    currentMode: 'dynamic',
    isTransitioning: true,
  }
}

export function completeTransition(state: ModeToggleState): ModeToggleState {
  return {
    ...state,
    isTransitioning: false,
  }
}
