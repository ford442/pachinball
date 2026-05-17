type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type DebugStageStatus = 'idle' | 'loading' | 'success' | 'failed' | 'skipped'

interface DebugStageConfig {
  label: string
  defaultEnabled: boolean
  runtimeToggleable?: boolean
}

export const DEBUG_STAGES = {
  settings_ui: { label: 'Settings + UI bootstrap', defaultEnabled: true },
  render_bootstrap: { label: 'Rendering bootstrap', defaultEnabled: true },
  core_helpers: { label: 'Core helper managers', defaultEnabled: true },
  state_setup: { label: 'Game state + event bus', defaultEnabled: true },
  physics: { label: 'Physics world init', defaultEnabled: true },
  scene_rendering: { label: 'Scene rendering systems', defaultEnabled: true },
  scene_gameplay: { label: 'Gameplay objects + logic', defaultEnabled: true },
  scene_optional: { label: 'Optional toys + adventure extras', defaultEnabled: true },
  scene_lcd_post: { label: 'LCD table post-process', defaultEnabled: true, runtimeToggleable: true },
  scene_critical: { label: 'Critical scene geometry', defaultEnabled: true },
  scene_gameplay_build: { label: 'Gameplay scene build', defaultEnabled: true },
  scene_cosmetic: { label: 'Cosmetic scene build', defaultEnabled: true, runtimeToggleable: true },
  input_runtime: { label: 'Input + runtime loop', defaultEnabled: true },
  managers_postinit: { label: 'Post-init managers (maps/cabinet/adventure)', defaultEnabled: true },
} as const satisfies Record<string, DebugStageConfig>

export type DebugStageKey = keyof typeof DEBUG_STAGES

interface StageState {
  enabled: boolean
  status: DebugStageStatus
  durationMs: number | null
  error: string | null
}

interface StageElements {
  indicator: HTMLElement
  checkbox: HTMLInputElement
  timing: HTMLElement
}

type StageToggleHandler = (enabled: boolean) => void | Promise<void>

interface CheckpointDebugControllerOptions {
  search?: string
  storage?: StorageLike | null
  documentRef?: Document | null
  locationRef?: Pick<Location, 'pathname' | 'hash'> | null
  historyRef?: Pick<History, 'replaceState'> | null
}

const STORAGE_KEY = 'pachinball.debugStages'
const URL_STAGE_KEY = 'debugStages'
const PANEL_Z_INDEX = 20000
const TIMING_PRECISION_DECIMALS = 1

export class CheckpointDebugController {
  private readonly stageState = new Map<DebugStageKey, StageState>()
  private readonly stageElements = new Map<DebugStageKey, StageElements>()
  private readonly toggleHandlers = new Map<DebugStageKey, StageToggleHandler>()
  private readonly debugEnabled: boolean
  private readonly storage: StorageLike | null
  private readonly documentRef: Document | null
  private readonly locationRef: Pick<Location, 'pathname' | 'hash'> | null
  private readonly historyRef: Pick<History, 'replaceState'> | null
  private readonly searchParams: URLSearchParams

  constructor(options: CheckpointDebugControllerOptions = {}) {
    const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '')
    this.searchParams = new URLSearchParams(search)
    this.debugEnabled = this.searchParams.get('debug') === '1' || this.searchParams.has('debug')
    this.storage = options.storage ?? this.getDefaultStorage()
    this.documentRef = options.documentRef ?? (typeof document !== 'undefined' ? document : null)
    this.locationRef = options.locationRef ?? (typeof window !== 'undefined' ? window.location : null)
    this.historyRef = options.historyRef ?? (typeof window !== 'undefined' ? window.history : null)

    const initialEnabled = this.loadEnabledStages()
    const stageKeys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
    for (const stage of stageKeys) {
      this.stageState.set(stage, {
        enabled: initialEnabled.get(stage) ?? DEBUG_STAGES[stage].defaultEnabled,
        status: 'idle',
        durationMs: null,
        error: null,
      })
    }

    if (this.debugEnabled) {
      this.createPanel()
    }
  }

  isEnabled(): boolean {
    return this.debugEnabled
  }

  isStageEnabled(stage: DebugStageKey): boolean {
    return this.stageState.get(stage)?.enabled ?? DEBUG_STAGES[stage].defaultEnabled
  }

  registerToggleHandler(stage: DebugStageKey, handler: StageToggleHandler): void {
    this.toggleHandlers.set(stage, handler)
  }

  getStageSnapshot(stage: DebugStageKey): StageState {
    const state = this.stageState.get(stage)
    if (state) return { ...state }
    return {
      enabled: DEBUG_STAGES[stage].defaultEnabled,
      status: 'idle',
      durationMs: null,
      error: null,
    }
  }

  async setStageEnabled(stage: DebugStageKey, enabled: boolean): Promise<void> {
    const state = this.stageState.get(stage)
    if (!state) return
    state.enabled = enabled
    this.persistEnabledStages()
    this.updateStageElements(stage)

    const handler = this.toggleHandlers.get(stage)
    if (handler) {
      try {
        await handler(enabled)
      } catch (error) {
        this.markStageFailure(stage, error)
      }
    }
  }

  markStageSkipped(stage: DebugStageKey, reason = 'disabled'): void {
    const state = this.stageState.get(stage)
    if (!state) return
    state.status = 'skipped'
    state.durationMs = null
    state.error = reason
    this.updateStageElements(stage)
    console.log(`[StageDebug] ${stage} ⏭ skipped (${reason})`)
  }

  async runStage(stage: DebugStageKey, init: () => void | Promise<void>): Promise<void> {
    const state = this.stageState.get(stage)
    if (!state) return
    state.status = 'loading'
    state.durationMs = null
    state.error = null
    this.updateStageElements(stage)

    const start = performance.now()
    console.log(`[StageDebug] ${stage} ⏳ start`)
    try {
      await init()
      state.status = 'success'
      state.durationMs = performance.now() - start
      this.updateStageElements(stage)
      console.log(`[StageDebug] ${stage} ✓ ${state.durationMs.toFixed(TIMING_PRECISION_DECIMALS)}ms`)
    } catch (error) {
      this.markStageFailure(stage, error, performance.now() - start)
      throw error
    }
  }

  private markStageFailure(stage: DebugStageKey, error: unknown, durationMs?: number): void {
    const state = this.stageState.get(stage)
    if (!state) return
    state.status = 'failed'
    state.durationMs = durationMs ?? state.durationMs
    state.error = error instanceof Error ? error.message : String(error)
    this.updateStageElements(stage)
    console.error(`[StageDebug] ${stage} ✗ failed`, error)
  }

  private createPanel(): void {
    if (!this.documentRef) return
    const panel = this.documentRef.createElement('div')
    panel.id = 'checkpoint-debug-panel'
    panel.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'width:340px',
      'max-height:80vh',
      'overflow:auto',
      `z-index:${PANEL_Z_INDEX}`,
      'padding:10px',
      'background:rgba(4,8,16,0.92)',
      'border:1px solid rgba(80,220,255,0.6)',
      'border-radius:8px',
      'font:12px/1.25 monospace',
      'color:#d7f2ff',
      'box-shadow:0 4px 16px rgba(0,0,0,0.45)',
    ].join(';')

    const title = this.documentRef.createElement('div')
    title.textContent = 'Checkpoint Debug Stages'
    title.style.cssText = 'font-weight:700;margin-bottom:8px;color:#8be3ff'
    panel.appendChild(title)

    const stageKeys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
    for (const stage of stageKeys) {
      const row = this.documentRef.createElement('div')
      row.style.cssText = 'display:grid;grid-template-columns:14px 18px 1fr auto;gap:6px;align-items:center;margin:4px 0'

      const indicator = this.documentRef.createElement('span')
      const checkbox = this.documentRef.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = this.isStageEnabled(stage)
      checkbox.addEventListener('change', () => { void this.setStageEnabled(stage, checkbox.checked) })

      const label = this.documentRef.createElement('span')
      const stageConfig = DEBUG_STAGES[stage]
      const runtime = ('runtimeToggleable' in stageConfig && stageConfig.runtimeToggleable) ? '' : ' (next init)'
      label.textContent = `${DEBUG_STAGES[stage].label}${runtime}`

      const timing = this.documentRef.createElement('span')
      timing.style.color = '#87d8ff'

      row.appendChild(indicator)
      row.appendChild(checkbox)
      row.appendChild(label)
      row.appendChild(timing)
      panel.appendChild(row)
      this.stageElements.set(stage, { indicator, checkbox, timing })
      this.updateStageElements(stage)
    }

    const legend = this.documentRef.createElement('div')
    legend.textContent = '✓ success  ✗ failed  ⏳ loading  ⏭ skipped'
    legend.style.cssText = 'margin-top:8px;color:#9db8c7'
    panel.appendChild(legend)

    this.documentRef.body.appendChild(panel)
  }

  private updateStageElements(stage: DebugStageKey): void {
    const state = this.stageState.get(stage)
    const elements = this.stageElements.get(stage)
    if (!state || !elements) return

    elements.checkbox.checked = state.enabled
    switch (state.status) {
      case 'success':
        elements.indicator.textContent = '✓'
        elements.indicator.style.color = '#43d66f'
        break
      case 'failed':
        elements.indicator.textContent = '✗'
        elements.indicator.style.color = '#ff5a5a'
        break
      case 'loading':
        elements.indicator.textContent = '⏳'
        elements.indicator.style.color = '#ffd35a'
        break
      case 'skipped':
        elements.indicator.textContent = '⏭'
        elements.indicator.style.color = '#9fa8b0'
        break
      default:
        elements.indicator.textContent = '·'
        elements.indicator.style.color = '#7f8f99'
        break
    }

    if (state.status === 'failed' && state.error) {
      elements.timing.textContent = state.error
      elements.timing.style.color = '#ff8c8c'
      return
    }
    elements.timing.textContent = state.durationMs === null ? '' : `${state.durationMs.toFixed(TIMING_PRECISION_DECIMALS)}ms`
    elements.timing.style.color = '#87d8ff'
  }

  private loadEnabledStages(): Map<DebugStageKey, boolean> {
    const fromUrl = this.parseStageList(this.searchParams.get(URL_STAGE_KEY))
    if (fromUrl.size > 0) return fromUrl
    const fromStorage = this.parseStageList(this.safeGetStorageItem(STORAGE_KEY))
    return fromStorage
  }

  private parseStageList(raw: string | null): Map<DebugStageKey, boolean> {
    const enabled = new Set((raw ?? '').split(',').map((v) => v.trim()).filter(Boolean))
    const stageKeys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
    const parsed = new Map<DebugStageKey, boolean>()
    if (enabled.size === 0) return parsed
    for (const stage of stageKeys) {
      parsed.set(stage, enabled.has(stage))
    }
    return parsed
  }

  private persistEnabledStages(): void {
    const stageKeys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
    const enabled = stageKeys.filter((stage) => this.isStageEnabled(stage))
    const serialized = enabled.join(',')
    try {
      this.storage?.setItem(STORAGE_KEY, serialized)
    } catch {
      // ignore storage write errors
    }
    if (!this.debugEnabled || !this.historyRef || !this.locationRef) return
    try {
      const params = new URLSearchParams(this.searchParams)
      params.set(URL_STAGE_KEY, serialized)
      const nextUrl = `${this.locationRef.pathname}?${params.toString()}${this.locationRef.hash || ''}`
      this.historyRef.replaceState(null, '', nextUrl)
    } catch {
      // ignore URL update errors
    }
  }

  private safeGetStorageItem(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  private getDefaultStorage(): StorageLike | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null
    } catch {
      return null
    }
  }
}
