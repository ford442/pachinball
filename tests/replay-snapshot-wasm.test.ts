/**
 * Replay against the real compiled bundle on the wasm-owner path (#422):
 *
 *   record N frames → the frame-0 C++ snapshot rides in the replay JSON →
 *   a FRESH replay client restores it before frame 0 → replays the input
 *   tape → score and the ball's WASM-id pose match the live run bit-for-bit.
 *
 * The live run is warmed up before recording starts (ball rolling, flippers
 * mid-swing), while the replay client starts from the table's spawn state, so
 * only a correct restore can make the two agree — the control case with the
 * snapshot stripped must diverge.
 *
 * Everything between input and score is production code: WasmTableWorld,
 * GamePhysicsController (WasmOwner flippers, collision dispatch in WASM-id
 * space, ScoringBridge), ReplayRecorder / ReplayRunner JSON round trip.
 *
 * Gated like tests/wasm-physics-parity.test.ts:
 *   npm run build:wasm
 *   RUN_WASM_PARITY=1 npx vitest run tests/replay-snapshot-wasm.test.ts
 */

import { describe, expect, it } from 'vitest'
import { readSnapshotHeader, decodeSnapshotBase64 } from '../src/replay/replay-snapshot'
import { readSnapshotIds } from '../src/wasm/snapshot-layout'
import { WASM_SNAPSHOT_VERSION } from '../src/wasm/wasm-types'
import {
  ballPose,
  LAUNCH_CHARGE,
  LAUNCH_FRAME,
  loadModule,
  RECORD_FRAMES,
  recordLiveRun,
  replay,
  RUN,
  WARMUP_FRAMES,
} from './helpers/wasm-replay-table'

describe.skipIf(!RUN)('replay from a C++ snapshot on the compiled bundle (#422)', () => {
  it('restores frame 0 in a fresh client and replays score + ball pose bit-for-bit', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module)

    // The recording is non-trivial and carries its world.
    expect(payload.frames).toHaveLength(RECORD_FRAMES)
    expect(live.host.score).toBeGreaterThan(0)
    expect(live.controller.getBumperMatches()).toBeGreaterThan(1)
    expect(payload.snapshotVersion).toBe(WASM_SNAPSHOT_VERSION)
    expect(payload.staticHash).toBe(live.engine.getStaticContentHash())
    expect(payload.feederTunablesHash).toMatch(/^[0-9a-f]{8}$/)
    const header = readSnapshotHeader(decodeSnapshotBase64(payload.initialSnapshot!)!)!
    expect(header.staticHash).toBe(payload.staticHash)
    expect(header.bodyIds).toContain(live.ball.wasmId)
    // The id table the worker shadow / spectate remap mirror (#441), read off the real blob.
    const ids = readSnapshotIds(decodeSnapshotBase64(payload.initialSnapshot!)!)!
    expect(ids.bodyIds).toEqual(header.bodyIds)
    expect(ids.hinges).toHaveLength(2)
    for (const h of ids.hinges) expect(ids.bodyIds).toContain(h.bodyId)
    expect(ids.nextHingeId).toBe(2)
    expect(ids.nextBodyId).toBe(Math.max(...ids.bodyIds) + 1)
    expect(ids.stepCount).toBeGreaterThan(0)

    const client = await replay(module, payload)
    expect(client.controller.getLastReplaySnapshotResult()).toMatchObject({ outcome: 'restored', message: null })
    expect(client.host.score).toBe(live.host.score)
    expect(client.controller.getBumperMatches()).toBe(live.controller.getBumperMatches())
    const a = ballPose(live)
    const b = ballPose(client)
    expect(b.id).toBe(a.id)
    // Bit-for-bit, not toBeCloseTo: same bundle, same inputs, same restored state.
    expect(b.p).toEqual(a.p)
    expect(b.v).toEqual(a.v)
    expect(client.engine.getStepCount()).toBe(live.engine.getStepCount())
    expect(client.engine.serializeSnapshot()).toEqual(live.engine.serializeSnapshot())
  })

  it('replays a charged launch at the taped charge, not the spectator\'s idle charge (#441)', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module, { launch: true })
    const { live: unlaunched } = await recordLiveRun(module)
    expect(payload.frames[LAUNCH_FRAME - WARMUP_FRAMES]?.plungerCharge).toBe(LAUNCH_CHARGE)
    // The launch changed the run, so matching it below is not vacuous.
    expect(ballPose(live).p).not.toEqual(ballPose(unlaunched).p)

    const client = await replay(module, payload)
    expect(client.controller.getLastReplaySnapshotResult()?.outcome).toBe('restored')
    expect(client.host.score).toBe(live.host.score)
    expect(ballPose(client).p).toEqual(ballPose(live).p)
    expect(ballPose(client).v).toEqual(ballPose(live).v)
  })

  it('without the snapshot the same tape drifts (control)', async () => {
    const module = await loadModule()
    const { live, payload } = await recordLiveRun(module)
    const client = await replay(module, { ...payload, initialSnapshot: undefined })
    expect(client.controller.getLastReplaySnapshotResult()?.outcome).toBe('no-snapshot')
    expect(ballPose(client).p).not.toEqual(ballPose(live).p)
  })

  it('refuses a snapshot recorded on a different table and says so', async () => {
    const module = await loadModule()
    const { payload } = await recordLiveRun(module)
    const client = await replay(module, payload, { extraBumper: true })
    const res = client.controller.getLastReplaySnapshotResult()
    expect(res?.outcome).toBe('table-mismatch')
    expect(res?.message).toMatch(/table differs/)
    // The world was left alone: the client's own ball never teleported to the recording's pose.
    expect(client.engine.getStepCount()).toBe(RECORD_FRAMES)
  })
})
