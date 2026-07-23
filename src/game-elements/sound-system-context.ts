import { GameConfig } from '../config'

export interface SoundSystemContextState {
  audioContext: AudioContext | null
  masterGain: GainNode | null
  sfxGain: GainNode | null
  musicMasterGain: GainNode | null
  musicGainA: GainNode | null
  musicGainB: GainNode | null
  spatialPanner: PannerNode | null
  humOscillator: OscillatorNode | null
  humHarmonicOscillator: OscillatorNode | null
  humGain: GainNode | null
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  isMuted: boolean
  isInitialized: boolean
  loadPromise: Promise<void> | null
  sampleBankPromise: Promise<void> | null
}

export interface SoundSystemContextInitHooks {
  createSynthesizedGameSounds: () => void
  decodeLocalSampleBank: () => Promise<void>
  loadGoldBallSounds: () => Promise<void>
}

export interface SoundSystemContextDisposeHooks {
  stopMusic: () => void
}

export async function initSoundSystemContext(
  state: SoundSystemContextState,
  doInit: () => Promise<void>,
): Promise<void> {
  if (state.isInitialized) return
  if (state.loadPromise) return state.loadPromise
  state.loadPromise = doInit()
  return state.loadPromise
}

export async function doInitSoundSystemContext(
  state: SoundSystemContextState,
  hooks: SoundSystemContextInitHooks,
): Promise<void> {
  try {
    state.audioContext = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )()

    state.masterGain = state.audioContext.createGain()
    state.masterGain.gain.value = state.masterVolume
    state.masterGain.connect(state.audioContext.destination)

    state.musicMasterGain = state.audioContext.createGain()
    state.musicMasterGain.gain.value = 1
    state.musicMasterGain.connect(state.masterGain)

    state.musicGainA = state.audioContext.createGain()
    state.musicGainA.gain.value = 0
    state.musicGainA.connect(state.musicMasterGain)

    state.musicGainB = state.audioContext.createGain()
    state.musicGainB.gain.value = 0
    state.musicGainB.connect(state.musicMasterGain)

    state.sfxGain = state.audioContext.createGain()
    state.sfxGain.gain.value = state.sfxVolume
    state.sfxGain.connect(state.masterGain)

    state.spatialPanner = state.audioContext.createPanner()
    state.spatialPanner.panningModel = 'HRTF'
    state.spatialPanner.distanceModel = 'inverse'
    state.spatialPanner.refDistance = 1
    state.spatialPanner.maxDistance = 20
    state.spatialPanner.rolloffFactor = 1
    state.spatialPanner.connect(state.sfxGain)

    hooks.createSynthesizedGameSounds()
    state.isInitialized = true
    console.log('[SoundSystem] Core audio ready — gold ball sounds loading in background')

    state.sampleBankPromise = hooks.decodeLocalSampleBank().catch((err) => {
      console.warn('[SoundSystem] Local sample bank decode failed, synth fallback active:', err)
    })

    hooks.loadGoldBallSounds().catch((err) => {
      console.warn('[SoundSystem] Gold ball sound loading failed:', err)
    })

    startAmbientHum(state)
    console.log('[SoundSystem] Initialized successfully')
  } catch (err) {
    console.error('[SoundSystem] Initialization failed:', err)
    throw err
  }
}

export async function resumeSoundSystemContext(state: SoundSystemContextState): Promise<void> {
  if (state.audioContext?.state === 'suspended') {
    await state.audioContext.resume()
  }
  if (!state.humOscillator) {
    startAmbientHum(state)
  }
}

export async function suspendSoundSystemContext(state: SoundSystemContextState): Promise<void> {
  if (state.audioContext?.state === 'running') {
    await state.audioContext.suspend()
  }
}

export function setHumVolume(state: SoundSystemContextState, volume: number): void {
  if (state.humGain) {
    state.humGain.gain.value = Math.max(0, Math.min(1, volume)) * 0.025
  }
}

export function setMasterVolume(state: SoundSystemContextState, volume: number): void {
  state.masterVolume = Math.max(0, Math.min(1, volume))
  if (state.masterGain) {
    state.masterGain.gain.value = state.isMuted ? 0 : state.masterVolume
  }
}

export function setMusicVolume(state: SoundSystemContextState, volume: number, effectiveVolume: number): void {
  state.musicVolume = Math.max(0, Math.min(1, volume))
  if (state.musicMasterGain) {
    state.musicMasterGain.gain.value = effectiveVolume
  }
}

export function setSfxVolume(state: SoundSystemContextState, volume: number): void {
  state.sfxVolume = Math.max(0, Math.min(1, volume))
  if (state.sfxGain) {
    state.sfxGain.gain.value = state.sfxVolume
  }
}

export function toggleMute(state: SoundSystemContextState): boolean {
  state.isMuted = !state.isMuted
  if (state.masterGain) {
    state.masterGain.gain.value = state.isMuted ? 0 : state.masterVolume
  }
  return state.isMuted
}

export function getVolumeSettings(state: SoundSystemContextState): {
  master: number
  music: number
  sfx: number
  muted: boolean
} {
  return {
    master: state.masterVolume,
    music: state.musicVolume,
    sfx: state.sfxVolume,
    muted: state.isMuted,
  }
}

export function getEffectiveMusicVolume(state: Pick<SoundSystemContextState, 'musicVolume'>): number {
  const reducedAudio = GameConfig.camera.reducedMotion || GameConfig.accessibility.photosensitiveMode
  return state.musicVolume * (reducedAudio ? 0.55 : 1)
}

export function isReady(state: SoundSystemContextState): boolean {
  return state.isInitialized
}

export function disposeSoundSystemContext(
  state: SoundSystemContextState,
  hooks: SoundSystemContextDisposeHooks,
): void {
  hooks.stopMusic()

  if (state.humOscillator) {
    try {
      state.humOscillator.stop()
    } catch {
      // ignore
    }
    state.humOscillator = null
  }
  if (state.humHarmonicOscillator) {
    try {
      state.humHarmonicOscillator.stop()
    } catch {
      // ignore
    }
    state.humHarmonicOscillator = null
  }

  if (state.audioContext) {
    void state.audioContext.close()
    state.audioContext = null
  }
}

function startAmbientHum(state: SoundSystemContextState): void {
  if (!state.audioContext || !state.masterGain) return

  state.humOscillator = state.audioContext.createOscillator()
  state.humOscillator.type = 'sine'
  state.humOscillator.frequency.value = 60

  state.humHarmonicOscillator = state.audioContext.createOscillator()
  state.humHarmonicOscillator.type = 'sine'
  state.humHarmonicOscillator.frequency.value = 120

  state.humGain = state.audioContext.createGain()
  state.humGain.gain.value = 0.025

  state.humOscillator.connect(state.humGain)
  state.humHarmonicOscillator.connect(state.humGain)
  state.humGain.connect(state.masterGain)

  state.humOscillator.start()
  state.humHarmonicOscillator.start()
}
