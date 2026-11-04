/**
 * Live broadcast (#444 Slice E): when the player has opted in, each of their
 * runs on the in-process engine streams its tape to the arcade service a
 * chunk at a time, so others can watch it live. A chunk is `LIVE_CHUNK_STEPS`
 * fixed steps of input (the recorder's RLE rows) plus the C++ world's state
 * hash and the score after its last step, which a spectator replaying it must
 * land on, and the ball's path over it, which a spectator who has just joined
 * shows while their game catches up. The run plays the same with or without
 * it: this only reads the recorder, after each step.
 */

import { createTimerScope } from '../core/timers'
import type { InputFrame } from '../game-elements/types'
import { encodeGhostTrack, trackSample } from '../replay/ghost-race'
import { compressInputFrames, type ReplayRecorder } from '../replay/replay-recorder'
import type { LiveChunk } from './arcade-api'

/** Fixed steps per chunk: 5 s. */
export const LIVE_CHUNK_STEPS = 300
/** The ball's path: one sample every 3 steps (20 Hz). Divides LIVE_CHUNK_STEPS. */
export const LIVE_TRACK_STRIDE = 3
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30_000
/** A 0-frame final chunk checks nothing; the column still wants a hash. */
const NO_HASH = '0000000000000000'

export type LiveArcade = Pick<typeof import('./arcade-api'), 'startLiveRun' | 'appendLiveChunk' | 'ArcadeError'>

/** The service said no (a 4xx other than a rate limit): retrying the same request will not help. */
export function isRefusal(err: unknown, ArcadeError: LiveArcade['ArcadeError']): boolean {
  return err instanceof ArcadeError && !err.offline && err.status >= 400 && err.status < 500 && err.status !== 429
}

export interface LiveBroadcastHost {
  readonly replayRecorder: ReplayRecorder
  readonly score: number
  /** The C++ world's state hash (synchronous on the in-process engine). */
  stateHash(): string | null
  /** The primary ball's position, or null between balls. */
  ballPosition(): { x: number; y: number; z: number } | null
}

/**
 * off: not opted in · idle: opted in, no run streaming · connecting · live ·
 * offline: chunks wait for the network · stopped: the service refused this run.
 */
export type LiveBroadcastStatus = 'off' | 'idle' | 'connecting' | 'live' | 'offline' | 'stopped'

interface LiveRunState {
  /** The recorder's frame array for this run (`start()` replaces it). */
  readonly frames: readonly InputFrame[]
  liveId: string | null
  /** Frames already cut into chunks. */
  cut: number
  seq: number
  samples: number[]
  lastHash: string
  lastScore: number
  ended: boolean
  failed: boolean
}

export class LiveBroadcast {
  private readonly timers = createTimerScope()
  private run: LiveRunState | null = null
  /** Chunks not yet stored, oldest first (a quit run's last chunk can still be in here when the next run starts). */
  private readonly outbox: Array<{ run: LiveRunState; chunk: LiveChunk }> = []
  private sending = false
  private retryMs = RETRY_MIN_MS
  private retryTimer = 0
  private wakeOpen: (() => void) | null = null
  private status: LiveBroadcastStatus = 'off'
  private enabled = false
  private disposed = false
  /** Status changes, with the streaming run's id once it has one. */
  onStatus: ((status: LiveBroadcastStatus, liveId: string | null) => void) | null = null

  constructor(
    private readonly host: LiveBroadcastHost,
    private readonly api: LiveArcade,
    private readonly options: { tag?: () => string | null; signal?: AbortSignal } = {},
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.wake(), { signal: options.signal })
    }
  }

  /** Opt in or out. Opting out ends a run that is streaming. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled && this.run) this.abandon(this.run)
    if (!enabled) this.setStatus('off')
    else if (!this.run) this.setStatus('idle')
  }

  getStatus(): LiveBroadcastStatus {
    return this.status
  }

  /** The streaming run's id (for a watch link), once the service has given one. */
  getLiveId(): string | null {
    return this.run?.liveId ?? null
  }

  /** After every fixed step (`Game.afterFixedStep`). */
  onStep(): void {
    const rec = this.host.replayRecorder
    const frames = rec.getFrames()
    // A new recording started under a run that never ended: the player quit it.
    if (this.run && this.run.frames !== frames) this.abandon(this.run)
    if (!this.run) {
      // Runs stream from their first step, once frame 0's world fingerprint is on the tape.
      if (!this.enabled || !rec.isRecording() || frames.length !== 1) return
      const header = rec.getMetadata()
      if (header?.physicsEngine !== 'wasm-owner' || !header.initialSnapshot) return
      this.run = { frames, liveId: null, cut: 0, seq: 0, samples: [], lastHash: NO_HASH, lastScore: 0, ended: false, failed: false }
      void this.open(this.run, header)
    }
    const run = this.run
    const steps = frames.length
    if ((steps - 1) % LIVE_TRACK_STRIDE === 0) run.samples.push(...trackSample(this.host.ballPosition()))
    // Game over stops the recorder inside the run's last step.
    const over = !rec.isRecording()
    if (over || steps - run.cut >= LIVE_CHUNK_STEPS) this.cutChunk(run, over)
    if (over) this.run = null
  }

  private cutChunk(run: LiveRunState, final: boolean): void {
    if (run.failed) return
    const count = run.frames.length - run.cut
    const hash = count > 0 ? this.host.stateHash() : run.lastHash
    if (!hash) {
      // No fingerprint, no stream: a spectator could not check it.
      this.refuse(run)
      return
    }
    const score = Math.max(0, Math.floor(this.host.score))
    this.post(run, {
      seq: run.seq++,
      start_frame: run.cut,
      frame_count: count,
      frames: compressInputFrames(run.frames.slice(run.cut)),
      state_hash: hash,
      score,
      track: run.samples.length ? encodeGhostTrack(run.samples) : null,
      final,
    })
    run.cut += count
    run.samples = []
    run.lastHash = hash
    run.lastScore = score
  }

  /** The run stopped without a game over: a last, empty chunk ends it for spectators. */
  private abandon(run: LiveRunState): void {
    if (this.run === run) this.run = null
    if (run.ended || run.failed) return
    this.post(run, {
      seq: run.seq++,
      start_frame: run.cut,
      frame_count: 0,
      frames: '',
      state_hash: run.lastHash,
      score: run.lastScore,
      track: null,
      final: true,
    })
  }

  private post(run: LiveRunState, chunk: LiveChunk): void {
    run.ended = chunk.final
    this.outbox.push({ run, chunk })
    void this.flush()
  }

  private async open(run: LiveRunState, header: object): Promise<void> {
    this.setStatus('connecting')
    while (!run.liveId && !run.failed && !this.disposed) {
      try {
        run.liveId = await this.api.startLiveRun({
          header,
          mapId: (header as { mapId?: string }).mapId ?? 'neon-helix',
          tag: this.options.tag?.() ?? null,
          chunkSteps: LIVE_CHUNK_STEPS,
          trackStride: LIVE_TRACK_STRIDE,
        })
        this.retryMs = RETRY_MIN_MS
      } catch (err) {
        if (!this.retryable(err)) {
          this.refuse(run)
          return
        }
        this.setStatus('offline')
        await this.backoff()
      }
    }
    if (run.liveId && this.run === run) this.setStatus('live')
    await this.flush()
  }

  /** Store pending chunks in order, one at a time; on a network failure, wait and retry. */
  private async flush(): Promise<void> {
    if (this.sending || this.disposed) return
    this.sending = true
    try {
      while (this.outbox.length) {
        const { run, chunk } = this.outbox[0]
        if (run.failed) {
          this.outbox.shift()
          continue
        }
        // Still opening: open() flushes once the run has an id.
        if (!run.liveId) return
        try {
          await this.api.appendLiveChunk(run.liveId, chunk)
        } catch (err) {
          if (!this.retryable(err)) {
            this.refuse(run)
            continue
          }
          this.setStatus('offline')
          this.timers.clearTimeout(this.retryTimer)
          this.retryTimer = this.timers.setTimeout(() => void this.flush(), this.retryMs)
          this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2)
          return
        }
        this.outbox.shift()
        this.retryMs = RETRY_MIN_MS
        if (this.run?.failed) continue
        this.setStatus(this.run ? 'live' : this.enabled ? 'idle' : 'off')
      }
    } finally {
      this.sending = false
    }
  }

  private refuse(run: LiveRunState): void {
    run.failed = true
    if (this.run === run || !this.run) this.setStatus('stopped')
  }

  /** The network is back (or a retry is due): reopen and resend now. */
  private wake(): void {
    this.wakeOpen?.()
    this.retryMs = RETRY_MIN_MS
    void this.flush()
  }

  private backoff(): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => done(), this.retryMs)
      const done = () => {
        this.timers.clearTimeout(timer)
        this.wakeOpen = null
        resolve()
      }
      this.wakeOpen = done
      this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2)
    })
  }

  /**
   * Only a refusal (validation, an ended run: a 4xx) gives up on the run.
   * Offline, a timeout, a server error or a rate limit (a backlog after a
   * dropped connection streams no faster than real time) try again.
   */
  private retryable(err: unknown): boolean {
    return !isRefusal(err, this.api.ArcadeError)
  }

  private setStatus(status: LiveBroadcastStatus): void {
    if (status === this.status) return
    this.status = status
    this.onStatus?.(status, this.run?.liveId ?? null)
  }

  /** Ends a streaming run (best effort: its last chunk goes out if the network takes it now). */
  dispose(): void {
    if (this.run) this.abandon(this.run)
    this.disposed = true
    this.timers.dispose()
    this.wakeOpen?.()
    this.onStatus = null
  }
}
