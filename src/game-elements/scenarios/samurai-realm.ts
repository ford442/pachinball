import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { DynamicScenario } from './types'

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
      videoUrl: 'backbox/samurai-gates.mp4',
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
