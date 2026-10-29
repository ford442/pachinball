/**
 * Screen border model — what colour each piece of the backbox's emissive frame
 * shows, as a function of DisplayState, the jackpot phase, bumper contacts and
 * the player's accessibility settings. No scene objects: `BackboxScreenBorder`
 * owns the meshes and copies `colors` onto them every frame.
 *
 * The strip is cosmetic; it reads state and never writes any. The jackpot phase
 * arrives from the sim-step phase clock (`jackpot:phase`), so the phase it shows
 * is the one the simulation is in.
 *
 * Accessibility, in three tiers:
 *   - default: the jackpot script of docs/PLAN.md §8 — a red pulse in the
 *     breach, a white/gold strobe in the critical phase, a rainbow wave from the
 *     top down in the meltdown. PLAN names 4 Hz and 10 Hz; every pulse is
 *     clamped to `flashFrequencyMax` (2 Hz by default, the project's seizure
 *     cap — `accessibility-config.ts`) and is a sine, never an on/off flash;
 *   - photosensitive mode: no pulse, strobe, wave or contact flash at all. Each
 *     phase holds its end state and colours fade between states slowly;
 *   - reduced motion: the same steady end states, and a phase change cuts to
 *     its end state instead of fading.
 */

import { DisplayState } from './display-types'
import { INTENSITY, PALETTE } from '../game-elements/visual-language'

export type Rgb = [number, number, number]

/** top · upper-left · upper-right · lower-left · lower-right · bottom */
export const BORDER_SEGMENT_COUNT = 6
/** 0 at the top edge, 1 at the bottom: the meltdown wave runs down these rows. */
export const BORDER_SEGMENT_ROW: readonly number[] = [0, 0.25, 0.25, 0.75, 0.75, 1]

/** The player settings the border honours; read live, so a settings change applies at once. */
export interface ScreenBorderAccessibility {
  reducedMotion: boolean
  /** Optional so an `AccessibilityConfig` is assignable as it is. */
  photosensitiveMode?: boolean
  /** Seizure cap in Hz (`AccessibilityConfig.flashFrequencyMax`). */
  flashFrequencyMax: number
}

/** Nominal pulse rates from docs/PLAN.md §8 and the state pulses of `BackboxBorderGlow`. */
export const BORDER_NOMINAL_HZ = { breach: 4, critical: 10, fever: 4, reach: 2 } as const

const WAVE_HZ = 0.5
/** Fade speed (1/s): default tracks fast, photosensitive mode stays slow. */
const FADE_DEFAULT = 6
const FADE_PHOTOSENSITIVE = 1.5
const CONTACT_BOOST = 0.35
const CONTACT_DECAY_S = 0.25
const MIN_PULSE_FLOOR = 0.3

function hexToRgb(hex: string, scale = 1): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255 * scale, ((n >> 8) & 255) / 255 * scale, (n & 255) / 255 * scale]
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Steady colour of each non-jackpot display state. */
const STATE_BASE: Record<string, Rgb> = {
  [DisplayState.IDLE]: [0.15, 0.15, 0.18],
  [DisplayState.REACH]: hexToRgb(PALETTE.ALERT, INTENSITY.ACTIVE),
  [DisplayState.FEVER]: hexToRgb(PALETTE.GOLD, INTENSITY.ACTIVE),
  [DisplayState.ADVENTURE]: hexToRgb(PALETTE.PURPLE, INTENSITY.ACTIVE),
  [DisplayState.PORTAL_OPEN]: hexToRgb(PALETTE.CYAN, INTENSITY.ACTIVE),
  [DisplayState.ESCAPE]: hexToRgb(PALETTE.ALERT, INTENSITY.ACTIVE),
}

/** Where each jackpot phase comes to rest (what reduced motion and photosensitive mode show). */
export const JACKPOT_END_STATE: Record<1 | 2 | 3, Rgb> = {
  1: hexToRgb(PALETTE.ALERT, INTENSITY.ACTIVE),
  2: mix(hexToRgb(PALETTE.WHITE, INTENSITY.ACTIVE), hexToRgb(PALETTE.GOLD, INTENSITY.ACTIVE), 0.5),
  3: hexToRgb(PALETTE.GOLD, INTENSITY.ACTIVE),
}

export class ScreenBorderModel {
  /** Emissive colour per segment after the last `update()`. */
  readonly colors: Rgb[] = Array.from({ length: BORDER_SEGMENT_COUNT }, () => [0, 0, 0] as Rgb)

  private state: DisplayState = DisplayState.IDLE
  private phase: 0 | 1 | 2 | 3 = 0
  private time = 0
  private contactLevel = 0
  private lastContactAt = -Infinity
  /** Steady colour the segments fade toward when nothing is animating. */
  private readonly shown: Rgb[] = Array.from({ length: BORDER_SEGMENT_COUNT }, () => [0, 0, 0] as Rgb)
  /** The first update snaps to the target instead of fading up from black. */
  private snap = true

  constructor(private readonly getAccessibility: () => ScreenBorderAccessibility) {}

  setDisplayState(state: DisplayState): void {
    this.state = state
  }

  /** The jackpot phase from the sim-step clock (`jackpot:phase`); 0 when the sequence is over. */
  setJackpotPhase(phase: number): void {
    this.phase = phase === 1 || phase === 2 || phase === 3 ? phase : 0
  }

  /** A bumper contact. A brief swell, rate-limited to the flash cap; absent entirely when motion is restricted. */
  contact(strength: number): void {
    if (this.isStatic()) return
    const minGap = 1 / Math.max(this.getAccessibility().flashFrequencyMax, 0.1)
    if (this.time - this.lastContactAt < minGap) return
    this.lastContactAt = this.time
    this.contactLevel = Math.max(this.contactLevel, CONTACT_BOOST * Math.min(Math.max(strength, 0.25), 1))
  }

  /** True when nothing oscillates: photosensitive mode or reduced motion. */
  isStatic(): boolean {
    const a = this.getAccessibility()
    return a.photosensitiveMode === true || a.reducedMotion
  }

  /** Pulse rate actually used for a nominal one: never past the seizure cap. */
  pulseHz(nominal: number): number {
    return Math.min(nominal, Math.max(this.getAccessibility().flashFrequencyMax, 0))
  }

  update(dt: number): void {
    this.time += dt
    const a = this.getAccessibility()
    const target = this.targets()
    const fade = a.photosensitiveMode === true ? FADE_PHOTOSENSITIVE : FADE_DEFAULT
    // Reduced motion cuts to each state's end state; the first frame snaps too.
    const k = a.reducedMotion || this.snap ? 1 : Math.min(dt * fade, 1)
    this.snap = false

    this.contactLevel = Math.max(0, this.contactLevel - (CONTACT_BOOST / CONTACT_DECAY_S) * dt)
    for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
      const shown = this.shown[i]
      const t = target[i]
      shown[0] += (t[0] - shown[0]) * k
      shown[1] += (t[1] - shown[1]) * k
      shown[2] += (t[2] - shown[2]) * k
    }
    const swell = 1 + this.contactLevel
    for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
      const out = this.colors[i]
      const shown = this.shown[i]
      out[0] = shown[0] * swell
      out[1] = shown[1] * swell
      out[2] = shown[2] * swell
    }
  }

  /** The colours each segment is heading for right now. */
  private targets(): Rgb[] {
    const animate = !this.isStatic()
    const out: Rgb[] = []
    const jackpot = this.phase !== 0 ? this.phase : this.state === DisplayState.JACKPOT ? 1 : 0

    for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
      if (jackpot === 0) {
        out.push(this.stateColor(animate))
      } else if (jackpot === 1) {
        out.push(this.pulsed(JACKPOT_END_STATE[1], BORDER_NOMINAL_HZ.breach, animate))
      } else if (jackpot === 2) {
        out.push(this.strobe(animate))
      } else {
        out.push(this.wave(BORDER_SEGMENT_ROW[i], animate))
      }
    }
    return out
  }

  private stateColor(animate: boolean): Rgb {
    const base = STATE_BASE[this.state] ?? STATE_BASE[DisplayState.IDLE]
    if (!animate) return base
    if (this.state === DisplayState.FEVER) return this.pulsed(base, BORDER_NOMINAL_HZ.fever, true, 0.8)
    if (this.state === DisplayState.REACH) return this.pulsed(base, BORDER_NOMINAL_HZ.reach, true, 0.5)
    return base
  }

  /** `color` swelling between `floor` and 1 at the (capped) pulse rate; steady at 1 when `animate` is off. */
  private pulsed(color: Rgb, nominalHz: number, animate: boolean, floor = MIN_PULSE_FLOOR): Rgb {
    if (!animate) return color
    const hz = this.pulseHz(nominalHz)
    const level = floor + (1 - floor) * 0.5 * (1 + Math.sin(2 * Math.PI * hz * this.time))
    return [color[0] * level, color[1] * level, color[2] * level]
  }

  /** Critical phase: white and gold trading places at the capped rate. */
  private strobe(animate: boolean): Rgb {
    const gold = hexToRgb(PALETTE.GOLD, INTENSITY.ACTIVE)
    const white = hexToRgb(PALETTE.WHITE, INTENSITY.ACTIVE)
    if (!animate) return JACKPOT_END_STATE[2]
    const hz = this.pulseHz(BORDER_NOMINAL_HZ.critical)
    return mix(gold, white, 0.5 * (1 + Math.sin(2 * Math.PI * hz * this.time)))
  }

  /** Meltdown: a rainbow running down the frame, or gold at rest. */
  private wave(row: number, animate: boolean): Rgb {
    if (!animate) return JACKPOT_END_STATE[3]
    return hsvToRgb(((this.time * WAVE_HZ - row * 0.6) % 1 + 1) % 1, 1, INTENSITY.ACTIVE)
  }
}
