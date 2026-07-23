import { Vector3 } from '@babylonjs/core'
import {
  getJackpotPhaseSampleKey,
  getLocalAudioPath,
  getSampleKeyForCategory,
  LOCAL_MUSIC_STEMS,
  LOCAL_SAMPLE_BANK,
  type AudioMusicStem,
  type AudioSampleKey,
  type AudioSourceMode,
  type SampleCategory,
} from './audio-sample-bank'

export interface SampleMetadata {
  id: string
  name: string
  url: string
  category: string
  duration: number
}

export interface MusicTrack {
  id: string
  title: string
  artist: string
  url: string
  duration: number
  map_id?: string
}

export interface CachedSample {
  buffer: AudioBuffer
  metadata: SampleMetadata
}

export interface SoundSystemSamplesState {
  isInitialized: boolean
  audioContext: AudioContext | null
  sfxGain: GainNode | null
  musicMasterGain: GainNode | null
  musicGainA: GainNode | null
  musicGainB: GainNode | null
  musicSourceA: AudioBufferSourceNode | null
  musicSourceB: AudioBufferSourceNode | null
  musicBufferA: AudioBuffer | null
  musicBufferB: AudioBuffer | null
  musicTrackIdA: string | null
  musicTrackIdB: string | null
  activeMusicChannel: 'A' | 'B'
  readonly CROSSFADE_DURATION: number
  sampleCache: Map<string, CachedSample>
  samplesByCategory: Map<SampleCategory, string[]>
  musicCache: Map<string, MusicTrack>
  spatialPanner: PannerNode | null
  sfxVolume: number
  musicVolume: number
  isMuted: boolean
  audioSource: AudioSourceMode
  localSampleBuffers: Map<AudioSampleKey, AudioBuffer>
  localMusicBuffers: Map<AudioMusicStem, AudioBuffer>
  sampleBankReady: boolean
  sampleBankPromise: Promise<void> | null
  activeMusicStem: AudioMusicStem | null
  lastJackpotPhasePlayed: number
}

export interface JackpotSynthFallbacks {
  playJackpotAlarmSynth: () => void
  playJackpotTurbineSynth: (duration?: number) => void
  playJackpotExplosionSynth: () => void
  playSlotJackpot: () => void
}

export function usesSampleBank(state: Pick<SoundSystemSamplesState, 'audioSource' | 'sampleBankReady'>): boolean {
  return state.audioSource === 'samples' && state.sampleBankReady
}

export async function waitForSampleBank(state: Pick<SoundSystemSamplesState, 'sampleBankPromise'>): Promise<void> {
  if (state.sampleBankPromise) {
    await state.sampleBankPromise
  }
}

export async function decodeLocalSampleBank(state: SoundSystemSamplesState): Promise<void> {
  if (!state.audioContext) return

  const decodeOne = async (url: string): Promise<AudioBuffer | null> => {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const arrayBuffer = await response.arrayBuffer()
      return await state.audioContext!.decodeAudioData(arrayBuffer)
    } catch {
      return null
    }
  }

  await Promise.all(
    LOCAL_SAMPLE_BANK.map(async (def) => {
      const buffer = await decodeOne(getLocalAudioPath(def.file))
      if (buffer) {
        state.localSampleBuffers.set(def.key, buffer)
      }
    }),
  )

  await Promise.all(
    LOCAL_MUSIC_STEMS.map(async (def) => {
      const buffer = await decodeOne(getLocalAudioPath(def.file))
      if (buffer) {
        state.localMusicBuffers.set(def.stem, buffer)
        state.musicCache.set(`stem-${def.stem}`, {
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

  state.sampleBankReady = state.localSampleBuffers.size > 0
  if (state.sampleBankReady) {
    console.log(
      `[SoundSystem] Sample bank ready (${state.localSampleBuffers.size} SFX, ${state.localMusicBuffers.size} stems)`,
    )
  }
}

export function playLocalSampleKey(
  state: SoundSystemSamplesState,
  key: AudioSampleKey,
  volume = 1,
  position?: Vector3,
  playbackRate = 1,
): boolean {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return false
  if (state.isMuted) return false

  const buffer = state.localSampleBuffers.get(key)
  if (!buffer) return false

  try {
    const source = state.audioContext.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = Math.max(0.5, Math.min(2, playbackRate))

    const gainNode = state.audioContext.createGain()
    gainNode.gain.value = volume * state.sfxVolume

    if (position && state.spatialPanner) {
      state.spatialPanner.positionX.value = position.x
      state.spatialPanner.positionY.value = position.y
      state.spatialPanner.positionZ.value = position.z
      source.connect(gainNode)
      gainNode.connect(state.spatialPanner)
    } else {
      source.connect(gainNode)
      gainNode.connect(state.sfxGain)
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

export function playSample(
  state: SoundSystemSamplesState,
  category: SampleCategory,
  position?: Vector3,
  volume = 1,
): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return

  if (usesSampleBank(state)) {
    const key = getSampleKeyForCategory(category)
    if (key && playLocalSampleKey(state, key, volume, position)) return
  }

  const sampleIds = state.samplesByCategory.get(category)
  if (!sampleIds || sampleIds.length === 0) {
    console.warn(`[SoundSystem] No samples in category: ${category}`)
    return
  }

  const randomId = sampleIds[Math.floor(Math.random() * sampleIds.length)]
  const cached = state.sampleCache.get(randomId)

  if (!cached) {
    console.warn(`[SoundSystem] Sample not cached: ${randomId}`)
    return
  }

  const source = state.audioContext.createBufferSource()
  source.buffer = cached.buffer

  const gainNode = state.audioContext.createGain()
  gainNode.gain.value = volume * state.sfxVolume

  if (position && state.spatialPanner) {
    state.spatialPanner.positionX.value = position.x
    state.spatialPanner.positionY.value = position.y
    state.spatialPanner.positionZ.value = position.z
    source.connect(gainNode)
    gainNode.connect(state.spatialPanner)
  } else {
    source.connect(gainNode)
    gainNode.connect(state.sfxGain)
  }

  source.start(0)
  source.onended = () => {
    gainNode.disconnect()
  }
}

export function playJackpotPhase(
  state: SoundSystemSamplesState,
  phase: number,
  fallbacks: JackpotSynthFallbacks,
): void {
  if (phase < 1 || phase > 3) return
  if (phase === state.lastJackpotPhasePlayed) return
  state.lastJackpotPhasePlayed = phase

  const sampleKey = getJackpotPhaseSampleKey(phase)
  if (sampleKey && usesSampleBank(state) && playLocalSampleKey(state, sampleKey, 0.95)) {
    return
  }

  switch (phase) {
    case 1:
      fallbacks.playJackpotAlarmSynth()
      break
    case 2:
      fallbacks.playJackpotTurbineSynth(2.8)
      break
    case 3:
      fallbacks.playJackpotExplosionSynth()
      fallbacks.playSlotJackpot()
      break
    default:
      break
  }
}

export function resetJackpotPhaseAudio(
  state: Pick<SoundSystemSamplesState, 'lastJackpotPhasePlayed'>,
): void {
  state.lastJackpotPhasePlayed = 0
}

export async function playMusicStem(
  state: SoundSystemSamplesState,
  stem: AudioMusicStem,
  getEffectiveMusicVolume: () => number,
): Promise<void> {
  if (!state.isInitialized || !state.audioContext || !state.musicMasterGain) return
  if (state.activeMusicStem === stem) return

  const buffer = state.localMusicBuffers.get(stem)
  if (!buffer) {
    console.warn(`[SoundSystem] No local music stem: ${stem}`)
    return
  }

  const trackId = `stem-${stem}`
  const track = state.musicCache.get(trackId)
  if (!track) return

  state.activeMusicStem = stem
  await crossfadeToBuffer(state, buffer, trackId, track.title, getEffectiveMusicVolume)
}

export async function crossfadeToBuffer(
  state: SoundSystemSamplesState,
  targetBuffer: AudioBuffer,
  trackId: string,
  title: string,
  getEffectiveMusicVolume: () => number,
): Promise<void> {
  if (!state.audioContext || !state.musicMasterGain) return

  const isTrackOnA = state.musicTrackIdA === trackId
  const isTrackOnB = state.musicTrackIdB === trackId

  let resolvedBuffer: AudioBuffer = targetBuffer
  if (isTrackOnA && state.musicBufferA) resolvedBuffer = state.musicBufferA
  else if (isTrackOnB && state.musicBufferB) resolvedBuffer = state.musicBufferB

  const outgoingChannel = state.activeMusicChannel
  const incomingChannel = outgoingChannel === 'A' ? 'B' : 'A'
  const outGain = outgoingChannel === 'A' ? state.musicGainA : state.musicGainB
  const inGain = incomingChannel === 'A' ? state.musicGainA : state.musicGainB
  const now = state.audioContext.currentTime
  const duration = state.CROSSFADE_DURATION
  const outSource = outgoingChannel === 'A' ? state.musicSourceA : state.musicSourceB

  if (!outSource) {
    const source = state.audioContext.createBufferSource()
    source.buffer = resolvedBuffer
    source.loop = true
    source.connect(inGain!)
    source.start(now)
    inGain!.gain.setValueAtTime(0, now)
    inGain!.gain.linearRampToValueAtTime(getEffectiveMusicVolume(), now + 0.1)
    if (incomingChannel === 'A') {
      state.musicSourceA = source
      state.musicBufferA = resolvedBuffer
      state.musicTrackIdA = trackId
    } else {
      state.musicSourceB = source
      state.musicBufferB = resolvedBuffer
      state.musicTrackIdB = trackId
    }
    state.activeMusicChannel = incomingChannel
    console.log(`[SoundSystem] Playing music: ${title}`)
    return
  }

  const prevIncomingSource = incomingChannel === 'A' ? state.musicSourceA : state.musicSourceB
  if (prevIncomingSource) {
    try {
      prevIncomingSource.stop(now)
    } catch {
      // ignore
    }
    try {
      prevIncomingSource.disconnect()
    } catch {
      // ignore
    }
  }

  const newSource = state.audioContext.createBufferSource()
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
  inGain!.gain.linearRampToValueAtTime(getEffectiveMusicVolume(), now + duration)

  if (incomingChannel === 'A') {
    state.musicSourceA = newSource
    state.musicBufferA = resolvedBuffer
    state.musicTrackIdA = trackId
  } else {
    state.musicSourceB = newSource
    state.musicBufferB = resolvedBuffer
    state.musicTrackIdB = trackId
  }

  setTimeout(() => {
    try {
      outSource.stop()
    } catch {
      // ignore
    }
    try {
      outSource.disconnect()
    } catch {
      // ignore
    }
    outGain!.gain.value = 0
  }, duration * 1000)

  state.activeMusicChannel = incomingChannel
  console.log(`[SoundSystem] Cross-fading to music: ${title}`)
}

export async function fetchMusicTracks(): Promise<void> {
  // No backend — music tracks are not available
}

export async function playMapMusic(state: SoundSystemSamplesState, mapId: string): Promise<void> {
  if (!state.isInitialized || !state.audioContext || !state.musicMasterGain) return

  try {
    let track: MusicTrack | undefined
    for (const t of state.musicCache.values()) {
      if (t.map_id === mapId) {
        track = t
        break
      }
    }

    if (!track) {
      console.warn(`[SoundSystem] No music for map: ${mapId}`)
      return
    }

    const isTrackOnA = state.musicTrackIdA === track.id
    const isTrackOnB = state.musicTrackIdB === track.id

    let targetBuffer: AudioBuffer | null = null
    if (isTrackOnA) {
      targetBuffer = state.musicBufferA
    } else if (isTrackOnB) {
      targetBuffer = state.musicBufferB
    } else {
      const audioResponse = await fetch(track.url)
      if (!audioResponse.ok) throw new Error(`Failed to fetch ${track.id}`)
      const arrayBuffer = await audioResponse.arrayBuffer()
      targetBuffer = await state.audioContext.decodeAudioData(arrayBuffer)
    }

    if (!targetBuffer) {
      console.warn(`[SoundSystem] Could not load buffer for ${track.id}`)
      return
    }

    const outgoingChannel = state.activeMusicChannel
    const incomingChannel = outgoingChannel === 'A' ? 'B' : 'A'
    const outGain = outgoingChannel === 'A' ? state.musicGainA : state.musicGainB
    const inGain = incomingChannel === 'A' ? state.musicGainA : state.musicGainB
    const now = state.audioContext.currentTime
    const duration = state.CROSSFADE_DURATION

    const outSource = outgoingChannel === 'A' ? state.musicSourceA : state.musicSourceB
    if (!outSource) {
      const source = state.audioContext.createBufferSource()
      source.buffer = targetBuffer
      source.loop = true
      source.connect(inGain!)
      source.start(now)

      inGain!.gain.setValueAtTime(0, now)
      inGain!.gain.linearRampToValueAtTime(state.musicVolume, now + 0.1)

      if (incomingChannel === 'A') {
        state.musicSourceA = source
        state.musicBufferA = targetBuffer
        state.musicTrackIdA = track.id
      } else {
        state.musicSourceB = source
        state.musicBufferB = targetBuffer
        state.musicTrackIdB = track.id
      }
      state.activeMusicChannel = incomingChannel
      console.log(`[SoundSystem] Playing music: ${track.title}`)
      return
    }

    const prevIncomingSource = incomingChannel === 'A' ? state.musicSourceA : state.musicSourceB
    if (prevIncomingSource) {
      try {
        prevIncomingSource.stop(now)
      } catch {
        // ignore
      }
      try {
        prevIncomingSource.disconnect()
      } catch {
        // ignore
      }
    }

    const newSource = state.audioContext.createBufferSource()
    newSource.buffer = targetBuffer
    newSource.loop = true
    newSource.connect(inGain!)
    newSource.start(now)

    const currentOutValue = outGain!.gain.value
    outGain!.gain.cancelScheduledValues(now)
    outGain!.gain.setValueAtTime(currentOutValue, now)
    outGain!.gain.linearRampToValueAtTime(0, now + duration)

    inGain!.gain.cancelScheduledValues(now)
    inGain!.gain.setValueAtTime(0, now)
    inGain!.gain.linearRampToValueAtTime(state.musicVolume, now + duration)

    if (incomingChannel === 'A') {
      state.musicSourceA = newSource
      state.musicBufferA = targetBuffer
      state.musicTrackIdA = track.id
    } else {
      state.musicSourceB = newSource
      state.musicBufferB = targetBuffer
      state.musicTrackIdB = track.id
    }

    setTimeout(() => {
      try {
        outSource.stop()
      } catch {
        // ignore
      }
      try {
        outSource.disconnect()
      } catch {
        // ignore
      }
      outGain!.gain.value = 0
    }, duration * 1000)

    state.activeMusicChannel = incomingChannel
    console.log(`[SoundSystem] Cross-fading to music: ${track.title}`)
  } catch (err) {
    console.warn('[SoundSystem] Failed to play music:', err)
  }
}

export function stopMusic(state: SoundSystemSamplesState): void {
  const now = state.audioContext?.currentTime ?? 0

  if (state.musicSourceA) {
    try {
      state.musicSourceA.stop()
    } catch {
      // ignore
    }
    try {
      state.musicSourceA.disconnect()
    } catch {
      // ignore
    }
    state.musicSourceA = null
  }
  if (state.musicSourceB) {
    try {
      state.musicSourceB.stop()
    } catch {
      // ignore
    }
    try {
      state.musicSourceB.disconnect()
    } catch {
      // ignore
    }
    state.musicSourceB = null
  }

  if (state.musicGainA) {
    state.musicGainA.gain.cancelScheduledValues(now)
    state.musicGainA.gain.value = 0
  }
  if (state.musicGainB) {
    state.musicGainB.gain.cancelScheduledValues(now)
    state.musicGainB.gain.value = 0
  }
}
