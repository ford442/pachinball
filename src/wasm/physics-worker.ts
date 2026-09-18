/**
 * Dedicated Worker entry for wasm-worker mode.
 * Owns WasmPhysicsEngine; never touches the DOM or Babylon.
 */

import { WasmPhysicsEngine } from './PhysicsModule'
import {
  applyPhysicsCommand,
  createWorkerRuntimeState,
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

  if (data.type !== 'batch') return

  let alpha = 0
  let stepped = false
  const t0 = performance.now()
  for (const cmd of data.commands) {
    const result = applyPhysicsCommand(engine, cmd, runtime)
    if (cmd.type === 'step') {
      alpha = result
      stepped = true
    }
  }

  if (!stepped) return

  publisher.publish(engine, runtime, alpha, performance.now() - t0)
}
