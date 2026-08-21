/**
 * ReplayRecorder — Append-only InputFrame recording during PLAYING state.
 * Encapsulates replay metadata and serialization for local persistence & API submission.
 */

import type { InputFrame } from '../game-elements/types'

export interface ReplayMetadata {
  version: number
  buildId: string
  mapId: string
  seed: number
  physicsEngine: 'rapier' | 'wasm'
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
 * Losslessly compress an array of InputFrames into a Run-Length Encoded (RLE) string.
 * Example chunk: "60:0,0,0;15:1,0,0;5:1,1,0.5" -> (length:flipperLeft,flipperRight,plunger)
 */
export function compressInputFrames(frames: InputFrame[]): string {
  if (frames.length === 0) return ''

  const runs: string[] = []
  let runLength = 0
  let currentKey = ''

  for (const frame of frames) {
    const left = frame.flipperLeft ? 1 : 0
    const right = frame.flipperRight ? 1 : 0
    const plunger = frame.plunger ? 1 : 0
    const nx = frame.nudge ? Math.round(frame.nudge.x * 100) / 100 : 0
    const ny = frame.nudge ? Math.round(frame.nudge.y * 100) / 100 : 0
    const nz = frame.nudge ? Math.round((frame.nudge.z || 0) * 100) / 100 : 0
    const key = `${left},${right},${plunger},${nx},${ny},${nz}`

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
 * Decompress an RLE string back into an array of InputFrames.
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
    const values = parts[1]!.split(',').map(Number)
    if (isNaN(count) || values.length < 3) continue

    const flipperLeft = values[0] === 1
    const flipperRight = values[1] === 1
    const plunger = values[2] === 1
    const nx = values[3] || 0
    const ny = values[4] || 0
    const nz = values[5] || 0
    const nudge = (nx !== 0 || ny !== 0 || nz !== 0) ? { x: nx, y: ny, z: nz } : null

    for (let i = 0; i < count; i++) {
      frames.push({
        flipperLeft,
        flipperRight,
        plunger,
        nudge,
        timestamp: currentTimestamp,
      })
      currentTimestamp += 1000 / 60
    }
  }

  return frames
}

export class ReplayRecorder {
  private recording = false
  private metadata: ReplayMetadata | null = null
  private frames: InputFrame[] = []

  /**
   * Start recording a new session. Resets frame buffer.
   */
  start(metadata: ReplayMetadata): void {
    this.metadata = { ...metadata }
    this.frames = []
    this.recording = true
  }

  /**
   * Append an InputFrame for a single physics step.
   */
  recordFrame(frame: InputFrame): void {
    if (!this.recording) return
    this.frames.push({
      flipperLeft: frame.flipperLeft,
      flipperRight: frame.flipperRight,
      plunger: frame.plunger,
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

  static fromJSON(jsonString: string): ReplayPayload {
    const data = JSON.parse(jsonString) as Partial<ReplayPayload> & {
      build_id?: string
      map_id?: string
      final_score?: number
      target_score?: number
      replay_id?: string
      challenge_id?: string
      client_renderer?: 'webgl2' | 'webgpu'
      compressedFrames?: string
      compressed_frames?: string
    }

    let frames: InputFrame[] = Array.isArray(data.frames) ? data.frames : []
    const compressedStr = data.compressedFrames ?? data.compressed_frames
    if (frames.length === 0 && compressedStr) {
      frames = decompressInputFrames(compressedStr)
    }

    return {
      version: data.version ?? 1,
      buildId: data.buildId ?? data.build_id ?? '1.0.0',
      mapId: data.mapId ?? data.map_id ?? 'neon-helix',
      seed: data.seed ?? 0,
      physicsEngine: data.physicsEngine ?? 'rapier',
      renderer: data.renderer ?? data.client_renderer ?? 'webgl2',
      createdAt: data.createdAt ?? new Date().toISOString(),
      frames,
      compressedFrames: compressedStr,
      finalScore: data.finalScore ?? data.final_score ?? 0,
      targetScore: data.targetScore ?? data.target_score,
      replayId: data.replayId ?? data.replay_id,
      challengeId: data.challengeId ?? data.challenge_id,
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

