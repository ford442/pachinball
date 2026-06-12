import { QualityTier } from '../game-elements/visual-language'
import type { UnlockedReward } from '../game-elements/types'

const MAX_SUMMARY_TEXT_LENGTH = 50
const TRUNCATE_AT_LENGTH = 47

export interface DisplayOverlayShowOptions {
  items: UnlockedReward[]
  durationMs: number
  reducedMotion: boolean
  qualityTier: QualityTier
}

export class DisplayOverlay {
  private active = false
  private items: UnlockedReward[] = []
  private durationMs = 0
  private elapsedMs = 0
  private reducedMotion = false
  private qualityTier: QualityTier = QualityTier.MEDIUM
  private alpha = 0 // for fade in / fade out

  constructor() {}

  public show(options: DisplayOverlayShowOptions): void {
    this.active = true
    this.items = options.items
    this.durationMs = options.durationMs
    this.elapsedMs = 0
    this.reducedMotion = options.reducedMotion
    this.qualityTier = options.qualityTier
    this.alpha = this.reducedMotion ? 1.0 : 0
  }

  public hide(): void {
    this.active = false
    this.alpha = 0
  }

  public isActive(): boolean {
    return this.active
  }

  public update(dtSeconds: number): void {
    if (!this.active) return

    const dtMs = dtSeconds * 1000
    this.elapsedMs += dtMs

    if (this.elapsedMs >= this.durationMs) {
      this.hide()
      return
    }

    if (this.reducedMotion) {
      this.alpha = 1.0
    } else {
      // Fade in (first 300ms), hold, fade out (last 300ms)
      const fadeTime = 300
      if (this.elapsedMs < fadeTime) {
        this.alpha = this.elapsedMs / fadeTime
      } else if (this.elapsedMs > this.durationMs - fadeTime) {
        this.alpha = Math.max(0, (this.durationMs - this.elapsedMs) / fadeTime)
      } else {
        this.alpha = 1.0
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, currentState: string): void {
    if (!this.active || this.alpha <= 0) return

    ctx.save()
    ctx.globalAlpha = this.alpha

    // Shrinks to a compact banner when the underlying state owns the full display (e.g. JACKPOT)
    const isFullDisplayState = currentState === 'jackpot' || currentState === 'fever'
    
    // Position/sizing
    // Constrained to the upper ~30% of the backbox
    const overlayHeight = isFullDisplayState ? canvasHeight * 0.18 : canvasHeight * 0.35
    const overlayWidth = canvasWidth * 0.9
    const x = (canvasWidth - overlayWidth) / 2
    const y = canvasHeight * 0.05 // slightly offset from the top

    // semi-transparent dark backing panel for contrast
    ctx.fillStyle = 'rgba(10, 10, 10, 0.85)'
    ctx.fillRect(x, y, overlayWidth, overlayHeight)

    // Rarity colored border
    // Find highest rarity among the items for coloring
    let highestRarity: 'common' | 'rare' | 'legendary' = 'common'
    for (const item of this.items) {
      if (item.rarity === 'legendary') {
        highestRarity = 'legendary'
      } else if (item.rarity === 'rare' && highestRarity === 'common') {
        highestRarity = 'rare'
      }
    }

    const rarityColors = {
      common: '#00d9ff', // Cyan
      rare: '#8800ff',   // Purple
      legendary: '#ffd700' // Gold
    }
    const borderColor = rarityColors[highestRarity]

    ctx.strokeStyle = borderColor
    ctx.lineWidth = isFullDisplayState ? 3 : 5
    // Add neon glow for border unless reducedMotion or low tier
    if (!this.reducedMotion && this.qualityTier !== QualityTier.LOW) {
      ctx.shadowColor = borderColor
      ctx.shadowBlur = 15
    }
    ctx.strokeRect(x, y, overlayWidth, overlayHeight)

    // Draw text inside
    ctx.shadowBlur = 0 // reset shadow for text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (this.items.length === 1) {
      // Single item celebration
      const item = this.items[0]
      const isCampaignComplete = item.scope === 'campaign-complete'

      if (isFullDisplayState) {
        // Compact banner
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 24px "Courier New", monospace'
        const text = isCampaignComplete 
          ? `🏆 CAMPAIGN UNLOCKED: ${item.label.toUpperCase()}`
          : `🎁 REWARD UNLOCKED: ${item.label.toUpperCase()}`
        ctx.fillText(text, canvasWidth / 2, y + overlayHeight / 2)
      } else {
        // Normal moment
        // Title
        ctx.fillStyle = borderColor
        ctx.font = 'bold 28px "Courier New", monospace'
        const titleText = isCampaignComplete 
          ? '🏆 CAMPAIGN COMPLETED! 🏆'
          : `${highestRarity.toUpperCase()} UNLOCK!`
        ctx.fillText(titleText, canvasWidth / 2, y + overlayHeight * 0.3)

        // Item label
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 36px "Courier New", monospace'
        ctx.fillText(item.label.toUpperCase(), canvasWidth / 2, y + overlayHeight * 0.65)
      }
    } else {
      // Summary mode
      if (isFullDisplayState) {
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 24px "Courier New", monospace'
        ctx.fillText(`🎁 UNLOCKED ${this.items.length} REWARDS!`, canvasWidth / 2, y + overlayHeight / 2)
      } else {
        // Title
        ctx.fillStyle = borderColor
        ctx.font = 'bold 28px "Courier New", monospace'
        ctx.fillText('🎁 REWARDS UNLOCKED! 🎁', canvasWidth / 2, y + overlayHeight * 0.25)

        // List names
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 22px "Courier New", monospace'
        const names = this.items.map(item => item.label.toUpperCase()).join(', ')
        // Draw centered wrapped text or truncated if too long
        const truncatedNames = names.length > MAX_SUMMARY_TEXT_LENGTH
          ? names.substring(0, TRUNCATE_AT_LENGTH) + '...'
          : names
        ctx.fillText(truncatedNames, canvasWidth / 2, y + overlayHeight * 0.65)
      }
    }

    ctx.restore()
  }
}
