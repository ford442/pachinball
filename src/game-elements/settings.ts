import { GameConfig } from '../config'
import type { AudioSourceMode } from '../audio/audio-sample-bank'
import { parseJsonWith, pickDefined } from '../schemas/record-kit'
import { StoredSettingsSchema } from '../schemas/settings'

export type { AudioSourceMode } from '../audio/audio-sample-bank'

export interface GameSettings {
  reducedMotion: boolean
  shakeIntensity: number
  photosensitiveMode: boolean
  qualityPreset: 'low' | 'medium' | 'high'
  enableFog: boolean
  enableShadows: boolean
  scanlineWeight: number
  scanlineEnabled: boolean
  scanlineIntensityMultiplier: number
  enableDebugHUD: boolean
  enablePhysicsTuning: boolean
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  muted: boolean
  audioSource: AudioSourceMode
  /** Duck impact voices independently of camera reduced-motion. */
  reducedAudio: boolean
  /** User preference for vibration; no-op when Vibration API missing (iOS Safari). */
  hapticsEnabled: boolean
}

export class SettingsManager {
  private static STORAGE_KEY = 'pachinball.settings'
  
  static load(): GameSettings {
    const defaults: GameSettings = {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      shakeIntensity: 0.08,
      photosensitiveMode: false,
      qualityPreset: 'medium',
      enableFog: true,
      enableShadows: true,
      scanlineWeight: 1.0,
      scanlineEnabled: true,
      scanlineIntensityMultiplier: 1.0,
      enableDebugHUD: false,
      enablePhysicsTuning: false,
      masterVolume: 0.8,
      musicVolume: 0.6,
      sfxVolume: 0.9,
      muted: false,
      audioSource: 'samples',
      reducedAudio: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      hapticsEnabled: true,
    }
    
    try {
      const parsed = parseJsonWith(StoredSettingsSchema, localStorage.getItem(this.STORAGE_KEY))
      if (parsed) {
        const { scanlineIntensity, ...stored } = parsed
        const migratedScanlineWeight = parsed.scanlineWeight ?? scanlineIntensity ?? defaults.scanlineWeight
        const migratedScanlineIntensityMultiplier =
          parsed.scanlineIntensityMultiplier ?? parsed.scanlineWeight ?? defaults.scanlineIntensityMultiplier
        return {
          ...defaults,
          ...pickDefined(stored),
          scanlineWeight: migratedScanlineWeight,
          scanlineIntensityMultiplier: migratedScanlineIntensityMultiplier,
          scanlineEnabled: parsed.scanlineEnabled ?? defaults.scanlineEnabled,
          audioSource: parsed.audioSource ?? 'samples',
          reducedAudio: parsed.reducedAudio ?? parsed.reducedMotion === true,
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return defaults
  }
  
  static save(settings: GameSettings): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Ignore localStorage errors
    }
  }
  
  static applyToConfig(settings: GameSettings): void {
    GameConfig.camera.reducedMotion = settings.reducedMotion
    GameConfig.camera.shakeIntensity = settings.reducedMotion ? 0 : settings.shakeIntensity
    GameConfig.accessibility.photosensitiveMode = settings.photosensitiveMode
    GameConfig.audio.reducedAudio = settings.reducedAudio || settings.reducedMotion
    
    // Apply photosensitive mode - disable all flashing
    if (settings.photosensitiveMode) {
      GameConfig.visuals.enableParticles = false
    }
  }
}
