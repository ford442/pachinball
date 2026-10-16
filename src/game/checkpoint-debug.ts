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

type StageToggleHandler = (enabled: boolean) => void | Promise<void>

interface CheckpointDebugControllerOptions {
  search?: string
  storage?: StorageLike | null
  documentRef?: Document | null
  locationRef?: Pick<Location, 'pathname' | 'hash'> | null
  historyRef?: Pick<History, 'replaceState'> | null
  /** Aborting removes the panel and every listener/console hook this controller installed. */
  signal?: AbortSignal
}

const STORAGE_KEY = 'pachinball.debugStages'
const URL_STAGE_KEY = 'debugStages'
const TIMING_PRECISION_DECIMALS = 1

export class CheckpointDebugController {
  private readonly stageState = new Map<DebugStageKey, StageState>()
  /** Mounted lazily (`?debug` only); null until its chunk has loaded. */
  private panel: { update(stage: DebugStageKey): void } | null = null
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

    if (this.debugEnabled && this.documentRef) {
      const { signal } = options
      const doc = this.documentRef
      // Dev-only UI: its own chunk keeps it out of the entry chunk (size budget).
      void import('./checkpoint-debug-panel').then(({ CheckpointDebugPanel }) => {
        if (signal?.aborted) return
        this.panel = new CheckpointDebugPanel(this, doc, signal)
      })
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

  private updateStageElements(stage: DebugStageKey): void {
    this.panel?.update(stage)
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
