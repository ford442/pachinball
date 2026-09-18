import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { DynamicScenario } from './types'

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
      videoUrl: 'backbox/speakeasy_intro.mp4',
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
      videoUrl: 'backbox/alley_chase.mp4',
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
      videoUrl: 'backbox/vault_crack.mp4',
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
