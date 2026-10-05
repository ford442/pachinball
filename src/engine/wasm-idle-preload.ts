/**
 * Warm-load for the C++ physics WASM bundle: immediately at bootstrap
 * (`preloadWasmPhysicsNow`, in parallel with engine creation), or on idle
 * (`scheduleIdleWasmPreload`) when the bootstrap did not start it.
 *
 * wasm-worker mode warms a Dedicated Worker instead of instantiating the
 * Emscripten module on the main thread (that instance is not transferable).
 */

import type { WasmPhysicsModule } from '../wasm/wasm-types'
import { WASM_PHYSICS, getPhysicsEnginePreference } from '../config/physics'

let preloadPromise: Promise<WasmPhysicsModule | null> | null = null
let preloadStarted = false

/**
 * The worker boot module is loaded on demand: only the `wasm-worker`
 * preference (the cross-origin-isolated default) needs it, and the in-process
 * owner boot should not fetch it.
 */
type WorkerBootModule = typeof import('../wasm/physics-worker-boot')
let workerBootModule: Promise<WorkerBootModule> | null = null

function loadWorkerBootModule(): Promise<WorkerBootModule> {
  workerBootModule ??= import('../wasm/physics-worker-boot')
  return workerBootModule
}

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

function startPreload(bundleUrl: string): void {
  if (getPhysicsEnginePreference() === 'wasm-worker') {
    void loadWorkerBootModule()
      .then(({ warmPhysicsWorker }) => warmPhysicsWorker(bundleUrl).ready)
      .then((ok) => {
        if (ok) {
          console.log('[Bootstrap] C++ WASM physics worker warm-loaded')
        }
      })
      .catch(() => {
        // Worker constructor unavailable (Node / tests)
      })
    return
  }

  preloadPromise = fetchAndCompileModule(bundleUrl)
  void preloadPromise.then((mod) => {
    if (mod) {
      console.log('[Bootstrap] C++ WASM physics module warm-loaded')
    }
  })
}

/** True when the physics preference needs nothing from the C++ bundle. */
function preloadDisabled(): boolean {
  return !WASM_PHYSICS.enabled || getPhysicsEnginePreference() === 'rapier'
}

/**
 * Fetch and compile the C++ bundle now. The bootstrap calls this in parallel
 * with engine creation (#412) — the production physics path — so
 * `PhysicsSystem.init()` finds the module ready instead of fetching it itself.
 * Safe to call multiple times; a no-op once any preload has started.
 */
export function preloadWasmPhysicsNow(bundleUrl = WASM_PHYSICS.bundleUrl): void {
  if (preloadStarted) return
  preloadStarted = true
  if (preloadDisabled()) return
  startPreload(bundleUrl)
}

/** Start idle preload if not already started. Safe to call multiple times. */
export function scheduleIdleWasmPreload(bundleUrl = WASM_PHYSICS.bundleUrl): void {
  if (preloadStarted) return
  preloadStarted = true

  if (preloadDisabled()) {
    return
  }

  const run = () => startPreload(bundleUrl)

  // Accessed via globalThis (not the bare `window` identifier) so this file stays
  // lib-agnostic — it's imported transitively by the Worker-lib physics-worker.ts
  // compile graph, which has no DOM lib globals.
  const ric = (globalThis as Record<string, unknown>).requestIdleCallback as
    | ((callback: () => void, options?: { timeout?: number }) => void)
    | undefined
  if (ric) {
    ric(run, { timeout: 8000 })
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
  const loaded = workerBootModule
  workerBootModule = null
  void loaded?.then((m) => m.resetPhysicsWorkerPrewarmForTests()).catch(() => {})
}
