/**
 * Display Reels Layer
 *
 * Handles slot machine reels rendering and animation.
 * Extracted from display.ts for modularity.
 */

import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
} from '@babylonjs/core'
import type { Scene, Mesh, TransformNode } from '@babylonjs/core'
import { DisplayState, type DisplayConfig, type SlotReel } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'

export interface SpinOptions {
  /** Per-reel rotation speeds. If omitted, random speeds are used. */
  reelSpeeds?: number[]
  /** If false, the reels keep spinning until stopReel() is called externally. */
  autoStop?: boolean
  /** Base spin duration in seconds before stop delays begin. */
  spinDuration?: number
  /** Per-reel delay after spinDuration before this reel locks. */
  stopDelays?: number[]
  /** Pre-determined final symbols (used by tests / debug force). */
  targetSymbols?: string[]
}

export class DisplayReelsLayer {
  private scene: Scene
  private reels: SlotReel[] = []
  private spinning = false
  private stopTimer = 0

  // Configurable symbol set. Defaults preserve legacy behavior.
  private reelSymbols: string[] = ['7', 'DIAMOND', 'BELL', 'CHERRY', 'GRAPE', 'STAR']
  private symbolWeights: Record<string, number> | null = null

  // Spin control state
  private spinOptions: SpinOptions = {}

  // Completion callback
  private onStoppedCallback: ((symbols: string[]) => void) | null = null

  private mesh: Mesh | null = null
  private dynamicTexture: DynamicTexture | null = null

  constructor(
    scene: Scene,

    _config: DisplayConfig
  ) {
    this.scene = scene
    // Use void expression to suppress "declared but never read" warning
    void this.scene
    this.initReels()
  }

  private initReels(): void {
    const symbols = this.reelSymbols

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

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    const width = config.width ?? 20
    const height = config.height ?? 12

    this.mesh = MeshBuilder.CreatePlane('displayReels', { width, height }, this.scene)
    this.mesh.parent = parent
    this.mesh.rotation.y = Math.PI
    this.mesh.position.z = DISPLAY_LAYER_Z.REELS

    this.dynamicTexture = new DynamicTexture(
      'displayReelsTexture',
      { width: 512, height: 256 },
      this.scene,
      false
    )

    const mat = new StandardMaterial('displayReelsMat', this.scene)
    mat.diffuseTexture = this.dynamicTexture
    mat.emissiveColor = Color3.White()
    mat.disableLighting = true

    this.mesh.material = mat

    this.renderReels()
  }

  private renderReels(): void {
    const ctx = this.dynamicTexture?.getContext() as CanvasRenderingContext2D | null
    if (!ctx || !this.dynamicTexture) return

    const canvas = ctx.canvas
    const w = canvas.width
    const h = canvas.height

    // Clear background
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, w, h)

    const reelCount = 3
    const stripWidth = Math.floor(w / reelCount)
    const symbolHeight = 80
    const gap = 4

    for (let i = 0; i < reelCount; i++) {
      const reel = this.reels[i]
      const x = i * stripWidth + gap
      const stripW = stripWidth - gap * 2

      // Reel background
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(x, 0, stripW, h)

      // Border
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 2
      ctx.strokeRect(x, 0, stripW, h)

      // Scroll offset in pixels
      const offset = (reel.position * reel.symbols.length) * symbolHeight

      // Draw symbols
      ctx.font = 'bold 48px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const symbols = reel.symbols
      const centerY = h / 2

      for (let s = -2; s <= 2; s++) {
        const symbolIndex =
          ((Math.floor(reel.position * symbols.length) + s) % symbols.length +
            symbols.length) %
          symbols.length
        const symbol = symbols[symbolIndex]
        const y = centerY + s * symbolHeight - offset

        // Clip to reel strip
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, 0, stripW, h)
        ctx.clip()

        // Glow/shadow for readability
        ctx.fillStyle = '#000'
        ctx.fillText(symbol, x + stripW / 2 + 2, y + 2)

        // Symbol text (gold)
        ctx.fillStyle = '#ffd700'
        ctx.fillText(symbol, x + stripW / 2, y)

        ctx.restore()
      }
    }

    // Win line highlight bar across the middle
    ctx.fillStyle = 'rgba(255, 215, 0, 0.3)'
    ctx.fillRect(0, h / 2 - 4, w, 8)

    // Gold middle line
    ctx.strokeStyle = '#ffd700'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    this.dynamicTexture.update()
  }

  /**
   * Replace the symbol set used on all reels. Optionally supply spawn weights
   * for pickRandomSymbol().
   */
  setSymbols(symbols: string[], weights?: Record<string, number>): void {
    this.reelSymbols = symbols.length > 0 ? symbols : this.reelSymbols
    this.symbolWeights = weights ?? null

    for (const reel of this.reels) {
      reel.symbols = [...this.reelSymbols].sort(() => Math.random() - 0.5)
      reel.targetSymbol = reel.symbols[0]
    }
    this.renderReels()
  }

  getSymbols(): string[] {
    return this.reelSymbols
  }

  private pickRandomSymbol(): string {
    if (this.symbolWeights) {
      const total = Object.values(this.symbolWeights).reduce((sum, w) => sum + w, 0)
      let roll = Math.random() * total
      for (const symbol of this.reelSymbols) {
        const weight = this.symbolWeights[symbol] ?? 0
        if (roll < weight) return symbol
        roll -= weight
      }
    }
    return this.reelSymbols[Math.floor(Math.random() * this.reelSymbols.length)]
  }

  /**
   * Begin a spin. With no arguments the legacy auto-stop behavior is preserved.
   */
  startSpin(options?: SpinOptions): void {
    this.spinning = true
    this.stopTimer = 0
    this.spinOptions = options ?? {}

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]
      reel.speed = options?.reelSpeeds?.[i] ?? 10 + Math.random() * 5
      reel.stopping = false
      if (options?.targetSymbols?.[i]) {
        reel.targetSymbol = options.targetSymbols[i]
      }
    }
  }

  /**
   * Stop a single reel. If targetSymbol is omitted, the reel lands on a
   * random symbol from the configured set.
   */
  stopReel(index: number, targetSymbol?: string): void {
    if (index < 0 || index >= this.reels.length) return
    const reel = this.reels[index]
    reel.stopping = true
    reel.targetSymbol = targetSymbol ?? this.pickRandomSymbol()
  }

  /**
   * Stop all reels at once. Each reel still settles with spring physics.
   */
  stopSpin(): void {
    for (let i = 0; i < this.reels.length; i++) {
      this.stopReel(i)
    }
  }

  /**
   * Instantly lock the reels to the supplied symbols without animation.
   * Useful for debug force-results.
   */
  forceResult(symbols: string[]): void {
    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]
      reel.targetSymbol = symbols[i] ?? reel.symbols[0]
      reel.stopping = false
      reel.speed = 0
      const targetIndex = reel.symbols.indexOf(reel.targetSymbol)
      if (targetIndex >= 0) {
        reel.position = targetIndex / reel.symbols.length
      }
    }
    this.spinning = false
    this.spinOptions = {}
    this.renderReels()
  }

  setOnStopped(callback: ((symbols: string[]) => void) | null): void {
    this.onStoppedCallback = callback
  }

  update(
    dt: number,

    _state: DisplayState
  ): void {
    if (!this.spinning) {
      // Still render in case we need to show static reels
      this.renderReels()
      return
    }

    this.stopTimer += dt

    const autoStop = this.spinOptions.autoStop ?? true
    const spinDuration = this.spinOptions.spinDuration ?? 1.0
    const defaultStopDelays = [0, 0.5, 1.0]

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]
      const stopDelay = this.spinOptions.stopDelays?.[i] ?? defaultStopDelays[i]

      // Start stopping reels with staggered delays
      if (autoStop && !reel.stopping && this.stopTimer > spinDuration + stopDelay) {
        reel.stopping = true
        if (!this.spinOptions.targetSymbols?.[i]) {
          reel.targetSymbol = this.pickRandomSymbol()
        }
      }

      if (reel.stopping) {
        // Spring constants extracted for tuning visibility of overshoot
        const FRICTION_DECEL_FACTOR = 0.96
        const SPRING_SPEED_CUTOFF = 3.0
        const SETTLE_STIFFNESS = 90
        const SETTLE_DAMPING = 4.0
        const SNAP_POSITION_THRESHOLD = 0.005
        const SNAP_SPEED_THRESHOLD = 0.08

        if (reel.speed > SPRING_SPEED_CUTOFF) {
          // Friction deceleration phase
          reel.speed *= FRICTION_DECEL_FACTOR
        } else {
          // Elastic settle: spring toward target symbol with overshoot
          const targetIndex = reel.symbols.indexOf(reel.targetSymbol)
          const targetPos = targetIndex / reel.symbols.length
          const currentFrac = ((reel.position % 1) + 1) % 1
          let delta = targetPos - currentFrac
          if (delta > 0.5) delta -= 1
          if (delta < -0.5) delta += 1

          const accel = SETTLE_STIFFNESS * delta - SETTLE_DAMPING * reel.speed
          reel.speed += accel * dt

          // Snap when close enough after visible oscillation
          if (Math.abs(delta) < SNAP_POSITION_THRESHOLD && Math.abs(reel.speed) < SNAP_SPEED_THRESHOLD) {
            reel.speed = 0
            reel.position = Math.floor(reel.position) + targetPos
          }
        }
      }

      // Update position
      reel.position += reel.speed * dt
      reel.position %= 1
      if (reel.position < 0) reel.position += 1
    }

    // Check if all stopped
    if (this.reels.every((r) => r.speed === 0)) {
      this.spinning = false
      this.spinOptions = {}
      const finalSymbols = this.reels.map((r) => r.targetSymbol)
      this.checkWin()
      this.onStoppedCallback?.(finalSymbols)
    }

    this.renderReels()
  }

  private checkWin(): void {
    const symbols = this.reels.map((r) => r.targetSymbol)
    const allMatch = symbols.every((s) => s === symbols[0])

    if (allMatch) {
      console.log('[Reels] WIN:', symbols[0])
    }
  }

  updateParallax(time: number): void {
    if (this.mesh) {
      // Period 3.5 s, amplitude 0.03, phase π/2
      this.mesh.position.z = DISPLAY_LAYER_Z.REELS + Math.sin(time * (2 * Math.PI / 3.5) + Math.PI / 2) * 0.03
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

  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.isVisible = visible
    }
  }

  dispose(): void {
    this.dynamicTexture?.dispose()
    this.mesh?.dispose()
    this.dynamicTexture = null
    this.mesh = null
    this.reels = []
    this.spinning = false
    this.onStoppedCallback = null
  }
}
