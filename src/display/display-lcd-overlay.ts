/**
 * PLAN.md §1 Layer 3 — Transparent LCD overlay.
 * Alpha canvas texture for Reach text, idle walk-bys, fever sparks, and jackpot cracks.
 * Renders over the main video layer (Layer 2).
 */

import {
  MeshBuilder,
  DynamicTexture,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import type { Mesh, Scene, TransformNode } from '@babylonjs/core'
import { DisplayState, type DisplayConfig } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'
import { PALETTE, STATE_COLORS, QualityTier } from '../game-elements/visual-language'
import type { DisplayOverlay } from './display-overlay'

interface WalkByCharacter {
  x: number
  speed: number
  emoji: string
  active: boolean
}

export class DisplayLcdOverlayLayer {
  private scene: Scene
  private mesh: Mesh | null = null
  private texture: DynamicTexture | null = null
  private material: StandardMaterial | null = null

  private storyText = ''
  private trackText = ''
  private temporaryText = ''
  private trackThemePrimary: string = PALETTE.CYAN
  private trackThemeAccent: string = PALETTE.GOLD

  private currentState = DisplayState.IDLE
  private time = 0
  private jackpotPhase = 0
  private qualityTier: QualityTier
  private reducedMotion = false
  private photosensitive = false

  private walkByTimer = 0
  private walkBy: WalkByCharacter | null = null
  private readonly walkByEmojis = ['🐯', '🎎', '⭐', '🎰', '💎']

  private displayOverlay: DisplayOverlay | null = null
  private drainMode = false
  private drainFlashTime = 0
  private drainSplashIndex = 0
  private splashImages: HTMLImageElement[] = []

  constructor(scene: Scene, _config: DisplayConfig, qualityTier: QualityTier) {
    this.scene = scene
    this.qualityTier = qualityTier
  }

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    const w = config.width
    const h = config.height
    const texW = 1024
    const texH = Math.round(texW * (h / w))

    this.texture = new DynamicTexture('displayLcdTex', { width: texW, height: texH }, this.scene, false)
    this.texture.hasAlpha = true

    this.material = new StandardMaterial('displayLcdMat', this.scene)
    this.material.diffuseTexture = this.texture
    this.material.opacityTexture = this.texture
    this.material.emissiveTexture = this.texture
    this.material.emissiveColor = Color3.White()
    this.material.disableLighting = true
    this.material.backFaceCulling = false
    this.material.useAlphaFromDiffuseTexture = true

    this.mesh = MeshBuilder.CreatePlane('displayLcd', { width: w, height: h }, this.scene)
    this.mesh.parent = parent
    this.mesh.rotation.y = Math.PI
    this.mesh.position.z = DISPLAY_LAYER_Z.LCD
    this.mesh.material = this.material
    this.mesh.isPickable = false

    this.preloadSplashImages()
    this.redraw()
  }

  setAccessibility(reducedMotion: boolean, photosensitive: boolean): void {
    this.reducedMotion = reducedMotion
    this.photosensitive = photosensitive
  }

  setDisplayOverlay(overlay: DisplayOverlay): void {
    this.displayOverlay = overlay
  }

  setStoryText(text: string): void {
    this.storyText = text
    this.redraw()
  }

  setTrackText(text: string): void {
    this.trackText = text
    this.redraw()
  }

  setTrackTheme(primaryHex: string, accentHex?: string): void {
    this.trackThemePrimary = primaryHex
    this.trackThemeAccent = accentHex ?? primaryHex
    this.redraw()
  }

  setTemporaryText(text: string): void {
    this.temporaryText = text
    this.redraw()
  }

  setDrainMode(active: boolean, flashTime = 0, splashIndex = 0): void {
    this.drainMode = active
    this.drainFlashTime = flashTime
    this.drainSplashIndex = splashIndex
    this.redraw()
  }

  onStateChange(state: DisplayState): void {
    this.currentState = state
    this.redraw()
  }

  setBlend(blend: number): void {
    if (this.material) {
      this.material.alpha = 0.85 + blend * 0.15
    }
  }

  update(dt: number, state: DisplayState, jackpotPhase: number): void {
    this.time += dt
    this.currentState = state
    this.jackpotPhase = jackpotPhase

    if (state === DisplayState.IDLE && !this.drainMode && !this.temporaryText) {
      this.updateWalkBy(dt)
    }

    const needsRedraw =
      this.drainMode ||
      this.temporaryText !== '' ||
      state === DisplayState.REACH ||
      state === DisplayState.FEVER ||
      state === DisplayState.JACKPOT ||
      this.displayOverlay?.isActive() ||
      this.walkBy?.active

    if (needsRedraw) {
      this.redraw()
    }
  }

  private updateWalkBy(dt: number): void {
    if (this.reducedMotion || this.qualityTier === QualityTier.LOW) return

    if (this.walkBy?.active) {
      this.walkBy.x += dt * this.walkBy.speed
      if (this.walkBy.x > 1.15) {
        this.walkBy.active = false
        this.walkByTimer = 6 + Math.random() * 8
      }
      return
    }

    this.walkByTimer -= dt
    if (this.walkByTimer <= 0) {
      this.walkBy = {
        x: -0.12,
        speed: 0.08 + Math.random() * 0.06,
        emoji: this.walkByEmojis[Math.floor(Math.random() * this.walkByEmojis.length)],
        active: true,
      }
    }
  }

  private preloadSplashImages(): void {
    const paths = ['/assets/backbox/splash1.png', '/assets/backbox/splash2.png']
    for (const path of paths) {
      const img = new Image()
      img.onerror = () => console.warn(`[DisplayLcd] Failed to load splash: ${path}`)
      img.src = path
      this.splashImages.push(img)
    }
  }

  private redraw(): void {
    if (!this.texture) return
    const ctx = this.texture.getContext() as CanvasRenderingContext2D
    const canvas = ctx.canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (this.drainMode) {
      this.drawDrainOverlay(ctx, canvas.width, canvas.height)
      this.texture.update(false)
      return
    }

    // State vignette darkening (Reach / Fever)
    this.drawStateVignette(ctx, canvas.width, canvas.height)

    // State-specific foreground effects
    switch (this.currentState) {
      case DisplayState.REACH:
        this.drawReachBanner(ctx, canvas.width, canvas.height)
        break
      case DisplayState.FEVER:
        this.drawFeverEffects(ctx, canvas.width, canvas.height)
        break
      case DisplayState.JACKPOT:
        this.drawJackpotOverlay(ctx, canvas.width, canvas.height)
        break
      default:
        break
    }

    // Idle walk-by character
    if (this.walkBy?.active && this.currentState === DisplayState.IDLE) {
      this.drawWalkBy(ctx, canvas.width, canvas.height)
    }

    // Story / track text (adventure)
    if (this.temporaryText) {
      this.drawTemporaryText(ctx, canvas.width, canvas.height)
    } else {
      if (this.storyText) {
        this.drawStoryText(ctx, canvas.width, canvas.height)
      }
      if (this.trackText) {
        this.drawTrackText(ctx, canvas.width, canvas.height)
      }
    }

    // Reward unlock overlay
    this.displayOverlay?.render(ctx, canvas.width, canvas.height, this.currentState)

    this.texture.update(false)
  }

  private drawStateVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.currentState === DisplayState.REACH) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.65)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(80,0,20,0.55)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    } else if (this.currentState === DisplayState.FEVER || this.currentState === DisplayState.JACKPOT) {
      const pulse = this.photosensitive ? 0.3 : (Math.sin(this.time * 6) + 1) * 0.15
      ctx.fillStyle = `rgba(255, 180, 0, ${pulse})`
      ctx.fillRect(0, 0, w, h)
    }
  }

  private drawReachBanner(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const pulse = this.photosensitive ? 1 : 0.75 + Math.sin(this.time * 8) * 0.25
    ctx.save()
    ctx.globalAlpha = pulse
    ctx.fillStyle = STATE_COLORS.REACH
    ctx.font = 'bold 120px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = STATE_COLORS.REACH
    ctx.shadowBlur = this.qualityTier === QualityTier.LOW ? 8 : 32
    ctx.fillText('REACH', w / 2, h * 0.22)
    ctx.restore()

    // Slot spin anticipation bar
    ctx.fillStyle = 'rgba(255, 0, 60, 0.25)'
    ctx.fillRect(w * 0.1, h * 0.38, w * 0.8, h * 0.08)
    ctx.strokeStyle = STATE_COLORS.REACH
    ctx.lineWidth = 3
    ctx.strokeRect(w * 0.1, h * 0.38, w * 0.8, h * 0.08)
  }

  private drawFeverEffects(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save()
    ctx.fillStyle = PALETTE.GOLD
    ctx.font = 'bold 96px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = PALETTE.GOLD
    ctx.shadowBlur = 24
    ctx.fillText('FEVER!', w / 2, h * 0.18)
    ctx.restore()

    if (this.qualityTier === QualityTier.LOW) return

    const coinCount = this.reducedMotion ? 6 : 14
    for (let i = 0; i < coinCount; i++) {
      const seed = i * 17.3 + this.time * (1.5 + i * 0.1)
      const x = (Math.sin(seed) * 0.5 + 0.5) * w
      const y = ((seed * 0.37) % 1) * h
      const size = 12 + (i % 3) * 6
      ctx.fillStyle = `rgba(255, 215, 0, ${0.4 + (i % 5) * 0.1})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawJackpotOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 88px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = PALETTE.GOLD
    ctx.shadowBlur = 40
    ctx.fillText('JACKPOT', w / 2, h * 0.2)
    ctx.restore()

    // Crack lines (PLAN.md §8 Phase 1)
    const crackProgress = this.jackpotPhase >= 1 ? Math.min(1, this.time * 0.4) : 0
    if (crackProgress > 0 && !this.reducedMotion) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${crackProgress * 0.7})`
      ctx.lineWidth = 2
      const cx = w / 2
      const cy = h / 2
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + this.time * 0.1
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(angle) * w * 0.45 * crackProgress, cy + Math.sin(angle) * h * 0.45 * crackProgress)
        ctx.stroke()
      }
    }

    // Shockwave ring (Phase 3)
    if (this.jackpotPhase >= 3 && !this.reducedMotion) {
      const radius = ((this.time * 120) % (w * 0.6)) + 20
      ctx.strokeStyle = `rgba(255, 215, 0, ${0.6 - radius / (w * 0.8)})`
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  private drawWalkBy(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.walkBy) return
    ctx.font = '72px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.walkBy.emoji, this.walkBy.x * w, h * 0.88)
  }

  private drawTemporaryText(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 72px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = PALETTE.CYAN
    ctx.shadowBlur = 24
    ctx.fillText(this.temporaryText, w / 2, h / 2)
  }

  private drawStoryText(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = this.trackThemePrimary
    ctx.font = 'bold 56px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = this.trackThemePrimary
    ctx.shadowBlur = 18
    this.wrapText(ctx, this.storyText, w / 2, h * 0.4, w * 0.9, 64)
  }

  private drawTrackText(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.shadowBlur = 10
    ctx.fillStyle = this.trackThemeAccent
    ctx.font = 'bold 40px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.trackText, w / 2, h * 0.82)
  }

  private drawDrainOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const photosafe = this.reducedMotion || this.photosensitive
    const splashIdx = photosafe ? 0 : this.drainSplashIndex
    const img = this.splashImages[splashIdx]
    if (img?.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, w, h)
    } else {
      ctx.fillStyle = splashIdx === 0 ? '#14003c' : '#3c0014'
      ctx.fillRect(0, 0, w, h)
    }

    const pulse = photosafe ? 0.5 : (Math.sin(this.drainFlashTime * Math.PI * 4) + 1) / 2
    const alpha = 0.55 + pulse * 0.45
    const cx = w / 2
    const cy = h / 2
    const boxW = w * 0.78
    const boxH = h * 0.3

    ctx.strokeStyle = `rgba(255, 40, 40, ${alpha})`
    ctx.lineWidth = 6
    ctx.shadowColor = `rgba(255, 0, 0, ${alpha})`
    ctx.shadowBlur = photosafe ? 12 : 8 + pulse * 40
    ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH)
    ctx.shadowBlur = 0

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.font = 'bold 96px "Courier New", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('BALL LOST', cx, cy)
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ): void {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    const startY = y - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight))
  }

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.isVisible = visible
  }

  dispose(): void {
    this.texture?.dispose()
    this.material?.dispose()
    this.mesh?.dispose()
    this.texture = null
    this.material = null
    this.mesh = null
  }
}
