import type { Vector3 } from '@babylonjs/core'
import { BallType } from '../config'
import type { EventBus } from '../game/event-bus'
import {
  type ImpactCategory,
  type ImpactVoiceOptions,
} from './audio-synth'
import {
  type AudioMusicStem,
  type AudioSampleKey,
  type AudioSourceMode,
  type SampleCategory,
} from './audio-sample-bank'
import { bindSoundEventBindings } from './sound-event-bindings'
import {
  doInitSoundSystemContext,
  disposeSoundSystemContext,
  getEffectiveMusicVolume,
  getVolumeSettings,
  initSoundSystemContext,
  isReady,
  resumeSoundSystemContext,
  setHumVolume,
  setMasterVolume,
  setMusicVolume,
  setSfxVolume,
  suspendSoundSystemContext,
  toggleMute,
  type SoundSystemContextState,
} from './sound-system-context'
import {
  decodeLocalSampleBank,
  fetchMusicTracks,
  playJackpotPhase,
  playLocalSampleKey,
  playMapMusic,
  playMusicStem,
  playSample,
  resetJackpotPhaseAudio,
  stopMusic,
  usesSampleBank,
  waitForSampleBank,
  type CachedSample,
  type MusicTrack,
  type SoundSystemSamplesState,
} from './sound-system-samples'
import {
  createSynthesizedGameSounds,
  loadGoldBallSounds,
  playBeep,
  playGoldBallCollect,
  playGoldBallSpawn,
  playImpact,
  playJackpotAlarmSynth,
  playJackpotExplosionSynth,
  playJackpotTurbineSynth,
  playNearMiss,
  playPortalEnter,
  playReelStop,
  playSlotJackpot,
  playSlotSpinStart,
  playSlotWin,
  playSynthesizedNamedSound,
  type SoundSystemSynthState,
} from './sound-system-synth'

export type { SampleCategory } from './audio-sample-bank'
export type MapId = string

export class SoundSystem {
  audioContext: AudioContext | null = null
  masterGain: GainNode | null = null
  sfxGain: GainNode | null = null
  musicMasterGain: GainNode | null = null
  musicGainA: GainNode | null = null
  musicGainB: GainNode | null = null
  musicSourceA: AudioBufferSourceNode | null = null
  musicSourceB: AudioBufferSourceNode | null = null
  musicBufferA: AudioBuffer | null = null
  musicBufferB: AudioBuffer | null = null
  musicTrackIdA: string | null = null
  musicTrackIdB: string | null = null
  activeMusicChannel: 'A' | 'B' = 'A'
  readonly CROSSFADE_DURATION = 0.8
  humOscillator: OscillatorNode | null = null
  humHarmonicOscillator: OscillatorNode | null = null
  humGain: GainNode | null = null
  sampleCache: Map<string, CachedSample> = new Map()
  samplesByCategory: Map<SampleCategory, string[]> = new Map()
  musicCache: Map<string, MusicTrack> = new Map()
  spatialPanner: PannerNode | null = null
  masterVolume = 0.8
  musicVolume = 0.6
  sfxVolume = 0.9
  isMuted = false
  lastImpactAtByCategory: Partial<Record<ImpactCategory, number>> = {}
  isInitialized = false
  loadPromise: Promise<void> | null = null
  audioSource: AudioSourceMode = 'samples'
  localSampleBuffers = new Map<AudioSampleKey, AudioBuffer>()
  localMusicBuffers = new Map<AudioMusicStem, AudioBuffer>()
  sampleBankReady = false
  sampleBankPromise: Promise<void> | null = null
  activeMusicStem: AudioMusicStem | null = null
  lastJackpotPhasePlayed = 0
  synthesizedSounds: Map<string, { play: () => void }> = new Map()
  private eventBusUnsubscribers: Array<() => void> = []

  constructor() {
    this.samplesByCategory.set('peg', [])
    this.samplesByCategory.set('bumper', [])
    this.samplesByCategory.set('flipper', [])
    this.samplesByCategory.set('jackpot', [])
    this.samplesByCategory.set('fever', [])
    this.samplesByCategory.set('launch', [])
    this.samplesByCategory.set('drain', [])
  }

  addEventBusUnsubscriber(unsub: () => void): void {
    this.eventBusUnsubscribers.push(unsub)
  }

  async init(): Promise<void> {
    return initSoundSystemContext(this.asContextState(), () => this.doInit())
  }

  private async doInit(): Promise<void> {
    return doInitSoundSystemContext(this.asContextState(), {
      createSynthesizedGameSounds: () => this.createSynthesizedGameSounds(),
      decodeLocalSampleBank: () => this.decodeLocalSampleBank(),
      loadGoldBallSounds: () => this.loadGoldBallSounds(),
    })
  }

  async resume(): Promise<void> {
    await resumeSoundSystemContext(this.asContextState())
  }

  async suspend(): Promise<void> {
    await suspendSoundSystemContext(this.asContextState())
  }

  setHumVolume(volume: number): void {
    setHumVolume(this.asContextState(), volume)
  }

  setAudioSource(mode: AudioSourceMode): void {
    this.audioSource = mode
  }

  getAudioSource(): AudioSourceMode {
    return this.audioSource
  }

  async waitForSampleBank(): Promise<void> {
    await waitForSampleBank(this.asSamplesState())
  }

  private usesSampleBank(): boolean {
    return usesSampleBank(this.asSamplesState())
  }

  private async decodeLocalSampleBank(): Promise<void> {
    await decodeLocalSampleBank(this.asSamplesState())
  }

  private playLocalSampleKey(key: AudioSampleKey, volume = 1, position?: Vector3, playbackRate = 1): boolean {
    return playLocalSampleKey(this.asSamplesState(), key, volume, position, playbackRate)
  }

  playJackpotPhase(phase: number): void {
    playJackpotPhase(this.asSamplesState(), phase, {
      playJackpotAlarmSynth: () => this.playJackpotAlarmSynth(),
      playJackpotTurbineSynth: (duration) => this.playJackpotTurbineSynth(duration),
      playJackpotExplosionSynth: () => this.playJackpotExplosionSynth(),
      playSlotJackpot: () => this.playSlotJackpot(),
    })
  }

  resetJackpotPhaseAudio(): void {
    resetJackpotPhaseAudio(this.asSamplesState())
  }

  async playMusicStem(stem: AudioMusicStem): Promise<void> {
    await playMusicStem(this.asSamplesState(), stem, () => this.getEffectiveMusicVolume())
  }

  private getEffectiveMusicVolume(): number {
    return getEffectiveMusicVolume(this.asContextState())
  }

  playSample(category: SampleCategory, position?: Vector3, volume = 1): void {
    playSample(this.asSamplesState(), category, position, volume)
  }

  playImpact(
    category: ImpactCategory,
    velocity: number,
    options: ImpactVoiceOptions & { position?: Vector3 } = {},
  ): void {
    playImpact(this.asSynthState(), category, velocity, options, {
      usesSampleBank: () => this.usesSampleBank(),
      playLocalSampleKey: (key, volume, position, playbackRate) =>
        this.playLocalSampleKey(key, volume, position, playbackRate),
    })
  }

  playPortalEnter(premium = true): void {
    playPortalEnter(this.asSynthState(), premium, {
      usesSampleBank: () => this.usesSampleBank(),
      playLocalSampleKey: (key, volume, position, playbackRate) =>
        this.playLocalSampleKey(key, volume, position, playbackRate),
    })
  }

  async fetchMusicTracks(): Promise<void> {
    await fetchMusicTracks()
  }

  async playMapMusic(mapId: MapId): Promise<void> {
    await playMapMusic(this.asSamplesState(), mapId)
  }

  stopMusic(): void {
    stopMusic(this.asSamplesState())
  }

  triggerJackpotAudio(): void {
    this.resetJackpotPhaseAudio()
    if (this.musicMasterGain && this.audioContext) {
      const now = this.audioContext.currentTime
      const base = this.getEffectiveMusicVolume()
      this.musicMasterGain.gain.setValueAtTime(base, now)
      this.musicMasterGain.gain.linearRampToValueAtTime(base * 1.3, now + 0.1)
      this.musicMasterGain.gain.linearRampToValueAtTime(base, now + 0.5)
    }
  }

  triggerFeverAudio(): void {
    this.playImpact('fever', 12, { premium: true })
  }

  setMasterVolume(volume: number): void {
    setMasterVolume(this.asContextState(), volume)
  }

  setMusicVolume(volume: number): void {
    setMusicVolume(this.asContextState(), volume, this.getEffectiveMusicVolume())
  }

  setSfxVolume(volume: number): void {
    setSfxVolume(this.asContextState(), volume)
  }

  toggleMute(): boolean {
    return toggleMute(this.asContextState())
  }

  getVolumeSettings(): { master: number; music: number; sfx: number; muted: boolean } {
    return getVolumeSettings(this.asContextState())
  }

  get isReady(): boolean {
    return isReady(this.asContextState())
  }

  playGoldBallSpawn(type: BallType): void {
    playGoldBallSpawn(this.asSynthState(), type, {
      playNamed: (name) => this.play(name),
      playImpact: (category, velocity, options) => this.playImpact(category, velocity, options),
    })
  }

  playGoldBallCollect(type: BallType): void {
    playGoldBallCollect(this.asSynthState(), type, {
      playNamed: (name) => this.play(name),
      playImpact: (category, velocity, options) => this.playImpact(category, velocity, options),
      usesSampleBank: () => this.usesSampleBank(),
      playLocalSampleKey: (key, volume, position, playbackRate) =>
        this.playLocalSampleKey(key, volume, position, playbackRate),
    })
  }

  private play(name: string): void {
    playSynthesizedNamedSound(this.asSynthState(), name)
  }

  private async loadGoldBallSounds(): Promise<void> {
    await loadGoldBallSounds(this.asSynthState())
  }

  private createSynthesizedGameSounds(): void {
    createSynthesizedGameSounds(this.asSynthState())
  }

  private playJackpotAlarmSynth(): void {
    playJackpotAlarmSynth(this.asSynthState())
  }

  private playJackpotTurbineSynth(duration = 2.8): void {
    playJackpotTurbineSynth(this.asSynthState(), duration)
  }

  private playJackpotExplosionSynth(): void {
    playJackpotExplosionSynth(this.asSynthState())
  }

  playBeep(freq: number): void {
    playBeep(this.asSynthState(), freq)
  }

  playSlotSpinStart(): void {
    playSlotSpinStart(this.asSynthState())
  }

  playReelStop(reelIndex: number): void {
    playReelStop(this.asSynthState(), reelIndex, {
      usesSampleBank: () => this.usesSampleBank(),
      playLocalSampleKey: (key, volume, position, playbackRate) =>
        this.playLocalSampleKey(key, volume, position, playbackRate),
    })
  }

  playSlotWin(multiplier: number): void {
    playSlotWin(this.asSynthState(), multiplier)
  }

  playSlotJackpot(): void {
    playSlotJackpot(this.asSynthState())
  }

  playNearMiss(): void {
    playNearMiss(this.asSynthState())
  }

  dispose(): void {
    for (const unsub of this.eventBusUnsubscribers) {
      try {
        unsub()
      } catch {
        // ignore
      }
    }
    this.eventBusUnsubscribers = []

    disposeSoundSystemContext(this.asContextState(), { stopMusic: () => this.stopMusic() })

    this.sampleCache.clear()
    this.localSampleBuffers.clear()
    this.localMusicBuffers.clear()
    this.sampleBankReady = false
    this.isInitialized = false
  }

  private asContextState(): SoundSystemContextState {
    return this as unknown as SoundSystemContextState
  }

  private asSamplesState(): SoundSystemSamplesState {
    return this as unknown as SoundSystemSamplesState
  }

  private asSynthState(): SoundSystemSynthState {
    return this as unknown as SoundSystemSynthState
  }
}

let soundSystemInstance: SoundSystem | null = null

export function getSoundSystem(eventBus?: EventBus): SoundSystem {
  if (!soundSystemInstance) {
    soundSystemInstance = new SoundSystem()
  }
  if (eventBus) {
    bindSoundEventBindings(soundSystemInstance, eventBus)
  }
  return soundSystemInstance
}

export function resetSoundSystem(): void {
  if (soundSystemInstance) {
    soundSystemInstance.dispose()
    soundSystemInstance = null
  }
}
