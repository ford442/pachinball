import { GameConfig } from '../config'

export type PachinkoVoiceType = 'bumper' | 'peg' | 'flipper' | 'drain'

export interface PlayVoiceParams {
  type: PachinkoVoiceType
  /** Normalized 0–1 impact energy. */
  velocity: number
  position?: { x: number; y?: number; z?: number }
  /** Ball angular speed mapped 0–1 for rolling rumble. */
  spin?: number
  fever?: boolean
}

const WORKLET_URL = '/audio/pachinko-voice-processor.js'

let instance: AudioEngine | null = null
let ownedContextCount = 0

function createNativeContext(): AudioContext {
  const g = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = g.AudioContext ?? g.webkitAudioContext
  if (!Ctor) throw new Error('Web Audio API is not available')
  return new Ctor({ latencyHint: 'interactive' })
}

function metalForType(type: PachinkoVoiceType): number {
  switch (type) {
    case 'peg':
      return 1
    case 'bumper':
      return 0.55
    case 'flipper':
      return 0.25
    case 'drain':
      return 0.12
  }
}

export function isReducedAudio(): boolean {
  return !!(
    GameConfig.audio?.reducedAudio ||
    GameConfig.camera.reducedMotion ||
    GameConfig.accessibility.photosensitiveMode
  )
}

/**
 * Single owned Web Audio graph for the whole game.
 * Babylon Engine.audioEngine stays disabled (engine-options.audioEngine: false).
 */
export class AudioEngine {
  readonly context: AudioContext
  readonly masterGain: GainNode
  readonly sfxGain: GainNode
  readonly musicGain: GainNode
  readonly stemGain: GainNode
  readonly hudGain: GainNode
  private workletNode: AudioWorkletNode | null = null
  private workletReady = false
  private workletFailed = false
  private workletPromise: Promise<boolean> | null = null

  private constructor() {
    this.context = createNativeContext()
    ownedContextCount += 1

    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = 1
    this.masterGain.connect(this.context.destination)

    this.sfxGain = this.context.createGain()
    this.sfxGain.gain.value = 0.9
    this.sfxGain.connect(this.masterGain)

    this.musicGain = this.context.createGain()
    this.musicGain.gain.value = 1
    this.musicGain.connect(this.masterGain)

    this.stemGain = this.context.createGain()
    this.stemGain.gain.value = 1
    this.stemGain.connect(this.musicGain)

    this.hudGain = this.context.createGain()
    this.hudGain.gain.value = 0.85
    this.hudGain.connect(this.masterGain)
  }

  static get(): AudioEngine {
    if (!instance) instance = new AudioEngine()
    return instance
  }

  async ensureWorklet(): Promise<boolean> {
    if (this.workletReady) return true
    if (this.workletFailed) return false
    if (this.workletPromise) return this.workletPromise

    this.workletPromise = (async () => {
      try {
        if (!this.context.audioWorklet) {
          this.workletFailed = true
          return false
        }
        await this.context.audioWorklet.addModule(WORKLET_URL)
        this.workletNode = new AudioWorkletNode(this.context, 'pachinko-voice', {
          numberOfOutputs: 1,
          outputChannelCount: [2],
        })
        this.workletNode.connect(this.sfxGain)
        this.workletReady = true
        return true
      } catch (err) {
        console.warn('[AudioEngine] Worklet load failed — oscillator fallback active:', err)
        this.workletFailed = true
        return false
      }
    })()

    return this.workletPromise
  }

  isWorkletReady(): boolean {
    return this.workletReady
  }

  playVoice(params: PlayVoiceParams): boolean {
    if (!this.workletReady || !this.workletNode) return false
    if (this.context.state === 'closed') return false

    const reduced = isReducedAudio()
    const velocity = Math.max(0, Math.min(1, params.velocity)) * (reduced ? 0.45 : 1)
    if (velocity < 0.02) return true

    const pan = params.position ? Math.max(-1, Math.min(1, params.position.x / 12)) : 0
    this.workletNode.port.postMessage({
      type: params.type,
      velocity,
      impact: velocity,
      metal: metalForType(params.type),
      spin: Math.max(0, Math.min(1, params.spin ?? 0)),
      fever: params.fever ? 1 : 0,
      pan: reduced ? pan * 0.35 : pan,
    })
    return true
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
  }

  resumeSync(): void {
    if (this.context.state === 'suspended') {
      void this.context.resume()
    }
  }

  async suspend(): Promise<void> {
    if (this.context.state === 'running') {
      await this.context.suspend()
    }
  }

  async dispose(): Promise<void> {
    this.workletNode?.disconnect()
    this.workletNode = null
    this.workletReady = false
    if (this.context.state !== 'closed') {
      await this.context.close().catch(() => {})
    }
    if (instance === this) {
      instance = null
      ownedContextCount = Math.max(0, ownedContextCount - 1)
    }
  }
}

export function getAudioEngine(): AudioEngine {
  return AudioEngine.get()
}

export function peekAudioEngine(): AudioEngine | null {
  return instance
}

/** Debug HUD / tests: contexts this package created that are still live. */
export function getOwnedAudioContextCount(): number {
  return ownedContextCount
}

export async function resetAudioEngine(): Promise<void> {
  if (instance) await instance.dispose()
  instance = null
  ownedContextCount = 0
}
