/**
 * Dedicated Worker entry for wasm-worker mode.
 * Owns WasmPhysicsEngine; never touches the DOM or Babylon.
 */

import { WasmPhysicsEngine } from './PhysicsModule'
import {
  createWorkerRuntimeState,
  runWorkerBatch,
  WorkerSnapshotPublisher,
} from './physics-worker-runtime'
import type { PhysicsWorkerFromWorker, PhysicsWorkerToWorker } from './physics-worker-protocol'

const engine = new WasmPhysicsEngine()
const runtime = createWorkerRuntimeState()

function post(msg: PhysicsWorkerFromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer)
}

const publisher = new WorkerSnapshotPublisher(post)

async function handleInit(bundleUrl: string): Promise<void> {
  try {
    await engine.load(bundleUrl)
    if (!engine.isReady) {
      post({ type: 'error', message: 'WASM physics bundle failed to load in worker' })
      return
    }
    post({ type: 'ready' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    post({ type: 'error', message })
  }
}

self.onmessage = (event: MessageEvent<PhysicsWorkerToWorker>) => {
  const data = event.data
  if (!data) return

  if (data.type === 'init') {
    void handleInit(data.bundleUrl)
    return
  }

  if (data.type === 'use-shared-transport') {
    publisher.requestShared()
    return
  }

  // After a fatal the world may be half-stepped: apply nothing more.
  if (data.type !== 'batch' || fatalSent) return

  // A throw here (a WASM trap, an embind error) would otherwise only reach the worker's global
  // `error` event and leave the client serving its last snapshot forever (#503 A2): tell it.
  try {
    runWorkerBatch(engine, runtime, data.commands, publisher, post)
  } catch (err) {
    fatal(err)
  }
}

let fatalSent = false
function fatal(err: unknown): void {
  if (fatalSent) return
  fatalSent = true
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  post({ type: 'fatal', message, stack })
}

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => fatal(event.reason))
