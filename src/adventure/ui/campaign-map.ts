/**
 * Campaign stage map — the campaign's front door.
 *
 * Renders the A/B spine plus its branches from `buildCampaignMapModel`, with
 * completion read from AdventureTrackProgression, and the Nexus Archive reward
 * panel that used to live on the legacy level-select screen. Clicking a reached
 * stage hands its id to the host, which starts (or jumps to) it.
 *
 * Loaded on first use via dynamic import, like the other overlays, so it stays
 * out of the entry chunk.
 */

import { getCampaignRewardsManager } from '../campaign-rewards-manager'
import {
  buildCampaignMapModel,
  type CampaignMapBranch,
  type CampaignMapModel,
  type CampaignMapStage,
  type CampaignProgressView,
} from './campaign-map-model'
import { renderCampaignMapStyles } from './campaign-map-styles'

export interface CampaignMapHost {
  /** The owning Game's signal; aborting it closes the map and drops its listeners. */
  readonly signal: AbortSignal
  /** Null until the campaign systems are initialised. */
  getProgress(): CampaignProgressView | null
  onStageSelect(trackId: string): void
}

const BRANCH_LABELS: Record<CampaignMapBranch['kind'], string> = {
  optional: 'Side branch',
  'post-finale': 'After the finale',
  detached: 'Side stages',
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stageMeta(stage: CampaignMapStage): string {
  switch (stage.status) {
    case 'completed':
      return stage.bestScore > 0 ? `Cleared · best ${stage.bestScore.toLocaleString()}` : 'Cleared'
    case 'current':
      return `Next · goal ${stage.recommendedScore.toLocaleString()}`
    case 'unlocked':
      return `Open · goal ${stage.recommendedScore.toLocaleString()}`
    case 'locked':
      return 'Locked'
  }
}

function renderStage(stage: CampaignMapStage): string {
  const label = stage.stageNumber !== null ? String(stage.stageNumber) : '◆'
  const slotTitle = stage.slot === 'A' ? 'A — course' : 'B — arena'
  return `
    <button type="button"
      class="campaign-stage status-${stage.status} slot-${stage.slot.toLowerCase()}"
      data-testid="campaign-stage-${stage.id}"
      data-track-id="${stage.id}"
      data-status="${stage.status}"
      title="${escapeHtml(stage.description)}"
      ${stage.playable ? '' : 'disabled aria-disabled="true"'}>
      <span class="campaign-stage-number">${label}</span>
      <span class="campaign-stage-body">
        <span class="campaign-stage-name">${escapeHtml(stage.name)}</span>
        <span class="campaign-stage-meta">${stageMeta(stage)}</span>
      </span>
      <span class="campaign-stage-slot" title="${slotTitle}">${stage.slot}</span>
    </button>
  `
}

function renderBranch(branch: CampaignMapBranch): string {
  return `
    <div class="campaign-branch kind-${branch.kind}"
      data-testid="campaign-branch-${branch.anchorTrackId ?? 'detached'}">
      <span class="campaign-branch-label">${BRANCH_LABELS[branch.kind]}</span>
      <div class="campaign-branch-stages">${branch.stages.map(renderStage).join('')}</div>
    </div>
  `
}

function renderMap(model: CampaignMapModel): string {
  const branchesByAnchor = new Map<string, CampaignMapBranch[]>()
  const detached: CampaignMapBranch[] = []
  for (const branch of model.branches) {
    if (branch.anchorTrackId === null) {
      detached.push(branch)
      continue
    }
    const list = branchesByAnchor.get(branch.anchorTrackId) ?? []
    list.push(branch)
    branchesByAnchor.set(branch.anchorTrackId, list)
  }

  const rows = model.spine.map((stage) => {
    const branches = branchesByAnchor.get(stage.id) ?? []
    return `
      <li class="campaign-spine-row">
        ${renderStage(stage)}
        ${branches.length > 0 ? `<div class="campaign-branches">${branches.map(renderBranch).join('')}</div>` : ''}
      </li>
    `
  }).join('')

  return `
    <ol class="campaign-spine" data-testid="campaign-spine">${rows}</ol>
    ${detached.map(renderBranch).join('')}
  `
}

function renderArchive(): string {
  const campaignRewards = getCampaignRewardsManager()
  const archiveItems = campaignRewards?.getArchiveState() ?? []
  const totalShards = campaignRewards?.getTotalShards() ?? 0
  return `
    <div class="campaign-archive" data-testid="campaign-archive-panel">
      <div class="campaign-archive-header">
        <h3>Nexus Archive</h3>
        <span class="campaign-shards" data-testid="campaign-shards-total">${Math.round(totalShards).toLocaleString()} Shards</span>
      </div>
      <div class="campaign-archive-items">
        ${archiveItems.map((item) => `
          <div
            class="campaign-archive-item ${item.unlocked ? 'unlocked' : 'locked'} ${item.equipped ? 'equipped' : ''}"
            data-testid="campaign-reward-item-${item.id}"
            data-reward-id="${item.id}"
          >
            <div class="campaign-archive-item-title">${escapeHtml(item.name)}</div>
            <div class="campaign-archive-item-meta">
              <span>${item.type.replace('-', ' ')}</span>
              <span>${item.shardCost.toLocaleString()} shards</span>
            </div>
            <div class="campaign-archive-item-desc">${escapeHtml(item.description)}</div>
            <div class="campaign-archive-item-state">
              ${item.unlocked
                ? (item.equipped
                    ? '<span class="campaign-state-badge">Equipped</span>'
                    : `<button type="button" class="campaign-equip-btn" data-reward-id="${item.id}">Equip</button>`)
                : `<span class="campaign-state-locked">Locked · Needs ${item.remainingShards.toLocaleString()} more shards</span>`}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

export class CampaignMapScreen {
  private container: HTMLElement | null = null
  /** Per-open listener scope; also aborted by the host signal. */
  private openScope: AbortController | null = null

  constructor(private readonly host: CampaignMapHost) {
    host.signal.addEventListener('abort', () => this.hide(), { once: true })
  }

  isShowing(): boolean {
    return this.container !== null
  }

  toggle(): void {
    if (this.isShowing()) this.hide()
    else this.show()
  }

  show(): void {
    if (this.container || this.host.signal.aborted) return
    const container = document.createElement('div')
    container.id = 'campaign-map'
    container.className = 'campaign-map-overlay'
    container.setAttribute('role', 'dialog')
    container.setAttribute('aria-modal', 'true')
    container.setAttribute('aria-label', 'Campaign stage map')
    container.dataset.testid = 'campaign-map'
    this.container = container
    this.render()
    // Above the menu overlay, so it also works from the start screen.
    ;(document.getElementById('game-cabinet') ?? document.body).appendChild(container)

    const scope = new AbortController()
    this.openScope = scope
    container.addEventListener('click', (event) => this.handleClick(event), { signal: scope.signal })
    // Modal: game shortcuts must not see keys meant for the map. Without this, Enter on a
    // focused stage both clicks it and reaches the menu's "Enter starts a game" handler.
    // stopPropagation keeps the default action (Tab focus, Enter/Space activation).
    document.addEventListener('keydown', (event) => {
      if (event.code === 'KeyL') return // the game's L handler toggles the map closed
      event.stopPropagation()
      if (event.code === 'Escape') this.hide()
    }, { signal: scope.signal, capture: true })

    const focusTarget = container.querySelector<HTMLElement>('.campaign-stage.status-current')
      ?? container.querySelector<HTMLElement>('.campaign-map-close')
    focusTarget?.focus({ preventScroll: true })
  }

  hide(): void {
    this.openScope?.abort()
    this.openScope = null
    this.container?.remove()
    this.container = null
  }

  /** Re-render in place (progress or rewards changed while open). */
  refresh(): void {
    if (this.container) this.render()
  }

  dispose(): void {
    this.hide()
  }

  private render(): void {
    if (!this.container) return
    const progress = this.host.getProgress()
    const model = progress ? buildCampaignMapModel(progress) : null
    const current = model?.spine.find((s) => s.id === model.currentTrackId)
      ?? model?.branches.flatMap((b) => b.stages).find((s) => s.id === model.currentTrackId)

    this.container.innerHTML = `
      <div class="campaign-map-container">
        <div class="campaign-map-header">
          <div>
            <h2>CAMPAIGN</h2>
            <p class="campaign-map-summary" data-testid="campaign-map-summary">
              ${model ? `${model.completedCount} / ${model.totalCount} stages cleared · ${model.completionPercent}%` : 'Campaign loading…'}
            </p>
          </div>
          <div class="campaign-map-actions">
            ${current?.playable
              ? `<button type="button" class="campaign-map-continue" data-track-id="${current.id}" data-testid="campaign-map-continue">Play ${escapeHtml(current.name)}</button>`
              : ''}
            <button type="button" class="campaign-map-close" aria-label="Close stage map">×</button>
          </div>
        </div>
        <div class="campaign-map-progress"><div class="campaign-map-progress-fill" style="width: ${model?.completionPercent ?? 0}%"></div></div>
        <p class="campaign-map-legend">
          <span class="campaign-stage-slot">A</span> course — reach the exit portal
          <span class="campaign-stage-slot slot-b">B</span> arena — rack the score in place
        </p>
        ${model ? renderMap(model) : ''}
        ${renderArchive()}
      </div>
      ${renderCampaignMapStyles()}
    `
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target === this.container || target.closest('.campaign-map-close')) {
      this.hide()
      return
    }

    const equip = target.closest<HTMLElement>('.campaign-equip-btn')
    if (equip) {
      const rewardId = equip.dataset.rewardId
      if (rewardId && getCampaignRewardsManager()?.equip(rewardId)) this.render()
      return
    }

    const stage = target.closest<HTMLButtonElement>('[data-track-id]')
    if (!stage || stage.disabled) return
    const trackId = stage.dataset.trackId
    if (!trackId) return
    this.hide()
    this.host.onStageSelect(trackId)
  }
}
