import { GameConfig } from '../config'
import type { AudioSourceMode } from './audio-sample-bank'

export type { AudioSourceMode } from './audio-sample-bank'

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
      hapticsEnabled: true,
    }
    
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<GameSettings> & { scanlineIntensity?: number }
        const migratedScanlineWeight =
          typeof parsed.scanlineWeight === 'number'
            ? parsed.scanlineWeight
            : typeof parsed.scanlineIntensity === 'number'
              ? parsed.scanlineIntensity
              : defaults.scanlineWeight
        const migratedScanlineIntensityMultiplier =
          typeof parsed.scanlineIntensityMultiplier === 'number'
            ? parsed.scanlineIntensityMultiplier
            : typeof parsed.scanlineWeight === 'number'
              ? parsed.scanlineWeight
              : defaults.scanlineIntensityMultiplier
        const scanlineEnabled =
          typeof parsed.scanlineEnabled === 'boolean'
            ? parsed.scanlineEnabled
            : defaults.scanlineEnabled
        return {
          ...defaults,
          ...parsed,
          scanlineWeight: migratedScanlineWeight,
          scanlineIntensityMultiplier: migratedScanlineIntensityMultiplier,
          scanlineEnabled,
          audioSource: parsed.audioSource === 'synth' ? 'synth' : 'samples',
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
    
    // Apply photosensitive mode - disable all flashing
    if (settings.photosensitiveMode) {
      GameConfig.visuals.enableParticles = false
    }
  }
}
