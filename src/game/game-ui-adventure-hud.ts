interface CampaignHUDState {
  trackName: string
  modeLabel: string
  scoreCurrent: number
  scoreTarget: number
  timeRemaining: number
  timeLimit: number
  nextTrackName: string | null
  nextTrackGoal: number | null
  goals: Array<{ description: string; current: number; target: number; completed: boolean }>
  shardTotal: number
  campaignPercent: number
}

/** Live campaign track panel — current goal, timer context, next-sector teaser. */
export function updateCampaignHUD(state: CampaignHUDState): void {
  const hudEl = document.getElementById('adventure-hud')
  if (!hudEl) return

  hudEl.classList.remove('hidden')

  const modeBadge = document.getElementById('campaign-mode-badge')
  if (modeBadge) modeBadge.textContent = state.modeLabel

  const levelNameEl = document.getElementById('adventure-level-name')
  if (levelNameEl) levelNameEl.textContent = state.trackName

  const scoreCurrentEl = document.getElementById('campaign-score-current')
  const scoreTargetEl = document.getElementById('campaign-score-target')
  if (scoreCurrentEl) scoreCurrentEl.textContent = Math.round(state.scoreCurrent).toLocaleString()
  if (scoreTargetEl) scoreTargetEl.textContent = state.scoreTarget.toLocaleString()

  const scoreFill = document.getElementById('campaign-score-fill')
  const scorePct = state.scoreTarget > 0
    ? Math.min(100, Math.round((state.scoreCurrent / state.scoreTarget) * 100))
    : 0
  if (scoreFill) scoreFill.style.width = `${scorePct}%`

  const goalsEl = document.getElementById('adventure-goals')
  if (goalsEl) {
    goalsEl.innerHTML = state.goals.map(goal => {
      const percent = goal.target > 0
        ? Math.min(100, Math.round((goal.current / goal.target) * 100))
        : 0
      return `
        <div class="adventure-goal ${goal.completed ? 'completed' : ''}">
          <span class="adventure-goal-text">${goal.description}</span>
          <span class="adventure-goal-progress">${goal.completed ? '✓' : `${percent}%`}</span>
        </div>
      `
    }).join('')
  }

  const nextNameEl = document.getElementById('campaign-next-track-name')
  const nextGoalEl = document.getElementById('campaign-next-track-goal')
  if (nextNameEl) {
    nextNameEl.textContent = state.nextTrackName ?? 'Campaign complete'
  }
  if (nextGoalEl) {
    nextGoalEl.textContent = state.nextTrackGoal != null
      ? `· ${state.nextTrackGoal.toLocaleString()} pts`
      : ''
  }

  const progressFill = document.getElementById('adventure-progress-fill')
  const progressText = document.getElementById('adventure-progress-text')
  if (progressFill) progressFill.style.width = `${state.campaignPercent}%`
  if (progressText) progressText.textContent = `${state.campaignPercent}% campaign`

  const shardEl = document.getElementById('campaign-hud-shard-total')
  if (shardEl) shardEl.textContent = Math.round(state.shardTotal).toLocaleString()
}

/**
 * Hide the adventure HUD.
 */
export function hideAdventureHUD(): void {
  const hudEl = document.getElementById('adventure-hud')
  if (hudEl) {
    hudEl.classList.add('hidden')
  }
}
