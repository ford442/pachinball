/**
 * Service worker registration and update lifecycle for cabinet / PWA installs.
 */

import { registerSW } from 'virtual:pwa-register'
import { warnIfBackboxCacheMayFillQuota } from './storage-quota'

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined

/**
 * Register the Workbox service worker. Safe to call once at bootstrap.
 * Skipped during Vite HMR dev unless devOptions.enabled is true.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    console.info('[PWA] Service workers not supported in this browser')
    return
  }

  updateSW = registerSW({
    immediate: true,
    onRegistered(registration) {
      console.info('[PWA] Service worker registered', registration?.scope)
      void warnIfBackboxCacheMayFillQuota()
    },
    onRegisterError(error) {
      console.warn('[PWA] Service worker registration failed', error)
    },
    onOfflineReady() {
      console.info('[PWA] App shell cached — Nexus Cascade is ready for offline play')
    },
    onNeedRefresh() {
      console.info('[PWA] Update available — reload to apply')
    },
  })
}

/** Apply a waiting service worker update (e.g. from a future settings toggle). */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (updateSW) {
    await updateSW(true)
  }
}
