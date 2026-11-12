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
export const NO_BALL = -2147483648

/** Decode a ghost track's base64 Int32 millimetre triples. */
export function decodeGhostTrack(track: Pick<GhostTrack, 'track'>): Int32Array {
  const binary = atob(track.track)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int32Array(bytes.buffer, 0, Math.floor(bytes.length / 12) * 3)
}

/** Millimetre triples (`NO_BALL, 0, 0` for no ball) as a track's base64 little-endian Int32s. */
export function encodeGhostTrack(samples: readonly number[]): string {
  const bytes = new Uint8Array(Int32Array.from(samples).buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The ball's position as a track sample. */
export function trackSample(pos: { x: number; y: number; z: number } | null | undefined): [number, number, number] {
  return pos ? [Math.round(pos.x * 1000), Math.round(pos.y * 1000), Math.round(pos.z * 1000)] : [NO_BALL, 0, 0]
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

/** One ghost in a race: a verified run's track and who played it. */
export interface GhostLane {
  track: GhostTrack
  label: string
}

/** Lane colours, leader first: magenta (the challenger / #1), gold, cyan, lime, orange. */
const LANE_COLORS = ['#ff3cf0', '#ffd23c', '#3cf0ff', '#9cff3c', '#ff8a3c'] as const

function isLaneList(value: GhostTrack | readonly GhostLane[]): value is readonly GhostLane[] {
  return Array.isArray(value)
}

interface Lane {
  readonly samples: Int32Array
  readonly stride: number
  readonly renderer: GhostBallRenderer
}

/**
 * The ghosts a game races: one (a challenger's run) or several (a weekly
 * tournament's top verified runs, #490 Slice C), all started with the game.
 */
export class GhostRace {
  private readonly lanes: Lane[]
  private startStep: number | null = null
  /** The first lane's label (the challenger, or the leader). */
  readonly label: string
  readonly labels: readonly string[]

  constructor(scene: Scene, track: GhostTrack, label: string)
  constructor(scene: Scene, lanes: readonly GhostLane[])
  constructor(scene: Scene, trackOrLanes: GhostTrack | readonly GhostLane[], label = 'ghost') {
    const lanes = isLaneList(trackOrLanes) ? trackOrLanes : [{ track: trackOrLanes, label }]
    this.labels = lanes.map((l) => l.label)
    this.label = this.labels[0] ?? label
    this.lanes = lanes.map((lane, i) => {
      const renderer = new GhostBallRenderer(scene)
      renderer.setGhostColor(LANE_COLORS[i % LANE_COLORS.length] ?? LANE_COLORS[0], 0.45)
      renderer.hide()
      return { samples: decodeGhostTrack(lane.track), stride: lane.track.stride, renderer }
    })
  }

  /** How many ghosts race. */
  get size(): number {
    return this.lanes.length
  }

  /** A game started: the ghosts run from their frame 0 now. */
  begin(): void {
    this.startStep = simClockSteps()
  }

  /** Once per render frame. */
  update(): void {
    if (this.startStep === null) return
    const steps = simClockSteps() - this.startStep
    for (const lane of this.lanes) {
      const pos = ghostPositionAt(lane.samples, lane.stride, steps)
      if (!pos) {
        if (lane.renderer.isVisible()) lane.renderer.hide()
        continue
      }
      if (!lane.renderer.isVisible()) lane.renderer.show()
      lane.renderer.updatePosition(pos)
    }
  }

  dispose(): void {
    this.startStep = null
    for (const lane of this.lanes) lane.renderer.dispose()
  }
}
