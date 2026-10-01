/**
 * Worker world-snapshot RPC on the compiled bundle (#441):
 *
 *   record on the in-process owner → the frame-0 C++ snapshot rides in the
 *   replay JSON → a FRESH wasm-worker client restores it over the
 *   request/reply protocol → replays the tape → score, bumper hits and the
 *   ball's WASM-id pose match the owner run bit-for-bit.
 *
 * The worker is a loopback (tests/helpers/wasm-replay-table.ts): commands
 * are structured-cloned through the real `applyPhysicsCommand`, and replies
 * come back through `receiveWorkerMessage`. Gated like the owner test:
 *   npm run build:wasm
 *   RUN_WASM_PARITY=1 npx vitest run tests/replay-worker-snapshot-wasm.test.ts
 */

import { describe, expect, it } from 'vitest'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { readSnapshotIds } from '../src/wasm/snapshot-layout'
import { WasmSnapshotStatus } from '../src/wasm/wasm-types'
import { decodeSnapshotBase64 } from '../src/replay/replay-snapshot'
import {
  ballPose,
  loadModule,
  makeTable,
  RECORD_FRAMES,
  recordLiveRun,
  replay,
  RUN,
  type Table,
} from './helpers/wasm-replay-table'

/** The ball's pose in the C++ world that actually stepped (the worker's engine on the worker path). */
function worldPose(t: Table) {
  const engine = t.workerEngine ?? (t.engine as WasmPhysicsEngine)
  const id = t.ball.wasmId!
  return { id, p: engine.getPosition(id), v: engine.getVelocity(id) }
}

describe.skipIf(!RUN)('worker world-snapshot RPC on the compiled bundle (#441)', () => {
  it('record on wasm-owner → restore on a wasm-worker client → replay matches bit-for-bit', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module, { launch: true })
    expect(live.host.score).toBeGreaterThan(0)

    const client = await replay(module, payload, { engine: 'worker' })
    expect(client.engine).toBeInstanceOf(PhysicsWorkerClient)
    const res = client.controller.getLastReplaySnapshotResult()
    expect(res?.outcome).toBe('restored')
    await expect(res?.settled).resolves.toMatchObject({ outcome: 'restored', status: WasmSnapshotStatus.Ok })

    expect(client.host.score).toBe(live.host.score)
    expect(client.controller.getBumperMatches()).toBe(live.controller.getBumperMatches())
    const a = worldPose(live)
    const b = worldPose(client)
    expect(b.id).toBe(a.id)
    expect(b.p).toEqual(a.p)
    expect(b.v).toEqual(a.v)
    // The client reads poses off the worker's transform snapshot — the same floats.
    expect(ballPose(client).p).toEqual(ballPose(live).p)
    expect(client.engine.getStepCount()).toBe(live.engine.getStepCount())

    // The whole world, fetched back over the RPC, is the owner's byte for byte.
    const workerBlob = await (client.engine as PhysicsWorkerClient).serializeSnapshot()
    expect(workerBlob).toEqual((live.engine as WasmPhysicsEngine).serializeSnapshot())
  })

  it('serializes the worker world over the RPC: its ids, hinges and static hash', async () => {
    const module = await loadModule()
    const workerTable = await makeTable(module, { engine: 'worker' })
    expect(workerTable.engine.getStaticContentHash()).toBeNull() // not told yet
    const blob = await (workerTable.engine as PhysicsWorkerClient).serializeSnapshot()
    const ids = readSnapshotIds(blob!)!
    expect(ids.bodyIds).toContain(workerTable.ball.wasmId)
    expect(ids.hinges).toHaveLength(2)
    // The client learnt the worker's static hash from the reply.
    expect(workerTable.engine.getStaticContentHash()).toBe(ids.staticHash)
  })

  it('a refused restore leaves the worker world and the client id shadow as they were', async () => {
    const module = await loadModule()
    const { payload } = await recordLiveRun(module)
    const client = await makeTable(module, { engine: 'worker', extraBumper: true })
    const engine = client.engine as PhysicsWorkerClient
    const before = await engine.serializeSnapshot()
    const status = await engine.restoreSnapshot(decodeSnapshotBase64(payload.initialSnapshot!)!)
    expect(status).toBe(WasmSnapshotStatus.StaticMismatch)
    expect(await engine.serializeSnapshot()).toEqual(before)
    // The next body gets the id the worker's C++ world hands out.
    const id = engine.createBody({ position: { x: 0, y: 2, z: 0 }, radius: 0.25, mass: 1 })
    const after = readSnapshotIds((await engine.serializeSnapshot())!)!
    expect(after.bodyIds).toContain(id)
  })

  it('replays the full tape through the worker path (control: no snapshot drifts)', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module)
    const client = await replay(module, { ...payload, initialSnapshot: undefined }, { engine: 'worker' })
    expect(client.controller.getLastReplaySnapshotResult()?.outcome).toBe('no-snapshot')
    expect(worldPose(client).p).not.toEqual(worldPose(live).p)
    expect(client.engine.getStepCount()).toBe(RECORD_FRAMES)
  })
})
