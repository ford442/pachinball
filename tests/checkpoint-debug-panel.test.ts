/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CheckpointDebugController, DEBUG_STAGES } from '../src/game/checkpoint-debug'
import { CheckpointDebugPanel } from '../src/game/checkpoint-debug-panel'

const noStorage = { getItem: () => null, setItem: () => undefined }

function makeController(search = '', signal?: AbortSignal) {
  return new CheckpointDebugController({
    search,
    storage: noStorage,
    documentRef: document,
    historyRef: null,
    locationRef: null,
    signal,
  })
}

const panelEl = () => document.getElementById('checkpoint-debug-panel')

describe('CheckpointDebugPanel (lazy ?debug UI)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders one row per stage and reflects state that predates the mount', async () => {
    const controller = makeController()
    await controller.runStage('physics', () => undefined)

    new CheckpointDebugPanel(controller, document)

    const rows = [...(panelEl()?.children ?? [])].filter((el) => el.querySelector('input'))
    expect(rows).toHaveLength(Object.keys(DEBUG_STAGES).length)
    const physicsRow = rows[Object.keys(DEBUG_STAGES).indexOf('physics')]
    expect(physicsRow?.children[0]?.textContent).toBe('✓')
    expect(physicsRow?.children[3]?.textContent).toMatch(/ms$/)
  })

  it('shows a failure and its message once the controller reports it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = makeController('?debug=1')
    await vi.waitFor(() => expect(panelEl()).not.toBeNull())

    await expect(
      controller.runStage('physics', () => {
        throw new Error('wasm 404')
      }),
    ).rejects.toThrow('wasm 404')

    const row = [...(panelEl()?.children ?? [])].filter((el) => el.querySelector('input'))[
      Object.keys(DEBUG_STAGES).indexOf('physics')
    ]
    expect(row?.children[0]?.textContent).toBe('✗')
    expect(row?.children[3]?.textContent).toBe('wasm 404')
  })

  it('is mounted lazily by the controller when ?debug is on (and not otherwise)', async () => {
    makeController('')
    await Promise.resolve()
    expect(panelEl()).toBeNull()

    const controller = makeController('?debug=1')
    expect(panelEl()).toBeNull() // its chunk has not resolved yet
    await vi.waitFor(() => expect(panelEl()).not.toBeNull())

    // Stage changes after the mount repaint the live panel.
    await controller.runStage('settings_ui', () => undefined)
    const first = [...(panelEl()?.children ?? [])].find((el) => el.querySelector('input'))
    expect(first?.children[0]?.textContent).toBe('✓')
  })

  it('never mounts if the owner was disposed before the chunk resolved', async () => {
    const abort = new AbortController()
    makeController('?debug=1', abort.signal)
    abort.abort()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(panelEl()).toBeNull()
  })

  it('removes itself and restores console.error on abort', () => {
    const abort = new AbortController()
    const before = console.error
    new CheckpointDebugPanel(makeController(), document, abort.signal)
    expect(panelEl()).not.toBeNull()
    expect(console.error).not.toBe(before)

    abort.abort()

    expect(panelEl()).toBeNull()
    expect(console.error).toBe(before)
  })

  it('logs GPU-looking console errors into the panel and still forwards them', () => {
    const forwarded = vi.spyOn(console, 'error').mockImplementation(() => {})
    const abort = new AbortController()
    new CheckpointDebugPanel(makeController(), document, abort.signal)

    console.error('WebGPU ShaderModule compile failed')

    expect(panelEl()?.textContent).toContain('GPU: WebGPU ShaderModule compile failed')
    expect(forwarded).toHaveBeenCalledWith('WebGPU ShaderModule compile failed')
    abort.abort()
  })
})
