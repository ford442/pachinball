/**
 * Debug HUD - Development overlay for game state monitoring
 */

export interface DebugSnapshot {
  gameState: string
  displayState: string
  score: number
  multiplier: number
  lives: number
  adventureTrack: string | null
  fps: number
  drawCalls: number
  frameTimeMs: number
  activeBodies: number
  physicsStepMs: number
  adventureTimeMs: number | null
  dynamicZoneState: string | null
}

interface PanelRow {
  rowEl: HTMLElement
  valueEl: HTMLElement
}

interface PanelElements {
  rootEl: HTMLElement
  headerEl: HTMLElement
  rows: Map<string, PanelRow>
  lastValues: Map<string, string>
}

interface DebugHUDOptions {
  onVisibilityChange?: (visible: boolean) => void
}

export class DebugHUD {
  private container: HTMLElement
  private panels: Map<string, PanelElements> = new Map()
  private pendingData: Map<string, Record<string, string | number>> = new Map()
  private flushRafId: number | null = null
  private updateCadenceMs = 250
  private lastFlushTime = 0
  private isVisible = false
  private onVisibilityChange?: (visible: boolean) => void

  constructor(options: DebugHUDOptions = {}) {
    this.onVisibilityChange = options.onVisibilityChange
    this.container = this.createContainer()
    document.body.appendChild(this.container)
  }

  private createContainer(): HTMLElement {
    const el = document.createElement('div')
    el.id = 'debug-hud'
    el.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0,0,0,0.85);
      border: 1px solid #00d9ff;
      border-radius: 4px;
      padding: 10px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #00d9ff;
      z-index: 9999;
      display: none;
      min-width: 200px;
      max-height: 80vh;
      overflow-y: auto;
      pointer-events: none;
    `
    return el
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide()
    } else {
      this.show()
    }
  }

  show(): void {
    if (this.isVisible) return
    this.isVisible = true
    this.container.style.display = 'block'
    this.onVisibilityChange?.(true)
  }

  hide(): void {
    if (!this.isVisible) return
    this.isVisible = false
    this.container.style.display = 'none'
    this.pendingData.clear()
    this.onVisibilityChange?.(false)
  }

  isHUDVisible(): boolean {
    return this.isVisible
  }

  setUpdateCadenceHz(hz: number): void {
    if (!Number.isFinite(hz) || hz <= 0) {
      console.warn(`[DebugHUD] Invalid update cadence: ${hz}`)
      return
    }
    this.updateCadenceMs = 1000 / hz
  }

  update(snapshot: DebugSnapshot): void {
    if (!this.isVisible) return

    this.updatePanel('Game State', {
      state: snapshot.gameState,
      mode: snapshot.displayState,
      lives: snapshot.lives,
      score: snapshot.score,
      multiplier: `${Math.round(snapshot.multiplier)}x`,
      track: snapshot.adventureTrack ?? 'none',
    })

    this.updatePanel('Physics', {
      'step ms': snapshot.physicsStepMs.toFixed(2),
      bodies: snapshot.activeBodies,
    })

    this.updatePanel('Display', {
      fps: snapshot.fps.toFixed(1),
      drawCalls: snapshot.drawCalls,
      'frame ms': snapshot.frameTimeMs.toFixed(2),
    })

    this.updatePanel('Mode timers', {
      'adventure ms': snapshot.adventureTimeMs?.toFixed(1) ?? 'n/a',
      'zone state': snapshot.dynamicZoneState ?? 'n/a',
    })
  }

  updatePanel(name: string, data: Record<string, string | number>): void {
    if (!this.isVisible) return
    this.pendingData.set(name, data)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushRafId !== null) return

    const flushLoop = (timestamp: number): void => {
      this.flushRafId = null
      if (!this.isVisible || this.pendingData.size === 0) return

      if (timestamp - this.lastFlushTime >= this.updateCadenceMs) {
        this.flushPendingPanels()
        this.lastFlushTime = timestamp
      }

      if (this.pendingData.size > 0) {
        this.flushRafId = window.requestAnimationFrame(flushLoop)
      }
    }

    this.flushRafId = window.requestAnimationFrame(flushLoop)
  }

  private flushPendingPanels(): void {
    for (const [name, panelData] of this.pendingData.entries()) {
      this.renderPanel(name, panelData)
    }
    this.pendingData.clear()
  }

  private renderPanel(name: string, data: Record<string, string | number>): void {
    const panel = this.getOrCreatePanel(name)
    panel.headerEl.textContent = name

    const activeKeys = new Set<string>()
    for (const [key, value] of Object.entries(data)) {
      activeKeys.add(key)
      const row = this.getOrCreateRow(panel, key)
      const nextValue = String(value)
      const previousValue = panel.lastValues.get(key)
      row.valueEl.style.color = previousValue !== nextValue ? '#ff0055' : '#00d9ff'
      row.valueEl.textContent = nextValue
      panel.lastValues.set(key, nextValue)
    }

    for (const [key, row] of panel.rows.entries()) {
      if (activeKeys.has(key)) continue
      row.rowEl.remove()
      panel.rows.delete(key)
      panel.lastValues.delete(key)
    }
  }

  private getOrCreatePanel(name: string): PanelElements {
    const existing = this.panels.get(name)
    if (existing) return existing

    const rootEl = document.createElement('div')
    rootEl.style.marginBottom = '10px'
    rootEl.style.borderBottom = '1px solid #333'
    rootEl.style.paddingBottom = '5px'

    const headerEl = document.createElement('strong')
    headerEl.style.color = '#00d9ff'
    headerEl.style.display = 'block'
    headerEl.style.marginBottom = '4px'
    rootEl.appendChild(headerEl)

    this.container.appendChild(rootEl)

    const panel: PanelElements = {
      rootEl,
      headerEl,
      rows: new Map(),
      lastValues: new Map(),
    }
    this.panels.set(name, panel)
    return panel
  }

  private getOrCreateRow(panel: PanelElements, key: string): PanelRow {
    const existing = panel.rows.get(key)
    if (existing) return existing

    const rowEl = document.createElement('div')
    rowEl.style.display = 'flex'
    rowEl.style.justifyContent = 'space-between'
    rowEl.style.gap = '10px'

    const keyEl = document.createElement('span')
    keyEl.textContent = `${key}:`
    keyEl.style.color = '#00d9ff'

    const valueEl = document.createElement('span')
    valueEl.style.color = '#00d9ff'

    rowEl.appendChild(keyEl)
    rowEl.appendChild(valueEl)
    panel.rootEl.appendChild(rowEl)

    const created: PanelRow = { rowEl, valueEl }
    panel.rows.set(key, created)
    return created
  }

  dispose(): void {
    if (this.flushRafId !== null) {
      window.cancelAnimationFrame(this.flushRafId)
      this.flushRafId = null
    }
    this.pendingData.clear()
    this.panels.clear()
    this.container.remove()
  }
}
