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
import { isPromiseLike, type Awaitable, type WasmSimEngine } from '../wasm/wasm-sim-engine'
import type { WasmTableWorld } from '../wasm/wasm-table-world'
import { readSnapshotIds, type SnapshotHinge, type SnapshotIds } from '../wasm/snapshot-layout'

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
  const ids = readSnapshotIds(bytes)
  return ids ? { version: ids.version, staticHash: ids.staticHash, bodyIds: ids.bodyIds } : null
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
): Awaitable<ReplayWorldFingerprint> {
  // Hashed now: the table is what it is at this frame, whenever the blob lands.
  const pinFieldOccupancy = pinFieldOccupancyHash(tablePinFieldSpecs(world))
  const build = (bytes: Uint8Array | null): ReplayWorldFingerprint => ({
    snapshotVersion: bytes ? WASM_SNAPSHOT_VERSION : 0,
    // The worker client learns its hash from the snapshot reply, so read it after.
    staticHash: engine?.getStaticContentHash() ?? null,
    pinFieldOccupancy,
    feederTunablesHash: feederTunablesHash(),
    initialSnapshot: bytes ? encodeSnapshotBase64(bytes) : undefined,
  })
  const bytes = engine?.serializeSnapshot() ?? null
  // The worker answers later; the blob is still the world as of this call.
  return isPromiseLike(bytes) ? bytes.then(build) : build(bytes)
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
  /** This engine cannot restore (Rapier / mirror session, a bundle built without snapshots). */
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
  /**
   * True when the live body / hinge ids differed from the recording's and the
   * TS links were moved onto the restored ids (#441) instead of refusing.
   */
  remapped?: boolean
  /** Raw restore status when a restore was attempted (null while a worker restore is pending). */
  status: WasmSnapshotStatus | null
  /** Player-facing, for the divergence toast; null when restored cleanly. */
  message: string | null
  /**
   * Worker path (#441): the restore was sent and takes effect before the next
   * step, but its status arrives later. `outcome` is provisionally `restored`;
   * this settles with the final result.
   */
  settled?: Promise<ReplaySnapshotResult>
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

/** The C++ ids the TS side holds: linked bodies, and the hinges it drives. */
export interface LiveIdLayout {
  bodyIds: readonly number[]
  hinges: readonly SnapshotHinge[]
}

/** Live id → restored id, for bodies and hinges whose id changes. */
export interface ReplayIdRemap {
  bodies: ReadonlyMap<number, number>
  hinges: ReadonlyMap<number, number>
}

/**
 * Pair the live ids with the snapshot's by role (#441): hinges in id order
 * (creation order — the same table authors its flippers in the same order),
 * their bodies with them, then every other body in id order. Null when a role
 * has a different count on the two sides — then the layouts genuinely differ.
 */
export function planReplayIdRemap(live: LiveIdLayout, recorded: Pick<SnapshotIds, 'bodyIds' | 'hinges'>): ReplayIdRemap | null {
  const byId = (a: SnapshotHinge, b: SnapshotHinge) => a.id - b.id
  const liveHinges = [...live.hinges].sort(byId)
  const recHinges = [...recorded.hinges].sort(byId)
  if (liveHinges.length !== recHinges.length) return null
  const liveBodies = new Set(live.bodyIds)
  const recBodies = new Set(recorded.bodyIds)

  const bodies = new Map<number, number>()
  const hinges = new Map<number, number>()
  for (let i = 0; i < liveHinges.length; i++) {
    const l = liveHinges[i]
    const r = recHinges[i]
    if (!liveBodies.has(l.bodyId) || !recBodies.has(r.bodyId)) return null
    if (bodies.has(l.bodyId) && bodies.get(l.bodyId) !== r.bodyId) return null
    hinges.set(l.id, r.id)
    bodies.set(l.bodyId, r.bodyId)
  }
  const recHinged = new Set(recHinges.map((h) => h.bodyId))
  const liveRest = [...liveBodies].filter((id) => !bodies.has(id)).sort((a, b) => a - b)
  const recRest = [...recBodies].filter((id) => !recHinged.has(id)).sort((a, b) => a - b)
  if (liveRest.length !== recRest.length) return null
  liveRest.forEach((id, i) => bodies.set(id, recRest[i]))

  // Only the ids that actually change.
  for (const [from, to] of bodies) if (from === to) bodies.delete(from)
  for (const [from, to] of hinges) if (from === to) hinges.delete(from)
  return { bodies, hinges }
}

/** The remap that undoes `remap` (a refused worker restore left the world as it was). */
export function invertReplayIdRemap(remap: ReplayIdRemap): ReplayIdRemap {
  const flip = (m: ReadonlyMap<number, number>) => new Map([...m].map(([a, b]) => [b, a] as [number, number]))
  return { bodies: flip(remap.bodies), hinges: flip(remap.hinges) }
}

/**
 * Restore a replay's frame-0 snapshot into the live engine, before the first
 * replayed frame. `live` is what the TS side holds in C++ id space (a bare id
 * list = linked bodies, no hinges). A restore replaces bodies "wholesale,
 * public ids included", so when the spectator's ids differ from the
 * recording's (they were allocated by earlier games) the TS links must follow:
 * with `onRemap` the ids are paired by role and `onRemap` moves every link
 * onto the restored id (`remapped: true`); without it, or when the roles do
 * not pair up, that is reported as `id-layout`, never forced.
 *
 * On any outcome but `restored` / `no-snapshot` the world is untouched and
 * `message` says why the ghost may desync.
 */
export function applyReplaySnapshot(
  engine: Pick<WasmSimEngine, 'restoreSnapshot' | 'getStaticContentHash'>,
  live: readonly number[] | LiveIdLayout,
  fingerprint: ReplayWorldFingerprint,
  onRemap?: (remap: ReplayIdRemap) => void,
): ReplaySnapshotResult {
  const layout: LiveIdLayout = isLiveIdLayout(live) ? live : { bodyIds: live, hinges: [] }
  if (fingerprint.feederTunablesHash && fingerprint.feederTunablesHash !== feederTunablesHash()) {
    return result('tunables-mismatch')
  }
  // Null when the engine cannot hash, or (worker client) has not been told
  // yet — then C++ itself refuses a different table on restore.
  const liveHash = engine.getStaticContentHash()
  if (fingerprint.staticHash && liveHash && fingerprint.staticHash !== liveHash) {
    return result('table-mismatch', WasmSnapshotStatus.StaticMismatch)
  }
  if (!fingerprint.initialSnapshot) return result('no-snapshot')

  const bytes = decodeSnapshotBase64(fingerprint.initialSnapshot)
  const recorded = bytes ? readSnapshotIds(bytes) : null
  if (!bytes || !recorded) return result('invalid', WasmSnapshotStatus.Corrupt)
  if (liveHash && recorded.staticHash !== liveHash) return result('table-mismatch', WasmSnapshotStatus.StaticMismatch)

  let remap: ReplayIdRemap | null = null
  if (!sameIds(layout.bodyIds, recorded.bodyIds)) {
    remap = onRemap ? planReplayIdRemap(layout, recorded) : null
    if (!remap) return result('id-layout')
  } else if (onRemap && layout.hinges.length > 0) {
    // Same bodies; the hinges they hang on may still have been renumbered.
    remap = planReplayIdRemap(layout, recorded)
    if (!remap) return result('id-layout')
  }
  const remapping = remap !== null && (remap.bodies.size > 0 || remap.hinges.size > 0)

  const status = engine.restoreSnapshot(bytes)
  if (!isPromiseLike(status)) {
    const res = restoreResult(status)
    if (res.outcome === 'restored' && remapping) {
      onRemap!(remap!)
      res.remapped = true
    }
    return res
  }
  // Worker: the restore applies before the next step, so the links must move
  // now; a refusal moves them back.
  if (remapping) onRemap!(remap!)
  const settled = status.then((s) => {
    const res = restoreResult(s)
    if (res.outcome !== 'restored' && remapping) onRemap!(invertReplayIdRemap(remap!))
    if (res.outcome === 'restored' && remapping) res.remapped = true
    return res
  })
  return { ...result('restored'), remapped: remapping || undefined, settled }
}

function isLiveIdLayout(live: readonly number[] | LiveIdLayout): live is LiveIdLayout {
  return !Array.isArray(live)
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort((p, q) => p - q)
  const y = [...b].sort((p, q) => p - q)
  return x.every((id, i) => id === y[i])
}

function restoreResult(status: WasmSnapshotStatus): ReplaySnapshotResult {
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
