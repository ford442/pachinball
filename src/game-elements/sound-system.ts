/**
 * Pachinball Sound System
 * 
 * Full audio integration using Web Audio API with storage_manager backend.
 * - Samples: /api/samples (peg, bumper, flipper hits)
 * - Music: /api/music (map-specific tracks)
 * - Spatial audio for key objects
 * - Master volume + mute controls
 */

import { Vector3 } from '@babylonjs/core'

// Storage manager API base URL
const STORAGE_API_BASE = 'http://localhost:8000/api'

// Audio categories for samples
export type SampleCategory = 'peg' | 'bumper' | 'flipper' | 'jackpot' | 'fever' | 'launch' | 'drain'

// Map IDs for music tracks
export type MapId = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | 'M'

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
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  
  // Cached samples by category
  private sampleCache: Map<string, CachedSample> = new Map()
  private samplesByCategory: Map<SampleCategory, string[]> = new Map()
  
  // Music state
  private currentMusicSource: AudioBufferSourceNode | null = null
  private currentMusicBuffer: AudioBuffer | null = null
  private currentTrackId: string | null = null
  
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
      
      // Create music gain node
      this.musicGain = this.audioContext.createGain()
      this.musicGain.gain.value = this.musicVolume
      this.musicGain.connect(this.masterGain)
      
      // Create SFX gain node
      this.sfxGain = this.audioContext.createGain()
      this.sfxGain.gain.value = this.sfxVolume
      this.sfxGain.connect(this.masterGain)
      
      // Create spatial panner for 3D audio
      this.spatialPanner = this.audioContext.createPanner()
      this.spatialPanner.panningModel = 'HRTF'
      this.spatialPanner.distanceModel = 'inverse'
      this.spatialPanner.refDistance = 1
      this.spatialPanner.maxDistance = 20
      this.spatialPanner.rolloffFactor = 1
      this.spatialPanner.connect(this.sfxGain)
      
      // Load samples from storage manager
      await this.loadSamples()
      
      this.isInitialized = true
      console.log('[SoundSystem] Initialized successfully')
    } catch (err) {
      console.error('[SoundSystem] Initialization failed:', err)
      throw err
    }
  }

  /**
   * Resume audio context (needed after user interaction)
   */
  async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  /**
   * Load all samples from the storage manager API
   */
  private async loadSamples(): Promise<void> {
    try {
      const response = await fetch(`${STORAGE_API_BASE}/samples`)
      if (!response.ok) throw new Error('Failed to fetch samples')
      
      const data = await response.json()
      const samples: SampleMetadata[] = data.samples || []
      
      // Group samples by category
      for (const sample of samples) {
        const category = sample.category as SampleCategory
        if (this.samplesByCategory.has(category)) {
          this.samplesByCategory.get(category)!.push(sample.id)
          
          // Load and cache the audio buffer
          await this.loadSampleBuffer(sample)
        }
      }
      
      console.log(`[SoundSystem] Loaded ${samples.length} samples`)
    } catch (err) {
      console.warn('[SoundSystem] Failed to load samples:', err)
      // Continue without samples - game still works
    }
  }

  /**
   * Load a single sample buffer
   */
  private async loadSampleBuffer(metadata: SampleMetadata): Promise<void> {
    if (!this.audioContext) return
    if (this.sampleCache.has(metadata.id)) return
    
    try {
      const response = await fetch(metadata.url)
      if (!response.ok) throw new Error(`Failed to fetch ${metadata.id}`)
      
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
      
      this.sampleCache.set(metadata.id, {
        buffer: audioBuffer,
        metadata
      })
    } catch (err) {
      console.warn(`[SoundSystem] Failed to load sample ${metadata.id}:`, err)
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
   * Play music for a specific map
   */
  async playMapMusic(mapId: MapId): Promise<void> {
    if (!this.isInitialized || !this.audioContext || !this.musicGain) return
    
    try {
      // Stop current music
      this.stopMusic()
      
      // Fetch music for this map
      const response = await fetch(`${STORAGE_API_BASE}/music?map_id=${mapId}`)
      if (!response.ok) throw new Error('Failed to fetch music')
      
      const data = await response.json()
      const tracks: MusicTrack[] = data.tracks || []
      
      if (tracks.length === 0) {
        console.warn(`[SoundSystem] No music for map: ${mapId}`)
        return
      }
      
      // Use first track (or could randomize)
      const track = tracks[0]
      
      // Load track if not cached
      if (this.currentTrackId !== track.id) {
        const audioResponse = await fetch(track.url)
        if (!audioResponse.ok) throw new Error(`Failed to fetch ${track.id}`)
        
        const arrayBuffer = await audioResponse.arrayBuffer()
        this.currentMusicBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
        this.currentTrackId = track.id
      }
      
      // Play
      this.playMusicBuffer()
      
      console.log(`[SoundSystem] Playing music: ${track.title}`)
    } catch (err) {
      console.warn('[SoundSystem] Failed to play music:', err)
    }
  }

  /**
   * Play the current music buffer
   */
  private playMusicBuffer(): void {
    if (!this.audioContext || !this.musicGain || !this.currentMusicBuffer) return
    
    this.currentMusicSource = this.audioContext.createBufferSource()
    this.currentMusicSource.buffer = this.currentMusicBuffer
    this.currentMusicSource.loop = true
    this.currentMusicSource.connect(this.musicGain)
    this.currentMusicSource.start(0)
  }

  /**
   * Stop music playback
   */
  stopMusic(): void {
    if (this.currentMusicSource) {
      try {
        this.currentMusicSource.stop()
        this.currentMusicSource.disconnect()
      } catch {
        // Ignore errors if already stopped
      }
      this.currentMusicSource = null
    }
  }

  /**
   * Trigger jackpot/fever audio layer
   */
  triggerJackpotAudio(): void {
    // Play jackpot sample
    this.playSample('jackpot', undefined, 1.2)
    
    // Could also add music layer, filter effects, etc.
    if (this.musicGain && this.audioContext) {
      // Brief volume boost
      const now = this.audioContext.currentTime
      this.musicGain.gain.setValueAtTime(this.musicVolume, now)
      this.musicGain.gain.linearRampToValueAtTime(this.musicVolume * 1.3, now + 0.1)
      this.musicGain.gain.linearRampToValueAtTime(this.musicVolume, now + 0.5)
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
    if (this.musicGain) {
      this.musicGain.gain.value = this.musicVolume
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
   * Dispose and cleanup
   */
  dispose(): void {
    this.stopMusic()
    
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

export function getSoundSystem(): SoundSystem {
  if (!soundSystemInstance) {
    soundSystemInstance = new SoundSystem()
  }
  return soundSystemInstance
}

export function resetSoundSystem(): void {
  if (soundSystemInstance) {
    soundSystemInstance.dispose()
    soundSystemInstance = null
  }
}
