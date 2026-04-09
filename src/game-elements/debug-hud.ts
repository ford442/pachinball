/**
 * Debug HUD - Development overlay for game state monitoring
 */

export class DebugHUD {
  private container: HTMLElement
  private panels: Map<string, HTMLElement> = new Map()
  private isVisible = false

  constructor() {
    this.container = this.createContainer()
    document.body.appendChild(this.container)
  }

  private createContainer(): HTMLElement {
    const el = document.createElement('div')
    el.id = 'debug-hud'
    el.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.85);
      border: 1px solid #00ff00;
      border-radius: 4px;
      padding: 10px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #00ff00;
      z-index: 9999;
      display: none;
      min-width: 200px;
      max-height: 80vh;
      overflow-y: auto;
    `
    return el
  }

  toggle(): void {
    this.isVisible = !this.isVisible
    this.container.style.display = this.isVisible ? 'block' : 'none'
  }

  show(): void {
    this.isVisible = true
    this.container.style.display = 'block'
  }

  hide(): void {
    this.isVisible = false
    this.container.style.display = 'none'
  }

  updatePanel(name: string, data: Record<string, string | number>): void {
    let panel = this.panels.get(name)

    if (!panel) {
      panel = document.createElement('div')
      panel.style.marginBottom = '10px'
      panel.style.borderBottom = '1px solid #333'
      panel.style.paddingBottom = '5px'
      this.container.appendChild(panel)
      this.panels.set(name, panel)
    }

    const rows = Object.entries(data)
      .map(([key, value]) => `<div style="display:flex;justify-content:space-between;"><span>${key}:</span><span>${value}</span></div>`)
      .join('')

    panel.innerHTML = `<strong style="color:#ffff00">${name}</strong>${rows}`
  }

  dispose(): void {
    this.container.remove()
  }
}
