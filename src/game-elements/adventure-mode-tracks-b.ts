import { AdventureModeTracksA } from './adventure-mode-tracks-a'
import { createCpuCoreTrackImpl, createCryoChamberTrackImpl, createBioHazardLabTrackImpl } from './adventure-mode-tracks-b-1'
import { createGravityForgeTrackImpl, createTidalNexusTrackImpl, createDigitalZenGardenTrackImpl, createSynthwaveSurfTrackImpl, createSolarFlareTrackImpl } from './adventure-mode-tracks-b-2'

export abstract class AdventureModeTracksB extends AdventureModeTracksA {
  protected createCpuCoreTrack(): void { createCpuCoreTrackImpl(this) }
  protected createCryoChamberTrack(): void { createCryoChamberTrackImpl(this) }
  protected createBioHazardLabTrack(): void { createBioHazardLabTrackImpl(this) }
  protected createGravityForgeTrack(): void { createGravityForgeTrackImpl(this) }
  protected createTidalNexusTrack(): void { createTidalNexusTrackImpl(this) }
  protected createDigitalZenGardenTrack(): void { createDigitalZenGardenTrackImpl(this) }
  protected createSynthwaveSurfTrack(): void { createSynthwaveSurfTrackImpl(this) }
  protected createSolarFlareTrack(): void { createSolarFlareTrackImpl(this) }
}
