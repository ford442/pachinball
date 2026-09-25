import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { DynamicScenario } from './types'

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
      videoUrl: 'backbox/noir-alley.mp4',
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
