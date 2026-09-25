import type { ZoneTrigger } from '../path-mechanics'

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
