/**
 * ReplayRunner — Replays recorded InputFrames into the physics apply path.
 * Disables live user input while active to ensure deterministic playback.
 */

import type { InputFrame } from '../game-elements/types'
import type { ReplayPayload } from './replay-recorder'
import type { ReplayWorldFingerprint } from './replay-snapshot'

export class ReplayRunner {
  private payload: ReplayPayload | null = null
  private currentFrameIndex = 0
  private playing = false
  /** True from load()/reset() until the first replayed step has checked the frame-0 snapshot. */
  private snapshotPending = false

  /**
   * Load a replay payload and arm it for playback.
   */
  load(payload: ReplayPayload): void {
    this.payload = payload
    this.currentFrameIndex = 0
    this.playing = true
    this.snapshotPending = true
  }

  /**
   * The recording's world fingerprint, exactly once per playback: the
   * physics step that replays frame 0 restores / verifies it before stepping.
   */
  takeSnapshotCheck(): ReplayWorldFingerprint | null {
    if (!this.snapshotPending || !this.payload) return null
    this.snapshotPending = false
    const p = this.payload
    return {
      snapshotVersion: p.snapshotVersion,
      staticHash: p.staticHash,
      pinFieldOccupancy: p.pinFieldOccupancy,
      feederTunablesHash: p.feederTunablesHash,
      initialSnapshot: p.initialSnapshot,
    }
  }

  isPlaying(): boolean {
    return this.playing
  }

  /**
   * Consume and return the next frame in the replay stream.
   * Automatically stops playback when reaching end-of-stream.
   */
  getNextFrame(): InputFrame | null {
    if (!this.playing || !this.payload) return null
    if (this.currentFrameIndex >= this.payload.frames.length) {
      this.playing = false
      return null
    }
    const frame = this.payload.frames[this.currentFrameIndex++]!
    return frame
  }

  peekNextFrame(): InputFrame | null {
    if (!this.playing || !this.payload) return null
    return this.payload.frames[this.currentFrameIndex] ?? null
  }

  getProgress(): { currentFrame: number; totalFrames: number } {
    return {
      currentFrame: this.currentFrameIndex,
      totalFrames: this.payload?.frames.length ?? 0,
    }
  }

  getPayload(): ReplayPayload | null {
    return this.payload
  }

  reset(): void {
    this.currentFrameIndex = 0
    this.playing = this.payload !== null
    this.snapshotPending = this.playing
  }

  stop(): void {
    this.playing = false
  }
}
