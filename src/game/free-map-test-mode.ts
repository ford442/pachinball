/**
 * Free Map Test Mode — Developer sandbox for instantly loading any adventure track.
 *
 * Activation: Ctrl+Shift+M (or programmatically via activate())
 * While active:
 *   - PageUp / PageDown cycle through all available layouts
 *   - On-screen HUD indicator shows current track + mode status
 *   - Each switch cleanly disposes prior physics bodies before loading new track
 *
 * Does NOT interfere with the normal adventure campaign flow — test mode
 * simply bypasses unlock gates and progression checks.
 */

import { getMapRegistry, type MapConfig } from './map-registry'
import { LevelLoader, type LevelLoaderDeps } from './level-loader'

export interface FreeMapTestModeConfig {
  /** Called when mode is activated/deactivated to update HUD. */
  onStatusChange?: (active: boolean, currentMap?: MapConfig) => void
  /** Called after a successful map switch. */
  onMapLoaded?: (config: MapConfig) => void
  /** Called to display a message (e.g., toast/popup). */
  onMessage?: (msg: string) => void
}

export class FreeMapTestMode {
  private active = false
  private currentIndex = 0
  private levelLoader: LevelLoader
  private config: FreeMapTestModeConfig
  private hudElement: HTMLElement | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(deps: LevelLoaderDeps, config: FreeMapTestModeConfig = {}) {
    this.levelLoader = new LevelLoader(deps)
    this.config = config
  }

  /**
   * Check if test mode is currently active.
   */
  isActive(): boolean {
    return this.active
  }

  /**
   * Activate free map test mode.
   */
  activate(): void {
    if (this.active) return
    this.active = true

    this.createHUD()
    this.registerKeyboardShortcuts()
    this.updateHUD()

    this.config.onStatusChange?.(true, this.getCurrentMapConfig())
    this.config.onMessage?.('[TEST MODE] Free Map Test Mode activated — PageUp/PageDown to cycle')
    console.log('[FreeMapTestMode] Activated. Use PageUp/PageDown to cycle maps.')
  }

  /**
   * Deactivate free map test mode.
   */
  deactivate(): void {
    if (!this.active) return
    this.active = false

    this.removeHUD()
    this.unregisterKeyboardShortcuts()

    this.config.onStatusChange?.(false)
    console.log('[FreeMapTestMode] Deactivated.')
  }

  /**
   * Toggle test mode on/off.
   */
  toggle(): void {
    if (this.active) {
      this.deactivate()
    } else {
      this.activate()
    }
  }

  /**
   * Cycle to the next map in the registry.
   */
  cycleNext(): void {
    if (!this.active) return
    const registry = getMapRegistry()
    this.currentIndex = (this.currentIndex + 1) % registry.length
    this.loadCurrentMap()
  }

  /**
   * Cycle to the previous map in the registry.
   */
  cyclePrev(): void {
    if (!this.active) return
    const registry = getMapRegistry()
    this.currentIndex = (this.currentIndex - 1 + registry.length) % registry.length
    this.loadCurrentMap()
  }

  /**
   * Load a specific map by id.
   */
  loadById(mapId: string): boolean {
    const registry = getMapRegistry()
    const idx = registry.findIndex(m => m.id === mapId)
    if (idx === -1) return false

    this.currentIndex = idx
    if (!this.active) this.activate()
    this.loadCurrentMap()
    return true
  }

  /**
   * Get current map config.
   */
  getCurrentMapConfig(): MapConfig | undefined {
    return getMapRegistry()[this.currentIndex]
  }

  /**
   * Get all available maps (for UI listing).
   */
  getAvailableMaps(): MapConfig[] {
    return getMapRegistry()
  }

  /**
   * Update level loader dependencies.
   */
  updateDeps(partial: Partial<LevelLoaderDeps>): void {
    this.levelLoader.updateDeps(partial)
  }

  /**
   * Dispose test mode and cleanup event listeners.
   */
  dispose(): void {
    this.deactivate()
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private loadCurrentMap(): void {
    const config = this.getCurrentMapConfig()
    if (!config) return

    const result = this.levelLoader.loadMap(config.id)
    if (result.success) {
      this.config.onMapLoaded?.(config)
      this.config.onMessage?.(`[TEST MODE] Loaded: ${config.displayName} (${config.layoutType})`)
      console.log(`[FreeMapTestMode] Loaded: ${config.displayName} [${config.layoutType}]`)
    } else {
      this.config.onMessage?.(`[TEST MODE] Failed: ${result.error}`)
      console.warn(`[FreeMapTestMode] Load failed: ${result.error}`)
    }

    this.updateHUD()
  }

  private registerKeyboardShortcuts(): void {
    if (typeof window === 'undefined') return
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.active) return

      if (e.code === 'PageDown') {
        e.preventDefault()
        this.cycleNext()
      } else if (e.code === 'PageUp') {
        e.preventDefault()
        this.cyclePrev()
      }
    }
    window.addEventListener('keydown', this.keyHandler)
  }

  private unregisterKeyboardShortcuts(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler)
      this.keyHandler = null
    }
  }

  private createHUD(): void {
    if (this.hudElement) return
    if (typeof document === 'undefined') return

    this.hudElement = document.createElement('div')
    this.hudElement.id = 'free-map-test-hud'
    this.hudElement.style.cssText = `
      position: fixed;
      top: 8px;
      right: 8px;
      background: rgba(0, 255, 128, 0.15);
      border: 1px solid rgba(0, 255, 128, 0.6);
      color: #00ff80;
      font-family: monospace;
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: none;
      backdrop-filter: blur(4px);
    `
    document.body.appendChild(this.hudElement)
  }

  private removeHUD(): void {
    if (this.hudElement) {
      this.hudElement.remove()
      this.hudElement = null
    }
  }

  private updateHUD(): void {
    if (!this.hudElement) return
    const config = this.getCurrentMapConfig()
    const registry = getMapRegistry()
    const idx = this.currentIndex + 1
    const total = registry.length

    this.hudElement.textContent = config
      ? `TEST MODE | ${config.displayName} [${config.layoutType}] | ${idx}/${total}`
      : `TEST MODE | No maps`
  }
}
