/**
 * Backbox Border Glow
 *
 * Animates the emissive color on the cabinet backbox mesh in sync with
 * DisplayState events. Operates on a cloned material to avoid bleeding
 * emissive animation onto the shared cabinet body material.
 *
 * Quality tier behaviour:
 *   LOW    — not instantiated; zero cost; cabinet material untouched.
 *   MEDIUM — emissive colour animation only; no GlowLayer.
 *   HIGH   — emissive colour animation + GlowLayer (half-res blur pass).
 *
 * Accessibility:
 *   - Strobe frequency is capped to `AccessibilityConfig.flashFrequencyMax`
 *     (default 2 Hz; seizure-safety cap enforced by the accessibility system).
 *   - GlowLayer and jackpot strobe are disabled when `reducedMotion` is true.
 */

import { Color3, GlowLayer, StandardMaterial, PBRMaterial } from '@babylonjs/core'
import type { Mesh, Scene } from '@babylonjs/core'
import type { DisplayState } from '../game-elements/types'
import { QualityTier } from '../game-elements/visual-language'
import { type AccessibilityConfig, DEFAULT_ACCESSIBILITY } from '../game-elements/accessibility-config'

/** Emissive colour targets per DisplayState string value */
const BORDER_STATE_COLORS: Record<string, Color3> = {
  idle:      new Color3(0.15, 0.15, 0.18),
  reach:     new Color3(1.0,  0.6,  0.0),
  fever:     new Color3(1.0,  0.8,  0.0),
  jackpot:   new Color3(1.0,  1.0,  1.0),  // strobe base — white
  adventure: new Color3(0.6,  0.0,  0.8),
}

/** Cyan settle colour after jackpot strobe */
const JACKPOT_SETTLE = new Color3(0.0, 0.8, 1.0)

/**
 * Shared emissive-colour interface covering both StandardMaterial and
 * PBRMaterial — both expose `emissiveColor: Color3` and a `.clone()` method.
 */
type EmissiveMaterial = (StandardMaterial | PBRMaterial) & {
  emissiveColor: Color3
  clone(name: string): EmissiveMaterial
  dispose(): void
}

export class BackboxBorderGlow {
  private _ownedMaterial: EmissiveMaterial | null = null
  private _glowLayer: GlowLayer | null = null
  private _targetColor: Color3 = Color3.Black()
  private _currentColor: Color3 = Color3.Black()
  private _lerpSpeed: number = 2.5
  private _strobeActive: boolean = false
  private _strobeTimer: number = 0
  private readonly _strobePhases: number = 6  // 6 half-cycles = 3 flashes
  private _pulseTime: number = 0
  /** Half-period in seconds for jackpot strobe, capped to accessibility limit */
  private _strobeHalfPeriod: number = 0.25  // 2 Hz default (safety cap)
  /** Whether jackpot strobe is suppressed by accessibility settings */
  private _strobeDisabled: boolean = false

  constructor(
    backboxMesh: Mesh | null,
    scene: Scene,
    qualityTier: QualityTier,
    accessibility: AccessibilityConfig = DEFAULT_ACCESSIBILITY,
  ) {
    if (qualityTier === QualityTier.LOW || !backboxMesh) return

    const sourceMat = backboxMesh.material
    if (!sourceMat) return
    if (
      !(sourceMat instanceof StandardMaterial) &&
      !(sourceMat instanceof PBRMaterial)
    ) return

    // Clone to avoid bleeding emissive animation onto the shared cabinet body
    // material. This class owns the cloned material and disposes it in dispose().
    const clonedMat = (sourceMat as EmissiveMaterial).clone('backboxGlowMat')
    clonedMat.emissiveColor = Color3.Black()
    backboxMesh.material = clonedMat
    this._ownedMaterial = clonedMat

    // Compute strobe half-period capped to accessibility flash frequency limit.
    // flashFrequencyMax is in Hz (full cycles); one half-cycle = 1 / (2 * Hz).
    const maxHz = accessibility.flashFrequencyMax
    this._strobeHalfPeriod = 1 / (2 * Math.max(maxHz, 0.1))
    // Disable strobe entirely under reduced-motion preferences.
    this._strobeDisabled = accessibility.reducedMotion

    // GlowLayer only on HIGH tier and when reduced motion is not requested.
    if (qualityTier === QualityTier.HIGH && !accessibility.reducedMotion) {
      this._glowLayer = new GlowLayer('backboxBorderGlow', scene, {
        mainTextureRatio: 0.5,
        blurKernelSize: 32,
      })
      this._glowLayer.intensity = 0.8
      this._glowLayer.addIncludedOnlyMesh(backboxMesh)
    }
  }

  /** Notify of a new DisplayState. Call whenever the display state changes. */
  onDisplaySet(state: DisplayState): void {
    const color = BORDER_STATE_COLORS[state as string] ?? Color3.Black()
    this._targetColor = color.clone()
    this._strobeActive = !this._strobeDisabled && (state as string) === 'jackpot'
    this._strobeTimer = 0
    this._pulseTime = 0
    this._lerpSpeed = this._strobeActive ? 12.0 : 2.5
  }

  /** Call once per frame with the elapsed time in seconds. */
  update(dt: number): void {
    if (!this._ownedMaterial) return
    this._pulseTime += dt

    if (this._strobeActive) {
      this._strobeTimer += dt
      const phase = Math.floor(this._strobeTimer / this._strobeHalfPeriod)
      this._ownedMaterial.emissiveColor =
        phase % 2 === 0 ? Color3.White() : Color3.Black()
      if (phase >= this._strobePhases) {
        this._strobeActive = false
        this._targetColor = JACKPOT_SETTLE.clone()
        this._currentColor = Color3.Black()
      }
      return
    }

    // Pulse on REACH and FEVER states
    const t = this._targetColor
    const isReach = t.r > 0.9 && t.g > 0.5 && t.b < 0.1
    const isFever = t.r > 0.9 && t.g > 0.7 && t.b < 0.1
    let intensityScale = 1.0
    if (isReach) intensityScale = 0.5 + 0.5 * Math.sin(this._pulseTime * Math.PI * 4)  // 2 Hz
    if (isFever) intensityScale = 0.8 + 0.2 * Math.sin(this._pulseTime * Math.PI * 8)  // 4 Hz

    Color3.LerpToRef(
      this._currentColor,
      this._targetColor,
      Math.min(dt * this._lerpSpeed, 1),
      this._currentColor,
    )
    this._ownedMaterial.emissiveColor = this._currentColor.scale(intensityScale)
  }

  /** Dispose GlowLayer and owned material clone. */
  dispose(): void {
    this._glowLayer?.dispose()
    this._glowLayer = null
    this._ownedMaterial?.dispose()  // class owns this clone — must dispose explicitly
    this._ownedMaterial = null
  }
}
