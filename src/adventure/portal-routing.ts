import { Vector3 } from '@babylonjs/core'
import { AdventureTrackType } from './adventure-types'

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

export function getTrackStartAnchor(track: AdventureTrackType): Vector3 {
  return TRACK_START_ANCHORS[track].clone()
}

export function isAdventureTrackType(value: string): value is AdventureTrackType {
  return Object.values(AdventureTrackType).includes(value as AdventureTrackType)
}
