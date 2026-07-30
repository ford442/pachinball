/**
 * TS track builder dispatch table — keyed by AdventureTrackType.
 */

import { AdventureTrackType } from '../adventure-types'
import type { TrackBuilderFn } from './track-manifest-types'
import { buildNeonHelix } from '../tracks/neon-helix'
import { buildCyberCore } from '../tracks/cyber-core'
import { buildQuantumGrid } from '../tracks/quantum-grid'
import { buildSingularityWell } from '../tracks/singularity-well'
import { buildChronoCore } from '../tracks/chrono-core'
import { buildPachinkoHall } from '../tracks/pachinko-hall'
import { buildPachinkoSpire } from '../tracks/pachinko-spire'
import { buildOrbitalJunkyard } from '../tracks/orbital-junkyard'
import { buildFirewallBreach } from '../tracks/firewall-breach'
import { buildPrismPathway } from '../tracks/prism-pathway'
import { buildMagneticStorage } from '../tracks/magnetic-storage'
import { buildNeuralNetwork } from '../tracks/neural-network'
import { buildNeonStronghold } from '../tracks/neon-stronghold'
import { buildCasinoHeist } from '../tracks/casino-heist'
import { buildCpuCore } from '../tracks/cpu-core'
import { buildCryoChamber } from '../tracks/cryo-chamber'
import { buildBioHazardLab } from '../tracks/bio-hazard-lab'
import { buildGravityForge } from '../tracks/gravity-forge'
import { buildTidalNexus } from '../tracks/tidal-nexus'
import { buildDigitalZenGarden } from '../tracks/digital-zen-garden'
import { buildSynthwaveSurf } from '../tracks/synthwave-surf'
import { buildSolarFlare } from '../tracks/solar-flare'
import { buildTeslaTower } from '../tracks/tesla-tower'
import { buildNeonSkyline } from '../tracks/neon-skyline'
import { buildPolychromeVoid } from '../tracks/polychrome-void'

export const TS_BUILDERS: Partial<Record<AdventureTrackType, TrackBuilderFn>> = {
  [AdventureTrackType.NEON_HELIX]: buildNeonHelix,
  [AdventureTrackType.CYBER_CORE]: buildCyberCore,
  [AdventureTrackType.PACHINKO_HALL]: buildPachinkoHall,
  [AdventureTrackType.QUANTUM_GRID]: buildQuantumGrid,
  [AdventureTrackType.SINGULARITY_WELL]: buildSingularityWell,
  [AdventureTrackType.CHRONO_CORE]: buildChronoCore,
  [AdventureTrackType.PACHINKO_SPIRE]: buildPachinkoSpire,
  [AdventureTrackType.ORBITAL_JUNKYARD]: buildOrbitalJunkyard,
  [AdventureTrackType.FIREWALL_BREACH]: buildFirewallBreach,
  [AdventureTrackType.CPU_CORE]: buildCpuCore,
  [AdventureTrackType.CRYO_CHAMBER]: buildCryoChamber,
  [AdventureTrackType.BIO_HAZARD_LAB]: buildBioHazardLab,
  [AdventureTrackType.GRAVITY_FORGE]: buildGravityForge,
  [AdventureTrackType.TIDAL_NEXUS]: buildTidalNexus,
  [AdventureTrackType.DIGITAL_ZEN_GARDEN]: buildDigitalZenGarden,
  [AdventureTrackType.SYNTHWAVE_SURF]: buildSynthwaveSurf,
  [AdventureTrackType.SOLAR_FLARE]: buildSolarFlare,
  [AdventureTrackType.PRISM_PATHWAY]: buildPrismPathway,
  [AdventureTrackType.MAGNETIC_STORAGE]: buildMagneticStorage,
  [AdventureTrackType.NEURAL_NETWORK]: buildNeuralNetwork,
  [AdventureTrackType.NEON_STRONGHOLD]: buildNeonStronghold,
  [AdventureTrackType.CASINO_HEIST]: buildCasinoHeist,
  [AdventureTrackType.TESLA_TOWER]: buildTeslaTower,
  [AdventureTrackType.NEON_SKYLINE]: buildNeonSkyline,
  [AdventureTrackType.POLYCHROME_VOID]: buildPolychromeVoid,
}
