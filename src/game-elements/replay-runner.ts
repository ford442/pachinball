/**
 * ReplayRunner — Replays recorded InputFrames into the physics apply path.
 * Disables live user input while active to ensure deterministic playback.
 */

import type { InputFrame } from './types'
import type { ReplayPayload } from './replay-recorder'

export class ReplayRunner {
  private payload: ReplayPayload | null = null
  private currentFrameIndex = 0
  private playing = false

  /**
   * Load a replay payload and arm it for playback.
   */
  load(payload: ReplayPayload): void {
    this.payload = payload
    this.currentFrameIndex = 0
    this.playing = true
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
  }

  stop(): void {
    this.playing = false
  }
}
