import { GameConfig } from '../config'

export interface CameraSettings {
  reducedMotion: boolean
  shakeIntensity: number
  photosensitiveMode: boolean
  enableFog: boolean
  enableShadows: boolean
  scanlineIntensity: number
}

export class SettingsManager {
  private static STORAGE_KEY = 'pachinball.settings'
  
  static load(): CameraSettings {
    const defaults: CameraSettings = {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      shakeIntensity: 0.08,
      photosensitiveMode: false,
      enableFog: true,
      enableShadows: true,
      scanlineIntensity: 0.12
    }
    
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY)
      if (saved) {
        return { ...defaults, ...JSON.parse(saved) }
      }
    } catch {
      // Ignore localStorage errors
    }
    return defaults
  }
  
  static save(settings: CameraSettings): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Ignore localStorage errors
    }
  }
  
  static applyToConfig(settings: CameraSettings): void {
    GameConfig.camera.reducedMotion = settings.reducedMotion
    GameConfig.camera.shakeIntensity = settings.reducedMotion ? 0 : settings.shakeIntensity
    GameConfig.accessibility.photosensitiveMode = settings.photosensitiveMode
    
    // Apply photosensitive mode - disable all flashing
    if (settings.photosensitiveMode) {
      GameConfig.visuals.enableParticles = false
    }
  }
}
