/**
 * Replay ↔ C++ world snapshots (#422).
 *
 * A replay is an input tape plus the world it was played on. The tape alone
 * is "hope the sim is deterministic"; this module adds the other half:
 *
 *  - metadata that pins the world down — snapshot version, the C++ static
 *    table hash, pin-field occupancy and feeder tunables hashes;
 *  - the frame-0 solver snapshot (`native/src/Snapshot.h`), base64 in JSON;
 *  - `applyReplaySnapshot`, which restores that snapshot before the first
 *    replayed frame and reports — never swallows — anything that would make
 *    the replay drift: a different table, a bundle without snapshots, a live
 *    world whose body ids do not line up with the recording.
 *
 * Nothing here imports Babylon; the toast is plain DOM and optional.
 */

import { FEEDER_TUNABLES } from '../config/feeders'
import { hashStringToSeed } from '../core/seeded-rng'
import { resolvePinField, type PinFieldSpec } from '../core/pin-field'
import { WASM_SNAPSHOT_VERSION, WasmSnapshotStatus } from '../wasm/wasm-types'
import type { WasmSimEngine } from '../wasm/wasm-sim-engine'
import type { WasmTableWorld } from '../wasm/wasm-table-world'

/** Word offsets in the v1 blob — mirror `PhysicsWorld::serialize()` (Snapshot.cpp). */
const SNAPSHOT_MAGIC = 0x4e534250
const WORD_VERSION = 1
const WORD_HASH_LO = 3
const WORD_HASH_HI = 4
/** Header (17) + step counter (2) + accumulator (1) + world params (10). */
const WORD_HANDLES = 30

export interface SnapshotHeader {
  version: number
  /** 16 hex chars, identical to `engine.getStaticContentHash()` on the same table. */
  staticHash: string
  /** Public ids of every rigid body in the snapshot, dense order. */
  bodyIds: number[]
}

function hex32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0')
}

/** Parse the fields a replay client checks before restoring; null when not a v1 snapshot. */
export function readSnapshotHeader(bytes: Uint8Array): SnapshotHeader | null {
  if (bytes.byteLength < (WORD_HANDLES + 2) * 4 || bytes.byteLength % 4 !== 0) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (i: number) => view.getUint32(i * 4, true)
  if (word(0) !== SNAPSHOT_MAGIC) return null
  const version = word(WORD_VERSION)
  if (version !== WASM_SNAPSHOT_VERSION) return null
  const slots = word(WORD_HANDLES + 1)
  const bodyCountWord = WORD_HANDLES + 2 + slots * 2
  if ((bodyCountWord + 1) * 4 > bytes.byteLength) return null
  const count = word(bodyCountWord)
  if ((bodyCountWord + 1 + count) * 4 > bytes.byteLength) return null
  const bodyIds: number[] = []
  for (let i = 0; i < count; i++) bodyIds.push(view.getInt32((bodyCountWord + 1 + i) * 4, true))
  return { version, staticHash: hex32(word(WORD_HASH_HI)) + hex32(word(WORD_HASH_LO)), bodyIds }
}

export function encodeSnapshotBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function decodeSnapshotBase64(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** FNV-1a of the feeder tunables: a tuning change must not replay against old recordings silently. */
export function feederTunablesHash(): string {
  return hex32(hashStringToSeed(JSON.stringify(FEEDER_TUNABLES)))
}

/**
 * FNV-1a over every resolved pin (lattice index + position) of every field,
 * in authoring order — the pins a ball actually collided with. Null when the
 * table has no pin field (or the path does not author one).
 */
export function pinFieldOccupancyHash(specs: Iterable<PinFieldSpec>): string | null {
  const parts: string[] = []
  for (const spec of specs) {
    parts.push(
      resolvePinField(spec)
        .map((p) => `${p.index}@${p.position.x},${p.position.z}`)
        .join(';'),
    )
  }
  return parts.length ? hex32(hashStringToSeed(parts.join('|'))) : null
}

/** What a replay knows about the world it was recorded on. All optional: v1 replays predate them. */
export interface ReplayWorldFingerprint {
  /** `WASM_SNAPSHOT_VERSION` when a snapshot was taken, 0 when the engine could not snapshot. */
  snapshotVersion?: number
  staticHash?: string | null
  pinFieldOccupancy?: string | null
  feederTunablesHash?: string
  /** Base64 frame-0 snapshot (`serializeSnapshot()` before the first recorded step). */
  initialSnapshot?: string
}

/** Every pin-field descriptor the owner table authored (#421), in authoring order. */
export function tablePinFieldSpecs(world: WasmTableWorld | null): PinFieldSpec[] {
  const specs: PinFieldSpec[] = []
  for (const body of world?.allBodies() ?? []) {
    for (const collider of body.colliders) {
      const shape = collider.desc.shape
      if (shape.kind === 'pinField') specs.push(shape.field)
    }
  }
  return specs
}

/** C++ ids the TS side links (balls, flippers) — what a restored snapshot must contain. */
export function linkedBodyIds(world: WasmTableWorld | null): number[] {
  const ids: number[] = []
  for (const body of world?.allBodies() ?? []) {
    const id = body.link?.id
    if (id !== undefined && id >= 0) ids.push(id)
  }
  return ids
}

/**
 * Fingerprint the world a recording starts on. Call immediately before the
 * physics step of frame 0. `engine` is null off the owner path (Rapier): the
 * replay then carries hashes but no snapshot, and plays as input tape only.
 */
export function captureReplayFingerprint(
  engine: Pick<WasmSimEngine, 'serializeSnapshot' | 'getStaticContentHash'> | null,
  world: WasmTableWorld | null,
): ReplayWorldFingerprint {
  const bytes = engine?.serializeSnapshot() ?? null
  return {
    snapshotVersion: bytes ? WASM_SNAPSHOT_VERSION : 0,
    staticHash: engine?.getStaticContentHash() ?? null,
    pinFieldOccupancy: pinFieldOccupancyHash(tablePinFieldSpecs(world)),
    feederTunablesHash: feederTunablesHash(),
    initialSnapshot: bytes ? encodeSnapshotBase64(bytes) : undefined,
  }
}

/** Stand-in for engines that cannot snapshot at all (Rapier / mirror sessions). */
export const NO_SNAPSHOT_ENGINE: Pick<WasmSimEngine, 'restoreSnapshot' | 'getStaticContentHash'> = {
  restoreSnapshot: () => WasmSnapshotStatus.Unsupported,
  getStaticContentHash: () => null,
}

export type ReplaySnapshotOutcome =
  | 'restored'
  /** The replay carries no snapshot (v1 replay, Rapier recording): input tape only. */
  | 'no-snapshot'
  /** This engine cannot restore (worker path, old bundle). */
  | 'unsupported'
  /** Different static table — the snapshot was refused. */
  | 'table-mismatch'
  /** Same table, but the live body ids differ from the recording's; restoring would alias bodies. */
  | 'id-layout'
  /** Truncated / corrupt / wrong version. */
  | 'invalid'
  /** Same table, but tuning the tape depends on changed since recording. */
  | 'tunables-mismatch'

export interface ReplaySnapshotResult {
  outcome: ReplaySnapshotOutcome
  /** Raw restore status when a restore was attempted. */
  status: WasmSnapshotStatus | null
  /** Player-facing, for the divergence toast; null when restored cleanly. */
  message: string | null
}

const MESSAGES: Record<Exclude<ReplaySnapshotOutcome, 'restored' | 'no-snapshot'>, string> = {
  unsupported: 'Replay not verified: this physics engine cannot restore snapshots — ghost may drift',
  'table-mismatch': 'Replay diverged: table differs from the recording (snapshot hash mismatch)',
  'id-layout': 'Replay not verified: ball layout differs from the recording — ghost may drift',
  invalid: 'Replay diverged: recording snapshot is corrupt or from another version',
  'tunables-mismatch': 'Replay diverged: feeder tuning changed since this recording',
}

function result(outcome: ReplaySnapshotOutcome, status: WasmSnapshotStatus | null = null): ReplaySnapshotResult {
  const message = outcome === 'restored' || outcome === 'no-snapshot' ? null : MESSAGES[outcome]
  return { outcome, status, message }
}

/**
 * Restore a replay's frame-0 snapshot into the live engine, before the first
 * replayed frame. `liveBodyIds` are the C++ ids the TS side currently links
 * (balls, flippers); the snapshot's ids must be the same set, or restoring
 * would leave TS pointing at the wrong bodies — that is reported, not forced.
 *
 * On any outcome but `restored` / `no-snapshot` the world is untouched and
 * `message` says why the ghost may desync.
 */
export function applyReplaySnapshot(
  engine: Pick<WasmSimEngine, 'restoreSnapshot' | 'getStaticContentHash'>,
  liveBodyIds: readonly number[],
  fingerprint: ReplayWorldFingerprint,
): ReplaySnapshotResult {
  if (fingerprint.feederTunablesHash && fingerprint.feederTunablesHash !== feederTunablesHash()) {
    return result('tunables-mismatch')
  }
  const liveHash = engine.getStaticContentHash()
  if (fingerprint.staticHash && liveHash && fingerprint.staticHash !== liveHash) {
    return result('table-mismatch', WasmSnapshotStatus.StaticMismatch)
  }
  if (!fingerprint.initialSnapshot) return result('no-snapshot')
  if (!liveHash) return result('unsupported', WasmSnapshotStatus.Unsupported)

  const bytes = decodeSnapshotBase64(fingerprint.initialSnapshot)
  const header = bytes ? readSnapshotHeader(bytes) : null
  if (!bytes || !header) return result('invalid', WasmSnapshotStatus.Corrupt)
  if (header.staticHash !== liveHash) return result('table-mismatch', WasmSnapshotStatus.StaticMismatch)

  const live = [...liveBodyIds].sort((a, b) => a - b)
  const recorded = [...header.bodyIds].sort((a, b) => a - b)
  if (live.length !== recorded.length || live.some((id, i) => id !== recorded[i])) return result('id-layout')

  const status = engine.restoreSnapshot(bytes)
  if (status === WasmSnapshotStatus.Ok) return result('restored', status)
  if (status === WasmSnapshotStatus.StaticMismatch) return result('table-mismatch', status)
  if (status === WasmSnapshotStatus.Unsupported) return result('unsupported', status)
  return result('invalid', status)
}

/** `<body data-replay-divergence>` — Playwright asserts on this, not on toast copy. */
export const REPLAY_DIVERGENCE_ATTRIBUTE = 'data-replay-divergence'
export const REPLAY_DIVERGENCE_TOAST_ID = 'replay-divergence-toast'

/** Surface a divergence instead of letting the ghost desync silently. No-op without a DOM. */
export function showReplayDivergenceToast(res: ReplaySnapshotResult, doc: Document | undefined = globalThis.document): void {
  if (!doc?.body) return
  doc.body.setAttribute(REPLAY_DIVERGENCE_ATTRIBUTE, res.outcome)
  if (!res.message) return
  doc.getElementById(REPLAY_DIVERGENCE_TOAST_ID)?.remove()
  const toast = doc.createElement('div')
  toast.id = REPLAY_DIVERGENCE_TOAST_ID
  toast.setAttribute('role', 'status')
  toast.textContent = res.message
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    max-width: min(90vw, 560px); padding: 10px 18px; border-radius: 10px;
    background: rgba(40, 0, 10, 0.92); border: 1px solid #ff3366; color: #ffd6e0;
    font: 600 0.85rem 'Orbitron', monospace, sans-serif; text-align: center;
    z-index: 1600; pointer-events: none;
  `
  doc.body.appendChild(toast)
  setTimeout(() => toast.remove(), 6000)
}
