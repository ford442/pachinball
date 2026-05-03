/**
 * Game Settings UI — Settings panel, latency overlay, map/cabinet/level selectors.
 */

import type { Scene } from '@babylonjs/core'
import type { SoundSystem } from '../game-elements/sound-system'
import type { DebugHUD } from '../game-elements/debug-hud'
import type { MapSystem } from '../game-elements/map-system'
import type { TableMapManager } from './game-maps'
import { SettingsManager } from '../game-elements'
import { TABLE_MAPS, registerMap } from '../shaders/lcd-table'

export interface SettingsUIHost {
  readonly mapSystem: MapSystem
  readonly mapManager: TableMapManager | null
  readonly soundSystem: SoundSystem
  readonly debugHUD: DebugHUD | null
  readonly scene: Scene | null

  scanlineIntensity: number
  debugHUDEnabledInSettings: boolean
  showDebugUI: boolean

  isDebugHUDAvailable(): boolean
  switchTableMap(mapName: string): void
  loadCabinetPreset(type: import('./game-cabinet').CabinetType): void
  toggleLevelSelect(): void
}

export class GameSettingsUI {
  private readonly host: SettingsUIHost
  private inputLatencyOverlay: HTMLElement | null = null

  constructor(host: SettingsUIHost) {
    this.host = host
  }

  setupSettingsUI(): void {
    const settingsBtn = document.getElementById('settings-btn')
    const settingsOverlay = document.getElementById('settings-overlay')
    const closeBtn = document.getElementById('close-settings')
    const saveBtn = document.getElementById('save-settings')

    settingsBtn?.addEventListener('click', () => {
      this.host.isDebugHUDAvailable()
      settingsOverlay?.classList.remove('hidden')
      this.loadSettingsIntoUI()
    })

    closeBtn?.addEventListener('click', () => {
      settingsOverlay?.classList.add('hidden')
    })

    saveBtn?.addEventListener('click', () => {
      this.saveSettingsFromUI()
      settingsOverlay?.classList.add('hidden')
    })
  }

  private loadSettingsIntoUI(): void {
    const settings = SettingsManager.load()
    const reducedMotionCheckbox = document.getElementById('reduced-motion') as HTMLInputElement
    const photosensitiveCheckbox = document.getElementById('photosensitive-mode') as HTMLInputElement
    const shakeSlider = document.getElementById('shake-intensity') as HTMLInputElement
    const scanlineSlider = document.getElementById('scanline-intensity') as HTMLInputElement
    const debugHUDCheckbox = document.getElementById('enable-debug-hud') as HTMLInputElement
    const masterVolumeSlider = document.getElementById('master-volume') as HTMLInputElement
    const musicVolumeSlider = document.getElementById('music-volume') as HTMLInputElement
    const sfxVolumeSlider = document.getElementById('sfx-volume') as HTMLInputElement
    const muteCheckbox = document.getElementById('mute-audio') as HTMLInputElement

    if (reducedMotionCheckbox) reducedMotionCheckbox.checked = settings.reducedMotion
    if (photosensitiveCheckbox) photosensitiveCheckbox.checked = settings.photosensitiveMode
    if (shakeSlider) shakeSlider.value = String(settings.shakeIntensity)
    if (scanlineSlider) {
      scanlineSlider.value = String(settings.scanlineIntensity)
      const span = scanlineSlider.parentElement?.querySelector('span')
      if (span) span.setAttribute('data-value', String(settings.scanlineIntensity))
    }
    if (debugHUDCheckbox) debugHUDCheckbox.checked = settings.enableDebugHUD

    this.host.mapManager?.getLCDTableState().setPhotosensitiveMode(settings.photosensitiveMode)

    const volumeSettings = this.host.soundSystem.getVolumeSettings()
    if (masterVolumeSlider) masterVolumeSlider.value = String(volumeSettings.master)
    if (musicVolumeSlider) musicVolumeSlider.value = String(volumeSettings.music)
    if (sfxVolumeSlider) sfxVolumeSlider.value = String(volumeSettings.sfx)
    if (muteCheckbox) muteCheckbox.checked = volumeSettings.muted
  }

  private saveSettingsFromUI(): void {
    const reducedMotionCheckbox = document.getElementById('reduced-motion') as HTMLInputElement
    const photosensitiveCheckbox = document.getElementById('photosensitive-mode') as HTMLInputElement
    const shakeSlider = document.getElementById('shake-intensity') as HTMLInputElement
    const scanlineSlider = document.getElementById('scanline-intensity') as HTMLInputElement
    const debugHUDCheckbox = document.getElementById('enable-debug-hud') as HTMLInputElement
    const masterVolumeSlider = document.getElementById('master-volume') as HTMLInputElement
    const musicVolumeSlider = document.getElementById('music-volume') as HTMLInputElement
    const sfxVolumeSlider = document.getElementById('sfx-volume') as HTMLInputElement
    const muteCheckbox = document.getElementById('mute-audio') as HTMLInputElement

    const newSettings = {
      reducedMotion: reducedMotionCheckbox?.checked ?? false,
      photosensitiveMode: photosensitiveCheckbox?.checked ?? false,
      shakeIntensity: parseFloat(shakeSlider?.value ?? '0.08'),
      scanlineIntensity: parseFloat(scanlineSlider?.value ?? '0.12'),
      enableDebugHUD: debugHUDCheckbox?.checked ?? false,
      enableFog: true,
      enableShadows: true,
    }

    SettingsManager.save(newSettings)
    SettingsManager.applyToConfig(newSettings)
    this.host.debugHUDEnabledInSettings = newSettings.enableDebugHUD
    this.host.scanlineIntensity = newSettings.scanlineIntensity
    console.log('[Accessibility] Settings saved:', newSettings)

    if (this.host.debugHUDEnabledInSettings && this.host.isDebugHUDAvailable()) {
      this.host.debugHUD?.show()
    } else {
      this.host.debugHUD?.hide()
    }

    this.host.mapManager?.getLCDTableState().setPhotosensitiveMode(newSettings.photosensitiveMode)

    if (masterVolumeSlider) {
      this.host.soundSystem.setMasterVolume(parseFloat(masterVolumeSlider.value))
    }
    if (musicVolumeSlider) {
      this.host.soundSystem.setMusicVolume(parseFloat(musicVolumeSlider.value))
    }
    if (sfxVolumeSlider) {
      this.host.soundSystem.setSfxVolume(parseFloat(sfxVolumeSlider.value))
    }
    if (muteCheckbox && muteCheckbox.checked !== this.host.soundSystem.getVolumeSettings().muted) {
      this.host.soundSystem.toggleMute()
    }
  }

  setupLatencyOverlay(): void {
    if (!this.host.showDebugUI) return
    this.inputLatencyOverlay = document.createElement('div')
    this.inputLatencyOverlay.id = 'latency-overlay'
    this.inputLatencyOverlay.style.cssText = `
      position: fixed; top: 10px; left: 10px;
      background: rgba(0, 0, 0, 0.7); color: #00ff00;
      padding: 8px 12px; border-radius: 4px;
      font-family: monospace; font-size: 12px;
      z-index: 1000; pointer-events: none;
      border: 1px solid #00ff00;
    `
    this.inputLatencyOverlay.textContent = 'Input: -- ms'
    document.body.appendChild(this.inputLatencyOverlay)
  }

  updateLatencyDisplay(inputManager?: { getLatencyReport: () => { avg: number; p95: number } | null }): void {
    if (!this.inputLatencyOverlay || !this.host.showDebugUI) return
    const report = inputManager?.getLatencyReport()
    if (report) {
      this.inputLatencyOverlay.textContent =
        `Input: ${report.avg.toFixed(1)}ms (P95: ${report.p95.toFixed(1)}ms)`
      if (report.avg > 20) {
        this.inputLatencyOverlay.style.color = '#ff0000'
        this.inputLatencyOverlay.style.borderColor = '#ff0000'
      } else if (report.avg > 10) {
        this.inputLatencyOverlay.style.color = '#ffff00'
        this.inputLatencyOverlay.style.borderColor = '#ffff00'
      } else {
        this.inputLatencyOverlay.style.color = '#00ff00'
        this.inputLatencyOverlay.style.borderColor = '#00ff00'
      }
    }
  }

  async setupMapSelector(): Promise<void> {
    const selector = document.getElementById('map-selector')
    if (!selector) return

    await Promise.all([
      this.host.mapSystem.fetchAll(),
      this.host.soundSystem.fetchMusicTracks(),
    ])
    for (const map of this.host.mapSystem.getAllMaps()) {
      if (!TABLE_MAPS[map.id]) {
        registerMap(map.id, map)
      }
    }
    this.buildMapSelectorUI(selector)
    this.updateMapSelectorUI()
  }

  private buildMapSelectorUI(selector: HTMLElement): void {
    const existingButtons = selector.querySelectorAll('.map-btn, .map-refresh, .map-add-hint')
    existingButtons.forEach((el) => el.remove())

    const maps = this.host.mapSystem.getAllMaps()
    let buttonIndex = 1

    for (const map of maps) {
      const btn = document.createElement('button')
      btn.className = 'map-btn'
      btn.dataset.map = map.id
      btn.title = map.name
      btn.textContent = String(buttonIndex)
      btn.addEventListener('click', () => {
        if (map.id !== this.host.mapManager?.getCurrentMap()) {
          this.animateMapButtonPress(btn)
          this.host.mapManager?.getLCDTableState().triggerFeedbackEffect()
          this.host.switchTableMap(map.id)
        }
      })
      selector.appendChild(btn)
      buttonIndex++
    }

    const refreshBtn = document.createElement('button')
    refreshBtn.className = 'map-btn map-refresh'
    refreshBtn.title = 'Refresh Content'
    refreshBtn.textContent = '↻'
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning')
      await Promise.all([
        this.host.mapSystem.refresh(),
        this.host.soundSystem.fetchMusicTracks(),
      ])
      for (const map of this.host.mapSystem.getAllMaps()) {
        if (!TABLE_MAPS[map.id]) {
          registerMap(map.id, map)
        }
      }
      this.buildMapSelectorUI(selector)
      this.updateMapSelectorUI()
      refreshBtn.classList.remove('spinning')
    })
    selector.appendChild(refreshBtn)

    const addHint = document.createElement('a')
    addHint.className = 'map-add-hint'
    addHint.href = 'https://storage.noahcohn.com/admin'
    addHint.target = '_blank'
    addHint.title = 'Upload new maps & music in storage_manager'
    addHint.textContent = '+ Add New Map'
    addHint.style.cssText = `
      display: block; margin-top: 6px; font-size: 10px;
      color: var(--map-accent, #00d9ff); text-decoration: none;
      opacity: 0.7; transition: opacity 0.2s; text-align: center;
    `
    addHint.addEventListener('mouseenter', () => { addHint.style.opacity = '1' })
    addHint.addEventListener('mouseleave', () => { addHint.style.opacity = '0.7' })
    selector.appendChild(addHint)

    this.setupCabinetSelector()
    this.setupLevelsSelector()
  }

  private setupCabinetSelector(): void {
    const selector = document.getElementById('cabinet-selector')
    if (!selector) return
    const buttons = selector.querySelectorAll('.cabinet-btn')
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cabinetType = btn.getAttribute('data-cabinet') as import('./game-cabinet').CabinetType
        if (cabinetType) {
          this.host.loadCabinetPreset(cabinetType)
        }
      })
    })
  }

  private setupLevelsSelector(): void {
    const levelsBtn = document.getElementById('levels-btn')
    if (!levelsBtn) return
    levelsBtn.addEventListener('click', () => {
      this.host.toggleLevelSelect()
    })
  }

  private animateMapButtonPress(btn: HTMLElement): void {
    const config = this.host.mapManager?.getMapSystem().getMap(this.host.mapManager?.getCurrentMap() || 'neon-helix') || TABLE_MAPS[this.host.mapManager?.getCurrentMap() || 'neon-helix']
    const accentColor = config ? config.baseColor : '#00d9ff'
    btn.style.transform = 'scale(0.85)'
    btn.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease'
    btn.style.boxShadow = `0 0 20px ${accentColor}, 0 0 40px ${accentColor}, 0 0 60px ${accentColor}, inset 0 0 20px rgba(255, 255, 255, 0.5)`

    setTimeout(() => {
      btn.style.transform = 'scale(1.05)'
      btn.style.boxShadow = `0 0 15px ${accentColor}, 0 0 30px ${accentColor}, inset 0 0 10px rgba(255, 255, 255, 0.3)`
      setTimeout(() => {
        btn.style.transform = ''
        btn.style.boxShadow = ''
        btn.style.transition = ''
      }, 150)
    }, 100)
  }

  updateMapSelectorUI(): void {
    const selector = document.getElementById('map-selector')
    if (!selector) return
    const currentMap = this.host.mapManager?.getCurrentMap() || 'neon-helix'
    const mapConfig = this.host.mapSystem.getMap(currentMap) || TABLE_MAPS[currentMap]
    const accentColor = mapConfig ? mapConfig.baseColor : '#00d9ff'
    selector.style.setProperty('--map-accent', accentColor)

    const buttons = selector.querySelectorAll('.map-btn')
    buttons.forEach((btn) => {
      if (btn.classList.contains('map-refresh')) return
      const mapName = (btn as HTMLElement).dataset.map
      if (mapName === currentMap) {
        btn.classList.add('active')
      } else {
        btn.classList.remove('active')
      }
    })
  }
}
