export type ImpactCategory = 'peg' | 'bumper' | 'flipper' | 'jackpot' | 'fever' | 'launch' | 'drain'

export interface ImpactVoiceOptions {
  isGold?: boolean
  premium?: boolean
}

export interface ImpactVoiceProfile {
  category: ImpactCategory
  waveform: OscillatorType
  baseFreq: number
  sweepFreq: number
  gain: number
  attack: number
  decay: number
  noiseAmount: number
  filterStart: number
  filterEnd: number
  cooldownSeconds: number
}

export function normalizeImpactVelocity(velocity: number, maxVelocity = 24): number {
  if (!Number.isFinite(velocity) || velocity <= 0) return 0
  return Math.max(0, Math.min(1, velocity / maxVelocity))
}

export function createImpactVoiceProfile(
  category: ImpactCategory,
  velocity: number,
  options: ImpactVoiceOptions = {},
  reducedAudio = false,
): ImpactVoiceProfile {
  const n = normalizeImpactVelocity(velocity)
  const loudnessScale = reducedAudio ? 0.62 : 1
  const noiseScale = reducedAudio ? 0.35 : 1
  const goldBoost = options.isGold ? 1.12 : 1
  const premiumBoost = options.premium ? 1.08 : 1

  switch (category) {
    case 'bumper':
      return {
        category,
        waveform: 'sawtooth',
        baseFreq: 140 + (n * 240),
        sweepFreq: 220 + (n * 520),
        gain: (0.18 + (n * 0.36)) * loudnessScale * goldBoost,
        attack: 0.002,
        decay: 0.14 + ((1 - n) * 0.06),
        noiseAmount: (0.18 + (n * 0.3)) * noiseScale,
        filterStart: 800 + (n * 2200),
        filterEnd: 500 + (n * 1200),
        cooldownSeconds: 0.028,
      }
    case 'flipper':
      return {
        category,
        waveform: 'triangle',
        baseFreq: 170 + (n * 130),
        sweepFreq: 100 + (n * 70),
        gain: (0.12 + (n * 0.2)) * loudnessScale,
        attack: 0.001,
        decay: 0.08,
        noiseAmount: (0.12 + (n * 0.08)) * noiseScale,
        filterStart: 1600 + (n * 900),
        filterEnd: 900 + (n * 500),
        cooldownSeconds: 0.022,
      }
    case 'peg':
      return {
        category,
        waveform: 'sine',
        baseFreq: 880,
        sweepFreq: 740,
        gain: (0.06 + (n * 0.12)) * loudnessScale,
        attack: 0.001,
        decay: 0.045,
        noiseAmount: 0.06 * noiseScale,
        filterStart: 3400,
        filterEnd: 1700,
        cooldownSeconds: 0.02,
      }
    case 'launch':
      return {
        category,
        waveform: 'triangle',
        baseFreq: 180 + (n * 180),
        sweepFreq: 520 + (n * 420),
        gain: (0.16 + (n * 0.22)) * loudnessScale * premiumBoost,
        attack: 0.002,
        decay: 0.2,
        noiseAmount: 0.1 * noiseScale,
        filterStart: 1400 + (n * 1600),
        filterEnd: 700 + (n * 900),
        cooldownSeconds: 0.06,
      }
    case 'drain':
      return {
        category,
        waveform: 'sawtooth',
        baseFreq: 190 + (n * 80),
        sweepFreq: 62,
        gain: (0.2 + (n * 0.18)) * loudnessScale,
        attack: 0.003,
        decay: 0.35,
        noiseAmount: 0.12 * noiseScale,
        filterStart: 900,
        filterEnd: 180,
        cooldownSeconds: 0.2,
      }
    case 'jackpot':
      return {
        category,
        waveform: options.isGold ? 'triangle' : 'sine',
        baseFreq: options.isGold ? 660 : 540,
        sweepFreq: options.isGold ? 1200 : 980,
        gain: (0.22 + (n * 0.2)) * loudnessScale * goldBoost * premiumBoost,
        attack: 0.002,
        decay: options.premium ? 0.45 : 0.26,
        noiseAmount: 0.04 * noiseScale,
        filterStart: 2200,
        filterEnd: 1100,
        cooldownSeconds: 0.16,
      }
    case 'fever':
      return {
        category,
        waveform: 'square',
        baseFreq: 520,
        sweepFreq: 860,
        gain: 0.2 * loudnessScale,
        attack: 0.002,
        decay: 0.24,
        noiseAmount: 0.03 * noiseScale,
        filterStart: 1700,
        filterEnd: 1200,
        cooldownSeconds: 0.1,
      }
  }
}

export function getPortalMotifFrequencies(isPremium = false): number[] {
  if (isPremium) {
    return [523.25, 659.25, 783.99, 1046.5]
  }
  return [440, 523.25, 659.25]
}

