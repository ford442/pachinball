/**
 * Context-loss UX.
 *
 * `attachGpuContextLogging()` used to be log-only, which meant a user whose GPU device
 * went away saw a frozen canvas and nothing else. This surfaces loss/restore in the
 * existing `#power-toast` and mirrors the state onto `<html data-gpu-context>` so
 * Playwright has a hook that does not depend on toast copy.
 *
 * What this deliberately does NOT do is call `engine.resize()` on restore.
 * `doNotHandleContextLost` is false, so Babylon owns re-uploading buffers and pipelines;
 * resize() re-uploads nothing and would only look like recovery. We wait for Babylon's
 * restore observable and then say so.
 */

export type GpuContextState = 'ok' | 'lost'

/** Attribute on `<html>`; Playwright asserts on this rather than on toast copy. */
export const GPU_CONTEXT_ATTRIBUTE = 'data-gpu-context'

export const GPU_CONTEXT_TOAST_ID = 'power-toast'

export const GPU_CONTEXT_LOST_MESSAGE = 'Graphics context lost — restoring…'
export const GPU_CONTEXT_RESTORED_MESSAGE = 'Graphics restored'

/** How long the "restored" toast stays up before hiding itself. */
export const RESTORED_TOAST_MS = 2600
/** Photosensitive mode holds it longer so the text is readable without a quick flash. */
export const RESTORED_TOAST_MS_PHOTOSENSITIVE = 5000

export interface GpuContextToastDeps {
  /** Injected in tests; defaults to the ambient document. */
  doc?: Document
  /** Defaults to the persisted accessibility setting. */
  isPhotosensitive?: () => boolean
  setTimeoutFn?: (handler: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

/**
 * Read photosensitive mode without importing the game config into the bootstrap layer.
 * Engine creation runs before `Game`, so `GameConfig` may not be populated yet; the
 * persisted settings blob is the earliest reliable source.
 */
function defaultIsPhotosensitive(): boolean {
  try {
    const raw = localStorage.getItem('pachinball.settings')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { photosensitiveMode?: unknown }
    return parsed?.photosensitiveMode === true
  } catch {
    return false
  }
}

export class GpuContextToast {
  private readonly doc: Document | undefined
  private readonly isPhotosensitive: () => boolean
  private readonly setTimeoutFn: (handler: () => void, ms: number) => unknown
  private readonly clearTimeoutFn: (handle: unknown) => void

  private state: GpuContextState = 'ok'
  private hideHandle: unknown = null

  constructor(deps: GpuContextToastDeps = {}) {
    this.doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined)
    this.isPhotosensitive = deps.isPhotosensitive ?? defaultIsPhotosensitive
    this.setTimeoutFn =
      deps.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms) as unknown)
    this.clearTimeoutFn =
      deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  getState(): GpuContextState {
    return this.state
  }

  /** Publish the initial `data-gpu-context="ok"` without showing a toast. */
  markReady(): void {
    this.writeAttribute('ok')
    this.state = 'ok'
  }

  onLost(): void {
    if (this.state === 'lost') return
    this.state = 'lost'
    this.writeAttribute('lost')
    // No auto-hide: the context is still gone, so the message stays until restore.
    this.showToast(GPU_CONTEXT_LOST_MESSAGE, null)
  }

  onRestored(): void {
    if (this.state === 'ok') return
    this.state = 'ok'
    this.writeAttribute('ok')
    this.showToast(
      GPU_CONTEXT_RESTORED_MESSAGE,
      this.isPhotosensitive() ? RESTORED_TOAST_MS_PHOTOSENSITIVE : RESTORED_TOAST_MS,
    )
  }

  /** Hide the toast and drop any pending timer. Called when the engine is disposed. */
  dispose(): void {
    this.cancelHide()
    this.hideToast()
  }

  private writeAttribute(state: GpuContextState): void {
    this.doc?.documentElement?.setAttribute(GPU_CONTEXT_ATTRIBUTE, state)
  }

  private toastElement(): HTMLElement | null {
    return this.doc?.getElementById(GPU_CONTEXT_TOAST_ID) ?? null
  }

  private showToast(message: string, autoHideMs: number | null): void {
    this.cancelHide()
    const el = this.toastElement()
    if (!el) return

    el.textContent = message
    // The .toast class fades opacity and slides on show. Under photosensitive mode a
    // flapping context would turn that into a repeating flash, so drop the transition
    // and let the toast appear and disappear flat.
    el.style.transition = this.isPhotosensitive() ? 'none' : ''
    el.classList.remove('hidden')
    el.classList.add('show')

    if (autoHideMs !== null) {
      this.hideHandle = this.setTimeoutFn(() => {
        this.hideHandle = null
        this.hideToast()
      }, autoHideMs)
    }
  }

  private hideToast(): void {
    const el = this.toastElement()
    if (!el) return
    el.classList.remove('show')
    el.classList.add('hidden')
  }

  private cancelHide(): void {
    if (this.hideHandle !== null) {
      this.clearTimeoutFn(this.hideHandle)
      this.hideHandle = null
    }
  }
}
