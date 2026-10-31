/**
 * #444 Slice E test doubles: an in-memory arcade service that holds live
 * runs to the rules `live_start` / `live_append` enforce, and a toy game
 * whose state hash and score depend on every input frame it steps (only on
 * what the RLE tape keeps), so a spectator that replays a tape step for step
 * lands on the player's fingerprints and one that skips or alters a frame
 * does not.
 */

import { ArcadeError, type LiveChunk, type LiveRun } from '../../src/arcade/arcade-api'
import { LiveBroadcast } from '../../src/arcade/live-broadcast'
import type { InputFrame } from '../../src/game-elements/types'
import { ReplayRecorder, REPLAY_SCHEMA_VERSION } from '../../src/replay/replay-recorder'

export class ToyGame {
  steps = 0
  score = 0
  private h = 0x811c9dc5
  constructor(private readonly overAt = Infinity) {}

  get over(): boolean {
    return this.steps >= this.overAt
  }

  step(frame: InputFrame): void {
    const bits = (frame.flipperLeft ? 1 : 0) | (frame.flipperRight ? 2 : 0) | (frame.plungerCharge !== null ? 4 : 0)
    this.h = Math.imul(this.h ^ (bits + 1 + Math.round((frame.plungerCharge ?? 0) * 100)), 0x01000193) >>> 0
    this.steps++
    if (frame.flipperLeft && this.steps % 7 === 0) this.score += 10
  }

  stateHash(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0').repeat(2)
  }

  /** The ball moves 1 cm a step along x, so a path sample says which step it was taken after. */
  ball(): { x: number; y: number; z: number } {
    return { x: this.steps / 100, y: 0.25, z: -1 }
  }
}

/** The scripted input of step `s` (0-based). */
export function frameAt(s: number): InputFrame {
  const fire = s % 600 === 5
  return {
    flipperLeft: s % 40 < 6,
    flipperRight: s % 40 >= 20 && s % 40 < 26,
    plungerCharge: fire ? 0.75 : null,
    plunger: fire,
    nudge: null,
    timestamp: 0,
  }
}

interface StoredRun extends LiveRun {
  header: object
  stored: LiveChunk[]
}

/** The arcade service, as far as live spectate uses it. */
export class FakeLiveCloud {
  runs = new Map<string, StoredRun>()
  offlineWrites = false
  offlineReads = false
  appendCalls = 0
  private next = 0

  readonly api = {
    ArcadeError,
    startLiveRun: async (run: { header: object; mapId: string; tag: string | null; chunkSteps: number; trackStride: number }): Promise<string> => {
      if (this.offlineWrites) throw new ArcadeError('Failed to fetch', 0, true)
      const id = `00000000-0000-4000-8000-${String(++this.next).padStart(12, '0')}`
      for (const r of this.runs.values()) if (r.status === 'live') r.status = 'left'
      this.runs.set(id, {
        id, header: run.header, map_id: run.mapId, player_tag: run.tag, chunk_steps: run.chunkSteps, track_stride: run.trackStride,
        chunks: 0, frames: 0, score: 0, status: 'live', created_at: '', updated_at: '', stored: [],
      })
      return id
    },
    appendLiveChunk: async (liveId: string, chunk: LiveChunk): Promise<number> => {
      this.appendCalls++
      if (this.offlineWrites) throw new ArcadeError('Failed to fetch', 0, true)
      const run = this.runs.get(liveId)
      if (!run) throw new ArcadeError('no such live run of yours', 401)
      if (chunk.seq < run.chunks) {
        const was = run.stored[chunk.seq]!
        if (was.frame_count === chunk.frame_count && was.state_hash === chunk.state_hash && was.final === chunk.final) return run.frames
        throw new ArcadeError('chunk already stored, differently', 409)
      }
      if (run.status === 'ended') throw new ArcadeError('this live run has ended', 409)
      if (chunk.seq !== run.chunks) throw new ArcadeError('chunks arrive in order', 409)
      if (ReplayRecorder.fromJSON({ compressedFrames: chunk.frames }).frames.length !== chunk.frame_count) throw new ArcadeError('frame_count', 400)
      if ((!chunk.final && chunk.frame_count !== run.chunk_steps) || chunk.frame_count > run.chunk_steps) throw new ArcadeError('chunk size', 400)
      run.stored.push({ ...chunk, start_frame: run.frames })
      run.chunks++
      run.frames += chunk.frame_count
      run.score = chunk.score
      if (chunk.final) run.status = 'ended'
      return run.frames
    },
    fetchLiveRuns: async (): Promise<LiveRun[]> => {
      if (this.offlineReads) throw new ArcadeError('Failed to fetch', 0, true)
      return [...this.runs.values()].filter((r) => r.status === 'live').map(({ stored: _s, header: _h, ...run }) => run)
    },
    fetchLiveRun: async (id: string): Promise<LiveRun | null> => {
      if (this.offlineReads) throw new ArcadeError('Failed to fetch', 0, true)
      const run = this.runs.get(id)
      if (!run) return null
      const { stored: _s, ...row } = run
      return structuredClone(row)
    },
    fetchLiveChunks: async (id: string, fromSeq: number, limit = 120): Promise<LiveChunk[]> => {
      if (this.offlineReads) throw new ArcadeError('Failed to fetch', 0, true)
      return structuredClone((this.runs.get(id)?.stored ?? []).slice(fromSeq, fromSeq + limit))
    },
  }

  only(): StoredRun {
    const [run] = [...this.runs.values()]
    if (!run) throw new Error('no live run')
    return run
  }
}

/** A player: the real recorder and broadcaster around a toy game, stepped like `stepFixed`. */
export function livePlayer(cloud: FakeLiveCloud, options: { overAt?: number; tag?: string } = {}) {
  const recorder = new ReplayRecorder()
  let game = new ToyGame(options.overAt)
  const broadcast = new LiveBroadcast(
    {
      replayRecorder: recorder,
      get score() { return game.score },
      stateHash: () => game.stateHash(),
      ballPosition: () => game.ball(),
    },
    cloud.api,
    { tag: () => options.tag ?? 'ACE' },
  )
  broadcast.setEnabled(true)

  const start = () => {
    game = new ToyGame(options.overAt)
    recorder.start({
      version: REPLAY_SCHEMA_VERSION, buildId: 'test', mapId: 'neon-helix', seed: 7,
      physicsEngine: 'wasm-owner', renderer: 'webgl2', createdAt: '2026-10-17T00:00:00Z',
    })
  }
  start()

  return {
    recorder,
    broadcast,
    get game() { return game },
    start,
    /** `n` fixed steps: record, fingerprint frame 0, step, game over, then the after-step hook. */
    play(n: number): void {
      for (let i = 0; i < n && recorder.isRecording(); i++) {
        const frame = frameAt(game.steps)
        recorder.recordFrame(frame)
        if (recorder.getFrameCount() === 1) recorder.attachWorldFingerprint({ snapshotVersion: 1, initialSnapshot: 'AAAA' })
        game.step(frame)
        if (game.over) recorder.stop(game.score)
        broadcast.onStep()
      }
    },
  }
}

/** Let pending promise chains (sends, polls) run. */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
