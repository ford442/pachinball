import { AdventureModeBuilder } from './adventure-mode-builder'
import { createHyperDriftTrackImpl, createPachinkoSpireTrackImpl, createOrbitalJunkyardTrackImpl, createFirewallBreachTrackImpl, createPrismPathwayTrackImpl } from './adventure-mode-tracks-a-1'
import { createMagneticStorageTrackImpl, createNeuralNetworkTrackImpl, createNeonStrongholdTrackImpl, createCasinoHeistTrackImpl } from './adventure-mode-tracks-a-2'

export abstract class AdventureModeTracksA extends AdventureModeBuilder {
  protected createHyperDriftTrack(): void { createHyperDriftTrackImpl(this) }
  protected createPachinkoSpireTrack(): void { createPachinkoSpireTrackImpl(this) }
  protected createOrbitalJunkyardTrack(): void { createOrbitalJunkyardTrackImpl(this) }
  protected createFirewallBreachTrack(): void { createFirewallBreachTrackImpl(this) }
  protected createPrismPathwayTrack(): void { createPrismPathwayTrackImpl(this) }

  protected createMagneticStorageTrack(): void { createMagneticStorageTrackImpl(this) }
  protected createNeuralNetworkTrack(): void { createNeuralNetworkTrackImpl(this) }
  protected createNeonStrongholdTrack(): void { createNeonStrongholdTrackImpl(this) }
  protected createCasinoHeistTrack(): void { createCasinoHeistTrackImpl(this) }
}
