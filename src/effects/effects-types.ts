// Types and interfaces
export enum EffectType {
  PARTICLE = 'particle',
  LIGHTNING = 'lightning',
  SHOCKWAVE = 'shockwave',
  SCREEN_SHAKE = 'screen_shake',
  BLOOM_PULSE = 'bloom_pulse'
}

export interface ParticleConfig {
  count: number
  lifetime: number
  size: number
  color: string
  velocity: { min: number; max: number }
  gravity: number
}

export interface ScreenShakeConfig {
  intensity: number
  duration: number
  decay: number
}

export interface BloomConfig {
  intensity: number
  threshold: number
  duration: number
}

export interface EffectState {
  active: boolean
  timer: number
  intensity: number
}
