/**
 * @vitest-environment happy-dom
 */
/**
 * #444 Slice E — the live broadcast: a run streams in chunks of
 * LIVE_CHUNK_STEPS fixed steps, each fingerprinted after its last step; game
 * over sends the rest as the final chunk, quitting sends an empty one; a
 * dropped connection loses nothing and keeps the order; opting out streams
 * nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_CHUNK_STEPS, LIVE_TRACK_STRIDE } from '../src/arcade/live-broadcast'
import { decodeGhostTrack } from '../src/replay/ghost-race'
import { decompressInputFrames } from '../src/replay/replay-recorder'
import { FakeLiveCloud, frameAt, livePlayer, settle, ToyGame } from './helpers/live-fakes'

describe('live broadcast (#444 Slice E)', () => {
  let cloud: FakeLiveCloud
  beforeEach(() => {
    vi.useFakeTimers()
    cloud = new FakeLiveCloud()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('streams a run in fingerprinted chunks and ends it at game over', async () => {
    const player = livePlayer(cloud, { overAt: 2 * LIVE_CHUNK_STEPS + 130 })
    player.play(10_000)
    await settle()
    const run = cloud.only()
    expect(run.header).toMatchObject({ physicsEngine: 'wasm-owner', initialSnapshot: 'AAAA', seed: 7 })
    expect(run).toMatchObject({ player_tag: 'ACE', chunk_steps: LIVE_CHUNK_STEPS, track_stride: LIVE_TRACK_STRIDE, status: 'ended' })
    expect(run.stored.map((c) => [c.seq, c.start_frame, c.frame_count, c.final])).toEqual([
      [0, 0, 300, false],
      [1, 300, 300, false],
      [2, 600, 130, true],
    ])
    // Each chunk's fingerprint is the game after its last step: replay the tape to check.
    const replayed = new ToyGame()
    for (const chunk of run.stored) {
      for (const frame of decompressInputFrames(chunk.frames)) replayed.step(frame)
      expect(chunk.state_hash).toBe(replayed.stateHash())
      expect(chunk.score).toBe(replayed.score)
    }
    expect(run.frames).toBe(player.recorder.getLastPayload()?.frames.length)
    // The ball's path: one sample every 3 steps, after steps 1, 4, 7, …
    const track = decodeGhostTrack({ track: run.stored[1]!.track! })
    expect(track.length / 3).toBe(LIVE_CHUNK_STEPS / LIVE_TRACK_STRIDE)
    expect(track[0]).toBe(3010)
    expect(player.broadcast.getStatus()).toBe('idle')
  })

  it('a quit run ends with an empty final chunk when the next one starts', async () => {
    const player = livePlayer(cloud)
    player.play(450)
    player.start()
    player.play(1)
    await settle()
    const [quit, next] = [...cloud.runs.values()]
    expect(quit!.stored.map((c) => [c.seq, c.frame_count, c.final])).toEqual([[0, 300, false], [1, 0, true]])
    expect(quit!.stored[1]!.state_hash).toBe(quit!.stored[0]!.state_hash)
    expect(quit!.status).toBe('ended')
    expect(next!.status).toBe('live')
  })

  it('offline, chunks wait and go out in order when the network is back', async () => {
    const player = livePlayer(cloud)
    player.play(1)
    await settle()
    cloud.offlineWrites = true
    player.play(3 * LIVE_CHUNK_STEPS)
    await settle()
    expect(player.broadcast.getStatus()).toBe('offline')
    expect(cloud.only().stored).toHaveLength(0)
    cloud.offlineWrites = false
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(cloud.only().stored.map((c) => c.seq)).toEqual([0, 1, 2])
    expect(player.broadcast.getStatus()).toBe('live')
  })

  it('a run that starts offline opens once the network is back, from frame 0', async () => {
    cloud.offlineWrites = true
    const player = livePlayer(cloud)
    player.play(LIVE_CHUNK_STEPS + 10)
    await settle()
    expect(cloud.runs.size).toBe(0)
    cloud.offlineWrites = false
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(cloud.only().stored.map((c) => [c.start_frame, c.frame_count])).toEqual([[0, 300]])
    const frames = decompressInputFrames(cloud.only().stored[0]!.frames)
    expect(frames[5]?.plungerCharge).toBe(frameAt(5).plungerCharge)
  })

  it('an error that is not a refusal (an aborted read) is retried', async () => {
    const player = livePlayer(cloud)
    player.play(1)
    await settle()
    const append = cloud.api.appendLiveChunk
    let failures = 1
    cloud.api.appendLiveChunk = (id, chunk) => failures-- > 0 ? Promise.reject(new DOMException('The user aborted a request.', 'AbortError')) : append(id, chunk)
    player.play(LIVE_CHUNK_STEPS)
    await settle()
    expect(player.broadcast.getStatus()).toBe('offline')
    await vi.advanceTimersByTimeAsync(5000)
    await settle()
    expect(cloud.only().stored.map((c) => c.seq)).toEqual([0])
    expect(player.broadcast.getStatus()).toBe('live')
  })

  it('a refused chunk stops the run instead of retrying it forever', async () => {
    const player = livePlayer(cloud)
    player.play(1)
    await settle()
    cloud.only().status = 'ended'
    player.play(LIVE_CHUNK_STEPS)
    await settle()
    expect(player.broadcast.getStatus()).toBe('stopped')
    const calls = cloud.appendCalls
    await vi.advanceTimersByTimeAsync(120_000)
    expect(cloud.appendCalls).toBe(calls)
  })

  it('opted out, nothing streams; opting out mid-run ends the run', async () => {
    const player = livePlayer(cloud)
    player.broadcast.setEnabled(false)
    player.play(LIVE_CHUNK_STEPS)
    await settle()
    expect(cloud.runs.size).toBe(0)

    player.start()
    player.broadcast.setEnabled(true)
    player.play(LIVE_CHUNK_STEPS + 20)
    player.broadcast.setEnabled(false)
    await settle()
    expect(cloud.only().stored.map((c) => [c.frame_count, c.final])).toEqual([[300, false], [0, true]])
    expect(player.broadcast.getStatus()).toBe('off')
  })
})
