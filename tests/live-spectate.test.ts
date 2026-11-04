/**
 * @vitest-environment happy-dom
 */
/**
 * #444 Slice E — live spectate, end to end in Node: a player's run streams
 * through the real recorder and broadcaster into an in-memory arcade, and a
 * spectator's game (a toy game behind the real replay runner) follows it.
 *   - Joining mid-run, the ghost shows at the live position within one chunk
 *     interval, and the game fast-forwards to one chunk behind.
 *   - Every chunk's fingerprint (state hash + score after its last step) matches.
 *   - A dropped connection (the spectator's or the player's) does not desync.
 *   - A tampered chunk is caught; game over and quitting both end the spectate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_CHUNK_STEPS } from '../src/arcade/live-broadcast'
import { ReplayRecorder } from '../src/replay/replay-recorder'
import { ReplayRunner } from '../src/replay/replay-runner'
import { LiveSpectator, type LiveSpectateHost } from '../src/replay/live-spectate'
import { FakeLiveCloud, livePlayer, settle, ToyGame } from './helpers/live-fakes'

const FRAME_MS = 1000 / 60
const CHUNK_MS = (LIVE_CHUNK_STEPS / 60) * 1000

/** A spectator's game: the toy game stepped through a real ReplayRunner, on a clock the test moves. */
function spectatorGame(cloud: FakeLiveCloud) {
  const runner = new ReplayRunner()
  let game = new ToyGame()
  let playing = false
  let clock = 0
  const ghosts: Array<{ at: number; pos: { x: number } | null | undefined }> = []
  const fastForward: boolean[] = []
  let left = 0

  const host: LiveSpectateHost = {
    replayRunner: runner,
    physicsController: {
      // As GamePhysicsController.stepFixed: a starved stream does not step; each step plays one frame.
      stepFixed: (_input, _actions, r) => {
        if (r.isStarved() || !playing) return
        const frame = r.getNextFrame()
        if (!frame) return
        game.step(frame)
        // The catch-up loop's budget: 0.2 ms of "work" per step.
        clock += 0.2
        if (game.over) playing = false
        spectator.onStep()
      },
    },
    inputActions: null,
    get score() { return game.score },
    currentMapId: 'neon-helix',
    isPlaying: () => playing,
    switchTableMap: vi.fn(),
    playReplay: async (raw, streaming) => {
      runner.load(ReplayRecorder.fromJSON(raw), streaming)
      game = new ToyGame(Infinity)
      playing = true
    },
    stateHash: () => game.stateHash(),
    setFastForward: (on) => { fastForward.push(on) },
    placeGhost: (pos) => { ghosts.push({ at: clock, pos }) },
    stopSpectating: () => {
      left++
      runner.stop()
      playing = false
    },
  }
  const spectator = new LiveSpectator(host, cloud.api, { now: () => clock })

  return {
    spectator,
    runner,
    ghosts,
    fastForward,
    get left() { return left },
    get game() { return game },
    set overAt(n: number) { game = Object.assign(game, { overAt: n }) },
    get clock() { return clock },
    /** One render frame: the game's own real-time step, then the spectator's pump. */
    frame(): void {
      clock += FRAME_MS
      host.physicsController!.stepFixed(null, null, runner, null)
      spectator.pump()
    },
  }
}

describe('live spectate (#444 Slice E)', () => {
  let cloud: FakeLiveCloud
  beforeEach(() => {
    vi.useFakeTimers()
    cloud = new FakeLiveCloud()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Real time passing for both: the player plays `ms` of steps while the spectator renders frames. */
  async function both(player: ReturnType<typeof livePlayer>, viewer: ReturnType<typeof spectatorGame>, ms: number) {
    for (let t = 0; t < ms; t += FRAME_MS) {
      player.play(1)
      viewer.frame()
      await vi.advanceTimersByTimeAsync(FRAME_MS)
    }
    await settle()
  }

  it('joining mid-run: the ghost is at the live position at once, then the game catches up and every fingerprint matches', async () => {
    const player = livePlayer(cloud)
    player.play(10 * LIVE_CHUNK_STEPS + 40)
    await settle()
    const viewer = spectatorGame(cloud)
    const joinedAt = viewer.clock
    expect(await viewer.spectator.join(cloud.only().id)).toBe(true)
    viewer.frame()

    // Within one chunk interval: the ghost at the frame one chunk behind the live edge.
    const first = viewer.ghosts.find((g) => g.pos)
    expect(first).toBeDefined()
    expect(first!.at - joinedAt).toBeLessThan(CHUNK_MS)
    expect(viewer.spectator.stats.ghostAfterMs).toBeLessThan(CHUNK_MS)
    const liveFrame = 10 * LIVE_CHUNK_STEPS - LIVE_CHUNK_STEPS
    expect(first!.pos!.x).toBeCloseTo(liveFrame / 100, 1)
    expect(viewer.spectator.getState()).toBe('catching-up')
    expect(viewer.fastForward).toEqual([true])

    await both(player, viewer, 3 * CHUNK_MS)
    expect(viewer.fastForward).toEqual([true, false])
    expect(viewer.ghosts.at(-1)?.pos).toBeUndefined()
    expect(viewer.spectator.getState()).toBe('live')
    // One chunk behind (plus the poll in between), and every chunk so far checked.
    const behind = cloud.only().frames - viewer.runner.getProgress().currentFrame
    expect(behind).toBeGreaterThan(0)
    expect(behind).toBeLessThanOrEqual(2 * LIVE_CHUNK_STEPS)
    const { stats } = viewer.spectator
    expect(stats.checked).toBeGreaterThanOrEqual(10)
    expect(stats.matched).toBe(stats.checked)
    expect(stats.mismatch).toBeNull()
    expect(viewer.game.stateHash()).toBe(new ToyGameAt(viewer.runner.getProgress().currentFrame).stateHash())
  })

  it('joining two chunks in fast-forwards too: the spectator watches one chunk behind, not two', async () => {
    const player = livePlayer(cloud)
    player.play(2 * LIVE_CHUNK_STEPS)
    await settle()
    const viewer = spectatorGame(cloud)
    await viewer.spectator.join(cloud.only().id)
    viewer.frame()
    expect(viewer.fastForward[0]).toBe(true)
    expect(viewer.ghosts.find((g) => g.pos)?.pos?.x).toBeCloseTo(LIVE_CHUNK_STEPS / 100, 1)
    for (let i = 0; i < 20; i++) viewer.frame()
    expect(viewer.runner.getProgress().currentFrame).toBeGreaterThanOrEqual(LIVE_CHUNK_STEPS)
    expect(viewer.spectator.stats).toMatchObject({ checked: 1, matched: 1 })
  })

  it('a dropped connection — the spectator\'s, then the player\'s — does not desync', async () => {
    const player = livePlayer(cloud)
    player.play(2 * LIVE_CHUNK_STEPS)
    await settle()
    const viewer = spectatorGame(cloud)
    await viewer.spectator.join(cloud.only().id)
    await both(player, viewer, 2 * CHUNK_MS)
    expect(viewer.spectator.getState()).toBe('live')

    // The spectator goes offline for four chunks: polls fail, the game plays what it has.
    cloud.offlineReads = true
    await both(player, viewer, 4 * CHUNK_MS)
    expect(['reconnecting', 'live']).toContain(viewer.spectator.getState())
    expect(viewer.runner.isStarved()).toBe(true)
    cloud.offlineReads = false
    await both(player, viewer, 3 * CHUNK_MS)
    expect(viewer.spectator.getState()).toBe('live')

    // The player goes offline for three chunks: the stream stalls, then the backlog arrives in order.
    cloud.offlineWrites = true
    await both(player, viewer, 3 * CHUNK_MS)
    expect(viewer.spectator.getState()).toBe('waiting')
    cloud.offlineWrites = false
    window.dispatchEvent(new Event('online'))
    await both(player, viewer, 4 * CHUNK_MS)
    expect(viewer.spectator.getState()).toBe('live')

    const { stats } = viewer.spectator
    expect(stats.checked).toBeGreaterThanOrEqual(10)
    expect(stats.matched).toBe(stats.checked)
    expect(stats.mismatch).toBeNull()
    expect(viewer.left).toBe(0)
  })

  it('a poll that fails with something other than a refusal (an aborted read) retries', async () => {
    const player = livePlayer(cloud)
    player.play(LIVE_CHUNK_STEPS)
    await settle()
    const viewer = spectatorGame(cloud)
    await viewer.spectator.join(cloud.only().id)
    const fetchLiveChunks = cloud.api.fetchLiveChunks
    cloud.api.fetchLiveChunks = () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
    await both(player, viewer, CHUNK_MS)
    expect(viewer.spectator.getState()).toBe('reconnecting')
    cloud.api.fetchLiveChunks = fetchLiveChunks
    await both(player, viewer, 3 * CHUNK_MS)
    expect(['live', 'catching-up']).toContain(viewer.spectator.getState())
    expect(viewer.spectator.stats.mismatch).toBeNull()
    expect(viewer.spectator.stats.checked).toBeGreaterThanOrEqual(2)
  })

  it('a chunk that does not match its tape stops the spectate at that chunk', async () => {
    const player = livePlayer(cloud)
    player.play(4 * LIVE_CHUNK_STEPS)
    await settle()
    cloud.only().stored[2]!.state_hash = 'ffffffffffffffff'
    const viewer = spectatorGame(cloud)
    await viewer.spectator.join(cloud.only().id)
    for (let i = 0; i < 200 && viewer.spectator.getState() !== 'desynced'; i++) viewer.frame()
    expect(viewer.spectator.getState()).toBe('desynced')
    expect(viewer.spectator.stats.mismatch).toMatchObject({ seq: 2, frame: 3 * LIVE_CHUNK_STEPS })
    expect(viewer.spectator.stats.matched).toBe(2)
    expect(viewer.left).toBe(1)
    expect(viewer.spectator.getReason()).toMatch(/Out of sync/)
  })

  it('game over ends the spectate on the same step; a quit run stops with its tape', async () => {
    const over = livePlayer(cloud, { overAt: LIVE_CHUNK_STEPS + 77 })
    over.play(10_000)
    await settle()
    const viewer = spectatorGame(cloud)
    await viewer.spectator.join(cloud.only().id)
    viewer.overAt = LIVE_CHUNK_STEPS + 77
    for (let i = 0; i < 1000 && viewer.spectator.getState() !== 'ended'; i++) viewer.frame()
    expect(viewer.spectator.getState()).toBe('ended')
    expect(viewer.spectator.getReason()).toBe('Game over')
    expect(viewer.left).toBe(0)
    expect(viewer.spectator.stats).toMatchObject({ checked: 2, matched: 2 })

    const quitCloud = new FakeLiveCloud()
    const quitter = livePlayer(quitCloud)
    quitter.play(LIVE_CHUNK_STEPS + 50)
    await settle()
    const watcher = spectatorGame(quitCloud)
    await watcher.spectator.join(quitCloud.only().id)
    quitter.start()
    quitter.play(1)
    await settle()
    await vi.advanceTimersByTimeAsync(CHUNK_MS)
    for (let i = 0; i < 1000 && watcher.spectator.getState() !== 'ended'; i++) watcher.frame()
    expect(watcher.spectator.getState()).toBe('ended')
    expect(watcher.spectator.getReason()).toBe('The player left the game')
    expect(watcher.runner.getProgress().currentFrame).toBe(LIVE_CHUNK_STEPS)
    expect(watcher.left).toBe(1)
  })

  it('a run that does not exist fails softly', async () => {
    const viewer = spectatorGame(cloud)
    expect(await viewer.spectator.join('00000000-0000-4000-8000-00000000dead')).toBe(false)
    expect(viewer.spectator.getState()).toBe('failed')
  })
})

/** The toy game after `n` steps of the scripted input. */
class ToyGameAt extends ToyGame {
  constructor(n: number) {
    super()
    const player = livePlayer(new FakeLiveCloud())
    player.broadcast.setEnabled(false)
    player.play(n)
    Object.assign(this, player.game)
  }
}
