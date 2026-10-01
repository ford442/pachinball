/**
 * ReplayRecorder — Append-only InputFrame recording during PLAYING state.
 * Encapsulates replay metadata and serialization for local persistence & API submission.
 */

import type { WasmPhysicsRuntimeMode } from '../config/physics'
import type { InputFrame } from '../game-elements/types'
import { DEFAULT_TABLE_MAP_ID } from '../shaders/lcd-table'
import type { ReplayWorldFingerprint } from './replay-snapshot'

/** Normalise legacy replay metadata (`wasm` → mirror). */
function normalizeReplayPhysicsEngine(value: unknown): WasmPhysicsRuntimeMode {
  if (value === 'wasm-mirror' || value === 'wasm') return 'wasm-mirror'
  if (value === 'wasm-owner') return 'wasm-owner'
  if (value === 'wasm-worker') return 'wasm-worker'
  return 'rapier'
}

/**
 * `physicsEngine` plus the optional world fingerprint (#422): snapshot
 * version, static-table / pin-occupancy / feeder-tunables hashes and the
 * frame-0 C++ snapshot. Captured at the first recorded step, not at `start()`
 * — the table (a Daily Cascade rebuild) is exported between the two.
 */
/**
 * Replay schema version.
 * - 1: RLE rows `count:L,R,P,nx,ny,nz` — plunger as a fired/not-fired bit.
 * - 2: a 7th field carries the 0–1 plunger charge the launch was scaled by (#441).
 */
export const REPLAY_SCHEMA_VERSION = 2

export interface ReplayMetadata extends ReplayWorldFingerprint {
  version: number
  buildId: string
  mapId: string
  seed: number
  physicsEngine: WasmPhysicsRuntimeMode
  renderer: 'webgl2' | 'webgpu'
  createdAt: string
}

export interface ReplayPayload extends ReplayMetadata {
  frames: InputFrame[]
  finalScore: number
  targetScore?: number
  replayId?: string
  challengeId?: string
  compressedFrames?: string
}

/**
 * Compress InputFrames into a Run-Length Encoded (RLE) string.
 * Row: `count:flipperLeft,flipperRight,plunger,nx,ny,nz,charge`, e.g.
 * `60:0,0,0,0,0,0,-;1:0,0,1,0,0,0,0.5`. `charge` is the plunger charge written
 * with `String()` (round-trips exactly) or `-` when the plunger did not fire.
 * Lossy only where playback does not care: a `null` flipper ("no change")
 * encodes as released, nudges round to 0.01 (live input is quantised the same
 * way), and `nudgeSource` / `timestamp` are dropped.
 */
export function compressInputFrames(frames: InputFrame[]): string {
  if (frames.length === 0) return ''

  const runs: string[] = []
  let runLength = 0
  let currentKey = ''

  for (const frame of frames) {
    const left = frame.flipperLeft ? 1 : 0
    const right = frame.flipperRight ? 1 : 0
    const plunger = frame.plungerCharge !== null ? 1 : 0
    const charge = frame.plungerCharge === null ? '-' : String(frame.plungerCharge)
    const nx = frame.nudge ? Math.round(frame.nudge.x * 100) / 100 : 0
    const ny = frame.nudge ? Math.round(frame.nudge.y * 100) / 100 : 0
    const nz = frame.nudge ? Math.round((frame.nudge.z || 0) * 100) / 100 : 0
    const key = `${left},${right},${plunger},${nx},${ny},${nz},${charge}`

    if (key === currentKey && runLength < 65535) {
      runLength++
    } else {
      if (runLength > 0) {
        runs.push(`${runLength}:${currentKey}`)
      }
      currentKey = key
      runLength = 1
    }
  }

  if (runLength > 0) {
    runs.push(`${runLength}:${currentKey}`)
  }

  return runs.join(';')
}

/**
 * Decompress an RLE string back into an array of InputFrames. Schema-1 rows
 * (no charge field) fire at charge 0 — what those tapes effectively replayed
 * with, since playback used to read the spectator's idle charge.
 */
export function decompressInputFrames(compressed: string): InputFrame[] {
  if (!compressed || compressed.trim().length === 0) return []

  const frames: InputFrame[] = []
  const chunks = compressed.split(';')
  let currentTimestamp = 0

  for (const chunk of chunks) {
    if (!chunk) continue
    const parts = chunk.split(':')
    if (parts.length !== 2) continue

    const count = parseInt(parts[0]!, 10)
    const fields = parts[1]!.split(',')
    const values = fields.map(Number)
    if (isNaN(count) || values.length < 3) continue

    const flipperLeft = values[0] === 1
    const flipperRight = values[1] === 1
    const fired = values[2] === 1
    const chargeField = fields[6]
    const charge = chargeField === undefined || chargeField === '-' ? 0 : Number(chargeField)
    const plungerCharge = fired ? (Number.isFinite(charge) ? charge : 0) : null
    const nx = values[3] || 0
    const ny = values[4] || 0
    const nz = values[5] || 0
    const nudge = (nx !== 0 || ny !== 0 || nz !== 0) ? { x: nx, y: ny, z: nz } : null

    for (let i = 0; i < count; i++) {
      frames.push({
        flipperLeft,
        flipperRight,
        plungerCharge,
        plunger: plungerCharge !== null,
        nudge: nudge ? { ...nudge } : null,
        timestamp: currentTimestamp,
      })
      currentTimestamp += 1000 / 60
    }
  }

  return frames
}

/**
 * Fill in `plungerCharge` on a frame from a schema-1 payload (raw `frames`
 * array, boolean plunger only): a fired plunger replays at charge 0.
 */
export function normalizeInputFrame(frame: InputFrame): InputFrame {
  const plungerCharge = typeof frame.plungerCharge === 'number' ? frame.plungerCharge : frame.plunger ? 0 : null
  return { ...frame, plungerCharge, plunger: plungerCharge !== null }
}

export class ReplayRecorder {
  private recording = false
  private metadata: ReplayMetadata | null = null
  private frames: InputFrame[] = []
  private fingerprinted = false
  /** Bumped by `start()`; a late async fingerprint only lands on its own recording. */
  private session = 0

  /**
   * Start recording a new session. Resets frame buffer.
   */
  start(metadata: ReplayMetadata): void {
    this.metadata = { ...metadata }
    this.frames = []
    this.recording = true
    this.fingerprinted = false
    this.session++
  }

  /**
   * Append an InputFrame for a single physics step.
   */
  recordFrame(frame: InputFrame): void {
    if (!this.recording) return
    this.frames.push({
      flipperLeft: frame.flipperLeft,
      flipperRight: frame.flipperRight,
      plungerCharge: frame.plungerCharge,
      plunger: frame.plungerCharge !== null,
      nudge: frame.nudge ? { ...frame.nudge } : null,
      nudgeSource: frame.nudgeSource,
      timestamp: frame.timestamp,
    })
  }

  /**
   * Stop recording and return the constructed ReplayPayload.
   */
  stop(finalScore: number = 0, targetScore?: number): ReplayPayload | null {
    if (!this.recording || !this.metadata) return null
    this.recording = false
    const payload: ReplayPayload = {
      ...this.metadata,
      finalScore,
      targetScore,
      frames: this.frames,
      compressedFrames: compressInputFrames(this.frames),
    }
    return payload
  }

  isRecording(): boolean {
    return this.recording
  }

  /**
   * Fold the world fingerprint into the metadata. Called once, by the physics
   * step that recorded frame 0, right before that step runs.
   */
  /**
   * Attach the world fingerprint once per recording. On the worker path it is
   * a promise (the snapshot blob comes back from the worker); it is merged
   * when it lands, and dropped if a new recording has started by then.
   */
  attachWorldFingerprint(fingerprint: ReplayWorldFingerprint | Promise<ReplayWorldFingerprint>): void {
    if (!this.metadata || this.fingerprinted) return
    this.fingerprinted = true
    if (fingerprint instanceof Promise) {
      const session = this.session
      void fingerprint.then((fp) => {
        if (this.session === session && this.metadata) this.metadata = { ...this.metadata, ...fp }
      })
      return
    }
    this.metadata = { ...this.metadata, ...fingerprint }
  }

  hasWorldFingerprint(): boolean {
    return this.fingerprinted
  }

  getFrameCount(): number {
    return this.frames.length
  }

  getFrames(): readonly InputFrame[] {
    return this.frames
  }

  getMetadata(): ReplayMetadata | null {
    return this.metadata
  }

  static toJSON(payload: ReplayPayload, compress = true): string {
    const copy: ReplayPayload = { ...payload }
    if (compress) {
      if (!copy.compressedFrames && copy.frames) {
        copy.compressedFrames = compressInputFrames(copy.frames)
      }
      // Omit raw frames array when compressedFrames is present to keep JSON payload tiny
      copy.frames = []
    }
    return JSON.stringify(copy)
  }

  /** Parse a stored / uploaded payload — a JSON string, or the object an API fetch already parsed. */
  static fromJSON(json: string | object): ReplayPayload {
    const data = (typeof json === 'string' ? JSON.parse(json) : json) as Partial<ReplayPayload> & {
      build_id?: string
      map_id?: string
      final_score?: number
      target_score?: number
      replay_id?: string
      challenge_id?: string
      client_renderer?: 'webgl2' | 'webgpu'
      compressedFrames?: string
      compressed_frames?: string
      snapshot_version?: number
      static_hash?: string | null
      pin_field_occupancy?: string | null
      feeder_tunables_hash?: string
      initial_snapshot?: string
    }

    let frames: InputFrame[] = Array.isArray(data.frames) ? data.frames.map(normalizeInputFrame) : []
    const compressedStr = data.compressedFrames ?? data.compressed_frames
    if (frames.length === 0 && compressedStr) {
      frames = decompressInputFrames(compressedStr)
    }

    return {
      version: data.version ?? 1,
      buildId: data.buildId ?? data.build_id ?? '1.0.0',
      mapId: data.mapId ?? data.map_id ?? DEFAULT_TABLE_MAP_ID,
      seed: data.seed ?? 0,
      physicsEngine: normalizeReplayPhysicsEngine(data.physicsEngine),
      renderer: data.renderer ?? data.client_renderer ?? 'webgl2',
      createdAt: data.createdAt ?? new Date().toISOString(),
      frames,
      compressedFrames: compressedStr,
      finalScore: data.finalScore ?? data.final_score ?? 0,
      targetScore: data.targetScore ?? data.target_score,
      replayId: data.replayId ?? data.replay_id,
      challengeId: data.challengeId ?? data.challenge_id,
      snapshotVersion: data.snapshotVersion ?? data.snapshot_version,
      // `null` is meaningful here ("hashed, none"), so only fall back on undefined.
      staticHash: data.staticHash !== undefined ? data.staticHash : data.static_hash,
      pinFieldOccupancy: data.pinFieldOccupancy !== undefined ? data.pinFieldOccupancy : data.pin_field_occupancy,
      feederTunablesHash: data.feederTunablesHash ?? data.feeder_tunables_hash,
      initialSnapshot: data.initialSnapshot ?? data.initial_snapshot,
    }
  }

  static saveToLocalStorage(key: string, payload: ReplayPayload): void {
    try {
      localStorage.setItem(key, ReplayRecorder.toJSON(payload))
    } catch {
      // Storage quota or disabled error ignored
    }
  }

  static loadFromLocalStorage(key: string): ReplayPayload | null {
    try {
      const item = localStorage.getItem(key)
      if (!item) return null
      return ReplayRecorder.fromJSON(item)
    } catch {
      return null
    }
  }
}

