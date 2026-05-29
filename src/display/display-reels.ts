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

export class DisplayReelsLayer {
  private scene: Scene
  private reels: SlotReel[] = []
  private spinning = false
  private stopTimer = 0
  private slotSymbols = ['7️⃣', '💎', '🍒', '🔔', '🍇', '⭐']
  private reelSymbols: string[] = ['7', 'BAR', 'CHERRY', 'BELL', 'DIAMOND']

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
    this.mesh.position.z = 0.2

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
      const offset = reel.position * symbolHeight

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
     
    _state: DisplayState
  ): void {
    if (!this.spinning) {
      // Still render in case we need to show static reels
      this.renderReels()
      return
    }

    this.stopTimer += dt

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i]

      // Start stopping reels with staggered delays
      if (!reel.stopping && this.stopTimer > 1 + i * 0.5) {
        reel.stopping = true
        reel.targetSymbol = reel.symbols[Math.floor(Math.random() * reel.symbols.length)]
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
      this.checkWin()
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
      this.mesh.position.z = 0.2 + Math.sin(time * (2 * Math.PI / 3.5) + Math.PI / 2) * 0.03
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
  }
}
