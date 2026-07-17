/**
 * Idle warm-load for the optional C++ physics WASM bundle.
 * Overlaps fetch/compile with menu idle time so A/B toggling avoids a hitch.
 */

import type { WasmPhysicsModule } from '../wasm/wasm-types'
import { WASM_PHYSICS } from '../config'

let preloadPromise: Promise<WasmPhysicsModule | null> | null = null
let preloadStarted = false

async function fetchAndCompileModule(bundleUrl: string): Promise<WasmPhysicsModule | null> {
  try {
    const head = await fetch(bundleUrl, { method: 'HEAD' })
    if (!head.ok) return null

    const { default: factory } = (await import(/* @vite-ignore */ bundleUrl)) as {
      default: () => Promise<WasmPhysicsModule>
    }
    return await factory()
  } catch {
    return null
  }
}

/** Start idle preload if not already started. Safe to call multiple times. */
export function scheduleIdleWasmPreload(bundleUrl = WASM_PHYSICS.bundleUrl): void {
  if (preloadStarted) return
  preloadStarted = true

  const run = () => {
    preloadPromise = fetchAndCompileModule(bundleUrl)
    void preloadPromise.then((mod) => {
      if (mod) {
        console.log('[Bootstrap] C++ WASM physics module warm-loaded')
      }
    })
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 8000 })
  } else {
    setTimeout(run, 2000)
  }
}

/** Await the idle preload result, or null if not started / unavailable. */
export async function getPreloadedWasmModule(): Promise<WasmPhysicsModule | null> {
  if (!preloadPromise) return null
  return preloadPromise
}

/** @internal Reset module state for unit tests. */
export function resetWasmPreloadForTests(): void {
  preloadPromise = null
  preloadStarted = false
}
