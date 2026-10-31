/**
 * Live spectate (#444 Slice E): watch someone's run while they play it. The
 * spectator's own game replays the run's tape as it streams in: frame 0's
 * world snapshot is restored as for any replay, then every fixed step plays
 * one streamed frame, about one chunk behind the player. No server runs the
 * game and nothing is rolled back; the tape is the run.
 *
 * - Joining mid-run, the game fast-forwards from frame 0 to one chunk behind
 *   the live edge. Meanwhile the ghost follows the ball's streamed path at
 *   the live position, so it shows within one chunk interval however long
 *   the run has been going.
 * - After the last step of every chunk the game's C++ state hash and score
 *   must equal the player's (the chunk's fingerprint); a mismatch stops the
 *   spectate instead of showing a drifting run.
 * - Polling resumes where it left off after a dropped connection; the frames
 *   it missed arrive in order and the game catches up again.
 *
 * Loaded lazily (`game/live-ui`); nothing here is on the boot path.
 */

import { createTimerScope, type TimerScope } from '../core/timers'
import type { InputFrame } from '../game-elements/types'
import type { LiveChunk, LiveRun } from '../arcade/arcade-api'
import type { StepInputActions } from '../game/physics/physics-controller'
import { decodeGhostTrack, ghostPositionAt, NO_BALL } from './ghost-race'
import { decompressInputFrames } from './replay-recorder'
import type { ReplayRunner } from './replay-runner'

export type LiveSpectateArcade = Pick<typeof import('../arcade/arcade-api'), 'fetchLiveRun' | 'fetchLiveChunks' | 'ArcadeError'>

/** What the game provides (`game/live-ui` adapts `Game`). */
export interface LiveSpectateHost {
  readonly replayRunner: ReplayRunner
  readonly physicsController: {
    stepFixed(input: null, actions: StepInputActions | null, runner: ReplayRunner, recorder: null): void
  } | null
  readonly inputActions: StepInputActions | null
  readonly score: number
  readonly currentMapId?: string | null
  isPlaying(): boolean
  switchTableMap(mapName: string): void
  /** Arm a (streaming) replay and start a game on its table. */
  playReplay(raw: object, streaming: boolean): Promise<unknown>
  /** The C++ world's state hash. */
  stateHash(): string | null
  /** Fast-forwarding: hide the game's own balls and mute it. */
  setFastForward(on: boolean): void
  /** Fast-forwarding: the ghost at the ball's streamed position (null: no ball); undefined: it follows the game's ball again. */
  placeGhost(pos: { x: number; y: number; z: number } | null | undefined): void
  /** Stop playing the tape and leave the table (a desync, the end of an abandoned run, Leave). */
  stopSpectating(): void
}

/**
 * joining · catching-up (fast-forwarding to one chunk behind) · live ·
 * waiting (the player's chunks stopped coming) · reconnecting (our polls fail) ·
 * ended · desynced · failed (no such run, or the tape does not play here) · left.
 */
export type LiveSpectateState = 'joining' | 'catching-up' | 'live' | 'waiting' | 'reconnecting' | 'ended' | 'desynced' | 'failed' | 'left'

const TERMINAL: ReadonlySet<LiveSpectateState> = new Set(['ended', 'desynced', 'failed', 'left'])
const PAGE = 120
const RETRY_MAX_MS = 15_000
/**
 * Stepping time per render frame while fast-forwarding: most of the time
 * between frames, so a slow device (long frames) catches up as fast as a
 * quick one, within bounds.
 */
const CATCH_UP_SHARE = 0.6
const CATCH_UP_MIN_MS = 24
const CATCH_UP_MAX_MS = 250
/** No chunk for this long: the player is gone. */
const GONE_MS = 120_000

export interface LiveSpectateStats {
  chunks: number
  frames: number
  /** Chunk fingerprints checked, and how many matched. */
  checked: number
  matched: number
  mismatch: { seq: number; frame: number; hash: string | null; score: number; wantHash: string; wantScore: number } | null
  /** From join() to the ghost first showing the live ball (ms). */
  ghostAfterMs: number | null
}

export class LiveSpectator {
  private readonly timers: TimerScope
  private readonly now: () => number
  private state: LiveSpectateState = 'joining'
  private run: LiveRun | null = null
  private nextSeq = 0
  private received = 0
  private final = false
  private lastChunkAt = 0
  private fastForward = false
  private failures = 0
  private pollTimer = 0
  private lastPump = 0
  private readonly checks: Array<{ seq: number; endFrame: number; hash: string; score: number }> = []
  private track: number[] = []
  private trackSamples: Int32Array = new Int32Array(0)
  private reason = ''
  readonly stats: LiveSpectateStats = { chunks: 0, frames: 0, checked: 0, matched: 0, mismatch: null, ghostAfterMs: null }
  private joinedAt = 0
  onChange: ((state: LiveSpectateState) => void) | null = null

  constructor(
    private readonly host: LiveSpectateHost,
    private readonly api: LiveSpectateArcade,
    options: { now?: () => number; timers?: TimerScope } = {},
  ) {
    this.now = options.now ?? (() => performance.now())
    this.timers = options.timers ?? createTimerScope()
  }

  getState(): LiveSpectateState {
    return this.state
  }

  /** Why the spectate failed or stopped, for the banner. */
  getReason(): string {
    return this.reason
  }

  getRun(): LiveRun | null {
    return this.run
  }

  /** How far the game is through what has streamed (0–1). */
  getProgress(): number {
    return this.received ? this.host.replayRunner.getProgress().currentFrame / this.received : 0
  }

  /** The score the player's stream last reported. */
  getLiveScore(): number {
    return this.run?.score ?? 0
  }

  /** Fetch the run and everything streamed so far, then start the game on it. Resolves false when it cannot. */
  async join(liveId: string): Promise<boolean> {
    this.joinedAt = this.now()
    let frames: InputFrame[]
    try {
      const run = await this.api.fetchLiveRun(liveId)
      if (!run?.header) return this.fail('That live run does not exist (or has been cleared)')
      this.run = run
      frames = []
      for (const chunk of await this.fetchAll()) frames.push(...this.accept(chunk))
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err))
    }
    if (TERMINAL.has(this.state)) return false
    const header = this.run.header as { mapId?: string }
    if (header.mapId && this.host.currentMapId !== header.mapId) this.host.switchTableMap(header.mapId)
    await this.host.playReplay({ ...this.run.header, frames, finalScore: this.run.score }, !this.final)
    if (!this.host.isPlaying()) return this.fail('The run did not start here')
    this.setState('live')
    this.schedulePoll(this.final ? -1 : this.pollMs())
    return true
  }

  /** After every fixed step: check the fingerprint of a chunk the game has just finished. */
  onStep(): void {
    if (TERMINAL.has(this.state) || !this.run) return
    const runner = this.host.replayRunner
    const rejection = runner.getRejection()
    if (rejection) {
      this.stop('failed', `This run does not replay here: ${rejection.message}`)
      return
    }
    const at = runner.getProgress().currentFrame
    while (this.checks.length && this.checks[0].endFrame <= at) {
      const check = this.checks.shift()!
      if (check.endFrame < at) continue
      const hash = this.host.stateHash()
      const score = Math.max(0, Math.floor(this.host.score))
      this.stats.checked++
      if (hash === check.hash && score === check.score) {
        this.stats.matched++
        continue
      }
      this.stats.mismatch = { seq: check.seq, frame: at, hash, score, wantHash: check.hash, wantScore: check.score }
      this.stop('desynced', `Out of sync with the player at ${formatClock(at)}`)
      return
    }
    this.checkEnd()
  }

  /** The whole tape has played: a run that ended in a game over ends here too; one the player quit stops with its tape. */
  private checkEnd(): void {
    if (!this.final || this.host.replayRunner.getProgress().currentFrame < this.received) return
    const over = !this.host.isPlaying()
    this.stop('ended', over ? 'Game over' : 'The player left the game', !over)
  }

  /**
   * The frame a spectator watches: one chunk behind the live edge, moving
   * in real time between chunk arrivals (never past what has arrived).
   */
  private liveFrame(): number {
    const shown = this.received - this.run!.chunk_steps + ((this.now() - this.lastChunkAt) / 1000) * 60
    return Math.max(0, Math.min(this.received, Math.floor(shown)))
  }

  /** Once per render frame, after the game's own steps: fast-forward when far behind, place the ghost. */
  pump(): void {
    if (TERMINAL.has(this.state) || this.state === 'joining' || !this.run) return
    const runner = this.host.replayRunner
    const chunk = this.run.chunk_steps
    const position = () => runner.getProgress().currentFrame
    const now = this.now()
    const frameGap = this.lastPump ? now - this.lastPump : 0
    this.lastPump = now
    // More than half a chunk behind the frame a spectator should be watching (joining, or a slow device).
    if (!this.fastForward && this.liveFrame() - position() > chunk / 2) this.setFastForward(true)
    if (this.fastForward) {
      // Up to the frame the ghost is showing, so the handover does not jump.
      const target = this.liveFrame()
      const budget = Math.min(CATCH_UP_MAX_MS, Math.max(CATCH_UP_MIN_MS, frameGap * CATCH_UP_SHARE))
      const controller = this.host.physicsController
      while (position() < target && this.now() - now < budget && this.host.isPlaying() && runner.isPlaying() && !TERMINAL.has(this.state)) {
        controller?.stepFixed(null, this.host.inputActions, runner, null)
      }
      if (position() >= target || TERMINAL.has(this.state)) this.setFastForward(false)
    }
    if (TERMINAL.has(this.state)) return
    // The ghost shows the live ball: its streamed path while fast-forwarding, the game's own ball after.
    this.stats.ghostAfterMs ??= this.now() - this.joinedAt
    if (this.fastForward) {
      this.host.placeGhost(ghostPositionAt(this.trackSamples, this.run.track_stride, this.liveFrame()))
      this.setState('catching-up')
    } else if (this.state !== 'reconnecting') {
      const quiet = this.now() - this.lastChunkAt > 2 * this.pollMs() + (chunk / 60) * 1000
      this.setState(runner.isStarved() && quiet ? 'waiting' : 'live')
    }
  }

  /** Leave: stop polling and playing. */
  leave(): void {
    this.stop('left', '', true)
  }

  dispose(): void {
    if (this.fastForward) this.setFastForward(false)
    this.timers.dispose()
    this.onChange = null
  }

  private async fetchAll(): Promise<LiveChunk[]> {
    const all: LiveChunk[] = []
    for (;;) {
      const page = await this.api.fetchLiveChunks(this.run!.id, this.nextSeq + all.length, PAGE)
      all.push(...page)
      if (page.length < PAGE) return all
    }
  }

  /** Take the next chunk in order: its frames, fingerprint and the ball's path. */
  private accept(chunk: LiveChunk): InputFrame[] {
    const run = this.run!
    if (chunk.seq !== this.nextSeq || chunk.start_frame !== this.received) {
      throw new Error(`live stream out of order at chunk ${chunk.seq}`)
    }
    const frames = decompressInputFrames(chunk.frames)
    if (frames.length !== chunk.frame_count) throw new Error(`live chunk ${chunk.seq} holds ${frames.length} frames, not ${chunk.frame_count}`)
    const from = this.received
    this.received += frames.length
    this.nextSeq++
    this.stats.chunks++
    this.stats.frames = this.received
    run.score = chunk.score
    if (frames.length) this.checks.push({ seq: chunk.seq, endFrame: this.received, hash: chunk.state_hash, score: chunk.score })
    // One sample after each step n with (n - 1) % stride === 0; pad a missing path so later chunks stay aligned.
    const stride = run.track_stride
    const want = Math.ceil(this.received / stride) - Math.ceil(from / stride)
    const got = chunk.track ? decodeGhostTrack({ track: chunk.track }) : new Int32Array(0)
    for (let i = 0; i < want; i++) {
      if (i * 3 + 2 < got.length) this.track.push(got[i * 3], got[i * 3 + 1], got[i * 3 + 2])
      else this.track.push(NO_BALL, 0, 0)
    }
    this.trackSamples = Int32Array.from(this.track)
    if (chunk.final) this.final = true
    this.lastChunkAt = this.now()
    return frames
  }

  private async poll(): Promise<void> {
    if (TERMINAL.has(this.state) || !this.run) return
    let chunks: LiveChunk[]
    try {
      chunks = await this.fetchAll()
    } catch (err) {
      // Only a refusal (a 4xx other than a rate limit) ends it; offline, a timeout or a server error retries.
      const refused = err instanceof this.api.ArcadeError && !err.offline && err.status >= 400 && err.status < 500 && err.status !== 429
      if (refused) {
        this.stop('failed', err.message, true)
      } else {
        this.failures++
        this.setState('reconnecting')
        this.schedulePoll(Math.min(RETRY_MAX_MS, this.pollMs() * 2 ** this.failures))
      }
      return
    }
    if (TERMINAL.has(this.state)) return
    this.failures = 0
    try {
      for (const chunk of chunks) this.host.replayRunner.append(this.accept(chunk))
    } catch (err) {
      this.stop('failed', err instanceof Error ? err.message : String(err), true)
      return
    }
    // A closed tab sends no final chunk.
    if (!chunks.length && this.now() - this.lastChunkAt > GONE_MS) {
      this.stop('ended', 'The player left the game', true)
      return
    }
    if (this.final) {
      this.host.replayRunner.endStream()
      // Already waiting at the end of the tape: nothing more will step.
      this.checkEnd()
      if (TERMINAL.has(this.state)) return
    }
    if (this.state === 'reconnecting') this.setState('live')
    this.schedulePoll(this.final ? -1 : this.pollMs())
  }

  /** Twice per chunk interval. */
  private pollMs(): number {
    return ((this.run?.chunk_steps ?? 300) / 60) * 500
  }

  private schedulePoll(ms: number): void {
    this.timers.clearTimeout(this.pollTimer)
    if (ms >= 0) this.pollTimer = this.timers.setTimeout(() => void this.poll(), ms)
  }

  private setFastForward(on: boolean): void {
    if (on === this.fastForward) return
    this.fastForward = on
    this.host.setFastForward(on)
    if (!on) this.host.placeGhost(undefined)
  }

  private stop(state: LiveSpectateState, reason: string, leaveTable = state !== 'ended'): void {
    if (TERMINAL.has(this.state)) return
    this.reason = reason
    this.schedulePoll(-1)
    if (this.fastForward) this.setFastForward(false)
    this.setState(state)
    if (leaveTable) this.host.stopSpectating()
  }

  private fail(reason: string): false {
    this.reason = reason
    this.setState('failed')
    return false
  }

  private setState(state: LiveSpectateState): void {
    if (state === this.state) return
    this.state = state
    this.onChange?.(state)
  }
}

/** Steps as m:ss of play. */
export function formatClock(steps: number): string {
  const s = Math.floor(steps / 60)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
