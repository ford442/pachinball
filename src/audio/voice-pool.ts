import { MIN_AUDIBLE_IMPACT, VOICE_POOL_SIZE, type VoiceHit } from './voice-hit'

/**
 * Fixed pool of impact voices, struct-of-arrays. Every typed array is allocated once in the
 * constructor; `trigger` and `render` never allocate (no object literals, arrays, closures,
 * `push` / `splice` / `shift`). `tests/audio-voice-pool.test.ts` holds that line.
 *
 * Imports nothing from the DOM or the worklet scope: `sampleRate` is passed in, so the pool runs
 * in Node tests and inside the AudioWorkletGlobalScope bundle alike.
 */
export class VoicePool {
  readonly size: number
  /** Samples still to render. 0 = free slot. */
  readonly samplesLeft: Int32Array
  readonly total: Int32Array
  readonly impact: Float32Array
  readonly metal: Float32Array
  readonly spin: Float32Array
  readonly fever: Float32Array
  readonly panL: Float32Array
  readonly panR: Float32Array
  /** Noise LCG state. */
  readonly seed: Int32Array
  /** Ring-oscillator phase, in cycles. */
  readonly phase: Float32Array
  /** One-pole low-pass state. */
  readonly lp: Float32Array

  private readonly sampleRate: number
  private readonly attackSamples: number
  private liveCount = 0

  constructor(sampleRate: number, size: number = VOICE_POOL_SIZE) {
    this.size = size
    this.sampleRate = sampleRate
    this.attackSamples = Math.max(1, sampleRate * 0.0015)
    this.samplesLeft = new Int32Array(size)
    this.total = new Int32Array(size)
    this.impact = new Float32Array(size)
    this.metal = new Float32Array(size)
    this.spin = new Float32Array(size)
    this.fever = new Float32Array(size)
    this.panL = new Float32Array(size)
    this.panR = new Float32Array(size)
    this.seed = new Int32Array(size)
    this.phase = new Float32Array(size)
    this.lp = new Float32Array(size)
  }

  /** Voices currently sounding. */
  get live(): number {
    return this.liveCount
  }

  /** Current output level of a slot: its gain at this point of the decay. 0 for a free slot. */
  level(slot: number): number {
    const left = this.samplesLeft[slot]!
    if (left <= 0) return 0
    const env = left / this.total[slot]!
    return this.impact[slot]! * env * env
  }

  /**
   * Start a voice in a free slot, or steal the quietest live one when all `size` are sounding.
   * Returns the slot used, or -1 when the hit is below {@link MIN_AUDIBLE_IMPACT}.
   */
  trigger(hit: VoiceHit): number {
    const impact = hit.impact
    if (!(impact >= MIN_AUDIBLE_IMPACT)) return -1

    let slot = -1
    let quietest = Infinity
    for (let i = 0; i < this.size; i++) {
      const level = this.level(i)
      if (level < quietest) {
        quietest = level
        slot = i
        if (level === 0) break
      }
    }

    const length = Math.max(1, Math.floor(this.sampleRate * (0.006 + impact * 0.024)))
    if (this.samplesLeft[slot]! <= 0) this.liveCount++
    this.samplesLeft[slot] = length
    this.total[slot] = length
    this.impact[slot] = impact
    this.metal[slot] = hit.metal
    this.spin[slot] = hit.spin
    this.fever[slot] = hit.fever
    this.panL[slot] = Math.min(1, 1 - hit.pan) * 0.707
    this.panR[slot] = Math.min(1, 1 + hit.pan) * 0.707
    this.seed[slot] = (Math.random() * 1e9) | 0
    this.phase[slot] = 0
    this.lp[slot] = 0
    return slot
  }

  /** Mix every live voice into `left` (and `right` unless it is the same buffer). Overwrites both. */
  render(left: Float32Array, right: Float32Array): void {
    left.fill(0)
    const stereo = right !== left
    if (stereo) right.fill(0)
    if (this.liveCount === 0) return

    const sampleRate = this.sampleRate
    const attackSamples = this.attackSamples
    const frames = left.length

    for (let v = 0; v < this.size; v++) {
      let remaining = this.samplesLeft[v]!
      if (remaining <= 0) continue

      const total = this.total[v]!
      const impact = this.impact[v]!
      const metal = this.metal[v]!
      const coeff = 0.12 + metal * 0.55 + this.fever[v]! * 0.2
      const phaseStep = (420 + metal * 1800 + this.spin[v]! * 90) / sampleRate
      const bodyGain = 0.55 + metal * 0.35
      const panL = this.panL[v]!
      const panR = this.panR[v]!
      let seed = this.seed[v]!
      let phase = this.phase[v]!
      let y = this.lp[v]!

      for (let i = 0; i < frames && remaining > 0; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0
        const noise = (seed >>> 8) / 0x1000000 * 2 - 1
        const env = remaining / total
        const attack = 1 - Math.min(1, (total - remaining) / attackSamples)
        const gain = impact * env * env * (0.35 + (1 - attack) * 0.65)
        y += coeff * (noise - y)
        phase += phaseStep
        if (phase >= 1) phase -= 1
        const ring = Math.sin(phase * Math.PI * 2) * metal * 0.35
        const sample = (y * bodyGain + ring * env) * gain
        left[i]! += sample * panL
        if (stereo) right[i]! += sample * panR
        remaining--
      }

      this.samplesLeft[v] = remaining
      this.seed[v] = seed
      this.phase[v] = phase
      this.lp[v] = y
      if (remaining <= 0) this.liveCount--
    }
  }
}
