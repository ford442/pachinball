/**
 * @vitest-environment happy-dom
 *
 * Prompt-mode service worker updates (#464 item 8): a waiting worker shows the
 * update toast instead of reloading the page on its own, accepting asks the
 * worker to take over exactly once, and nothing here reloads the page itself
 * (vite-plugin-pwa reloads once, when the new worker takes control).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RegisterOptions = {
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
}

const updateSW = vi.fn((_reloadPage?: boolean) => Promise.resolve())
let registered: RegisterOptions = {}

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: RegisterOptions) => {
    registered = options
    return updateSW
  },
}))
vi.mock('../src/pwa/storage-quota', () => ({ warnIfBackboxCacheMayFillQuota: () => Promise.resolve() }))

async function boot() {
  const sw = await import('../src/pwa/register-sw')
  const toast = await import('../src/pwa/update-toast')
  sw.registerServiceWorker()
  return { sw, toast }
}

/** The toast module is a dynamic import: let it settle. */
async function waitForToast(id: string): Promise<HTMLElement> {
  await vi.waitFor(() => {
    if (!document.getElementById(id)) throw new Error('toast not shown yet')
  })
  return document.getElementById(id)!
}

function buttons(root: HTMLElement): { accept: HTMLButtonElement; later: HTMLButtonElement } {
  const [accept, later] = [...root.querySelectorAll('button')]
  return { accept: accept!, later: later! }
}

describe('service worker update prompt', () => {
  beforeEach(() => {
    vi.resetModules()
    updateSW.mockClear()
    registered = {}
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('a waiting worker shows the toast; nothing updates until the player accepts', async () => {
    const { toast } = await boot()
    registered.onNeedRefresh?.()
    const root = await waitForToast(toast.UPDATE_TOAST_ID)
    expect(root.textContent).toContain('Update ready')
    expect(updateSW).not.toHaveBeenCalled()
    // Mounted without stealing focus from the game.
    expect(root.contains(document.activeElement)).toBe(false)
  })

  it('accept asks the waiting worker to take over once, and never reloads by itself', async () => {
    const reload = vi.fn()
    const location = window.location
    Object.defineProperty(window, 'location', { value: { ...location, reload }, configurable: true })
    try {
      const { sw, toast } = await boot()
      registered.onNeedRefresh?.()
      const { accept } = buttons(await waitForToast(toast.UPDATE_TOAST_ID))
      accept.click()
      accept.click()
      await sw.applyServiceWorkerUpdate()
      await Promise.resolve()
      expect(updateSW).toHaveBeenCalledTimes(1)
      expect(updateSW).toHaveBeenCalledWith(true)
      expect(reload).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { value: location, configurable: true })
    }
  })

  it('later dismisses without updating, and a repeat waiting event does not stack toasts', async () => {
    const { toast } = await boot()
    registered.onNeedRefresh?.()
    const { later } = buttons(await waitForToast(toast.UPDATE_TOAST_ID))
    later.click()
    expect(document.getElementById(toast.UPDATE_TOAST_ID)).toBeNull()
    registered.onNeedRefresh?.()
    await Promise.resolve()
    expect(document.querySelectorAll(`#${toast.UPDATE_TOAST_ID}`)).toHaveLength(0)
    expect(updateSW).not.toHaveBeenCalled()
  })

  it('a second toast replaces the first', async () => {
    const { toast } = await boot()
    toast.showUpdateToast({ onAccept: vi.fn() })
    toast.showUpdateToast({ onAccept: vi.fn() })
    expect(document.querySelectorAll(`#${toast.UPDATE_TOAST_ID}`)).toHaveLength(1)
  })
})
