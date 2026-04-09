/**
 * Display Reels Layer
 * 
 * Handles slot machine reels rendering and animation.
 * Extracted from display.ts for modularity.
 */

import type { Scene } from '@babylonjs/core'
import { DisplayState, type DisplayConfig, type SlotReel } from './display-types'

export class DisplayReelsLayer {
  private scene: Scene
  private reels: SlotReel[] = []
  private spinning = false
  private stopTimer = 0
  private slotSymbols = ['7️⃣', '💎', '🍒', '🔔', '🍇', '⭐']

  constructor(
    scene: Scene,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: DisplayConfig
  ) {
    this.scene = scene
    // Use void expression to suppress "declared but never read" warning
    void this.scene
    this.initReels()
  }

  private initReels(): void {
    // Create 3 reels with symbols
    const symbols = ['7', 'BAR', 'CHERRY', 'BELL', 'DIAMOND']

    for (let i = 0; i < 3; i++) {
      this.reels.push({
        symbols: [...symbols].sort(() => Math.random() - 0.5),
        position: 0,
        speed: 0,
        stopping: false,
        targetSymbol: symbols[0],
      })
    }
  }

  startSpin(): void {
    this.spinning = true
    this.stopTimer = 0

    for (const reel of this.reels) {
      reel.speed = 10 + Math.random() * 5
      reel.stopping = false
    }
  }

  stopSpin(): void {
    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]
      reel.stopping = true
      reel.targetSymbol = reel.symbols[Math.floor(Math.random() * reel.symbols.length)]
    }
  }

  update(
    dt: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _state: DisplayState
  ): void {
    if (!this.spinning) return

    this.stopTimer += dt

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]

      // Start stopping reels with staggered delays
      if (!reel.stopping && this.stopTimer > 1 + i * 0.5) {
        reel.stopping = true
        reel.targetSymbol = reel.symbols[Math.floor(Math.random() * reel.symbols.length)]
      }

      if (reel.stopping) {
        // Decelerate
        reel.speed *= 0.95
        if (reel.speed < 0.1) {
          reel.speed = 0
        }
      }

      // Update position
      reel.position += reel.speed * dt
      reel.position %= 1 // Wrap around
    }

    // Check if all stopped
    if (this.reels.every((r) => r.speed === 0)) {
      this.spinning = false
      this.checkWin()
    }
  }

  private checkWin(): void {
    const symbols = this.reels.map((r) => r.targetSymbol)
    const allMatch = symbols.every((s) => s === symbols[0])

    if (allMatch) {
      console.log('[Reels] WIN:', symbols[0])
    }
  }

  onStateChange(state: DisplayState): void {
    if (state === DisplayState.JACKPOT || state === DisplayState.FEVER) {
      this.startSpin()
    }
  }

  isSpinning(): boolean {
    return this.spinning
  }

  getReels(): SlotReel[] {
    return this.reels
  }

  getSymbols(): string[] {
    return this.slotSymbols
  }

  dispose(): void {
    this.reels = []
    this.spinning = false
  }
}
