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

// Audio categories for samples
export type SampleCategory = 'peg' | 'bumper' | 'flipper' | 'jackpot' | 'fever' | 'launch' | 'drain'

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
  
  // Loading state
  private isInitialized = false
  private loadPromise: Promise<void> | null = null

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
   * Set ambient cabinet hum volume (0.0 to 1.0)
   */
  setHumVolume(volume: number): void {
    if (this.humGain) {
      this.humGain.gain.value = Math.max(0, Math.min(1, volume)) * 0.025
    }
  }

  /**
   * Play a random sample from a category
   */
  playSample(category: SampleCategory, position?: Vector3, volume = 1.0): void {
    if (!this.isInitialized || !this.audioContext || !this.sfxGain) return
    if (this.isMuted) return
    
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
    // Play jackpot sample
    this.playSample('jackpot', undefined, 1.2)
    
    // Brief volume boost on music master
    if (this.musicMasterGain && this.audioContext) {
      const now = this.audioContext.currentTime
      this.musicMasterGain.gain.setValueAtTime(this.musicVolume, now)
      this.musicMasterGain.gain.linearRampToValueAtTime(this.musicVolume * 1.3, now + 0.1)
      this.musicMasterGain.gain.linearRampToValueAtTime(this.musicVolume, now + 0.5)
    }
  }

  triggerFeverAudio(): void {
    this.playSample('fever', undefined, 1.0)
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
      this.musicMasterGain.gain.value = this.musicVolume
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

    this.play(soundName)
  }

  /**
   * Play sound when a gold ball is collected
   */
  playGoldBallCollect(type: BallType): void {
    if (type === BallType.STANDARD) return

    const soundName = type === BallType.SOLID_GOLD
      ? 'solid-gold-collect'
      : 'gold-plated-collect'

    this.play(soundName)
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
    const base = (import.meta.env.BASE_URL as string) || './'
    const soundFiles = [
      { name: 'gold-plated-spawn', url: `${base}sounds/gold-spawn.mp3` },
      { name: 'solid-gold-spawn', url: `${base}sounds/solid-gold-spawn.mp3` },
      { name: 'gold-plated-collect', url: `${base}sounds/gold-collect.mp3` },
      { name: 'solid-gold-collect', url: `${base}sounds/solid-gold-collect.mp3` }
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
      })
    )

    ss.addEventBusUnsubscriber(
      eventBus.on('jackpot:start', () => {
        ss.triggerJackpotAudio()
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
  }

  return soundSystemInstance
}

export function resetSoundSystem(): void {
  if (soundSystemInstance) {
    soundSystemInstance.dispose()
    soundSystemInstance = null
  }
}
