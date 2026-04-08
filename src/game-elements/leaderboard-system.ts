/**
 * Pachinball Leaderboard System
 *
 * Global high-score table with storage_manager backend.
 * - Auto-refreshes every 30 seconds
 * - Retro LCD-style UI overlay
 * - Filtered by current map + adventure level
 */

import { apiFetch } from '../config'

export interface LeaderboardEntry {
  rank: number
  name: string
  score: number
  map_id: string
  adventure_level?: string
  balls: number
  combo_max: number
  date: string
}

export interface ScoreSubmission {
  name: string
  score: number
  map_id: string
  adventure_level?: string
  balls: number
  combo_max: number
}

export class LeaderboardSystem {
  private scores: LeaderboardEntry[] = []
  private lastRefresh = 0
  private refreshTimer: number | null = null
  private isRefreshing = false
  private currentMapId = 'neon-helix'
  private currentAdventureLevel?: string

  // Polling retry state
  private consecutiveFailures = 0
  private maxRetries = 5
  private baseInterval = 30000 // 30 seconds base
  private maxInterval = 300000 // 5 minutes max
  private isPaused = false

  // UI Elements
  private overlay: HTMLElement | null = null
  private scoreList: HTMLElement | null = null
  private isVisible = false

  constructor() {
    this.createOverlay()
  }

  /**
   * Set the current map/level context for filtering
   */
  setContext(mapId: string, adventureLevel?: string): void {
    this.currentMapId = mapId
    this.currentAdventureLevel = adventureLevel
    this.refresh(true) // Force refresh on context change
  }

  /**
   * Start auto-refresh with exponential backoff on failures
   */
  start(): void {
    this.stop() // Clear existing timer
    this.consecutiveFailures = 0
    this.isPaused = false
    this.refresh()
    this.scheduleNextRefresh()
  }

  /**
   * Schedule next refresh with exponential backoff
   */
  private scheduleNextRefresh(): void {
    if (this.isPaused) return

    // Calculate interval with exponential backoff: base * 2^failures
    const interval = Math.min(
      this.baseInterval * Math.pow(2, this.consecutiveFailures),
      this.maxInterval
    )

    this.refreshTimer = window.setTimeout(() => {
      this.refresh().then(() => {
        this.scheduleNextRefresh()
      })
    }, interval)

    console.log(`[Leaderboard] Next refresh in ${Math.round(interval / 1000)}s (failures: ${this.consecutiveFailures})`)
  }

  /**
   * Stop auto-refresh
   */
  stop(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /**
   * Pause polling (e.g., when tab is hidden)
   */
  pause(): void {
    this.isPaused = true
    this.stop()
  }

  /**
   * Resume polling
   */
  resume(): void {
    this.isPaused = false
    this.scheduleNextRefresh()
  }

  /**
   * Fetch latest scores from backend
   */
  async refresh(force = false): Promise<void> {
    // Throttle refreshes
    const now = Date.now()
    if (!force && now - this.lastRefresh < 5000) return

    if (this.isRefreshing) return
    this.isRefreshing = true

    const params = new URLSearchParams()
    params.append('map_id', this.currentMapId)
    params.append('limit', '10')
    if (this.currentAdventureLevel) {
      params.append('adventure_level', this.currentAdventureLevel)
    }

    try {
      const data = await apiFetch<{ scores: LeaderboardEntry[] }>(`/leaderboard?${params}`)
      
      if (!data) {
        throw new Error('No data returned from API')
      }
      
      this.scores = data.scores || []
      this.lastRefresh = now
      
      // Reset failure count on success
      this.consecutiveFailures = 0
      
      this.updateUI()
      console.log(`[Leaderboard] Refreshed: ${this.scores.length} scores`)
    } catch (err) {
      this.consecutiveFailures++
      console.warn(`[Leaderboard] Refresh failed (${this.consecutiveFailures}/${this.maxRetries}):`, err)
      
      if (this.consecutiveFailures >= this.maxRetries) {
        console.error('[Leaderboard] Max retries exceeded. Pausing polling for 5 minutes.')
        this.pause()
        setTimeout(() => {
          console.log('[Leaderboard] Resuming polling after pause')
          this.consecutiveFailures = Math.floor(this.maxRetries / 2) // Partial reset
          this.resume()
        }, 300000) // 5 minutes
      }
    } finally {
      this.isRefreshing = false
    }
  }

  /**
   * Submit a new score
   */
  async submitScore(score: ScoreSubmission): Promise<{ success: boolean; rank?: number; message?: string }> {
    const result = await apiFetch<{ success: boolean; rank?: number; message?: string }>(
      '/leaderboard',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(score),
      }
    )
    
    if (!result) {
      return { success: false, message: 'Failed to submit score' }
    }
    
    // Refresh after submission
    this.refresh(true)
    return result
  }

  /**
   * Get player's rank for current map
   */
  async getPlayerRank(score: number): Promise<number | null> {
    const params = new URLSearchParams()
    params.append('map_id', this.currentMapId)
    params.append('score', score.toString())
    if (this.currentAdventureLevel) {
      params.append('adventure_level', this.currentAdventureLevel)
    }

    const data = await apiFetch<{ rank: number }>(`/leaderboard/player-rank?${params}`)
    return data?.rank ?? null
  }

  /**
   * Check player's rank for current map (alias for getPlayerRank)
   */
  async checkRank(score: number): Promise<number | null> {
    return this.getPlayerRank(score)
  }

  /**
   * Toggle leaderboard visibility
   */
  toggle(): void {
    this.isVisible = !this.isVisible
    if (this.overlay) {
      this.overlay.style.display = this.isVisible ? 'block' : 'none'
    }
    if (this.isVisible) {
      this.refresh()
    }
  }

  /**
   * Show the leaderboard
   */
  show(): void {
    this.isVisible = true
    if (this.overlay) {
      this.overlay.style.display = 'block'
    }
    this.refresh()
  }

  /**
   * Hide the leaderboard
   */
  hide(): void {
    this.isVisible = false
    if (this.overlay) {
      this.overlay.style.display = 'none'
    }
  }

  /**
   * Create the leaderboard UI overlay
   */
  private createOverlay(): void {
    const overlay = document.createElement('div')
    overlay.id = 'leaderboard-overlay'
    overlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 400px;
      max-height: 80vh;
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid #00ff88;
      border-radius: 8px;
      padding: 20px;
      font-family: 'Courier New', monospace;
      color: #00ff88;
      display: none;
      z-index: 1000;
      overflow-y: auto;
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
    `

    const title = document.createElement('h2')
    title.textContent = 'HIGH SCORES'
    title.style.cssText = `
      margin: 0 0 15px 0;
      text-align: center;
      font-size: 24px;
      text-shadow: 0 0 10px #00ff88;
      letter-spacing: 3px;
    `
    overlay.appendChild(title)

    const scoreList = document.createElement('div')
    scoreList.id = 'leaderboard-scores'
    overlay.appendChild(scoreList)

    const closeBtn = document.createElement('button')
    closeBtn.textContent = 'CLOSE'
    closeBtn.style.cssText = `
      display: block;
      margin: 15px auto 0;
      padding: 8px 20px;
      background: transparent;
      border: 1px solid #00ff88;
      color: #00ff88;
      cursor: pointer;
      font-family: inherit;
      font-size: 14px;
    `
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = '#00ff88'
      closeBtn.style.color = '#000'
    }
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = 'transparent'
      closeBtn.style.color = '#00ff88'
    }
    closeBtn.onclick = () => this.hide()
    overlay.appendChild(closeBtn)

    document.body.appendChild(overlay)
    this.overlay = overlay
    this.scoreList = scoreList
  }

  /**
   * Update the UI with current scores
   */
  private updateUI(): void {
    if (!this.scoreList) return

    if (this.scores.length === 0) {
      this.scoreList.innerHTML = '<div style="text-align: center; padding: 20px;">No scores yet</div>'
      return
    }

    const html = this.scores
      .map(
        (entry, index) => `
        <div style="
          display: flex;
          justify-content: space-between;
          padding: 8px;
          margin: 4px 0;
          background: ${index % 2 === 0 ? 'rgba(0, 255, 136, 0.1)' : 'transparent'};
          border-left: 3px solid ${index < 3 ? '#ffd700' : '#00ff88'};
        ">
          <span>${entry.rank}. ${entry.name}</span>
          <span style="font-weight: bold;">${entry.score.toLocaleString()}</span>
        </div>
      `
      )
      .join('')

    this.scoreList.innerHTML = html
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop()
    if (this.overlay) {
      this.overlay.remove()
      this.overlay = null
    }
    this.scoreList = null
  }
}

// Singleton instance
let leaderboardInstance: LeaderboardSystem | null = null

export function getLeaderboardSystem(): LeaderboardSystem {
  if (!leaderboardInstance) {
    leaderboardInstance = new LeaderboardSystem()
  }
  return leaderboardInstance
}

export function resetLeaderboardSystem(): void {
  leaderboardInstance?.dispose()
  leaderboardInstance = null
}
