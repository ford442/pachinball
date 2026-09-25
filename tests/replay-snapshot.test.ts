// @vitest-environment happy-dom
/**
 * Replay world fingerprint + frame-0 snapshot gate (#431), without a bundle.
 * The compiled-bundle round trip lives in tests/replay-snapshot-wasm.test.ts.
 */

import { describe, expect, it, vi } from 'vitest'
import { ReplayRecorder } from '../src/replay/replay-recorder'
import { ReplayRunner } from '../src/replay/replay-runner'
import {
  applyReplaySnapshot,
  captureReplayFingerprint,
  decodeSnapshotBase64,
  encodeSnapshotBase64,
  feederTunablesHash,
  pinFieldOccupancyHash,
  readSnapshotHeader,
  REPLAY_DIVERGENCE_ATTRIBUTE,
  REPLAY_DIVERGENCE_TOAST_ID,
  showReplayDivergenceToast,
  type ReplayWorldFingerprint,
} from '../src/replay/replay-snapshot'
import { WASM_SNAPSHOT_VERSION, WasmSnapshotStatus } from '../src/wasm/wasm-types'
import { pachinkoPinFieldSpec } from '../src/objects/pachinko-pin-field'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'

/** A v1 blob with the words readSnapshotHeader reads (layout: native/src/Snapshot.cpp). */
function fakeSnapshot(opts: { hashHi: number; hashLo: number; ids: number[]; version?: number }): Uint8Array {
  const words: number[] = [0x4e534250, opts.version ?? 1, 0, opts.hashLo, opts.hashHi]
  for (let i = 0; i < 12; i++) words.push(0) // static counts
  words.push(0, 0, 0) // step lo/hi, accumulator
  for (let i = 0; i < 10; i++) words.push(0) // params
  const nextId = Math.max(-1, ...opts.ids) + 1
  words.push(nextId, nextId)
  for (let id = 0; id < nextId; id++) words.push(opts.ids.indexOf(id), 0)
  words.push(opts.ids.length, ...opts.ids)
  words[2] = words.length
  const out = new Uint8Array(words.length * 4)
  const view = new DataView(out.buffer)
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true))
  return out
}

const HASH = '00c0ffee12345678'
const blob = fakeSnapshot({ hashHi: 0x00c0ffee, hashLo: 0x12345678, ids: [0, 1, 3] })

function engine(hash: string | null, status: WasmSnapshotStatus = WasmSnapshotStatus.Ok) {
  return { restoreSnapshot: vi.fn(() => status), getStaticContentHash: vi.fn(() => hash) }
}

function fingerprint(extra: Partial<ReplayWorldFingerprint> = {}): ReplayWorldFingerprint {
  return {
    snapshotVersion: WASM_SNAPSHOT_VERSION,
    staticHash: HASH,
    feederTunablesHash: feederTunablesHash(),
    initialSnapshot: encodeSnapshotBase64(blob),
    ...extra,
  }
}

describe('snapshot blob header', () => {
  it('reads version, static hash (hi‖lo hex, as the C++ getter prints it) and body ids', () => {
    expect(readSnapshotHeader(blob)).toEqual({ version: 1, staticHash: HASH, bodyIds: [0, 1, 3] })
  })

  it('rejects other versions, bad magic and truncation', () => {
    expect(readSnapshotHeader(fakeSnapshot({ hashHi: 1, hashLo: 2, ids: [0], version: 2 }))).toBeNull()
    const bad = blob.slice()
    bad[0] ^= 0xff
    expect(readSnapshotHeader(bad)).toBeNull()
    expect(readSnapshotHeader(blob.subarray(0, blob.length - 4))).toBeNull()
    expect(readSnapshotHeader(new Uint8Array(3))).toBeNull()
  })

  it('base64 round-trips bytes exactly', () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 131) & 0xff)
    expect(decodeSnapshotBase64(encodeSnapshotBase64(big))).toEqual(big)
    expect(decodeSnapshotBase64('%%%')).toBeNull()
  })
})

describe('applyReplaySnapshot', () => {
  it('restores when table, tunables and body ids all match', () => {
    const e = engine(HASH)
    expect(applyReplaySnapshot(e, [3, 0, 1], fingerprint())).toEqual({ outcome: 'restored', status: 0, message: null })
    expect(e.restoreSnapshot).toHaveBeenCalledWith(blob)
  })

  it('refuses a different table without touching the world', () => {
    const e = engine('ffffffffffffffff')
    const res = applyReplaySnapshot(e, [0, 1, 3], fingerprint())
    expect(res.outcome).toBe('table-mismatch')
    expect(res.status).toBe(WasmSnapshotStatus.StaticMismatch)
    expect(res.message).toMatch(/table differs/)
    expect(e.restoreSnapshot).not.toHaveBeenCalled()
  })

  it('reports a native StaticMismatch as a table mismatch too', () => {
    const res = applyReplaySnapshot(engine(HASH, WasmSnapshotStatus.StaticMismatch), [0, 1, 3], fingerprint())
    expect(res.outcome).toBe('table-mismatch')
  })

  it('will not alias bodies when the live id layout differs', () => {
    const e = engine(HASH)
    expect(applyReplaySnapshot(e, [0, 1, 7], fingerprint()).outcome).toBe('id-layout')
    expect(e.restoreSnapshot).not.toHaveBeenCalled()
  })

  it('flags changed feeder tuning, unsupported engines and corrupt blobs', () => {
    expect(applyReplaySnapshot(engine(HASH), [0, 1, 3], fingerprint({ feederTunablesHash: 'deadbeef' })).outcome)
      .toBe('tunables-mismatch')
    expect(applyReplaySnapshot(engine(null), [0, 1, 3], fingerprint()).outcome).toBe('unsupported')
    expect(applyReplaySnapshot(engine(HASH), [0, 1, 3], fingerprint({ initialSnapshot: 'AAAA' })).outcome).toBe('invalid')
    expect(applyReplaySnapshot(engine(HASH, WasmSnapshotStatus.Corrupt), [0, 1, 3], fingerprint()).outcome).toBe('invalid')
  })

  it('treats a replay without a snapshot as tape-only, silently', () => {
    const res = applyReplaySnapshot(engine(HASH), [], { staticHash: HASH })
    expect(res).toEqual({ outcome: 'no-snapshot', status: null, message: null })
  })
})

describe('recording and playback carry the fingerprint', () => {
  it('captures once, survives JSON, and the runner hands it back exactly once', () => {
    const recorder = new ReplayRecorder()
    recorder.start({
      version: 1, buildId: 't', mapId: 'neon-helix', seed: 12345, physicsEngine: 'wasm-owner',
      renderer: 'webgl2', createdAt: '2026-09-25T00:00:00.000Z',
    })
    const e = { serializeSnapshot: vi.fn(() => blob), getStaticContentHash: vi.fn(() => HASH) }
    recorder.attachWorldFingerprint(captureReplayFingerprint(e, null))
    recorder.attachWorldFingerprint({ staticHash: 'later' })
    expect(recorder.hasWorldFingerprint()).toBe(true)
    recorder.recordFrame({ flipperLeft: true, flipperRight: null, plunger: false, nudge: null, timestamp: 0 })
    const payload = ReplayRecorder.fromJSON(ReplayRecorder.toJSON(recorder.stop(500)!))

    expect(payload).toMatchObject({
      physicsEngine: 'wasm-owner',
      snapshotVersion: WASM_SNAPSHOT_VERSION,
      staticHash: HASH,
      pinFieldOccupancy: null,
      feederTunablesHash: feederTunablesHash(),
    })
    expect(decodeSnapshotBase64(payload.initialSnapshot!)).toEqual(blob)

    const runner = new ReplayRunner()
    runner.load(payload)
    expect(runner.takeSnapshotCheck()?.initialSnapshot).toBe(payload.initialSnapshot)
    expect(runner.takeSnapshotCheck()).toBeNull()
    runner.reset()
    expect(runner.takeSnapshotCheck()?.staticHash).toBe(HASH)
  })

  it('an engine that cannot snapshot records hashes but no snapshot (version 0)', () => {
    const fp = captureReplayFingerprint(null, null)
    expect(fp).toMatchObject({ snapshotVersion: 0, staticHash: null, initialSnapshot: undefined })
    expect(fp.feederTunablesHash).toBe(feederTunablesHash())
  })

  it('pin-field occupancy hash follows the resolved pins', () => {
    const center = { x: 0, z: 6 }
    const vanilla = pachinkoPinFieldSpec(center, 24, 22)!
    const seeded = generateTableLayout({ seed: 12345, seedId: 'occupancy' })
    const cascade = pachinkoPinFieldSpec(center, 24, 22, seeded.pins, seeded.pinLattice)!
    expect(pinFieldOccupancyHash([vanilla])).toBe(pinFieldOccupancyHash([vanilla]))
    expect(pinFieldOccupancyHash([vanilla])).not.toBe(pinFieldOccupancyHash([cascade]))
    expect(pinFieldOccupancyHash([])).toBeNull()
  })
})

describe('divergence toast', () => {
  it('shows the reason and marks <body> for Playwright; a clean restore shows nothing', () => {
    showReplayDivergenceToast({ outcome: 'restored', status: 0, message: null })
    expect(document.body.getAttribute(REPLAY_DIVERGENCE_ATTRIBUTE)).toBe('restored')
    expect(document.getElementById(REPLAY_DIVERGENCE_TOAST_ID)).toBeNull()

    const res = applyReplaySnapshot(engine('ffffffffffffffff'), [0, 1, 3], fingerprint())
    showReplayDivergenceToast(res)
    expect(document.body.getAttribute(REPLAY_DIVERGENCE_ATTRIBUTE)).toBe('table-mismatch')
    expect(document.getElementById(REPLAY_DIVERGENCE_TOAST_ID)?.textContent).toMatch(/table differs/)
  })
})
