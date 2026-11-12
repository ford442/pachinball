/**
 * A scenario zone's path-mechanic placement (gate, magnet, spinner, jump pad, peg cluster).
 * Scenario data only: no runtime spawns these yet (the never-instantiated `PathMechanicsManager`
 * that once read them was deleted in #505).
 */
export interface ZoneTrigger {
  minZ: number
  maxZ: number
  mechanicType: 'gate' | 'magnet' | 'spinner' | 'jumppad' | 'pegs'
  config: Readonly<Record<string, unknown>>
  /** Optional callback when this trigger zone is entered */
  onEnter?: () => void
  /** Optional callback when this trigger zone is exited */
  onExit?: () => void
}

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
