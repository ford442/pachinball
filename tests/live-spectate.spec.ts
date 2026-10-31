import { test, expect, type Page } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner } from './helpers/wasm-owner-boot'

/**
 * #444 Slice E in the real game, on the in-process engine: one page plays a
 * run and streams it, a second page watches it live.
 *   - The spectator joins two chunks in and sees the ghost, at the ball's
 *     streamed position, within one chunk interval (5 s).
 *   - Its game replays the tape from frame 0's snapshot and lands on every
 *     chunk's fingerprint: the C++ state hash and the score.
 *   - It loses its connection for two chunks and catches up without a desync.
 *   - The player quits; the spectate ends with the tape.
 * The arcade service is a store in this test process with the database's
 * rules (order, sizes, resends); both pages reach it through an exposed function.
 */

interface Chunk {
  seq: number
  start_frame: number
  frame_count: number
  frames: string
  state_hash: string
  score: number
  track: string | null
  final: boolean
}

interface Run {
  id: string
  header: object
  map_id: string
  player_tag: string | null
  chunk_steps: number
  track_stride: number
  chunks: number
  frames: number
  score: number
  status: 'live' | 'left' | 'ended'
  created_at: string
  updated_at: string
}

type Answer = { value?: unknown; error?: { message: string; status: number; offline: boolean } }

class Cloud {
  runs = new Map<string, Run & { stored: Chunk[] }>()
  offlineReads = false
  private next = 0

  call(method: string, args: unknown[]): Answer {
    const offline = { error: { message: 'Failed to fetch', status: 0, offline: true } }
    const refuse = (message: string, status: number) => ({ error: { message, status, offline: false } })
    const row = (r: Run & { stored: Chunk[] }, withHeader: boolean) => {
      const { stored: _stored, header, ...rest } = r
      return withHeader ? { ...rest, header } : rest
    }
    switch (method) {
      case 'startLiveRun': {
        const r = args[0] as { header: object; mapId: string; tag: string | null; chunkSteps: number; trackStride: number }
        const id = `00000000-0000-4000-8000-${String(++this.next).padStart(12, '0')}`
        for (const run of this.runs.values()) if (run.status === 'live') run.status = 'left'
        const now = new Date().toISOString()
        this.runs.set(id, {
          id, header: r.header, map_id: r.mapId, player_tag: r.tag, chunk_steps: r.chunkSteps, track_stride: r.trackStride,
          chunks: 0, frames: 0, score: 0, status: 'live', created_at: now, updated_at: now, stored: [],
        })
        return { value: id }
      }
      case 'appendLiveChunk': {
        const [id, chunk] = args as [string, Chunk]
        const run = this.runs.get(id)
        if (!run) return refuse('no such live run of yours', 401)
        if (chunk.seq < run.chunks) {
          const was = run.stored[chunk.seq]!
          return was.state_hash === chunk.state_hash && was.frame_count === chunk.frame_count ? { value: run.frames } : refuse('stored differently', 409)
        }
        if (run.status === 'ended' || chunk.seq !== run.chunks) return refuse('out of order', 409)
        if ((!chunk.final && chunk.frame_count !== run.chunk_steps) || chunk.frame_count > run.chunk_steps) return refuse('chunk size', 400)
        run.stored.push({ ...chunk, start_frame: run.frames })
        run.chunks++
        run.frames += chunk.frame_count
        run.score = chunk.score
        if (chunk.final) run.status = 'ended'
        return { value: run.frames }
      }
      case 'fetchLiveRuns':
        if (this.offlineReads) return offline
        return { value: [...this.runs.values()].filter((r) => r.status === 'live').map((r) => row(r, false)) }
      case 'fetchLiveRun': {
        if (this.offlineReads) return offline
        const run = this.runs.get(args[0] as string)
        return { value: run ? row(run, true) : null }
      }
      case 'fetchLiveChunks': {
        if (this.offlineReads) return offline
        const [id, from, limit] = args as [string, number, number]
        return { value: (this.runs.get(id)?.stored ?? []).slice(from, from + (limit ?? 120)) }
      }
      default:
        return refuse(`no ${method}`, 400)
    }
  }

  only() {
    const [run] = [...this.runs.values()]
    if (!run) throw new Error('no live run yet')
    return run
  }
}

type LivePage = {
  game: {
    engine: { stopRenderLoop(): void; getDeltaTime: () => number }
    mapManager?: { update?: (dt: number) => void }
    startGame(): Promise<void>
    stateManager: { isPlaying(): boolean }
    ballManager: { getBallBody(): { setTranslation(v: object, w: boolean): void; setLinvel(v: object, w: boolean): void } }
    gameObjects: { getBumperVisuals(): Array<{ mesh: { position: { x: number; y: number; z: number } } }> }
    physicsController: { rebuildHandleCaches(): void; stepFixed(i: unknown, a: unknown, r: unknown, rec: unknown): void }
    inputActions: unknown
    replayRecorder: unknown
    scene: { getMeshByName(name: string): { isEnabled(): boolean; position: { x: number; y: number; z: number } } | null }
    liveUI: import('../src/game/live-ui').LiveUI
  }
  __liveCloud(method: string, args: unknown[]): Promise<Answer>
  __play(n: number): number
}

/** Route the page's live arcade calls to `cloud`. */
async function connect(page: Page, cloud: Cloud): Promise<void> {
  // The game loads its live UI lazily after boot (a fresh headless page can be busy compiling shaders for a while).
  await expect.poll(() => page.evaluate(() => !!(window as unknown as LivePage).game.liveUI), { timeout: 120_000 }).toBe(true)
  await page.exposeFunction('__liveCloud', (method: string, args: unknown[]) => cloud.call(method, args))
  await page.evaluate(async () => {
    const w = window as unknown as LivePage
    const { ArcadeError } = await import('/src/arcade/arcade-api.ts' as string) as typeof import('../src/arcade/arcade-api')
    const call = async (method: string, ...args: unknown[]) => {
      const res = await w.__liveCloud(method, args)
      if (res.error) throw new ArcadeError(res.error.message, res.error.status, res.error.offline)
      return res.value
    }
    w.game.liveUI.useArcade({
      ArcadeError,
      startLiveRun: (run) => call('startLiveRun', run) as Promise<string>,
      appendLiveChunk: (id, chunk) => call('appendLiveChunk', id, chunk) as Promise<number>,
      fetchLiveRuns: () => call('fetchLiveRuns') as never,
      fetchLiveRun: (id) => call('fetchLiveRun', id) as never,
      fetchLiveChunks: (id, from, limit) => call('fetchLiveChunks', id, from, limit) as never,
    })
  })
}

/** The player: broadcasting on, a scored ball (as the golden tapes), and scripted fixed steps. */
async function startPlayer(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as LivePage
    const g = w.game
    const getLiveUI = () => (window as unknown as LivePage).game.liveUI
    await getLiveUI()!.setBroadcasting(true)
    g.engine.stopRenderLoop()
    if (g.mapManager) g.mapManager.update = () => {}
    g.engine.getDeltaTime = () => 1000 / 60
    await g.startGame()
    const ball = g.ballManager.getBallBody()
    const p = g.gameObjects.getBumperVisuals()[0]!.mesh.position
    ball.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z + 0.9 }, true)
    ball.setLinvel({ x: 2, y: 0, z: -3 }, true)
    g.physicsController.rebuildHandleCaches()
    let steps = 0
    const source = {
      update() {},
      processBufferedInputs: () => {
        const s = steps++
        const fire = s % 600 === 5
        return {
          flipperLeft: s % 40 < 6, flipperRight: s % 40 >= 20 && s % 40 < 26,
          plungerCharge: fire ? 1 : null, plunger: fire, nudge: null, timestamp: 0,
        }
      },
    }
    w.__play = (n: number) => {
      for (let i = 0; i < n && g.stateManager.isPlaying(); i++) g.physicsController.stepFixed(source, g.inputActions, null, g.replayRecorder)
      return steps
    }
  })
}

const spectatorState = (page: Page) => page.evaluate(async () => {
  const getLiveUI = () => (window as unknown as LivePage).game.liveUI
  const s = getLiveUI()?.getSpectator()
  return s ? { state: s.getState(), reason: s.getReason(), stats: { ...s.stats } } : null
})

/** Base64 Int32 millimetre triples → metres. */
function decodeTrack(track: string): Array<{ x: number; z: number } | null> {
  const ints = new Int32Array(new Uint8Array(Buffer.from(track, 'base64')).buffer)
  const out: Array<{ x: number; z: number } | null> = []
  for (let i = 0; i + 2 < ints.length; i += 3) out.push(ints[i] === -2147483648 ? null : { x: ints[i]! / 1000, z: ints[i + 2]! / 1000 })
  return out
}

test.describe('live spectate (#444 Slice E)', () => {
  test('a spectator joins mid-run, follows it through a dropped connection, and every chunk matches', async ({ browser, playwright, baseURL }) => {
    test.setTimeout(600_000)
    const cloud = new Cloud()
    // Two browsers, so the two pages' headless GPU work (shader compiles) does not queue behind each other.
    const viewerBrowser = await playwright.chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] })
    const playerContext = await browser.newContext({ baseURL })
    // A small canvas: software rendering keeps up with the run on a loaded test host.
    const viewerContext = await viewerBrowser.newContext({ baseURL, viewport: { width: 480, height: 320 } })
    const player = await playerContext.newPage()
    const viewer = await viewerContext.newPage()
    const errors: string[] = []
    viewer.on('pageerror', (e) => errors.push(e.message))
    try {
      assertWasmOwnerReady(await bootWasmOwner(player))
      await connect(player, cloud)
      await startPlayer(player)
      assertWasmOwnerReady(await bootWasmOwner(viewer))
      await connect(viewer, cloud)

      // Two chunks (10 s of play) before anyone watches.
      await player.evaluate(() => (window as unknown as LivePage).__play(620))
      await expect.poll(() => cloud.runs.size && cloud.only().chunks).toBe(2)
      const run = cloud.only()
      expect(run.header).toMatchObject({ physicsEngine: 'wasm-owner' })

      // Join: the ghost within one chunk interval, on the ball's streamed path one chunk behind.
      await viewer.evaluate(async (id) => {
        const getLiveUI = () => (window as unknown as LivePage).game.liveUI
        void getLiveUI()!.spectate(id)
      }, run.id)
      // One chunk behind the live edge: on the path of the latest chunk.
      const path = run.stored.slice(-1).flatMap((c) => (c.track ? decodeTrack(c.track) : [])).filter((p): p is { x: number; z: number } => !!p)
      const ghostOffPath = async () => {
        const ghost = await viewer.evaluate(() => {
          const mesh = (window as unknown as LivePage).game.scene.getMeshByName('ghostBallMesh')
          return mesh?.isEnabled() ? { x: mesh.position.x, z: mesh.position.z } : null
        })
        return ghost ? Math.min(...path.map((p) => Math.hypot(p.x - ghost.x, p.z - ghost.z))) : Infinity
      }
      await expect.poll(ghostOffPath, { timeout: 60_000, intervals: [100] }).toBeLessThan(0.05)
      // Timed in the page (a loaded test host makes every evaluate slow): within one chunk interval of joining.
      expect((await spectatorState(viewer))?.stats.ghostAfterMs).toBeLessThan(5000)
      // Every state the spectate goes through from here.
      await viewer.evaluate(async () => {
        const getLiveUI = () => (window as unknown as LivePage).game.liveUI
        const s = getLiveUI()!.getSpectator()!
        const w = window as unknown as { __states: string[] }
        w.__states = [s.getState()]
        const render = s.onChange
        s.onChange = (state) => {
          w.__states.push(state)
          render?.(state)
        }
      })
      const states = () => viewer.evaluate(() => (window as unknown as { __states: string[] }).__states)

      // The player keeps playing, a chunk at a time, in about real time.
      const playChunks = async (n: number) => {
        for (let i = 0; i < n; i++) {
          await player.evaluate(() => (window as unknown as LivePage).__play(300))
          await viewer.waitForTimeout(5000)
        }
      }
      await playChunks(2)
      // Caught up: watching live, or waiting at the live edge for the player's next chunk.
      const caughtUp = async () => (await states()).some((st) => st === 'live' || st === 'waiting')
      await expect.poll(caughtUp, { timeout: 90_000 }).toBe(true)

      // The spectator drops off for two chunks, then comes back.
      cloud.offlineReads = true
      await playChunks(2)
      await expect.poll(states, { timeout: 30_000 }).toContain('reconnecting')
      cloud.offlineReads = false
      await playChunks(1)

      // Every chunk the spectator has played through matched, and it catches up to one chunk behind.
      const total = cloud.only().chunks
      await expect.poll(async () => (await spectatorState(viewer))?.stats.checked ?? 0, { timeout: 90_000 }).toBeGreaterThanOrEqual(total - 2)
      const mid = await spectatorState(viewer)
      expect(mid?.stats.mismatch).toBeNull()
      expect(mid?.stats.matched).toBe(mid?.stats.checked)

      // The player quits: the next game's first step ends this run; the spectate ends with its tape.
      await player.evaluate(async () => {
        const w = window as unknown as LivePage
        await w.game.startGame()
        w.__play(1)
      })
      await expect.poll(() => cloud.only().status, { timeout: 10_000 }).toBe('ended')
      await expect.poll(async () => (await spectatorState(viewer))?.state, { timeout: 90_000 }).toBe('ended')
      const end = await spectatorState(viewer)
      expect(end?.reason).toBe('The player left the game')
      expect(end?.stats.mismatch).toBeNull()
      expect(end?.stats.checked).toBe(cloud.only().stored.filter((c) => c.frame_count > 0).length)
      expect(end?.stats.matched).toBe(end?.stats.checked)
      expect(await states()).not.toContain('desynced')
      expect(errors).toEqual([])
    } finally {
      await playerContext.close()
      await viewerContext.close()
      await viewerBrowser.close()
    }
  })
})
