import type { Vector3 } from '@babylonjs/core'
import { BallType, GameConfig } from '../config'
import { resolveAssetUrl } from '../game/game-utils'
import {
  createImpactVoiceProfile,
  getPortalMotifFrequencies,
  type ImpactCategory,
  type ImpactVoiceOptions,
} from './audio-synth'
import { getSampleKeyForImpact, type AudioSampleKey, type SampleCategory } from './audio-sample-bank'
import type { CachedSample } from './sound-system-samples'
interface SynthesizedSound {
  play: () => void
}
export interface SoundSystemSynthState {
  isInitialized: boolean
  audioContext: AudioContext | null
  sfxGain: GainNode | null
  isMuted: boolean
  sfxVolume: number
  lastImpactAtByCategory: Partial<Record<ImpactCategory, number>>
  synthesizedSounds: Map<string, SynthesizedSound>
  sampleCache: Map<string, CachedSample>
  samplesByCategory: Map<SampleCategory, string[]>
}
export interface SampleBankPlaybackHelpers {
  usesSampleBank: () => boolean
  playLocalSampleKey: (key: AudioSampleKey, volume?: number, position?: Vector3, playbackRate?: number) => boolean
}

type SampleRenderer = (t: number, duration: number) => number

interface SampleRenderConfig {
  cat: SampleCategory
  duration: number
  render: SampleRenderer
}

const SYNTHETIC_SAMPLE_CONFIGS: readonly SampleRenderConfig[] = [
  {
    cat: 'launch',
    duration: 0.4,
    render: (t, d) => {
      const env = Math.max(0, 1 - t / d)
      const freq = 200 + t * 800
      return Math.sin(2 * Math.PI * freq * t) * env * 0.4
    },
  },
  {
    cat: 'flipper',
    duration: 0.08,
    render: (t, d) => {
      const env = t < 0.01 ? t / 0.01 : Math.max(0, 1 - (t - 0.01) / (d - 0.01))
      return (Math.random() * 2 - 1) * env * 0.5
    },
  },
  {
    cat: 'bumper',
    duration: 0.25,
    render: (t) => {
      const env = Math.exp(-t * 20)
      return (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t)) * env * 0.35
    },
  },
  {
    cat: 'peg',
    duration: 0.06,
    render: (t, d) => {
      const env = Math.max(0, 1 - t / d)
      return (Math.random() * 2 - 1) * env * 0.3
    },
  },
  {
    cat: 'drain',
    duration: 0.5,
    render: (t, d) => {
      const env = Math.max(0, 1 - t / d)
      const freq = 300 - t * 200
      return Math.sin(2 * Math.PI * Math.max(50, freq) * t) * env * 0.4
    },
  },
  {
    cat: 'jackpot',
    duration: 0.6,
    render: (t, d) => {
      const env = Math.max(0, 1 - t / d)
      return (
        (Math.sin(2 * Math.PI * 523 * t) +
          Math.sin(2 * Math.PI * 659 * t) +
          Math.sin(2 * Math.PI * 784 * t)) *
        env *
        0.25
      )
    },
  },
  {
    cat: 'fever',
    duration: 0.3,
    render: (t, d) => {
      const env = Math.max(0, 1 - t / d)
      const freq = 600 + Math.sin(t * 30) * 100
      return Math.sin(2 * Math.PI * freq * t) * env * 0.35
    },
  },
]

export function createSynthesizedGameSounds(state: SoundSystemSynthState): void {
  if (!state.audioContext) return

  for (const config of SYNTHETIC_SAMPLE_CONFIGS) {
    const id = `synth-${config.cat}`
    const buffer = renderBuffer(state.audioContext, config.duration, config.render)
    state.sampleCache.set(id, {
      buffer,
      metadata: { id, name: id, url: '', category: config.cat, duration: config.duration },
    })
    const list = state.samplesByCategory.get(config.cat) ?? []
    list.push(id)
    state.samplesByCategory.set(config.cat, list)
  }

  console.log('[SoundSystem] Synthesized game sounds created')
}

function renderBuffer(ctx: AudioContext, duration: number, render: SampleRenderer): AudioBuffer {
  const sr = ctx.sampleRate
  const buf = ctx.createBuffer(1, Math.floor(sr * duration), sr)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const t = i / sr
    data[i] = render(t, duration)
  }
  return buf
}

export function createSynthesizedSound(state: SoundSystemSynthState, name: string): void {
  const audioContext = state.audioContext
  if (!audioContext) return

  const isSolidGold = name.includes('solid-gold')
  const startFreq = isSolidGold ? 880 : 523.25
  const endFreq = isSolidGold ? 1760 : 1046.5
  const startGain = isSolidGold ? 0.3 : 0.2
  const decaySeconds = isSolidGold ? 0.5 : 0.3

  state.synthesizedSounds.set(name, {
    play: () => {
      const osc = audioContext.createOscillator()
      const gain = audioContext.createGain()
      osc.frequency.setValueAtTime(startFreq, audioContext.currentTime)
      osc.frequency.exponentialRampToValueAtTime(endFreq, audioContext.currentTime + 0.1)
      gain.gain.setValueAtTime(startGain, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + decaySeconds)
      osc.connect(gain)
      gain.connect(state.sfxGain!)
      osc.start()
      osc.stop(audioContext.currentTime + 0.6)
    },
  })
}

export function playSynthesizedNamedSound(state: SoundSystemSynthState, name: string): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return

  const sound = state.synthesizedSounds.get(name)
  if (sound) {
    sound.play()
  }
}

export async function loadGoldBallSounds(state: SoundSystemSynthState): Promise<void> {
  const soundFiles = [
    { name: 'gold-plated-spawn', url: resolveAssetUrl('sounds/gold-spawn.mp3')! },
    { name: 'solid-gold-spawn', url: resolveAssetUrl('sounds/solid-gold-spawn.mp3')! },
    { name: 'gold-plated-collect', url: resolveAssetUrl('sounds/gold-collect.mp3')! },
    { name: 'solid-gold-collect', url: resolveAssetUrl('sounds/solid-gold-collect.mp3')! },
  ]

  for (const { name, url } of soundFiles) {
    try {
      await loadSoundFile(state, name, url)
    } catch {
      createSynthesizedSound(state, name)
    }
  }
}

async function loadSoundFile(state: SoundSystemSynthState, name: string, url: string): Promise<void> {
  if (!state.audioContext) return
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${name}`)

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer)

  state.synthesizedSounds.set(name, {
    play: () => {
      const source = state.audioContext!.createBufferSource()
      source.buffer = audioBuffer
      const gain = state.audioContext!.createGain()
      gain.gain.value = state.sfxVolume
      source.connect(gain)
      gain.connect(state.sfxGain!)
      source.start(0)
    },
  })
}

export function playImpact(
  state: SoundSystemSynthState,
  category: ImpactCategory,
  velocity: number,
  options: ImpactVoiceOptions & { position?: Vector3 } = {},
  sampleHelpers?: SampleBankPlaybackHelpers,
): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return

  if (sampleHelpers?.usesSampleBank()) {
    const key = getSampleKeyForImpact(category)
    if (key) {
      const n = Math.max(0, Math.min(1, velocity / 24))
      const vol = (0.55 + n * 0.45) * (options.premium ? 1.08 : 1)
      const rate = 0.85 + n * 0.35
      if (sampleHelpers.playLocalSampleKey(key, vol, options.position, rate)) return
    }
  }

  const now = state.audioContext.currentTime
  const reducedAudio = GameConfig.camera.reducedMotion || GameConfig.accessibility.photosensitiveMode
  const profile = createImpactVoiceProfile(category, velocity, options, reducedAudio)
  const lastPlayedAt = state.lastImpactAtByCategory[category] ?? Number.NEGATIVE_INFINITY
  if (now - lastPlayedAt < profile.cooldownSeconds) return
  state.lastImpactAtByCategory[category] = now

  const finalGain = Math.max(0.0001, Math.min(1, profile.gain * state.sfxVolume))
  const voiceGain = state.audioContext.createGain()
  voiceGain.gain.setValueAtTime(0.0001, now)
  voiceGain.gain.linearRampToValueAtTime(finalGain, now + profile.attack)
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.decay)

  const stereoPanner = createOptionalStereoPanner(state, options.position, reducedAudio)
  voiceGain.connect(stereoPanner ?? state.sfxGain)

  const osc = state.audioContext.createOscillator()
  osc.type = profile.waveform
  osc.frequency.setValueAtTime(profile.baseFreq, now)
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, profile.sweepFreq), now + profile.decay)

  const tonalFilter = state.audioContext.createBiquadFilter()
  tonalFilter.type = 'lowpass'
  tonalFilter.frequency.setValueAtTime(profile.filterStart, now)
  tonalFilter.frequency.exponentialRampToValueAtTime(Math.max(120, profile.filterEnd), now + profile.decay)

  osc.connect(tonalFilter)
  tonalFilter.connect(voiceGain)
  osc.start(now)
  osc.stop(now + profile.decay + 0.02)

  if (profile.noiseAmount > 0.001 && !reducedAudio) {
    playNoiseBurst(state, profile, now, voiceGain)
  }

  if (category === 'jackpot' || options.premium) {
    playMotif(state, getPortalMotifFrequencies(true), now, finalGain * 0.55)
  }
}

export function playPortalEnter(
  state: SoundSystemSynthState,
  premium = true,
  sampleHelpers?: SampleBankPlaybackHelpers,
): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  if (sampleHelpers?.usesSampleBank() && sampleHelpers.playLocalSampleKey('portal', premium ? 0.95 : 0.7)) return

  const now = state.audioContext.currentTime
  const reducedAudio = GameConfig.camera.reducedMotion || GameConfig.accessibility.photosensitiveMode
  const notes = getPortalMotifFrequencies(premium && !reducedAudio)
  playMotif(state, notes, now, reducedAudio ? 0.1 : 0.16)
}

function playMotif(state: SoundSystemSynthState, notes: number[], startTime: number, gain = 0.14): void {
  if (!state.audioContext || !state.sfxGain || notes.length === 0) return
  for (let i = 0; i < notes.length; i++) {
    const osc = state.audioContext.createOscillator()
    const g = state.audioContext.createGain()
    const noteStart = startTime + i * 0.055
    const noteEnd = noteStart + 0.2
    osc.type = i % 2 === 0 ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(notes[i], noteStart)
    g.gain.setValueAtTime(0.0001, noteStart)
    g.gain.linearRampToValueAtTime(gain, noteStart + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, noteEnd)
    osc.connect(g)
    g.connect(state.sfxGain)
    osc.start(noteStart)
    osc.stop(noteEnd + 0.01)
  }
}

function playNoiseBurst(
  state: SoundSystemSynthState,
  profile: ReturnType<typeof createImpactVoiceProfile>,
  startTime: number,
  outputNode: GainNode,
): void {
  if (!state.audioContext) return
  const sr = state.audioContext.sampleRate
  const duration = Math.max(0.02, Math.min(0.12, profile.decay * 0.6))
  const buffer = state.audioContext.createBuffer(1, Math.floor(sr * duration), sr)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * profile.noiseAmount

  const source = state.audioContext.createBufferSource()
  source.buffer = buffer

  const bandpass = state.audioContext.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.setValueAtTime(Math.max(250, profile.filterStart), startTime)
  bandpass.Q.value = 0.85

  const noiseGain = state.audioContext.createGain()
  noiseGain.gain.setValueAtTime(profile.noiseAmount, startTime)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

  source.connect(bandpass)
  bandpass.connect(noiseGain)
  noiseGain.connect(outputNode)
  source.start(startTime)
  source.stop(startTime + duration + 0.01)
}

function createOptionalStereoPanner(
  state: SoundSystemSynthState,
  position: Vector3 | undefined,
  reducedAudio: boolean,
): StereoPannerNode | null {
  if (!state.audioContext || reducedAudio) return null
  const createStereoPanner = (state.audioContext as unknown as { createStereoPanner?: () => StereoPannerNode })
    .createStereoPanner
  if (!createStereoPanner) return null
  const panner = createStereoPanner.call(state.audioContext)
  const pan = position ? Math.max(-1, Math.min(1, position.x / 8)) : Math.random() * 0.3 - 0.15
  panner.pan.value = pan
  panner.connect(state.sfxGain!)
  return panner
}

export function playJackpotAlarmSynth(state: SoundSystemSynthState): void {
  if (!state.audioContext || !state.sfxGain) return
  const now = state.audioContext.currentTime

  const sub = state.audioContext.createOscillator()
  const subG = state.audioContext.createGain()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(48, now)
  subG.gain.setValueAtTime(0.6 * state.sfxVolume, now)
  subG.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
  sub.connect(subG)
  subG.connect(state.sfxGain)
  sub.start(now)
  sub.stop(now + 1.3)

  const siren = state.audioContext.createOscillator()
  const sG = state.audioContext.createGain()
  siren.type = 'sawtooth'
  siren.frequency.setValueAtTime(620, now)
  siren.frequency.linearRampToValueAtTime(980, now + 0.25)
  siren.frequency.linearRampToValueAtTime(620, now + 0.5)
  sG.gain.setValueAtTime(0.25 * state.sfxVolume, now)
  sG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
  siren.connect(sG)
  sG.connect(state.sfxGain)
  siren.start(now)
  siren.stop(now + 0.65)
}

export function playJackpotTurbineSynth(state: SoundSystemSynthState, duration = 2.8): void {
  if (!state.audioContext || !state.sfxGain) return
  const now = state.audioContext.currentTime

  const o = state.audioContext.createOscillator()
  const g = state.audioContext.createGain()
  const filter = state.audioContext.createBiquadFilter()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(140, now)
  o.frequency.exponentialRampToValueAtTime(920, now + duration)
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(600, now)
  filter.Q.setValueAtTime(1.8, now)
  g.gain.setValueAtTime(0.0001, now)
  g.gain.linearRampToValueAtTime(0.22 * state.sfxVolume, now + 0.2)
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  o.connect(filter)
  filter.connect(g)
  g.connect(state.sfxGain)
  o.start(now)
  o.stop(now + duration + 0.05)
}

export function playJackpotExplosionSynth(state: SoundSystemSynthState): void {
  if (!state.audioContext || !state.sfxGain) return
  const now = state.audioContext.currentTime

  const noise = state.audioContext.createBufferSource()
  const buffer = state.audioContext.createBuffer(1, state.audioContext.sampleRate * 1.2, state.audioContext.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noise.buffer = buffer

  const noiseFilter = state.audioContext.createBiquadFilter()
  noiseFilter.type = 'lowpass'
  noiseFilter.frequency.setValueAtTime(1200, now)

  const nG = state.audioContext.createGain()
  nG.gain.setValueAtTime(0.7 * state.sfxVolume, now)
  nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
  noise.connect(noiseFilter)
  noiseFilter.connect(nG)
  nG.connect(state.sfxGain)
  noise.start(now)

  const punch = state.audioContext.createOscillator()
  const pG = state.audioContext.createGain()
  punch.type = 'sine'
  punch.frequency.setValueAtTime(48, now)
  pG.gain.setValueAtTime(0.9 * state.sfxVolume, now)
  pG.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
  punch.connect(pG)
  pG.connect(state.sfxGain)
  punch.start(now)
  punch.stop(now + 0.7)
}

export function playBeep(state: SoundSystemSynthState, freq: number): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  const o = state.audioContext.createOscillator()
  const g = state.audioContext.createGain()
  o.frequency.value = freq
  o.connect(g)
  g.connect(state.sfxGain)
  o.start()
  g.gain.exponentialRampToValueAtTime(0.0001, state.audioContext.currentTime + 0.1)
  o.stop(state.audioContext.currentTime + 0.1)
}

export function playSlotSpinStart(state: SoundSystemSynthState): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  const o = state.audioContext.createOscillator()
  const g = state.audioContext.createGain()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(200, state.audioContext.currentTime)
  o.frequency.exponentialRampToValueAtTime(800, state.audioContext.currentTime + 0.3)
  g.gain.setValueAtTime(0.25, state.audioContext.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, state.audioContext.currentTime + 0.5)
  o.connect(g)
  g.connect(state.sfxGain)
  o.start()
  o.stop(state.audioContext.currentTime + 0.5)
}

export function playReelStop(
  state: SoundSystemSynthState,
  reelIndex: number,
  sampleHelpers?: SampleBankPlaybackHelpers,
): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  if (sampleHelpers?.usesSampleBank()) {
    const rate = 0.9 + reelIndex * 0.08
    if (sampleHelpers.playLocalSampleKey('slot-stop', 0.85, undefined, rate)) return
  }

  const baseFreq = 400 + reelIndex * 100
  const o = state.audioContext.createOscillator()
  const g = state.audioContext.createGain()
  o.type = 'square'
  o.frequency.setValueAtTime(baseFreq, state.audioContext.currentTime)
  o.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, state.audioContext.currentTime + 0.05)
  g.gain.setValueAtTime(0.2, state.audioContext.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, state.audioContext.currentTime + 0.1)
  o.connect(g)
  g.connect(state.sfxGain)
  o.start()
  o.stop(state.audioContext.currentTime + 0.1)
}

export function playSlotWin(state: SoundSystemSynthState, multiplier: number): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  const ctx = state.audioContext
  const out = state.sfxGain
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

export function playSlotJackpot(state: SoundSystemSynthState): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  const ctx = state.audioContext
  const out = state.sfxGain
  const now = ctx.currentTime

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

export function playNearMiss(state: SoundSystemSynthState): void {
  if (!state.isInitialized || !state.audioContext || !state.sfxGain) return
  if (state.isMuted) return
  const o = state.audioContext.createOscillator()
  const g = state.audioContext.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(400, state.audioContext.currentTime)
  o.frequency.exponentialRampToValueAtTime(200, state.audioContext.currentTime + 0.3)
  g.gain.setValueAtTime(0.25, state.audioContext.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, state.audioContext.currentTime + 0.3)
  o.connect(g)
  g.connect(state.sfxGain)
  o.start()
  o.stop(state.audioContext.currentTime + 0.3)
}

export function playGoldBallSpawn(
  state: SoundSystemSynthState,
  type: BallType,
  hooks: {
    playNamed: (name: string) => void
    playImpact: (category: ImpactCategory, velocity: number, options: ImpactVoiceOptions) => void
  },
): void {
  if (type === BallType.STANDARD) return
  const soundName = type === BallType.SOLID_GOLD ? 'solid-gold-spawn' : 'gold-plated-spawn'
  if (state.synthesizedSounds.has(soundName)) hooks.playNamed(soundName)
  hooks.playImpact('launch', type === BallType.SOLID_GOLD ? 16 : 12, {
    isGold: true,
    premium: type === BallType.SOLID_GOLD,
  })
}

export function playGoldBallCollect(
  state: SoundSystemSynthState,
  type: BallType,
  hooks: {
    playNamed: (name: string) => void
    playImpact: (category: ImpactCategory, velocity: number, options: ImpactVoiceOptions) => void
  } & SampleBankPlaybackHelpers,
): void {
  if (type === BallType.STANDARD) return
  const soundName = type === BallType.SOLID_GOLD ? 'solid-gold-collect' : 'gold-plated-collect'
  if (state.synthesizedSounds.has(soundName)) hooks.playNamed(soundName)
  if (hooks.usesSampleBank() && hooks.playLocalSampleKey('gold-collect', type === BallType.SOLID_GOLD ? 1 : 0.85)) return
  hooks.playImpact('jackpot', type === BallType.SOLID_GOLD ? 22 : 16, { isGold: true, premium: true })
}
