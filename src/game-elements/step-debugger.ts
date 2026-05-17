/**
 * Step Debugger — activated by the ?debug-steps URL parameter.
 *
 * Shows a fixed overlay panel listing each named initialization step.
 * In debug mode the user clicks "Next Step" to run one step at a time,
 * making it easy to identify which shader / PostProcess registration
 * triggers a WebGPU validation error.
 *
 * In normal mode (no URL param) `run()` executes all steps sequentially
 * with zero overhead.
 *
 * Usage:
 *   const dbg = new StepDebugger()
 *   dbg.step('Skybox', () => { ... })
 *      .step('Display System', async () => { ... })
 *   await dbg.run()
 */

export type StepFn = () => void | Promise<void>

interface StepEntry {
  label: string
  fn: StepFn
}

export class StepDebugger {
  private readonly _enabled: boolean
  private _steps: StepEntry[] = []

  // UI elements
  private _listEl: HTMLElement | null = null
  private _stepEls: HTMLElement[] = []
  private _nextBtn: HTMLButtonElement | null = null
  private _allBtn: HTMLButtonElement | null = null
  private _logEl: HTMLElement | null = null

  // State
  private _resolveNext: (() => void) | null = null
  private _runAll = false

  constructor() {
    this._enabled = new URLSearchParams(window.location.search).has('debug-steps')
    if (this._enabled) {
      this._buildOverlay()
      this._listenForGPUErrors()
    }
  }

  get isEnabled(): boolean { return this._enabled }

  step(label: string, fn: StepFn): this {
    this._steps.push({ label, fn })
    return this
  }

  async run(): Promise<void> {
    if (!this._enabled) {
      for (const s of this._steps) await s.fn()
      return
    }

    this._buildStepList()

    for (let i = 0; i < this._steps.length; i++) {
      this._highlight(i)
      if (!this._runAll) await this._waitForNext()
      try {
        await this._steps[i].fn()
        this._markDone(i, true)
      } catch (err) {
        this._markDone(i, false, String(err))
        this._appendLog(`✗ "${this._steps[i].label}" threw: ${err}`, '#ff5555')
      }
    }

    if (this._nextBtn) { this._nextBtn.disabled = true; this._nextBtn.style.opacity = '0.35' }
    if (this._allBtn)  { this._allBtn.disabled  = true; this._allBtn.style.opacity  = '0.35' }
    this._appendLog('All steps complete.', '#4caf50')
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private _waitForNext(): Promise<void> {
    this._setButtonsWaiting(true)
    return new Promise(resolve => { this._resolveNext = resolve })
  }

  private _advanceOne(): void {
    if (this._resolveNext) {
      const r = this._resolveNext
      this._resolveNext = null
      this._setButtonsWaiting(false)
      r()
    }
  }

  private _setButtonsWaiting(waiting: boolean): void {
    if (this._nextBtn) {
      this._nextBtn.disabled = !waiting
      this._nextBtn.style.opacity = waiting ? '1' : '0.4'
    }
    if (this._allBtn) {
      this._allBtn.disabled = !waiting
      this._allBtn.style.opacity = waiting ? '1' : '0.4'
    }
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  private _buildOverlay(): void {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
      position: 'fixed', top: '10px', right: '10px', width: '300px',
      background: 'rgba(8,8,16,0.95)', border: '1px solid #333',
      borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px',
      color: '#ddd', zIndex: '99999', boxShadow: '0 4px 28px rgba(0,0,0,0.8)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    })

    // Header
    const hdr = document.createElement('div')
    Object.assign(hdr.style, {
      padding: '8px 12px', background: '#0d1117', borderBottom: '1px solid #333',
      color: '#00d9ff', fontWeight: 'bold', letterSpacing: '0.06em',
    })
    hdr.textContent = '🔬 Shader Step Debugger'
    panel.appendChild(hdr)

    // Sub-header hint
    const hint = document.createElement('div')
    Object.assign(hint.style, {
      padding: '4px 12px 6px', fontSize: '10px', color: '#666', borderBottom: '1px solid #222',
    })
    hint.textContent = 'Load one step at a time to isolate GPU errors'
    panel.appendChild(hint)

    // Step list
    const list = document.createElement('div')
    Object.assign(list.style, {
      flex: '1', overflowY: 'auto', padding: '4px 0', maxHeight: '380px',
    })
    panel.appendChild(list)
    this._listEl = list

    // Error / event log
    const log = document.createElement('div')
    Object.assign(log.style, {
      borderTop: '1px solid #2a2a2a', padding: '6px 10px', fontSize: '10px',
      color: '#aaa', maxHeight: '72px', overflowY: 'auto', display: 'none',
    })
    panel.appendChild(log)
    this._logEl = log

    // Button row
    const row = document.createElement('div')
    Object.assign(row.style, {
      display: 'flex', gap: '8px', padding: '8px 10px', borderTop: '1px solid #333',
    })

    const nextBtn = document.createElement('button')
    nextBtn.textContent = '▶ Next Step'
    Object.assign(nextBtn.style, {
      flex: '1', padding: '6px 4px', background: '#00d9ff', color: '#000',
      border: 'none', borderRadius: '4px', cursor: 'pointer',
      fontFamily: 'monospace', fontWeight: 'bold', fontSize: '12px', opacity: '0.35',
    })
    nextBtn.disabled = true
    nextBtn.onclick = () => this._advanceOne()
    row.appendChild(nextBtn)
    this._nextBtn = nextBtn

    const allBtn = document.createElement('button')
    allBtn.textContent = '▶▶ Run All'
    Object.assign(allBtn.style, {
      flex: '1', padding: '6px 4px', background: '#2a2a3a', color: '#ccc',
      border: '1px solid #444', borderRadius: '4px', cursor: 'pointer',
      fontFamily: 'monospace', fontSize: '12px', opacity: '0.35',
    })
    allBtn.disabled = true
    allBtn.onclick = () => {
      this._runAll = true
      this._advanceOne()
    }
    row.appendChild(allBtn)
    this._allBtn = allBtn

    panel.appendChild(row)
    document.body.appendChild(panel)
  }

  private _buildStepList(): void {
    if (!this._listEl) return
    this._listEl.innerHTML = ''
    this._stepEls = []

    // "Already done" auto-step entry
    const auto = this._makeStepEl('Engine + Physics (auto-loaded)', '✓', '#4caf50')
    this._listEl.appendChild(auto)

    for (const s of this._steps) {
      const el = this._makeStepEl(s.label, '○', '#555')
      this._listEl.appendChild(el)
      this._stepEls.push(el)
    }
  }

  private _makeStepEl(label: string, icon: string, color: string): HTMLElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      padding: '5px 12px', color, lineHeight: '1.4',
    })
    const iconEl = document.createElement('span')
    iconEl.textContent = icon
    iconEl.style.flexShrink = '0'
    const labelEl = document.createElement('span')
    labelEl.textContent = label
    el.appendChild(iconEl)
    el.appendChild(labelEl)
    return el
  }

  private _highlight(i: number): void {
    this._stepEls.forEach((el, idx) => {
      if (idx === i) {
        el.style.color = '#ffd700'
        el.style.background = 'rgba(255,215,0,0.07)';
        (el.firstElementChild as HTMLElement).textContent = '▶'
      } else if (idx > i) {
        el.style.color = '#555'
        el.style.background = '';
        (el.firstElementChild as HTMLElement).textContent = '○'
      }
    })
    this._stepEls[i]?.scrollIntoView({ block: 'nearest' })
  }

  private _markDone(i: number, ok: boolean, errMsg?: string): void {
    const el = this._stepEls[i]
    if (!el) return
    el.style.color = ok ? '#4caf50' : '#ff5555'
    el.style.background = ok ? '' : 'rgba(255,85,85,0.06)';
    (el.firstElementChild as HTMLElement).textContent = ok ? '✓' : '✗'
    if (errMsg) el.title = errMsg
  }

  private _appendLog(msg: string, color = '#aaa'): void {
    if (!this._logEl) return
    this._logEl.style.display = 'block'
    const line = document.createElement('div')
    line.style.color = color
    line.textContent = msg
    this._logEl.appendChild(line)
    this._logEl.scrollTop = this._logEl.scrollHeight
  }

  private _listenForGPUErrors(): void {
    window.addEventListener('error', (e) => {
      const msg = e.message ?? ''
      if (/wgsl|webgpu|shader|GPUValidation/i.test(msg)) {
        this._appendLog(`GPU: ${msg.slice(0, 140)}`, '#ff5555')
      }
    })
    // Babylon surfaces GPU errors via console.error — intercept those too
    const origError = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      origError(...args)
      const msg = args.map(a => String(a)).join(' ')
      if (/wgsl|WebGPU|ShaderModule|GPUValidation/i.test(msg)) {
        this._appendLog(`GPU: ${msg.slice(0, 140)}`, '#ff5555')
      }
    }
  }
}
