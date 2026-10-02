/**
 * Dedicated Worker boot for wasm-worker mode: create the worker, post `init`,
 * and settle `ready` exactly once. It settles true on the worker's `ready`
 * reply. It settles false on an `error` reply, a Worker `error` /
 * `messageerror` event (the script failed to load or threw at top level), or
 * the `WASM_PHYSICS.workerReadyTimeoutMs` backstop. A failed worker is
 * terminated, so `PhysicsSystem` can fall back to the in-process owner instead
 * of hanging boot (#439).
 *
 * Kept apart from the client so the idle preload can warm a worker without
 * loading the client's codecs; both reach the same `prewarmed` slot here.
 */

import { WASM_PHYSICS } from '../config/physics'
import type { PhysicsWorkerFromWorker, PhysicsWorkerToWorker } from './physics-worker-protocol'

export function resolvePhysicsBundleUrl(bundleUrl: string): string {
  if (/^https?:/i.test(bundleUrl) || bundleUrl.startsWith('blob:')) return bundleUrl
  // Accessed via globalThis (not the bare `window` identifier) — this file compiles
  // under both the DOM app project and the WebWorker-lib worker project.
  const win = (globalThis as Record<string, unknown>).window as
    | { location?: { href?: string } }
    | undefined
  if (!win?.location?.href) return bundleUrl
  try {
    return new URL(bundleUrl, win.location.href).href
  } catch {
    return bundleUrl
  }
}

export function createPhysicsWorker(): Worker {
  return new Worker(new URL('./physics-worker.ts', import.meta.url), { type: 'module' })
}

export type PrewarmedPhysicsWorker = {
  worker: Worker
  /** True once the worker loaded the bundle; false (worker terminated) on any failure. */
  ready: Promise<boolean>
}

/** Create a worker and start its WASM load. Throws only if `new Worker` does. */
export function startPhysicsWorker(
  bundleUrl: string,
  timeoutMs: number = WASM_PHYSICS.workerReadyTimeoutMs,
): PrewarmedPhysicsWorker {
  const worker = createPhysicsWorker()
  const ready = new Promise<boolean>((resolve) => {
    const settle = (ok: boolean, cause?: string) => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
      if (!ok) {
        console.warn(`[PhysicsWorkerClient] worker boot failed: ${cause}`)
        worker.terminate()
      }
      resolve(ok)
    }
    const onMessage = (event: MessageEvent<PhysicsWorkerFromWorker>) => {
      const data = event.data
      if (data?.type === 'ready') settle(true)
      else if (data?.type === 'error') settle(false, data.message)
    }
    const onError = (event: Event) => {
      settle(false, (event as ErrorEvent).message || 'worker script failed to load')
    }
    const onMessageError = () => settle(false, 'worker reply could not be deserialized')
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onMessageError)
    const timer = setTimeout(() => settle(false, `no reply to init within ${timeoutMs} ms`), timeoutMs)
  })
  worker.postMessage({
    type: 'init',
    bundleUrl: resolvePhysicsBundleUrl(bundleUrl),
  } satisfies PhysicsWorkerToWorker)
  return { worker, ready }
}

let prewarmed: PrewarmedPhysicsWorker | null = null

/** Start WASM load inside a Dedicated Worker (idle warm-path for wasm-worker). */
export function warmPhysicsWorker(bundleUrl: string): PrewarmedPhysicsWorker {
  prewarmed ??= startPhysicsWorker(bundleUrl)
  return prewarmed
}

export function consumePrewarmedPhysicsWorker(): PrewarmedPhysicsWorker | null {
  const held = prewarmed
  prewarmed = null
  return held
}

/** @internal */
export function resetPhysicsWorkerPrewarmForTests(): void {
  if (prewarmed) {
    prewarmed.worker.terminate()
    prewarmed = null
  }
}
