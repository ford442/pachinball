/**
 * Challenge System — URL parsing, share link generation, and challenge HUD banners.
 */

import { apiFetch } from '../config'

export interface ChallengeConfig {
  id?: string
  seed: number
  targetScore: number
  mapId: string
  challengerName?: string
}

export class ChallengeSystem {
  private activeChallenge: ChallengeConfig | null = null
  private bannerElement: HTMLElement | null = null

  constructor() {
    this.checkUrlParameters()
  }

  /**
   * Check URL parameters for challenge or seed metadata.
   */
  checkUrlParameters(queryString?: string): ChallengeConfig | null {
    const search = queryString ?? (typeof window !== 'undefined' ? window.location.search : '')
    const params = new URLSearchParams(search)

    const challengeParam = params.get('challenge')
    const seedParam = params.get('seed')
    const targetParam = params.get('target')
    const mapParam = params.get('map') || 'neon-helix'

    if (challengeParam) {
      if (challengeParam.includes(':')) {
        const [seedStr, targetStr] = challengeParam.split(':')
        const seed = parseInt(seedStr || '0', 10)
        const targetScore = parseInt(targetStr || '100000', 10)
        this.activeChallenge = { seed, targetScore, mapId: mapParam }
      } else {
        // Single challenge ID
        const targetScore = targetParam ? parseInt(targetParam, 10) : 100000
        const seed = seedParam ? parseInt(seedParam, 10) : Math.floor(Math.random() * 1000000)
        this.activeChallenge = { id: challengeParam, seed, targetScore, mapId: mapParam }
      }
    } else if (seedParam) {
      const seed = parseInt(seedParam, 10) || 0
      const targetScore = targetParam ? parseInt(targetParam, 10) : 100000
      this.activeChallenge = { seed, targetScore, mapId: mapParam }
    }

    if (this.activeChallenge) {
      this.showChallengeBanner()
    }

    return this.activeChallenge
  }

  getActiveChallenge(): ChallengeConfig | null {
    return this.activeChallenge
  }

  setActiveChallenge(config: ChallengeConfig | null): void {
    this.activeChallenge = config
    if (config) {
      this.showChallengeBanner()
    } else {
      this.hideChallengeBanner()
    }
  }

  /**
   * Generate a shareable URL string for a challenge.
   */
  static createChallengeShareUrl(seed: number, targetScore: number, mapId = 'neon-helix'): string {
    const baseUrl = (typeof window !== 'undefined' && window.location)
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://pachinball.example/'
    return `${baseUrl}?challenge=${seed}:${targetScore}&map=${encodeURIComponent(mapId)}`
  }

  /**
   * Copy challenge link to user's clipboard and display feedback toast.
   */
  static async copyChallengeLink(seed: number, targetScore: number, mapId = 'neon-helix'): Promise<boolean> {
    const url = ChallengeSystem.createChallengeShareUrl(seed, targetScore, mapId)
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      // Fallback
      prompt('Copy challenge link:', url)
      return true
    }
  }

  /**
   * Submit challenge metadata to backend API if available.
   */
  async submitChallenge(challenge: ChallengeConfig): Promise<string | null> {
    try {
      const res = await apiFetch<{ success: boolean; challenge_id: string }>('/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: challenge.seed,
          targetScore: challenge.targetScore,
          mapId: challenge.mapId,
          challengerName: challenge.challengerName || 'AAA',
        }),
      })
      return res?.challenge_id || null
    } catch {
      return null
    }
  }

  /**
   * Render challenge HUD banner during play.
   */
  private showChallengeBanner(): void {
    if (!this.activeChallenge) return
    this.hideChallengeBanner()

    const banner = document.createElement('div')
    banner.id = 'challenge-hud-banner'
    banner.style.cssText = `
      position: fixed;
      top: 15px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 15, 30, 0.9);
      border: 2px solid #00f0ff;
      border-radius: 20px;
      padding: 6px 20px;
      font-family: 'Orbitron', monospace, sans-serif;
      font-size: 0.85rem;
      color: #00f0ff;
      text-shadow: 0 0 8px #00f0ff;
      z-index: 1500;
      box-shadow: 0 0 15px rgba(0, 240, 255, 0.3);
      display: flex;
      gap: 15px;
      align-items: center;
      pointer-events: none;
    `

    banner.innerHTML = `
      <span>⚡ CHALLENGE MODE</span>
      <span>SEED: <strong>${this.activeChallenge.seed}</strong></span>
      <span>TARGET: <strong style="color:#ffc800;">${this.activeChallenge.targetScore.toLocaleString()}</strong></span>
    `

    document.body.appendChild(banner)
    this.bannerElement = banner
  }

  hideChallengeBanner(): void {
    if (this.bannerElement) {
      this.bannerElement.remove()
      this.bannerElement = null
    }
  }

  dispose(): void {
    this.hideChallengeBanner()
    this.activeChallenge = null
  }
}

// Singleton helper
let challengeSystemInstance: ChallengeSystem | null = null

export function getChallengeSystem(): ChallengeSystem {
  if (!challengeSystemInstance) {
    challengeSystemInstance = new ChallengeSystem()
  }
  return challengeSystemInstance
}

export function resetChallengeSystem(): void {
  challengeSystemInstance?.dispose()
  challengeSystemInstance = null
}
