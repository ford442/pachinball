/**
 * Pachinball Sound System
 * 
 * Full audio integration using Web Audio API with storage_manager backend.
 * - Samples: /api/samples (peg, bumper, flipper hits)
 * - Music: /api/music (map-specific tracks) with smooth cross-fade
 * - Spatial audio for key objects
 * - Master volume + mute controls
 * - Ambient cabinet hum synthesis
 */

import { Vector3 } from '@babylonjs/core'
import { BallType } from '../config'
import type { EventBus } from '../game/event-bus'
import { GameConfig } from '../config'
import { resolveAssetUrl } from '../game/game-utils'
import {
  createImpactVoiceProfile,
  getPortalMotifFrequencies,
  type ImpactCategory,
  type ImpactVoiceOptions,
} from './audio-synth'
import {
  getJackpotPhaseSampleKey,
  getLocalAudioPath,
  getSampleKeyForCategory,
  getSampleKeyForImpact,
  LOCAL_MUSIC_STEMS,
  LOCAL_SAMPLE_BANK,
  type AudioMusicStem,
  type AudioSampleKey,
  type AudioSourceMode,
  type SampleCategory,
} from './audio-sample-bank'

// Audio categories for samples
export type { SampleCategory } from './audio-sample-bank'

// Map IDs for music tracks (dynamic — any string allowed)
export type MapId = string

interface SampleMetadata {
  id: string
  name: string
  url: string
  category: string
  duration: number
}

interface MusicTrack {
  id: string
  title: string
  artist: string
  url: string
  duration: number
  map_id?: string
}

interface CachedSample {
  buffer: AudioBuffer
  metadata: SampleMetadata
}

export class SoundSystem {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  
  // Music cross-fade architecture
  private musicMasterGain: GainNode | null = null
  private musicGainA: GainNode | null = null
  private musicGainB: GainNode | null = null
  private musicSourceA: AudioBufferSourceNode | null = null
  private musicSourceB: AudioBufferSourceNode | null = null
  private musicBufferA: AudioBuffer | null = null
  private musicBufferB: AudioBuffer | null = null
  private musicTrackIdA: string | null = null
  private musicTrackIdB: string | null = null
  private activeMusicChannel: 'A' | 'B' = 'A'
  private readonly CROSSFADE_DURATION = 0.8 // seconds
  
  // Ambient cabinet hum
  private humOscillator: OscillatorNode | null = null
  private humHarmonicOscillator: OscillatorNode | null = null
  private humGain: GainNode | null = null
  
  // Cached samples by category
  private sampleCache: Map<string, CachedSample> = new Map()
  private samplesByCategory: Map<SampleCategory, string[]> = new Map()
  
  // Music state
  private musicCache: Map<string, MusicTrack> = new Map()
  
  // Spatial audio nodes
  private spatialPanner: PannerNode | null = null
  
  // Volume settings
  private masterVolume = 0.8
  private musicVolume = 0.6
  private sfxVolume = 0.9
  private isMuted = false
  private lastImpactAtByCategory: Partial<Record<ImpactCategory, number>> = {}
  
  // Loading state
  private isInitialized = false
  private loadPromise: Promise<void> | null = null
  private audioSource: AudioSourceMode = 'samples'
  private localSampleBuffers = new Map<AudioSampleKey, AudioBuffer>()
  private localMusicBuffers = new Map<AudioMusicStem, AudioBuffer>()
  private sampleBankReady = false
  private sampleBankPromise: Promise<void> | null = null
  private activeMusicStem: AudioMusicStem | null = null
  private lastJackpotPhasePlayed = 0

  // EventBus subscriptions
  private eventBusUnsubscribers: Array<() => void> = []

  /**
   * Register an EventBus unsubscribe function for cleanup
   */
  addEventBusUnsubscriber(unsub: () => void): void {
    this.eventBusUnsubscribers.push(unsub)
  }

  constructor() {
    // Initialize maps for categories
    this.samplesByCategory.set('peg', [])
    this.samplesByCategory.set('bumper', [])
    this.samplesByCategory.set('flipper', [])
    this.samplesByCategory.set('jackpot', [])
    this.samplesByCategory.set('fever', [])
    this.samplesByCategory.set('launch', [])
    this.samplesByCategory.set('drain', [])
  }

  /**
   * Initialize the audio context and load samples
   * Must be called after user interaction (click/tap)
   */
  async init(): Promise<void> {
    if (this.isInitialized) return
    if (this.loadPromise) return this.loadPromise
    
    this.loadPromise = this.doInit()
    return this.loadPromise
  }

  private async doInit(): Promise<void> {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      
      // Create master gain node
      this.masterGain = this.audioContext.createGain()
      this.masterGain.gain.value = this.masterVolume
      this.masterGain.connect(this.audioContext.destination)
      
      // Create music master gain + dual channel gains for cross-fade
      this.musicMasterGain = this.audioContext.createGain()
      this.musicMasterGain.gain.value = 1.0
      this.musicMasterGain.connect(this.masterGain)
      
      this.musicGainA = this.audioContext.createGain()
      this.musicGainA.gain.value = 0
      this.musicGainA.connect(this.musicMasterGain)
      
      this.musicGainB = this.audioContext.createGain()
      this.musicGainB.gain.value = 0
      this.musicGainB.connect(this.musicMasterGain)
      
      // Create SFX gain node
      this.sfxGain = this.audioContext.createGain()
      this.sfxGain.gain.value = this.sfxVolume
      this.sfxGain.connect(this.masterGain)
      
      // Note: Ambient hum is created in startAmbientHum() using oscillators
      
      // Create spatial panner for 3D audio
      this.spatialPanner = this.audioContext.createPanner()
      this.spatialPanner.panningModel = 'HRTF'
      this.spatialPanner.distanceModel = 'inverse'
      this.spatialPanner.refDistance = 1
      this.spatialPanner.maxDistance = 20
      this.spatialPanner.rolloffFactor = 1
      this.spatialPanner.connect(this.sfxGain)
      
    // Create synthesized placeholder sounds so every category has at least one sample
      this.createSynthesizedGameSounds()
      
      // Mark initialization as complete early so playSample() can work
      // while gold-ball sounds load in the background.
      this.isInitialized = true
      console.log('[SoundSystem] Core audio ready — gold ball sounds loading in background')
      
      // Decode local sample bank after user gesture (non-blocking for gameplay)
      this.sampleBankPromise = this.decodeLocalSampleBank().catch((err) => {
        console.warn('[SoundSystem] Local sample bank decode failed, synth fallback active:', err)
      })
      
      // Load gold ball sounds (with synthesized fallback) — non-blocking
      this.loadGoldBallSounds().catch(err => {
        console.warn('[SoundSystem] Gold ball sound loading failed:', err)
      })
      
      // Start ambient hum immediately
      this.startAmbientHum()
      console.log('[SoundSystem] Initialized successfully')
    } catch (err) {
      console.error('[SoundSystem] Initialization failed:', err)
      throw err
    }
  }
  
  /**
   * Synthesize a low ambient cabinet hum (60Hz mains + 120Hz harmonic)
   */
  private startAmbientHum(): void {
    if (!this.audioContext || !this.masterGain) return
    
    // 60Hz mains hum
    this.humOscillator = this.audioContext.createOscillator()
    this.humOscillator.type = 'sine'
    this.humOscillator.frequency.value = 60
    
    // 120Hz harmonic for transformer buzz texture
    this.humHarmonicOscillator = this.audioContext.createOscillator()
    this.humHarmonicOscillator.type = 'sine'
    this.humHarmonicOscillator.frequency.value = 120
    
    this.humGain = this.audioContext.createGain()
    this.humGain.gain.value = 0.025 // Very low, background texture only
    
    this.humOscillator.connect(this.humGain)
    this.humHarmonicOscillator.connect(this.humGain)
    this.humGain.connect(this.masterGain)
    
    this.humOscillator.start()
    this.humHarmonicOscillator.start()
  }

  /**
   * Resume audio context (needed after user interaction)
   */
  async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume()
    }
    // Start ambient hum on first resume (user interaction)
    if (!this.humOscillator) {
      this.startAmbientHum()
    }
  }

  /**
   * Suspend audio context (e.g. tab hidden or game paused)
   */
  async suspend(): Promise<void> {
    if (this.audioContext?.state === 'running') {
      await this.audioContext.suspend()
    }
  }
  
  /**
   * Set ambient cabinet hum volume (0.0 to 1.0)
   */
  setHumVolume(volume: number): void {
    if (this.humGain) {
      this.humGain.gain.value = Math.max(0, Math.min(1, volume)) * 0.025
    }
  }

  setAudioSource(mode: AudioSourceMode): void {
    this.audioSource = mode
  }

  getAudioSource(): AudioSourceMode {
    return this.audioSource
  }

  /** Await local sample bank decode (no-op if synth-only or already done). */
  async waitForSampleBank(): Promise<void> {
    if (this.sampleBankPromise) {
      await this.sampleBankPromise
    }
  }

  private usesSampleBank(): boolean {
    return this.audioSource === 'samples' && this.sampleBankReady
  }

  /**
   * Fetch + decode all local OGG samples on first user gesture.
   * Playback after decode is buffer-source only (<2ms on main thread).
   */
  private async decodeLocalSampleBank(): Promise<void> {
    if (!this.audioContext) return

    const decodeOne = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(url)
        if (!response.ok) return null
        const arrayBuffer = await response.arrayBuffer()
        return await this.audioContext!.decodeAudioData(arrayBuffer)
      } catch {
        return null
      }
    }

    await Promise.all(
      LOCAL_SAMPLE_BANK.map(async (def) => {
        const buffer = await decodeOne(getLocalAudioPath(def.file))
        if (buffer) {
          this.localSampleBuffers.set(def.key, buffer)
        }
      }),
    )

    await Promise.all(
      LOCAL_MUSIC_STEMS.map(async (def) => {
        const buffer = await decodeOne(getLocalAudioPath(def.file))
        if (buffer) {
          this.localMusicBuffers.set(def.stem, buffer)
          this.musicCache.set(`stem-${def.stem}`, {
            id: `stem-${def.stem}`,
            title: def.title,
            artist: 'Nexus Cascade',
            url: getLocalAudioPath(def.file),
            duration: buffer.duration,
            map_id: def.stem,
          })
        }
      }),
    )

    this.sampleBankReady = this.localSampleBuffers.size > 0
    if (this.sampleBankReady) {
      console.log(`[SoundSystem] Sample bank ready (${this.localSampleBuffers.size} SFX, ${this.localMusicBuffers.size} stems)`)
    }
  }

  /**
   * Play a pre-decoded local sample. Fast path — no fetch/decode on main thread.
   */
  private playLocalSampleKey(
    key: AudioSampleKey,
    volume = 1.0,
    position?: Vector3,
    playbackRate = 1,
  ): boolean {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return false
    if (this.isMuted) return false

    const buffer = this.localSampleBuffers.get(key)
    if (!buffer) return false

    try {
      const source = this.audioContext.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = Math.max(0.5, Math.min(2, playbackRate))

      const gainNode = this.audioContext.createGain()
      gainNode.gain.value = volume * this.sfxVolume

      if (position && this.spatialPanner) {
        this.spatialPanner.positionX.value = position.x
        this.spatialPanner.positionY.value = position.y
        this.spatialPanner.positionZ.value = position.z
        source.connect(gainNode)
        gainNode.connect(this.spatialPanner)
      } else {
        source.connect(gainNode)
        gainNode.connect(this.sfxGain)
      }

      source.start(0)
      source.onended = () => {
        gainNode.disconnect()
      }
      return true
    } catch {
      return false
    }
  }

  playJackpotPhase(phase: number): void {
    if (phase < 1 || phase > 3) return
    if (phase === this.lastJackpotPhasePlayed) return
    this.lastJackpotPhasePlayed = phase

    const sampleKey = getJackpotPhaseSampleKey(phase)
    if (sampleKey && this.usesSampleBank() && this.playLocalSampleKey(sampleKey, 0.95)) {
      return
    }

    switch (phase) {
      case 1:
        this.playJackpotAlarmSynth()
        break
      case 2:
        this.playJackpotTurbineSynth(2.8)
        break
      case 3:
        this.playJackpotExplosionSynth()
        this.playSlotJackpot()
        break
      default:
        break
    }
  }

  resetJackpotPhaseAudio(): void {
    this.lastJackpotPhasePlayed = 0
  }

  /**
   * Cross-fade to a loopable local music stem (attract / fever).
   */
  async playMusicStem(stem: AudioMusicStem): Promise<void> {
    if (!this.isInitialized || !this.audioContext || !this.musicMasterGain) return
    if (this.activeMusicStem === stem) return

    const buffer = this.localMusicBuffers.get(stem)
    if (!buffer) {
      console.warn(`[SoundSystem] No local music stem: ${stem}`)
      return
    }

    const trackId = `stem-${stem}`
    const track = this.musicCache.get(trackId)
    if (!track) return

    this.activeMusicStem = stem
    await this.crossfadeToBuffer(buffer, trackId, track.title)
  }

  private async crossfadeToBuffer(targetBuffer: AudioBuffer, trackId: string, title: string): Promise<void> {
    if (!this.audioContext || !this.musicMasterGain) return

    const isTrackOnA = this.musicTrackIdA === trackId
    const isTrackOnB = this.musicTrackIdB === trackId

    let resolvedBuffer: AudioBuffer = targetBuffer
    if (isTrackOnA && this.musicBufferA) resolvedBuffer = this.musicBufferA
    else if (isTrackOnB && this.musicBufferB) resolvedBuffer = this.musicBufferB

    const outgoingChannel = this.activeMusicChannel
    const incomingChannel = outgoingChannel === 'A' ? 'B' : 'A'
    const outGain = outgoingChannel === 'A' ? this.musicGainA : this.musicGainB
    const inGain = incomingChannel === 'A' ? this.musicGainA : this.musicGainB
    const now = this.audioContext.currentTime
    const duration = this.CROSSFADE_DURATION
    const outSource = outgoingChannel === 'A' ? this.musicSourceA : this.musicSourceB

    if (!outSource) {
      const source = this.audioContext.createBufferSource()
      source.buffer = resolvedBuffer
      source.loop = true
      source.connect(inGain!)
      source.start(now)
      inGain!.gain.setValueAtTime(0, now)
      inGain!.gain.linearRampToValueAtTime(this.getEffectiveMusicVolume(), now + 0.1)
      if (incomingChannel === 'A') {
        this.musicSourceA = source
        this.musicBufferA = resolvedBuffer
        this.musicTrackIdA = trackId
      } else {
        this.musicSourceB = source
        this.musicBufferB = resolvedBuffer
        this.musicTrackIdB = trackId
      }
      this.activeMusicChannel = incomingChannel
      console.log(`[SoundSystem] Playing music: ${title}`)
      return
    }

    const prevIncomingSource = incomingChannel === 'A' ? this.musicSourceA : this.musicSourceB
    if (prevIncomingSource) {
      try { prevIncomingSource.stop(now) } catch { /* ignore */ }
      try { prevIncomingSource.disconnect() } catch { /* ignore */ }
    }

    const newSource = this.audioContext.createBufferSource()
    newSource.buffer = resolvedBuffer
    newSource.loop = true
    newSource.connect(inGain!)
    newSource.start(now)

    const currentOutValue = outGain!.gain.value
    outGain!.gain.cancelScheduledValues(now)
    outGain!.gain.setValueAtTime(currentOutValue, now)
    outGain!.gain.linearRampToValueAtTime(0, now + duration)

    inGain!.gain.cancelScheduledValues(now)
    inGain!.gain.setValueAtTime(0, now)
    inGain!.gain.linearRampToValueAtTime(this.getEffectiveMusicVolume(), now + duration)

    if (incomingChannel === 'A') {
      this.musicSourceA = newSource
      this.musicBufferA = resolvedBuffer
      this.musicTrackIdA = trackId
    } else {
      this.musicSourceB = newSource
      this.musicBufferB = resolvedBuffer
      this.musicTrackIdB = trackId
    }

    setTimeout(() => {
      try { outSource.stop() } catch { /* ignore */ }
      try { outSource.disconnect() } catch { /* ignore */ }
      outGain!.gain.value = 0
    }, duration * 1000)

    this.activeMusicChannel = incomingChannel
    console.log(`[SoundSystem] Cross-fading to music: ${title}`)
  }

  private getEffectiveMusicVolume(): number {
    const reducedAudio = GameConfig.camera.reducedMotion || GameConfig.accessibility.photosensitiveMode
    return this.musicVolume * (reducedAudio ? 0.55 : 1)
  }

  /**
   * Play a random sample from a category
   */
  playSample(category: SampleCategory, position?: Vector3, volume = 1.0): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    if (this.usesSampleBank()) {
      const key = getSampleKeyForCategory(category)
      if (key && this.playLocalSampleKey(key, volume, position)) return
    }
    
    const sampleIds = this.samplesByCategory.get(category)
    if (!sampleIds || sampleIds.length === 0) {
      console.warn(`[SoundSystem] No samples in category: ${category}`)
      return
    }

    // Pick random sample
    const randomId = sampleIds[Math.floor(Math.random() * sampleIds.length)]
    const cached = this.sampleCache.get(randomId)
    
    if (!cached) {
      console.warn(`[SoundSystem] Sample not cached: ${randomId}`)
      return
    }
    
    // Create source and play
    const source = this.audioContext.createBufferSource()
    source.buffer = cached.buffer
    
    // Create gain node for this sound
    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = volume * this.sfxVolume
    
    // Connect with optional spatial audio
    if (position && this.spatialPanner) {
      // Update panner position
      this.spatialPanner.positionX.value = position.x
      this.spatialPanner.positionY.value = position.y
      this.spatialPanner.positionZ.value = position.z
      
      source.connect(gainNode)
      gainNode.connect(this.spatialPanner)
    } else {
      source.connect(gainNode)
      gainNode.connect(this.sfxGain)
    }
    
    source.start(0)
    
    // Cleanup when done
    source.onended = () => {
      gainNode.disconnect()
    }
  }

  playImpact(
    category: ImpactCategory,
    velocity: number,
    options: ImpactVoiceOptions & { position?: Vector3 } = {},
  ): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    if (this.usesSampleBank()) {
      const key = getSampleKeyForImpact(category)
      if (key) {
        const n = Math.max(0, Math.min(1, velocity / 24))
        const vol = (0.55 + n * 0.45) * (options.premium ? 1.08 : 1)
        const rate = 0.85 + n * 0.35
        if (this.playLocalSampleKey(key, vol, options.position, rate)) return
      }
    }

    const now = this.audioContext.currentTime
    const reducedAudio = GameConfig.camera.reducedMotion || GameConfig.accessibility.photosensitiveMode
    const profile = createImpactVoiceProfile(category, velocity, options, reducedAudio)
    const lastPlayedAt = this.lastImpactAtByCategory[category] ?? Number.NEGATIVE_INFINITY
    if ((now - lastPlayedAt) < profile.cooldownSeconds) return
    this.lastImpactAtByCategory[category] = now

    const finalGain = Math.max(0.0001, Math.min(1, profile.gain * this.sfxVolume))
    const voiceGain = this.audioContext.createGain()
    voiceGain.gain.setValueAtTime(0.0001, now)
    voiceGain.gain.linearRampToValueAtTime(finalGain, now + profile.attack)
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.decay)

    const stereoPanner = this.createOptionalStereoPanner(options.position, reducedAudio)
    voiceGain.connect(stereoPanner ?? this.sfxGain)

    const osc = this.audioContext.createOscillator()
    osc.type = profile.waveform
    osc.frequency.setValueAtTime(profile.baseFreq, now)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, profile.sweepFreq), now + profile.decay)

    const tonalFilter = this.audioContext.createBiquadFilter()
    tonalFilter.type = 'lowpass'
    tonalFilter.frequency.setValueAtTime(profile.filterStart, now)
    tonalFilter.frequency.exponentialRampToValueAtTime(Math.max(120, profile.filterEnd), now + profile.decay)

    osc.connect(tonalFilter)
    tonalFilter.connect(voiceGain)
    osc.start(now)
    osc.stop(now + profile.decay + 0.02)

    if (profile.noiseAmount > 0.001 && !reducedAudio) {
      this.playNoiseBurst(profile, now, voiceGain)
    }

    if (category === 'jackpot' || options.premium) {
      this.playMotif(getPortalMotifFrequencies(true), now, finalGain * 0.55)
    }
  }

  playPortalEnter(premium = true): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    if (this.usesSampleBank() && this.playLocalSampleKey('portal', premium ? 0.95 : 0.7)) {
      return
    }

    const now = this.audioContext.currentTime
    const reducedAudio = GameConfig.camera.reducedMotion || GameConfig.accessibility.photosensitiveMode
    const notes = getPortalMotifFrequencies(premium && !reducedAudio)
    this.playMotif(notes, now, reducedAudio ? 0.1 : 0.16)
  }

  private playMotif(notes: number[], startTime: number, gain = 0.14): void {
    if (!this.audioContext || !this.sfxGain || notes.length === 0) return
    for (let i = 0; i < notes.length; i++) {
      const osc = this.audioContext.createOscillator()
      const g = this.audioContext.createGain()
      const noteStart = startTime + (i * 0.055)
      const noteEnd = noteStart + 0.2
      osc.type = i % 2 === 0 ? 'triangle' : 'sine'
      osc.frequency.setValueAtTime(notes[i], noteStart)
      g.gain.setValueAtTime(0.0001, noteStart)
      g.gain.linearRampToValueAtTime(gain, noteStart + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, noteEnd)
      osc.connect(g)
      g.connect(this.sfxGain)
      osc.start(noteStart)
      osc.stop(noteEnd + 0.01)
    }
  }

  private playNoiseBurst(
    profile: ReturnType<typeof createImpactVoiceProfile>,
    startTime: number,
    outputNode: GainNode,
  ): void {
    if (!this.audioContext) return
    const sr = this.audioContext.sampleRate
    const duration = Math.max(0.02, Math.min(0.12, profile.decay * 0.6))
    const buffer = this.audioContext.createBuffer(1, Math.floor(sr * duration), sr)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * profile.noiseAmount
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer

    const bandpass = this.audioContext.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(Math.max(250, profile.filterStart), startTime)
    bandpass.Q.value = 0.85

    const noiseGain = this.audioContext.createGain()
    noiseGain.gain.setValueAtTime(profile.noiseAmount, startTime)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    source.connect(bandpass)
    bandpass.connect(noiseGain)
    noiseGain.connect(outputNode)
    source.start(startTime)
    source.stop(startTime + duration + 0.01)
  }

  private createOptionalStereoPanner(position: Vector3 | undefined, reducedAudio: boolean): StereoPannerNode | null {
    if (!this.audioContext || reducedAudio) return null
    const createStereoPanner = (this.audioContext as unknown as { createStereoPanner?: () => StereoPannerNode }).createStereoPanner
    if (!createStereoPanner) return null
    const panner = createStereoPanner.call(this.audioContext)
    const pan = position ? Math.max(-1, Math.min(1, position.x / 8)) : (Math.random() * 0.3 - 0.15)
    panner.pan.value = pan
    panner.connect(this.sfxGain!)
    return panner
  }

  /**
   * Pre-fetch and cache all music tracks from backend
   *
   * NOTE: Backend is disabled. This is a no-op.
   */
  async fetchMusicTracks(): Promise<void> {
    // No backend — music tracks are not available
  }

  /**
   * Play music for a specific map with 800ms cross-fade
   */
  async playMapMusic(mapId: MapId): Promise<void> {
    if (!this.isInitialized || !this.audioContext || !this.musicMasterGain) return

    try {
      // Try cache first, then fetch
      let track: MusicTrack | undefined
      for (const t of this.musicCache.values()) {
        if (t.map_id === mapId) {
          track = t
          break
        }
      }

      if (!track) {
        console.warn(`[SoundSystem] No music for map: ${mapId}`)
        return
      }

      // Load track if not cached in memory buffer
      const isTrackOnA = this.musicTrackIdA === track.id
      const isTrackOnB = this.musicTrackIdB === track.id
      
      let targetBuffer: AudioBuffer | null = null
      if (isTrackOnA) {
        targetBuffer = this.musicBufferA
      } else if (isTrackOnB) {
        targetBuffer = this.musicBufferB
      } else {
        const audioResponse = await fetch(track.url)
        if (!audioResponse.ok) throw new Error(`Failed to fetch ${track.id}`)
        const arrayBuffer = await audioResponse.arrayBuffer()
        targetBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
      }
      
      if (!targetBuffer) {
        console.warn(`[SoundSystem] Could not load buffer for ${track.id}`)
        return
      }

      const outgoingChannel = this.activeMusicChannel
      const incomingChannel = outgoingChannel === 'A' ? 'B' : 'A'
      const outGain = outgoingChannel === 'A' ? this.musicGainA : this.musicGainB
      const inGain = incomingChannel === 'A' ? this.musicGainA : this.musicGainB
      const now = this.audioContext.currentTime
      const duration = this.CROSSFADE_DURATION

      // If no music is currently playing, just start on active channel
      const outSource = outgoingChannel === 'A' ? this.musicSourceA : this.musicSourceB
      if (!outSource) {
        // First play — no crossfade needed
        const source = this.audioContext.createBufferSource()
        source.buffer = targetBuffer
        source.loop = true
        source.connect(inGain!)
        source.start(now)
        
        inGain!.gain.setValueAtTime(0, now)
        inGain!.gain.linearRampToValueAtTime(this.musicVolume, now + 0.1)
        
        if (incomingChannel === 'A') {
          this.musicSourceA = source
          this.musicBufferA = targetBuffer
          this.musicTrackIdA = track.id
        } else {
          this.musicSourceB = source
          this.musicBufferB = targetBuffer
          this.musicTrackIdB = track.id
        }
        this.activeMusicChannel = incomingChannel
        console.log(`[SoundSystem] Playing music: ${track.title}`)
        return
      }

      // Cross-fade: fade out current, fade in new
      // 1. Stop any previous source on incoming channel
      const prevIncomingSource = incomingChannel === 'A' ? this.musicSourceA : this.musicSourceB
      if (prevIncomingSource) {
        try { prevIncomingSource.stop(now) } catch { /* ignore */ }
        try { prevIncomingSource.disconnect() } catch { /* ignore */ }
      }

      // 2. Start new source on incoming channel at volume 0
      const newSource = this.audioContext.createBufferSource()
      newSource.buffer = targetBuffer
      newSource.loop = true
      newSource.connect(inGain!)
      newSource.start(now)

      // 3. Schedule fades
      const currentOutValue = outGain!.gain.value
      outGain!.gain.cancelScheduledValues(now)
      outGain!.gain.setValueAtTime(currentOutValue, now)
      outGain!.gain.linearRampToValueAtTime(0, now + duration)

      inGain!.gain.cancelScheduledValues(now)
      inGain!.gain.setValueAtTime(0, now)
      inGain!.gain.linearRampToValueAtTime(this.musicVolume, now + duration)

      // 4. Store references
      if (incomingChannel === 'A') {
        this.musicSourceA = newSource
        this.musicBufferA = targetBuffer
        this.musicTrackIdA = track.id
      } else {
        this.musicSourceB = newSource
        this.musicBufferB = targetBuffer
        this.musicTrackIdB = track.id
      }

      // 5. Stop outgoing source after fade completes
      setTimeout(() => {
        try { outSource.stop() } catch { /* ignore */ }
        try { outSource.disconnect() } catch { /* ignore */ }
        // Reset outgoing gain to 0 for next use
        outGain!.gain.value = 0
      }, duration * 1000)

      this.activeMusicChannel = incomingChannel
      console.log(`[SoundSystem] Cross-fading to music: ${track.title}`)
    } catch (err) {
      console.warn('[SoundSystem] Failed to play music:', err)
    }
  }

  /**
   * Stop music playback on both channels
   */
  stopMusic(): void {
    const now = this.audioContext?.currentTime ?? 0
    
    if (this.musicSourceA) {
      try { this.musicSourceA.stop() } catch { /* ignore */ }
      try { this.musicSourceA.disconnect() } catch { /* ignore */ }
      this.musicSourceA = null
    }
    if (this.musicSourceB) {
      try { this.musicSourceB.stop() } catch { /* ignore */ }
      try { this.musicSourceB.disconnect() } catch { /* ignore */ }
      this.musicSourceB = null
    }
    
    if (this.musicGainA) {
      this.musicGainA.gain.cancelScheduledValues(now)
      this.musicGainA.gain.value = 0
    }
    if (this.musicGainB) {
      this.musicGainB.gain.cancelScheduledValues(now)
      this.musicGainB.gain.value = 0
    }
  }

  /**
   * Trigger jackpot/fever audio layer
   */
  triggerJackpotAudio(): void {
    this.resetJackpotPhaseAudio()

    // Brief volume boost on music master
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

  /**
   * Set master volume (0.0 to 1.0)
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
    if (this.masterGain) {
      this.masterGain.gain.value = this.isMuted ? 0 : this.masterVolume
    }
  }

  /**
   * Set music volume (0.0 to 1.0)
   */
  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume))
    if (this.musicMasterGain) {
      this.musicMasterGain.gain.value = this.getEffectiveMusicVolume()
    }
  }

  /**
   * Set SFX volume (0.0 to 1.0)
   */
  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume))
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxVolume
    }
  }

  /**
   * Toggle mute
   */
  toggleMute(): boolean {
    this.isMuted = !this.isMuted
    if (this.masterGain) {
      this.masterGain.gain.value = this.isMuted ? 0 : this.masterVolume
    }
    return this.isMuted
  }

  /**
   * Get current volume settings
   */
  getVolumeSettings(): { master: number; music: number; sfx: number; muted: boolean } {
    return {
      master: this.masterVolume,
      music: this.musicVolume,
      sfx: this.sfxVolume,
      muted: this.isMuted
    }
  }

  /**
   * Check if system is initialized
   */
  get isReady(): boolean {
    return this.isInitialized
  }

  /**
   * Play sound when a gold ball spawns
   */
  playGoldBallSpawn(type: BallType): void {
    if (type === BallType.STANDARD) return
    const soundName = type === BallType.SOLID_GOLD
      ? 'solid-gold-spawn'
      : 'gold-plated-spawn'
    if (this.synthesizedSounds.has(soundName)) {
      this.play(soundName)
    }
    this.playImpact('launch', type === BallType.SOLID_GOLD ? 16 : 12, {
      isGold: true,
      premium: type === BallType.SOLID_GOLD,
    })
  }

  /**
   * Play sound when a gold ball is collected
   */
  playGoldBallCollect(type: BallType): void {
    if (type === BallType.STANDARD) return
    const soundName = type === BallType.SOLID_GOLD
      ? 'solid-gold-collect'
      : 'gold-plated-collect'
    if (this.synthesizedSounds.has(soundName)) {
      this.play(soundName)
    }
    if (this.usesSampleBank() && this.playLocalSampleKey('gold-collect', type === BallType.SOLID_GOLD ? 1 : 0.85)) {
      return
    }
    this.playImpact('jackpot', type === BallType.SOLID_GOLD ? 22 : 16, {
      isGold: true,
      premium: true,
    })
  }

  /**
   * Play a named sound (used for synthesized sounds)
   */
  private play(name: string): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    const sound = this.synthesizedSounds.get(name)
    if (sound) {
      sound.play()
    }
  }

  // Map to store synthesized sounds
  private synthesizedSounds: Map<string, { play: () => void }> = new Map()

  private async loadGoldBallSounds(): Promise<void> {
    // Try to load actual sound files
    const soundFiles = [
      { name: 'gold-plated-spawn', url: resolveAssetUrl('sounds/gold-spawn.mp3')! },
      { name: 'solid-gold-spawn', url: resolveAssetUrl('sounds/solid-gold-spawn.mp3')! },
      { name: 'gold-plated-collect', url: resolveAssetUrl('sounds/gold-collect.mp3')! },
      { name: 'solid-gold-collect', url: resolveAssetUrl('sounds/solid-gold-collect.mp3')! }
    ]

    for (const { name, url } of soundFiles) {
      try {
        await this.loadSoundFile(name, url)
      } catch {
        // If file doesn't exist, create synthesized version
        this.createSynthesizedSound(name)
      }
    }
  }

  private async loadSoundFile(name: string, url: string): Promise<void> {
    if (!this.audioContext) return

    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch ${name}`)

    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)

    // Store as playable sound
    this.synthesizedSounds.set(name, {
      play: () => {
        const source = this.audioContext!.createBufferSource()
        source.buffer = audioBuffer
        const gain = this.audioContext!.createGain()
        gain.gain.value = this.sfxVolume
        source.connect(gain)
        gain.connect(this.sfxGain!)
        source.start(0)
      }
    })
  }

  /**
   * Create synthesized placeholder sounds for all game categories.
   * Called during init so playSample() never finds an empty category.
   */
  private createSynthesizedGameSounds(): void {
    if (!this.audioContext) return

    const categories: { cat: SampleCategory; duration: number; fn: (ctx: AudioContext, duration: number) => AudioBuffer }[] = [
      {
        cat: 'launch',
        duration: 0.4,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = Math.max(0, 1 - t / d)
            const freq = 200 + t * 800
            data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.4
          }
          return buf
        },
      },
      {
        cat: 'flipper',
        duration: 0.08,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = t < 0.01 ? t / 0.01 : Math.max(0, 1 - (t - 0.01) / (d - 0.01))
            data[i] = (Math.random() * 2 - 1) * env * 0.5
          }
          return buf
        },
      },
      {
        cat: 'bumper',
        duration: 0.25,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = Math.exp(-t * 20)
            data[i] = (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t)) * env * 0.35
          }
          return buf
        },
      },
      {
        cat: 'peg',
        duration: 0.06,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = Math.max(0, 1 - t / d)
            data[i] = (Math.random() * 2 - 1) * env * 0.3
          }
          return buf
        },
      },
      {
        cat: 'drain',
        duration: 0.5,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = Math.max(0, 1 - t / d)
            const freq = 300 - t * 200
            data[i] = Math.sin(2 * Math.PI * Math.max(50, freq) * t) * env * 0.4
          }
          return buf
        },
      },
      {
        cat: 'jackpot',
        duration: 0.6,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = Math.max(0, 1 - t / d)
            data[i] = (
              Math.sin(2 * Math.PI * 523 * t) +
              Math.sin(2 * Math.PI * 659 * t) +
              Math.sin(2 * Math.PI * 784 * t)
            ) * env * 0.25
          }
          return buf
        },
      },
      {
        cat: 'fever',
        duration: 0.3,
        fn: (ctx, d) => {
          const sr = ctx.sampleRate
          const buf = ctx.createBuffer(1, Math.floor(sr * d), sr)
          const data = buf.getChannelData(0)
          for (let i = 0; i < data.length; i++) {
            const t = i / sr
            const env = Math.max(0, 1 - t / d)
            const freq = 600 + Math.sin(t * 30) * 100
            data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.35
          }
          return buf
        },
      },
    ]

    for (const { cat, duration, fn } of categories) {
      const id = `synth-${cat}`
      const buffer = fn(this.audioContext, duration)
      this.sampleCache.set(id, {
        buffer,
        metadata: { id, name: id, url: '', category: cat, duration },
      })
      const list = this.samplesByCategory.get(cat) ?? []
      list.push(id)
      this.samplesByCategory.set(cat, list)
    }

    console.log('[SoundSystem] Synthesized game sounds created')
  }

  /**
   * Create a synthesized sound as fallback
   */
  private createSynthesizedSound(name: string): void {
    // Use Web Audio API to create synthesized sounds
    const audioContext = this.audioContext
    if (!audioContext) return

    // Store as a playable sound
    this.synthesizedSounds.set(name, {
      play: () => {
        const osc = audioContext.createOscillator()
        const gain = audioContext.createGain()

        if (name.includes('solid-gold')) {
          // Higher pitch for solid gold
          if (name.includes('spawn')) {
            // Spawn: rising pitch effect
            osc.frequency.setValueAtTime(880, audioContext.currentTime)
            osc.frequency.exponentialRampToValueAtTime(1760, audioContext.currentTime + 0.1)
            gain.gain.setValueAtTime(0.3, audioContext.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
          } else {
            // Collect: longer, more dramatic
            osc.frequency.setValueAtTime(880, audioContext.currentTime)
            osc.frequency.exponentialRampToValueAtTime(1760, audioContext.currentTime + 0.1)
            gain.gain.setValueAtTime(0.3, audioContext.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
          }
        } else {
          // Gold-plated: lower pitch
          if (name.includes('spawn')) {
            // Spawn: quick rising pitch
            osc.frequency.setValueAtTime(523.25, audioContext.currentTime)
            osc.frequency.exponentialRampToValueAtTime(1046.5, audioContext.currentTime + 0.1)
            gain.gain.setValueAtTime(0.2, audioContext.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
          } else {
            // Collect: quick collect sound
            osc.frequency.setValueAtTime(523.25, audioContext.currentTime)
            osc.frequency.exponentialRampToValueAtTime(1046.5, audioContext.currentTime + 0.1)
            gain.gain.setValueAtTime(0.2, audioContext.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3)
          }
        }

        osc.connect(gain)
        gain.connect(this.sfxGain!)
        osc.start()
        osc.stop(audioContext.currentTime + 0.6)
      }
    })
  }

  /** Synth fallbacks for jackpot phases when sample bank is off or missing. */
  private playJackpotAlarmSynth(): void {
    if (!this.audioContext || !this.sfxGain) return
    const now = this.audioContext.currentTime

    const sub = this.audioContext.createOscillator()
    const subG = this.audioContext.createGain()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(48, now)
    subG.gain.setValueAtTime(0.6 * this.sfxVolume, now)
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
    sub.connect(subG)
    subG.connect(this.sfxGain)
    sub.start(now)
    sub.stop(now + 1.3)

    const siren = this.audioContext.createOscillator()
    const sG = this.audioContext.createGain()
    siren.type = 'sawtooth'
    siren.frequency.setValueAtTime(620, now)
    siren.frequency.linearRampToValueAtTime(980, now + 0.25)
    siren.frequency.linearRampToValueAtTime(620, now + 0.5)
    sG.gain.setValueAtTime(0.25 * this.sfxVolume, now)
    sG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    siren.connect(sG)
    sG.connect(this.sfxGain)
    siren.start(now)
    siren.stop(now + 0.65)
  }

  private playJackpotTurbineSynth(duration = 2.8): void {
    if (!this.audioContext || !this.sfxGain) return
    const now = this.audioContext.currentTime

    const o = this.audioContext.createOscillator()
    const g = this.audioContext.createGain()
    const filter = this.audioContext.createBiquadFilter()

    o.type = 'sawtooth'
    o.frequency.setValueAtTime(140, now)
    o.frequency.exponentialRampToValueAtTime(920, now + duration)

    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(600, now)
    filter.Q.setValueAtTime(1.8, now)

    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(0.22 * this.sfxVolume, now + 0.2)
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    o.connect(filter)
    filter.connect(g)
    g.connect(this.sfxGain)
    o.start(now)
    o.stop(now + duration + 0.05)
  }

  private playJackpotExplosionSynth(): void {
    if (!this.audioContext || !this.sfxGain) return
    const now = this.audioContext.currentTime

    const noise = this.audioContext.createBufferSource()
    const buffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate * 1.2, this.audioContext.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noise.buffer = buffer

    const noiseFilter = this.audioContext.createBiquadFilter()
    noiseFilter.type = 'lowpass'
    noiseFilter.frequency.setValueAtTime(1200, now)

    const nG = this.audioContext.createGain()
    nG.gain.setValueAtTime(0.7 * this.sfxVolume, now)
    nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)

    noise.connect(noiseFilter)
    noiseFilter.connect(nG)
    nG.connect(this.sfxGain)
    noise.start(now)

    const punch = this.audioContext.createOscillator()
    const pG = this.audioContext.createGain()
    punch.type = 'sine'
    punch.frequency.setValueAtTime(48, now)
    pG.gain.setValueAtTime(0.9 * this.sfxVolume, now)
    pG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    punch.connect(pG)
    pG.connect(this.sfxGain)
    punch.start(now)
    punch.stop(now + 0.7)
  }

  /**
   * Play a short synthesized beep at the given frequency
   */
  playBeep(freq: number): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    const o = this.audioContext.createOscillator()
    const g = this.audioContext.createGain()

    o.frequency.value = freq
    o.connect(g)
    g.connect(this.sfxGain)
    o.start()

    g.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.1)
    o.stop(this.audioContext.currentTime + 0.1)
  }

  /**
   * Slot machine spin-start: rising sawtooth sweep 200Hz → 800Hz.
   */
  playSlotSpinStart(): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    const o = this.audioContext.createOscillator()
    const g = this.audioContext.createGain()

    o.type = 'sawtooth'
    o.frequency.setValueAtTime(200, this.audioContext.currentTime)
    o.frequency.exponentialRampToValueAtTime(800, this.audioContext.currentTime + 0.3)

    g.gain.setValueAtTime(0.25, this.audioContext.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.5)

    o.connect(g)
    g.connect(this.sfxGain)
    o.start()
    o.stop(this.audioContext.currentTime + 0.5)
  }

  /**
   * Slot machine reel stop: mechanical click with reel-specific pitch.
   */
  playReelStop(reelIndex: number): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    if (this.usesSampleBank()) {
      const rate = 0.9 + reelIndex * 0.08
      if (this.playLocalSampleKey('slot-stop', 0.85, undefined, rate)) return
    }

    const baseFreq = 400 + reelIndex * 100
    const o = this.audioContext.createOscillator()
    const g = this.audioContext.createGain()

    o.type = 'square'
    o.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime)
    o.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, this.audioContext.currentTime + 0.05)

    g.gain.setValueAtTime(0.2, this.audioContext.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.1)

    o.connect(g)
    g.connect(this.sfxGain)
    o.start()
    o.stop(this.audioContext.currentTime + 0.1)
  }

  /**
   * Slot machine small win: ascending C-major arpeggio scaled by multiplier.
   */
  playSlotWin(multiplier: number): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    const ctx = this.audioContext
    const out = this.sfxGain
    const notes = [523.25, 659.25, 783.99, 1046.5]
    const duration = Math.min(0.4, 0.1 * Math.max(1, multiplier))

    notes.forEach((freq, i) => {
      const startTime = ctx.currentTime + i * 0.08
      const o = ctx.createOscillator()
      const g = ctx.createGain()

      o.type = 'sine'
      o.frequency.value = freq

      g.gain.setValueAtTime(0.0001, startTime)
      g.gain.linearRampToValueAtTime(0.25, startTime + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

      o.connect(g)
      g.connect(out)
      o.start(startTime)
      o.stop(startTime + duration + 0.02)
    })
  }

  /**
   * Slot machine jackpot: drum-roll fanfare + victory chord.
   */
  playSlotJackpot(): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    const ctx = this.audioContext
    const out = this.sfxGain
    const now = ctx.currentTime

    // Drum roll
    for (let i = 0; i < 8; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()

      o.type = 'sawtooth'
      o.frequency.value = 100 + Math.random() * 50

      g.gain.setValueAtTime(0.15, now + i * 0.1)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.08)

      o.connect(g)
      g.connect(out)
      o.start(now + i * 0.1)
      o.stop(now + i * 0.1 + 0.1)
    }

    // Victory chord
    const chord = [523.25, 659.25, 783.99, 1046.5]
    chord.forEach((freq, i) => {
      const startTime = now + 0.8 + i * 0.03
      const o = ctx.createOscillator()
      const g = ctx.createGain()

      o.type = i === 0 ? 'sawtooth' : 'sine'
      o.frequency.value = freq * 2

      g.gain.setValueAtTime(0.0001, startTime)
      g.gain.linearRampToValueAtTime(i === 0 ? 0.35 : 0.2, startTime + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2)

      o.connect(g)
      g.connect(out)
      o.start(startTime)
      o.stop(startTime + 1.25)
    })
  }

  /**
   * Slot machine near-miss: descending "aww" tone.
   */
  playNearMiss(): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return

    const o = this.audioContext.createOscillator()
    const g = this.audioContext.createGain()

    o.type = 'sine'
    o.frequency.setValueAtTime(400, this.audioContext.currentTime)
    o.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 0.3)

    g.gain.setValueAtTime(0.25, this.audioContext.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 0.3)

    o.connect(g)
    g.connect(this.sfxGain)
    o.start()
    o.stop(this.audioContext.currentTime + 0.3)
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    // Unsubscribe from EventBus
    for (const unsub of this.eventBusUnsubscribers) {
      try { unsub() } catch { /* ignore */ }
    }
    this.eventBusUnsubscribers = []

    this.stopMusic()
    
    if (this.humOscillator) {
      try { this.humOscillator.stop() } catch { /* ignore */ }
      this.humOscillator = null
    }
    if (this.humHarmonicOscillator) {
      try { this.humHarmonicOscillator.stop() } catch { /* ignore */ }
      this.humHarmonicOscillator = null
    }
    
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    
    this.sampleCache.clear()
    this.localSampleBuffers.clear()
    this.localMusicBuffers.clear()
    this.sampleBankReady = false
    this.isInitialized = false
  }
}

// Singleton instance
let soundSystemInstance: SoundSystem | null = null

export function getSoundSystem(eventBus?: EventBus): SoundSystem {
  if (!soundSystemInstance) {
    soundSystemInstance = new SoundSystem()
  }

  if (eventBus) {
    // === EventBus-driven sound integration ===
    const ss = soundSystemInstance

    ss.addEventBusUnsubscriber(
      eventBus.on('game:start', () => {
        ss.playSample('launch', undefined, 0.8)
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('game:over', () => {
        ss.playSample('drain', undefined, 0.8)
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('fever:start', () => {
        ss.triggerFeverAudio()
        void ss.playMusicStem('fever')
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('fever:end', () => {
        void ss.playMusicStem('attract')
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('jackpot:start', () => {
        ss.triggerJackpotAudio()
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('jackpot:phase', ({ phase }) => {
        ss.playJackpotPhase(phase)
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('jackpot:end', () => {
        ss.resetJackpotPhaseAudio()
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('adventure:end', () => {
        ss.playBeep(440)
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('display:set', (state) => {
        // Optional state-specific audio layers
        if (state === 'fever') {
          ss.triggerFeverAudio()
        }
      })
    )

    // Slot machine mini-game audio
    ss.addEventBusUnsubscriber(
      eventBus.on('slot:spin:start', () => {
        ss.playSlotSpinStart()
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('slot:reel:stop', ({ reelIndex }) => {
        ss.playReelStop(reelIndex)
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('slot:win', ({ multiplier }) => {
        ss.playSlotWin(multiplier)
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('slot:jackpot', () => {
        ss.playSlotJackpot()
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('slot:nearmiss', () => {
        ss.playNearMiss()
      })
    )

    // Route generic 'sound:play' events from obstacle builders to SoundSystem
    ss.addEventBusUnsubscriber(
      eventBus.on('sound:play', ({ soundKey, volume = 1, pitch = 1 }) => {
        const velocity = Math.max(0.5, Math.min(24, volume * pitch * 12))
        switch (soundKey) {
          case 'trap-catch':
          case 'trap-release':
            ss.playImpact('peg', velocity)
            return
          case 'trap-release-timeout':
            ss.playImpact('drain', velocity * 0.8)
            return
          case 'bump-spinner':
            ss.playImpact('bumper', velocity)
            return
          case 'launcher-fire':
          case 'launcher-trigger':
            ss.playImpact('launch', velocity * 1.2)
            return
          case 'gate-open':
            ss.playImpact('peg', velocity * 0.9)
            return
          case 'portal-open-success':
            ss.playImpact('jackpot', velocity * 1.4, { premium: true })
            return
          case 'portal-open-timeout':
            ss.playImpact('drain', velocity * 1.1)
            return
          case 'portal-enter':
            ss.playPortalEnter(true)
            return
          default:
            break
        }
      })
    )
  }

  return soundSystemInstance
}

export function resetSoundSystem(): void {
  if (soundSystemInstance) {
    soundSystemInstance.dispose()
    soundSystemInstance = null
  }
}
