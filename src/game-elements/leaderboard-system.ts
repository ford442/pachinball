/**
 * Pachinball Leaderboard System
 * 
 * Global high-score table with storage_manager backend.
 * - Auto-refreshes every 30 seconds
 * - Retro LCD-style UI overlay
 * - Filtered by current map + adventure level
 */

// Storage manager API base URL
const STORAGE_API_BASE = 'http://localhost:8000/api'

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
  private refreshInterval = 30000 // 30 seconds
  private refreshTimer: number | null = null
  private isRefreshing = false
  private currentMapId = 'neon-helix'
  private currentAdventureLevel?: string
  
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
   * Start auto-refresh
   */
  start(): void {
    this.stop() // Clear existing timer
    this.refresh()
    
    this.refreshTimer = window.setInterval(() => {
      this.refresh()
    }, this.refreshInterval)
  }

  /**
   * Stop auto-refresh
   */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
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
    
    try {
      const params = new URLSearchParams()
      params.append('map_id', this.currentMapId)
      params.append('limit', '10')
      if (this.currentAdventureLevel) {
        params.append('adventure_level', this.currentAdventureLevel)
      }
      
      const response = await fetch(`${STORAGE_API_BASE}/leaderboard?${params}`)
      if (!response.ok) throw new Error('Failed to fetch leaderboard')
      
      const data = await response.json()
      this.scores = data.scores || []
      this.lastRefresh = now
      
      this.updateUI()
      console.log(`[Leaderboard] Refreshed: ${this.scores.length} scores`)
    } catch (err) {
      console.warn('[Leaderboard] Refresh failed:', err)
    } finally {
      this.isRefreshing = false
    }
  }

  /**
   * Submit a new score
   */
  async submitScore(score: ScoreSubmission): Promise<{ success: boolean; rank?: number; message?: string }> {
    try {
      const response = await fetch(`${STORAGE_API_BASE}/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(score)
      })
      
      if (!response.ok) throw new Error('Failed to submit score')
      
      const result = await response.json()
      
      // Refresh to show new score
      await this.refresh(true)
      
      return {
        success: result.success,
        rank: result.rank,
        message: result.message
      }
    } catch (err) {
      console.error('[Leaderboard] Submit failed:', err)
      return { success: false, message: 'Failed to submit score' }
    }
  }

  /**
   * Check if a score would rank on the leaderboard
   */
  async checkRank(score: number): Promise<number> {
    try {
      const params = new URLSearchParams()
      params.append('score', String(score))
      params.append('map_id', this.currentMapId)
      if (this.currentAdventureLevel) {
        params.append('adventure_level', this.currentAdventureLevel)
      }
      
      const response = await fetch(`${STORAGE_API_BASE}/leaderboard/player-rank?${params}`)
      if (!response.ok) throw new Error('Failed to check rank')
      
      const data = await response.json()
      return data.rank
    } catch (err) {
      console.warn('[Leaderboard] Rank check failed:', err)
      return 999 // Default to low rank
    }
  }

  /**
   * Show the leaderboard overlay
   */
  show(): void {
    if (this.overlay) {
      this.overlay.classList.remove('hidden')
      this.isVisible = true
      this.refresh()
    }
  }

  /**
   * Hide the leaderboard overlay
   */
  hide(): void {
    if (this.overlay) {
      this.overlay.classList.add('hidden')
      this.isVisible = false
    }
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide()
    } else {
      this.show()
    }
  }

  /**
   * Get current scores
   */
  getScores(): LeaderboardEntry[] {
    return this.scores
  }

  /**
   * Create the leaderboard overlay UI
   */
  private createOverlay(): void {
    // Check if already exists
    if (document.getElementById('leaderboard-overlay')) return
    
    const overlay = document.createElement('div')
    overlay.id = 'leaderboard-overlay'
    overlay.className = 'hidden'
    overlay.innerHTML = `
      <div class="leaderboard-panel">
        <div class="leaderboard-header">
          <span class="leaderboard-title">HIGH SCORES</span>
          <span class="leaderboard-close">×</span>
        </div>
        <div class="leaderboard-content">
          <div class="leaderboard-map">MAP: <span class="map-name">NEON HELIX</span></div>
          <div class="leaderboard-list"></div>
        </div>
        <div class="leaderboard-footer">
          <span class="refresh-indicator">●</span>
          <span>AUTO-REFRESH</span>
        </div>
      </div>
    `
    
    // Add styles
    const style = document.createElement('style')
    style.textContent = `
      #leaderboard-overlay {
        position: absolute;
        top: 16px;
        right: 16px;
        z-index: 40;
        font-family: 'Orbitron', monospace;
      }
      
      #leaderboard-overlay.hidden {
        display: none;
      }
      
      .leaderboard-panel {
        background: rgba(0, 10, 20, 0.9);
        border: 2px solid var(--map-accent, #00d9ff);
        border-radius: 4px;
        padding: 12px;
        min-width: 220px;
        box-shadow: 
          0 0 20px rgba(0, 217, 255, 0.3),
          inset 0 0 30px rgba(0, 217, 255, 0.05);
        backdrop-filter: blur(4px);
      }
      
      .leaderboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(0, 217, 255, 0.3);
      }
      
      .leaderboard-title {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--map-accent, #00d9ff);
        letter-spacing: 2px;
        text-shadow: 0 0 8px var(--map-accent, #00d9ff);
      }
      
      .leaderboard-close {
        font-size: 1.2rem;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        padding: 0 4px;
        transition: color 0.2s;
      }
      
      .leaderboard-close:hover {
        color: #ff0055;
      }
      
      .leaderboard-map {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 8px;
        letter-spacing: 1px;
      }
      
      .leaderboard-map .map-name {
        color: var(--map-accent, #00d9ff);
      }
      
      .leaderboard-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .leaderboard-entry {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        font-size: 0.75rem;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 2px;
        transition: background 0.2s;
      }
      
      .leaderboard-entry:hover {
        background: rgba(0, 217, 255, 0.1);
      }
      
      .leaderboard-entry.top-3 {
        background: rgba(255, 200, 0, 0.15);
        border-left: 2px solid #ffc800;
      }
      
      .leaderboard-entry.is-player {
        background: rgba(0, 217, 255, 0.2);
        border-left: 2px solid #00d9ff;
        animation: playerPulse 1s ease-in-out infinite;
      }
      
      @keyframes playerPulse {
        0%, 100% { box-shadow: 0 0 5px rgba(0, 217, 255, 0.3); }
        50% { box-shadow: 0 0 15px rgba(0, 217, 255, 0.6); }
      }
      
      .entry-rank {
        width: 20px;
        text-align: center;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
      }
      
      .leaderboard-entry.top-3 .entry-rank {
        color: #ffc800;
        text-shadow: 0 0 8px #ffc800;
      }
      
      .entry-name {
        flex: 1;
        color: #fff;
        font-weight: 600;
        letter-spacing: 1px;
      }
      
      .entry-score {
        color: var(--map-accent, #00d9ff);
        font-weight: 700;
        font-family: monospace;
        font-size: 0.8rem;
      }
      
      .leaderboard-footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(0, 217, 255, 0.2);
        font-size: 0.55rem;
        color: rgba(255, 255, 255, 0.4);
        letter-spacing: 1px;
      }
      
      .refresh-indicator {
        color: #00ff44;
        animation: blink 2s infinite;
      }
      
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      
      .leaderboard-empty {
        text-align: center;
        padding: 20px;
        color: rgba(255, 255, 255, 0.4);
        font-size: 0.7rem;
      }
    `
    
    document.head.appendChild(style)
    document.body.appendChild(overlay)
    
    // Close button
    const closeBtn = overlay.querySelector('.leaderboard-close')
    closeBtn?.addEventListener('click', () => this.hide())
    
    this.overlay = overlay
    this.scoreList = overlay.querySelector('.leaderboard-list')
  }

  /**
   * Update the UI with current scores
   */
  private updateUI(): void {
    if (!this.scoreList) return
    
    // Update map name
    const mapNameEl = this.overlay?.querySelector('.map-name')
    if (mapNameEl) {
      mapNameEl.textContent = this.currentMapId.replace('-', ' ').toUpperCase()
    }
    
    // Clear list
    this.scoreList.innerHTML = ''
    
    if (this.scores.length === 0) {
      this.scoreList.innerHTML = '<div class="leaderboard-empty">NO SCORES</div>'
      return
    }
    
    // Add entries
    this.scores.forEach((entry) => {
      const row = document.createElement('div')
      row.className = 'leaderboard-entry'
      if (entry.rank <= 3) row.classList.add('top-3')
      
      row.innerHTML = `
        <span class="entry-rank">${entry.rank}</span>
        <span class="entry-name">${this.escapeHtml(entry.name)}</span>
        <span class="entry-score">${entry.score.toLocaleString()}</span>
      `
      
      this.scoreList!.appendChild(row)
    })
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.stop()
    this.overlay?.remove()
    this.overlay = null
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
  if (leaderboardInstance) {
    leaderboardInstance.dispose()
    leaderboardInstance = null
  }
}
