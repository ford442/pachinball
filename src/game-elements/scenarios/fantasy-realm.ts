import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { DynamicScenario } from './types'

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
      videoUrl: 'backbox/crystal_cave.mp4',
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
      videoUrl: 'backbox/enchanted_forest.mp4',
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
      videoUrl: 'backbox/dragon_lair.mp4',
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
