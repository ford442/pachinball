import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { DynamicScenario } from './types'

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
      videoUrl: 'backbox/quantum-waves.mp4',
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
