/**
 * Race ghost (#444 Slice D): the challenger's ball, moving alongside the
 * player's own game on the same table. Its path is the replay verifier's
 * recording of the challenger's verified run (`ghost_tracks`), never a
 * client's self-report: one sample every `stride` fixed steps from frame 0,
 * so after the player's n-th step of a game the ghost is at sample
 * (n - 1) / stride, interpolated.
 */

import type { Scene } from '@babylonjs/core/scene'
import { simClockSteps } from '../core/sim-clock'
import type { GhostTrack } from '../arcade/arcade-api'
import { GhostBallRenderer } from './ghost-ball-renderer'

/** A track sample with no ball (between balls). */
const NO_BALL = -2147483648

/** Decode a ghost track's base64 Int32 millimetre triples. */
export function decodeGhostTrack(track: GhostTrack): Int32Array {
  const binary = atob(track.track)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int32Array(bytes.buffer, 0, Math.floor(bytes.length / 12) * 3)
}

/** The ghost's position (m) after `steps` steps of the run, or null (no ball, before start, past the end). */
export function ghostPositionAt(samples: Int32Array, stride: number, steps: number): { x: number; y: number; z: number } | null {
  if (steps < 1) return null
  const at = (steps - 1) / stride
  const i0 = Math.floor(at)
  const count = samples.length / 3
  if (i0 >= count) return null
  const i1 = Math.min(i0 + 1, count - 1)
  const a = i0 * 3
  const b = i1 * 3
  if (samples[a] === NO_BALL) return null
  const t = samples[b] === NO_BALL ? 0 : at - i0
  const lerp = (k: number) => ((samples[a + k] ?? 0) + ((samples[b + k] ?? 0) - (samples[a + k] ?? 0)) * t) / 1000
  return { x: lerp(0), y: lerp(1), z: lerp(2) }
}

export class GhostRace {
  private readonly samples: Int32Array
  private readonly stride: number
  private readonly renderer: GhostBallRenderer
  private startStep: number | null = null

  constructor(scene: Scene, track: GhostTrack, readonly label: string) {
    this.samples = decodeGhostTrack(track)
    this.stride = track.stride
    this.renderer = new GhostBallRenderer(scene)
    this.renderer.setGhostColor('#ff3cf0', 0.45)
    this.renderer.hide()
  }

  /** A game started: the ghost runs from its frame 0 now. */
  begin(): void {
    this.startStep = simClockSteps()
  }

  /** Once per render frame. */
  update(): void {
    if (this.startStep === null) return
    const pos = ghostPositionAt(this.samples, this.stride, simClockSteps() - this.startStep)
    if (!pos) {
      if (this.renderer.isVisible()) this.renderer.hide()
      return
    }
    if (!this.renderer.isVisible()) this.renderer.show()
    this.renderer.updatePosition(pos)
  }

  dispose(): void {
    this.startStep = null
    this.renderer.dispose()
  }
}
