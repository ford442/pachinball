/**
 * The `?debug` checkpoint panel: per-stage ✓ / ✗ / ⏳ rows with timings, stage toggles and a GPU
 * error log. Dev-only, so it is its own chunk (see CheckpointDebugController's constructor).
 */

import { DEBUG_STAGES, type CheckpointDebugController, type DebugStageKey } from './checkpoint-debug'

interface StageElements {
  indicator: HTMLElement
  checkbox: HTMLInputElement
  timing: HTMLElement
}

const PANEL_Z_INDEX = 20000
const TIMING_PRECISION_DECIMALS = 1

export class CheckpointDebugPanel {
  private readonly stageElements = new Map<DebugStageKey, StageElements>()
  private gpuLogEl: HTMLElement | null = null

  constructor(
    private readonly controller: Pick<CheckpointDebugController, 'getStageSnapshot' | 'isStageEnabled' | 'setStageEnabled'>,
    private readonly doc: Document,
    signal?: AbortSignal,
  ) {
    this.createPanel(signal)
    this.listenForGPUErrors(signal)
    signal?.addEventListener('abort', () => {
      this.doc.getElementById('checkpoint-debug-panel')?.remove()
    }, { once: true })
  }

  update(stage: DebugStageKey): void {
    this.updateStageElements(stage)
  }

  private createPanel(signal?: AbortSignal): void {
    const panel = this.doc.createElement('div')
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

    const title = this.doc.createElement('div')
    title.textContent = 'Checkpoint Debug Stages'
    title.style.cssText = 'font-weight:700;margin-bottom:8px;color:#8be3ff'
    panel.appendChild(title)

    const stageKeys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
    for (const stage of stageKeys) {
      const row = this.doc.createElement('div')
      row.style.cssText = 'display:grid;grid-template-columns:14px 18px 1fr auto;gap:6px;align-items:center;margin:4px 0'

      const indicator = this.doc.createElement('span')
      const checkbox = this.doc.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = this.controller.isStageEnabled(stage)
      checkbox.addEventListener('change', () => { void this.controller.setStageEnabled(stage, checkbox.checked) }, { signal })

      const label = this.doc.createElement('span')
      const stageConfig = DEBUG_STAGES[stage]
      const runtime = ('runtimeToggleable' in stageConfig && stageConfig.runtimeToggleable) ? '' : ' (next init)'
      label.textContent = `${DEBUG_STAGES[stage].label}${runtime}`

      const timing = this.doc.createElement('span')
      timing.style.color = '#87d8ff'

      row.appendChild(indicator)
      row.appendChild(checkbox)
      row.appendChild(label)
      row.appendChild(timing)
      panel.appendChild(row)
      this.stageElements.set(stage, { indicator, checkbox, timing })
      this.updateStageElements(stage)
    }

    const legend = this.doc.createElement('div')
    legend.textContent = '✓ success  ✗ failed  ⏳ loading  ⏭ skipped'
    legend.style.cssText = 'margin-top:8px;color:#9db8c7'
    panel.appendChild(legend)

    this.doc.body.appendChild(panel)
  }

  private updateStageElements(stage: DebugStageKey): void {
    const state = this.controller.getStageSnapshot(stage)
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

  private appendGPULog(msg: string): void {
    if (!this.gpuLogEl) {
      const el = this.doc.createElement('div')
      el.style.cssText = [
        'margin-top:8px',
        'max-height:120px',
        'overflow:auto',
        'background:rgba(80,0,0,0.55)',
        'border:1px solid rgba(255,80,80,0.5)',
        'border-radius:4px',
        'padding:4px 6px',
        'font-size:11px',
        'color:#ff9090',
        'word-break:break-all',
      ].join(';')
      const panel = this.doc.getElementById('checkpoint-debug-panel')
      panel?.appendChild(el)
      this.gpuLogEl = el
    }
    const line = this.doc.createElement('div')
    line.textContent = msg
    this.gpuLogEl.appendChild(line)
    this.gpuLogEl.scrollTop = this.gpuLogEl.scrollHeight
  }

  private listenForGPUErrors(signal?: AbortSignal): void {
    if (typeof window === 'undefined') return
    window.addEventListener('error', (e) => {
      const msg = e.message ?? ''
      if (/wgsl|webgpu|shader|GPUValidation/i.test(msg)) {
        this.appendGPULog(`GPU: ${msg.slice(0, 200)}`)
      }
    }, { signal })
    const original = console.error
    const origError = original.bind(console)
    const wrapped = (...args: unknown[]): void => {
      origError(...args)
      const msg = args.map((a) => String(a)).join(' ')
      if (/wgsl|WebGPU|ShaderModule|GPUValidation/i.test(msg)) {
        this.appendGPULog(`GPU: ${msg.slice(0, 200)}`)
      }
    }
    console.error = wrapped
    // Only restore if nothing wrapped us in the meantime; clobbering a later patch would be worse.
    signal?.addEventListener('abort', () => {
      if (console.error === wrapped) console.error = original
    }, { once: true })
  }
}
