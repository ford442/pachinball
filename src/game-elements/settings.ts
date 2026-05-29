import { GameConfig } from '../config'

export interface GameSettings {
  reducedMotion: boolean
  shakeIntensity: number
  photosensitiveMode: boolean
  enableFog: boolean
  enableShadows: boolean
  scanlineWeight: number
  enableDebugHUD: boolean
}

export class SettingsManager {
  private static STORAGE_KEY = 'pachinball.settings'
  
  static load(): GameSettings {
    const defaults: GameSettings = {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      shakeIntensity: 0.08,
      photosensitiveMode: false,
      enableFog: true,
      enableShadows: true,
      scanlineWeight: 1.0,
      enableDebugHUD: false,
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
        return { ...defaults, ...parsed, scanlineWeight: migratedScanlineWeight }
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
