/**
 * Slot Machine Mini-Game System
 *
 * Orchestrates the backbox 3-reel slot mini-game:
 * - Activates on REACH / FEVER (with cooldown + chance/score gating)
 * - Drives DisplayReelsLayer with randomized speeds and staggered stops
 * - Detects wins and emits typed EventBus events
 * - Syncs audio and cabinet lighting through EventBus
 * - Supports debug force-result and force-spin toggles
 */

import { DisplayState } from '../game-elements/display-config'
import { SLOT_MACHINE_CONFIG } from '../config'
import type { EventBus } from '../game/event-bus'
import { DisplayReelsLayer, type SpinOptions } from './display-reels'
import {
  SlotSymbol,
  SlotSpinState,
  type SlotMachineConfig,
  type SlotSpinPlan,
  type SlotResult,
  type SlotActivationState,
} from './slot-types'
import {
  generateSpin,
  checkWin,
  shouldActivate,
  recordActivation,
} from './slot-logic'

/** Display labels for each internal SlotSymbol. */
const SLOT_SYMBOL_DISPLAY: Record<SlotSymbol, string> = {
  [SlotSymbol.SEVEN]: '7',
  [SlotSymbol.DIAMOND]: 'DIAMOND',
  [SlotSymbol.BELL]: 'BELL',
  [SlotSymbol.CHERRY]: 'CHERRY',
  [SlotSymbol.GRAPE]: 'GRAPE',
  [SlotSymbol.STAR]: 'STAR',
}

const DISPLAY_TO_SLOT_SYMBOL: Record<string, SlotSymbol> = Object.fromEntries(
  Object.entries(SLOT_SYMBOL_DISPLAY).map(([key, label]) => [label, key as SlotSymbol])
) as Record<string, SlotSymbol>

const DEBUG_FORCE_KEY = 'pachinball-debug-slot-force'

export class SlotMachine {
  private config: SlotMachineConfig
  private reelsLayer: DisplayReelsLayer
  private eventBus: EventBus

  private state: SlotActivationState = {
    lastActivationTime: -Number.MAX_VALUE,
    lastActivationScore: 0,
    isSpinning: false,
  }

  private spinState: SlotSpinState = SlotSpinState.IDLE
  private spinPlan: SlotSpinPlan | null = null
  private spinTimer = 0
  private stoppedReels: boolean[] = [false, false, false]
  private finalSymbols: SlotSymbol[] = [
    SlotSymbol.SEVEN,
    SlotSymbol.SEVEN,
    SlotSymbol.SEVEN,
  ]

  /** Override the RNG outcome of the *next* spin. */
  private debugForceResult: SlotSymbol[] | null = null

  constructor(
    reelsLayer: DisplayReelsLayer,
    eventBus: EventBus,
    config?: Partial<SlotMachineConfig>
  ) {
    this.reelsLayer = reelsLayer
    this.eventBus = eventBus
    this.config = { ...SLOT_MACHINE_CONFIG, ...config }

    this.configureReelsLayer()
    this.reelsLayer.setOnStopped((symbols) => this.onReelsStopped(symbols))
    this.loadDebugForceFromStorage()
    this.exposeDebugGlobals()
  }

  private exposeDebugGlobals(): void {
    if (typeof window === 'undefined') return
    try {
      const w = window as unknown as {
        forceSlotSpin?: (forcedResult?: SlotSymbol[]) => void
        setSlotDebugForce?: (symbols: SlotSymbol[]) => void
      }
      w.forceSlotSpin = (forcedResult?: SlotSymbol[]) => this.forceSpin(forcedResult)
      w.setSlotDebugForce = (symbols: SlotSymbol[]) => this.setDebugForceResult(symbols)
    } catch {
      // Ignore if window object is frozen
    }
  }

  /** Reconfigure at runtime (e.g. from a settings panel). */
  configure(config: Partial<SlotMachineConfig>): void {
    this.config = { ...this.config, ...config }
    this.configureReelsLayer()
  }

  private configureReelsLayer(): void {
    const displaySymbols = this.config.symbols.map((s) => SLOT_SYMBOL_DISPLAY[s])
    const displayWeights: Record<string, number> = {}
    for (const symbol of this.config.symbols) {
      displayWeights[SLOT_SYMBOL_DISPLAY[symbol]] = this.config.symbolWeights[symbol]
    }
    this.reelsLayer.setSymbols(displaySymbols, displayWeights)
  }

  subscribeToEvents(): void {
    this.eventBus.on('display:set', (displayState) => {
      if (displayState === DisplayState.REACH || displayState === DisplayState.FEVER) {
        this.tryActivate()
      }
    })
  }

  /**
   * Try to activate the slot machine. Returns true if a spin started.
   * If `currentScore` is omitted, the score gating uses the last known score.
   */
  tryActivate(currentScore?: number): boolean {
    if (this.spinState !== SlotSpinState.IDLE) return false

    const score = currentScore ?? this.state.lastActivationScore
    const now = performance.now() / 1000

    if (!shouldActivate(Math.random, score, now, this.state, this.config)) {
      return false
    }

    this.startSpin(score)
    return true
  }

  /**
   * Force a spin immediately, bypassing activation checks and cooldown.
   * Useful for debug HUD / console testing.
   */
  forceSpin(forcedResult?: SlotSymbol[], currentScore = 0): void {
    if (forcedResult) {
      this.setDebugForceResult(forcedResult)
    }
    this.startSpin(currentScore)
  }

  private startSpin(currentScore: number): void {
    recordActivation(this.state, performance.now() / 1000, currentScore)

    this.spinState = SlotSpinState.STARTING
    this.spinPlan = generateSpin(Math.random, this.config)

    if (this.debugForceResult) {
      this.spinPlan.targetSymbols = [...this.debugForceResult]
    }

    const displaySymbols = this.spinPlan.targetSymbols.map((s) => SLOT_SYMBOL_DISPLAY[s])
    const spinOptions: SpinOptions = {
      reelSpeeds: this.spinPlan.reelSpeeds,
      autoStop: false,
      spinDuration: this.spinPlan.spinDuration,
      stopDelays: this.spinPlan.stopDelays,
      targetSymbols: displaySymbols,
    }
    this.reelsLayer.startSpin(spinOptions)

    this.spinTimer = 0
    this.stoppedReels = [false, false, false]

    this.eventBus.emit('slot:spin:start', {
      duration: this.spinPlan.spinDuration,
      reelSpeeds: this.spinPlan.reelSpeeds,
      stopDelays: this.spinPlan.stopDelays,
    })

    this.spinState = SlotSpinState.SPINNING
    this.setLighting('spin')
  }

  /** Per-frame update. Must be called *before* DisplayReelsLayer.update(). */
  update(dt: number): void {
    if (this.spinState !== SlotSpinState.SPINNING || !this.spinPlan) return

    this.spinTimer += dt
    const spinDuration = this.spinPlan.spinDuration

    for (let i = 0; i < this.stoppedReels.length; i++) {
      if (this.stoppedReels[i]) continue

      const stopDelay = this.spinPlan.stopDelays[i] ?? 0
      if (this.spinTimer >= spinDuration + stopDelay) {
        const targetSymbol = this.spinPlan.targetSymbols[i]
        this.reelsLayer.stopReel(i, SLOT_SYMBOL_DISPLAY[targetSymbol])
        this.stoppedReels[i] = true

        this.eventBus.emit('slot:reel:stop', {
          reelIndex: i,
          symbol: targetSymbol,
        })

        // Brief stop flare unless another reel is still going
        this.setLighting('stop')
      }
    }
  }

  private onReelsStopped(symbols: string[]): void {
    this.finalSymbols = symbols.map((label) => DISPLAY_TO_SLOT_SYMBOL[label] ?? SlotSymbol.STAR)

    const result = checkWin(this.finalSymbols, this.config)
    this.state.isSpinning = false

    if (result.nearMiss) {
      this.spinState = SlotSpinState.STOPPED
      this.eventBus.emit('slot:nearmiss', { symbols: this.finalSymbols })
      this.setLighting('stop')
      return
    }

    if (!result.combination) {
      this.spinState = SlotSpinState.STOPPED
      this.setLighting('idle')
      return
    }

    if (result.nearMiss) {
      // Two sevens always create a tension beat, even when a payout also applies.
      this.eventBus.emit('slot:nearmiss', { symbols: this.finalSymbols })
    }

    if (result.combination.isJackpot) {
      this.spinState = SlotSpinState.JACKPOT
      this.eventBus.emit('slot:jackpot', {
        points: result.points,
        symbols: this.finalSymbols,
      })
      // Also trigger the main jackpot pathway
      this.eventBus.emit('jackpot:start')
      this.setLighting('jackpot')
    } else {
      this.spinState = SlotSpinState.STOPPED
      this.eventBus.emit('slot:win', {
        combination: result.combination.name,
        multiplier: result.combination.multiplier,
        points: result.points,
        symbols: this.finalSymbols,
      })
      this.eventBus.emit('points:awarded', {
        amount: result.points,
        source: 'slot-machine',
      })
      this.setLighting('win')
    }
  }

  private setLighting(mode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'): void {
    if (!this.config.enableLightEffects) return
    this.eventBus.emit('effect:slot:lighting', { mode })
  }

  getSpinState(): SlotSpinState {
    return this.spinState
  }

  isSpinning(): boolean {
    return this.spinState === SlotSpinState.SPINNING || this.spinState === SlotSpinState.STARTING
  }

  getFinalSymbols(): ReadonlyArray<SlotSymbol> {
    return this.finalSymbols
  }

  getLastResult(): SlotResult {
    return checkWin(this.finalSymbols, this.config)
  }

  /** Force a specific result for the next spin (debug / tests). */
  setDebugForceResult(symbols: SlotSymbol[] | null): void {
    this.debugForceResult = symbols && symbols.length >= 3 ? symbols.slice(0, 3) : null
    this.saveDebugForceToStorage()
  }

  getDebugForceResult(): SlotSymbol[] | null {
    return this.debugForceResult
  }

  private loadDebugForceFromStorage(): void {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(DEBUG_FORCE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as string[]
      const valid = parsed
        .slice(0, 3)
        .map((s) => (Object.values(SlotSymbol) as string[]).includes(s) ? (s as SlotSymbol) : null)
        .filter((s): s is SlotSymbol => s !== null)
      if (valid.length === 3) {
        this.debugForceResult = valid
      }
    } catch {
      // Ignore malformed debug storage
    }
  }

  private saveDebugForceToStorage(): void {
    if (typeof localStorage === 'undefined') return
    if (!this.debugForceResult) {
      localStorage.removeItem(DEBUG_FORCE_KEY)
      return
    }
    localStorage.setItem(DEBUG_FORCE_KEY, JSON.stringify(this.debugForceResult))
  }

  dispose(): void {
    this.reelsLayer.setOnStopped(null)
  }
}
