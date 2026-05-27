import { Vector3 } from '@babylonjs/core'
import { AdventureTrackType } from './adventure-types'

export const ADVENTURE_TRACK_SEQUENCE: AdventureTrackType[] = [
  AdventureTrackType.NEON_HELIX,
  AdventureTrackType.CYBER_CORE,
  AdventureTrackType.QUANTUM_GRID,
  AdventureTrackType.SINGULARITY_WELL,
  AdventureTrackType.GLITCH_SPIRE,
  AdventureTrackType.RETRO_WAVE_HILLS,
  AdventureTrackType.CHRONO_CORE,
  AdventureTrackType.HYPER_DRIFT,
  AdventureTrackType.PACHINKO_SPIRE,
  AdventureTrackType.ORBITAL_JUNKYARD,
  AdventureTrackType.FIREWALL_BREACH,
  AdventureTrackType.CPU_CORE,
  AdventureTrackType.CRYO_CHAMBER,
  AdventureTrackType.BIO_HAZARD_LAB,
  AdventureTrackType.GRAVITY_FORGE,
  AdventureTrackType.TIDAL_NEXUS,
  AdventureTrackType.DIGITAL_ZEN_GARDEN,
  AdventureTrackType.SYNTHWAVE_SURF,
  AdventureTrackType.SOLAR_FLARE,
  AdventureTrackType.PRISM_PATHWAY,
  AdventureTrackType.MAGNETIC_STORAGE,
  AdventureTrackType.NEURAL_NETWORK,
  AdventureTrackType.NEON_STRONGHOLD,
  AdventureTrackType.CASINO_HEIST,
  AdventureTrackType.TESLA_TOWER,
  AdventureTrackType.NEON_SKYLINE,
  AdventureTrackType.POLYCHROME_VOID,
]

const TRACK_START_ANCHORS: Record<AdventureTrackType, Vector3> = {
  [AdventureTrackType.NEON_HELIX]: new Vector3(0, 2, 8),
  [AdventureTrackType.CYBER_CORE]: new Vector3(0, 20, 0),
  [AdventureTrackType.QUANTUM_GRID]: new Vector3(0, 10, 0),
  [AdventureTrackType.SINGULARITY_WELL]: new Vector3(0, 25, 0),
  [AdventureTrackType.GLITCH_SPIRE]: new Vector3(0, 10, 0),
  [AdventureTrackType.RETRO_WAVE_HILLS]: new Vector3(0, 5, 0),
  [AdventureTrackType.CHRONO_CORE]: new Vector3(0, 15, 0),
  [AdventureTrackType.HYPER_DRIFT]: new Vector3(0, 15, 0),
  [AdventureTrackType.PACHINKO_SPIRE]: new Vector3(0, 30, 0),
  [AdventureTrackType.ORBITAL_JUNKYARD]: new Vector3(0, 15, 0),
  [AdventureTrackType.FIREWALL_BREACH]: new Vector3(0, 25, 0),
  [AdventureTrackType.CPU_CORE]: new Vector3(0, 15, 0),
  [AdventureTrackType.CRYO_CHAMBER]: new Vector3(0, 20, 0),
  [AdventureTrackType.BIO_HAZARD_LAB]: new Vector3(0, 20, 0),
  [AdventureTrackType.GRAVITY_FORGE]: new Vector3(0, 20, 0),
  [AdventureTrackType.TIDAL_NEXUS]: new Vector3(0, 25, 0),
  [AdventureTrackType.DIGITAL_ZEN_GARDEN]: new Vector3(0, 20, 0),
  [AdventureTrackType.SYNTHWAVE_SURF]: new Vector3(0, 20, 0),
  [AdventureTrackType.SOLAR_FLARE]: new Vector3(0, 20, 0),
  [AdventureTrackType.PRISM_PATHWAY]: new Vector3(0, 20, 0),
  [AdventureTrackType.MAGNETIC_STORAGE]: new Vector3(0, 20, 0),
  [AdventureTrackType.NEURAL_NETWORK]: new Vector3(0, 20, 0),
  [AdventureTrackType.NEON_STRONGHOLD]: new Vector3(0, 20, 0),
  [AdventureTrackType.CASINO_HEIST]: new Vector3(0, 20, 0),
  [AdventureTrackType.TESLA_TOWER]: new Vector3(0, 20, 0),
  [AdventureTrackType.NEON_SKYLINE]: new Vector3(0, 20, 0),
  [AdventureTrackType.POLYCHROME_VOID]: new Vector3(0, 20, 0),
}

export function getNextAdventureTrack(track: AdventureTrackType): AdventureTrackType {
  const idx = ADVENTURE_TRACK_SEQUENCE.indexOf(track)
  if (idx < 0) return ADVENTURE_TRACK_SEQUENCE[0]
  return ADVENTURE_TRACK_SEQUENCE[(idx + 1) % ADVENTURE_TRACK_SEQUENCE.length]
}

export function getTrackStartAnchor(track: AdventureTrackType): Vector3 {
  return TRACK_START_ANCHORS[track].clone()
}

export function isAdventureTrackType(value: string): value is AdventureTrackType {
  return Object.values(AdventureTrackType).includes(value as AdventureTrackType)
}
