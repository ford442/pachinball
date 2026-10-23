/**
 * Service worker registration and update lifecycle for cabinet / PWA installs.
 *
 * `registerType: 'prompt'` (vite.config.ts): a new worker installs and waits.
 * Workbox reports it through `onNeedRefresh`, the player accepts the update
 * toast, `updateSW()` tells the waiting worker to skip waiting, and the plugin
 * reloads the page once, when that worker takes control. Nothing here calls
 * `location.reload()` itself: a second reload would race the first.
 */

import { registerSW } from 'virtual:pwa-register'
import { warnIfBackboxCacheMayFillQuota } from './storage-quota'

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined
let updateRequested = false
let promptShown = false

/**
 * Register the Workbox service worker. Safe to call once at bootstrap.
 * The dev server only has one when started with PWA_DEV=1 (vite.config.ts devOptions).
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
      console.info('[PWA] Update available')
      void promptForUpdate()
    },
  })
}

async function promptForUpdate(): Promise<void> {
  if (promptShown) return
  promptShown = true
  try {
    const { showUpdateToast } = await import('./update-toast')
    showUpdateToast({ onAccept: () => { void applyServiceWorkerUpdate() } })
  } catch (error) {
    console.warn('[PWA] Update prompt failed to load', error)
  }
}

/**
 * Activate the waiting service worker; the page reloads when it takes control.
 * One-shot: a double click (or the toast and a settings toggle) asks once.
 */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!updateSW || updateRequested) return
  updateRequested = true
  await updateSW(true)
}
