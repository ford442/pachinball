/**
 * Floating physics tuning panel — live sliders for core-loop feel.
 * Visible when ?tune=1 or Developer → Enable Physics Tuning.
 */

import {
  PHYSICS_TUNING_SLIDERS,
  getPhysicsTuningValue,
  resetPhysicsTuningOverrides,
  setPhysicsTuningOverride,
  type PhysicsTuningKey,
  type PhysicsTuningSliderDef,
} from './physics-tuning'

export class PhysicsTuningPanel {
  private container: HTMLElement | null = null
  private isVisible = false

  constructor() {
    if (typeof document === 'undefined') return
    this.container = this.buildPanel()
    document.body.appendChild(this.container)
  }

  private buildPanel(): HTMLElement {
    const el = document.createElement('div')
    el.id = 'physics-tuning-panel'
    el.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 12px;
      width: 280px;
      max-height: 70vh;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #ffaa00;
      border-radius: 6px;
      padding: 10px 12px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #ffdd88;
      z-index: 10000;
      display: none;
      pointer-events: auto;
    `

    const header = document.createElement('div')
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'
    header.innerHTML = '<strong>Physics Tuning</strong>'
    const resetBtn = document.createElement('button')
    resetBtn.textContent = 'Reset'
    resetBtn.style.cssText = 'background:#331100;color:#ffcc66;border:1px solid #664400;border-radius:3px;cursor:pointer;font-size:10px;padding:2px 6px;'
    resetBtn.addEventListener('click', () => {
      resetPhysicsTuningOverrides()
      this.syncSlidersFromValues()
    })
    header.appendChild(resetBtn)
    el.appendChild(header)

    const groups: Record<string, PhysicsTuningSliderDef[]> = {
      ball: [],
      flipper: [],
      launch: [],
      obstacles: [],
    }
    for (const def of PHYSICS_TUNING_SLIDERS) {
      groups[def.group].push(def)
    }

    const groupLabels: Record<string, string> = {
      ball: 'Ball',
      flipper: 'Flippers',
      launch: 'Launch / Nudge',
      obstacles: 'Bumpers / Toys',
    }

    for (const [group, defs] of Object.entries(groups)) {
      if (defs.length === 0) continue
      const title = document.createElement('div')
      title.textContent = groupLabels[group] ?? group
      title.style.cssText = 'color:#00d9ff;margin:8px 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;'
      el.appendChild(title)

      for (const def of defs) {
        el.appendChild(this.createSliderRow(def))
      }
    }

    return el
  }

  private createSliderRow(def: PhysicsTuningSliderDef): HTMLElement {
    const row = document.createElement('label')
    row.style.cssText = 'display:block;margin-bottom:6px;'
    row.dataset.tuningKey = def.key

    const labelRow = document.createElement('div')
    labelRow.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:2px;'
    const name = document.createElement('span')
    name.textContent = def.label
    const valueSpan = document.createElement('span')
    valueSpan.dataset.valueFor = def.key
    valueSpan.textContent = String(getPhysicsTuningValue(def.key))
    labelRow.appendChild(name)
    labelRow.appendChild(valueSpan)
    row.appendChild(labelRow)

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(def.min)
    input.max = String(def.max)
    input.step = String(def.step)
    input.value = String(getPhysicsTuningValue(def.key))
    input.style.width = '100%'
    input.addEventListener('input', () => {
      const val = parseFloat(input.value)
      setPhysicsTuningOverride(def.key, val)
      valueSpan.textContent = formatTuningValue(def.key, val)
    })
    row.appendChild(input)
    return row
  }

  private syncSlidersFromValues(): void {
    if (!this.container) return
    for (const def of PHYSICS_TUNING_SLIDERS) {
      const input = this.container.querySelector(`label[data-tuning-key="${def.key}"] input`) as HTMLInputElement | null
      const valueSpan = this.container.querySelector(`span[data-value-for="${def.key}"]`)
      const val = getPhysicsTuningValue(def.key)
      if (input) input.value = String(val)
      if (valueSpan) valueSpan.textContent = formatTuningValue(def.key, val)
    }
  }

  show(): void {
    if (!this.container) return
    this.isVisible = true
    this.container.style.display = 'block'
    this.syncSlidersFromValues()
  }

  hide(): void {
    if (!this.container) return
    this.isVisible = false
    this.container.style.display = 'none'
  }

  toggle(): void {
    if (this.isVisible) this.hide()
    else this.show()
  }

  isPanelVisible(): boolean {
    return this.isVisible
  }

  dispose(): void {
    this.container?.remove()
    this.container = null
  }
}

function formatTuningValue(key: PhysicsTuningKey, value: number): string {
  if (key === 'flipperStiffness') return value.toFixed(0)
  if (key === 'flipperDamping') return value.toFixed(0)
  return value.toFixed(2)
}

export function isPhysicsTuningQueryEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('tune')
}
