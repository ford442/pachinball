import type { DisplaySystem } from '../display'

export interface CRTPreset {
  name: string
  params: {
    scanlineIntensity: number
    curvature: number
    vignette: number
    chromaticAberration: number
    glow: number
    noise: number
    flicker: number
  }
}

/**
 * Manages CRT effect preset cycling for the backbox display.
 * Encapsulates preset state and cycling logic so Game.ts stays lean.
 */
export class CRTPresetManager {
  private display: DisplaySystem | null = null
  private presetIndex = 0

  private readonly presets: CRTPreset[] = [
    {
      name: 'MODERN_LCD',
      params: { scanlineIntensity: 0.05, curvature: 0.0, vignette: 0.1, chromaticAberration: 0.0, glow: 0.6, noise: 0.0, flicker: 0.0 },
    },
    {
      name: 'RETRO',
      params: { scanlineIntensity: 0.6, curvature: 0.05, vignette: 0.5, chromaticAberration: 0.5, glow: 0.6, noise: 0.05, flicker: 0.03 },
    },
    {
      name: 'STORY',
      params: { scanlineIntensity: 0.15, curvature: 0.03, vignette: 0.25, chromaticAberration: 0.15, glow: 0.35, noise: 0.01, flicker: 0.005 },
    },
    {
      name: 'OFF',
      params: { scanlineIntensity: 0.0, curvature: 0.0, vignette: 0.0, chromaticAberration: 0.0, glow: 0.0, noise: 0.0, flicker: 0.0 },
    },
  ]

  setDisplay(display: DisplaySystem): void {
    this.display = display
  }

  cycle(): void {
    const preset = this.presets[this.presetIndex]
    console.log(`[CRT] Preset: ${preset.name}`)

    this.display?.setCRTEffectEnabled(preset.name !== 'OFF')
    this.display?.setCRTEffectParams(preset.params)

    this.presetIndex = (this.presetIndex + 1) % this.presets.length
  }

  getCurrentPreset(): CRTPreset {
    return this.presets[this.presetIndex]
  }

  reset(): void {
    this.presetIndex = 0
  }
}
