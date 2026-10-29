/**
 * @vitest-environment happy-dom
 *
 * Which table a game starts on, and in what order `startGame` builds it: the
 * session RNG is seeded with the machine's seed BEFORE the table is rebuilt (the
 * weekly machine draws through getLayoutRng), and a replay of a weekly run
 * rebuilds the descriptor from the tape's seed before the frame-0 snapshot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveStartMachine, type StartMachineInput } from '../src/cascade/start-machine'
import { getDailyCascadeState, resetDailyCascadeState } from '../src/cascade/daily-cascade-state'
import { generateWeeklyMachine, weeklyMachineHash } from '../src/cascade/weekly-machine'
import { getChallengeSystem, resetChallengeSystem } from '../src/replay/challenge-system'
import { ReplayRecorder, REPLAY_SCHEMA_VERSION, type ReplayPayload } from '../src/replay/replay-recorder'
import { initSessionRng, getSessionSeed, seedFromWeeklyId, weeklySeedId } from '../src/core/seeded-rng'
import { GameLifecycle, type LifecycleHost } from '../src/game/game-lifecycle'
import type { StartMachine } from '../src/cascade/start-machine'

const input = (over: Partial<StartMachineInput> = {}): StartMachineInput => ({
  mode: 'vanilla',
  modeSeed: 0,
  replay: null,
  challengeSeed: null,
  campaign: false,
  ...over,
})

describe('resolveStartMachine', () => {
  it.each<[string, Partial<StartMachineInput>, StartMachine]>([
    ['plain vanilla start', {}, { kind: 'vanilla' }],
    ['Weekly mode plays the mode seed', { mode: 'weekly', modeSeed: 77 }, { kind: 'weekly', seed: 77 }],
    ['Weekly mode wins over a share link', { mode: 'weekly', modeSeed: 77, challengeSeed: 5 }, { kind: 'weekly', seed: 77 }],
    ['Daily keeps its cascade layout, share link or not', { mode: 'daily', challengeSeed: 5 }, { kind: 'cascade' }],
    ['Free Play keeps its cascade layout', { mode: 'free' }, { kind: 'cascade' }],
    ['a share link on a vanilla start selects the weekly machine for its seed', { challengeSeed: 12345 }, { kind: 'weekly', seed: 12345 }],
    ['seed 0 is a seed', { challengeSeed: 0 }, { kind: 'weekly', seed: 0 }],
    ['the campaign rides the vanilla table', { challengeSeed: 12345, campaign: true }, { kind: 'vanilla' }],
  ])('%s', (_name, over, expected) => {
    expect(resolveStartMachine(input(over))).toEqual(expected)
  })

  it('a weekly tape rebuilds the machine from its seed, whatever the spectator selected', () => {
    for (const mode of ['vanilla', 'daily', 'free', 'weekly'] as const) {
      expect(resolveStartMachine(input({ mode, replay: { seed: 99, machine: 'weekly' }, challengeSeed: 3 }))).toEqual({
        kind: 'weekly',
        seed: 99,
      })
    }
  })

  it('any other tape never inherits the spectator’s weekly mode or share link', () => {
    expect(resolveStartMachine(input({ mode: 'weekly', modeSeed: 7, replay: { seed: 99 } }))).toEqual({ kind: 'vanilla' })
    expect(resolveStartMachine(input({ replay: { seed: 99 }, challengeSeed: 3 }))).toEqual({ kind: 'vanilla' })
    expect(resolveStartMachine(input({ mode: 'daily', replay: { seed: 99 } }))).toEqual({ kind: 'cascade' })
  })
})

describe('weekly mode in DailyCascadeState', () => {
  beforeEach(() => resetDailyCascadeState())

  it('takes its seed from the ISO week and rolls over with the calendar', () => {
    const state = getDailyCascadeState()
    state.setMode('weekly')
    expect(state.getSeedId()).toBe(weeklySeedId())
    expect(state.getModeSeed()).toBe(seedFromWeeklyId(weeklySeedId()))
    expect(state.displaySeedLabel()).toBe(`Weekly: ${weeklySeedId()}`)

    state.applyWeeklySeed(new Date('2026-10-29T12:00:00Z'))
    expect(state.getSeedId()).toBe('2026-W44')
    expect(state.getSeed()).toBe(seedFromWeeklyId('2026-W44'))
    // A tab left open past the week: the mode seed rolls to the current week.
    expect(state.getModeSeed()).toBe(seedFromWeeklyId(weeklySeedId()))
  })

  it('builds the layout once per seed and only with the session seeded', async () => {
    const state = getDailyCascadeState()
    await state.loadWeekly()
    initSessionRng(31)
    const layout = state.weeklyLayout(31)
    expect(state.weeklyLayout(31)).toBe(layout)
    expect(state.getWeeklySeed()).toBe(31)
    initSessionRng(32)
    expect(state.weeklyLayout(32)).not.toBe(layout)

    initSessionRng(1)
    resetDailyCascadeState()
    const fresh = getDailyCascadeState()
    expect(() => fresh.weeklyLayout(40)).toThrow(/loadWeekly/) // the generator is a lazy chunk
    await fresh.loadWeekly()
    expect(() => fresh.weeklyLayout(40)).toThrow(/initSessionRng\(40\)/)
  })

  it('never builds a layout from ensureLayout() in weekly mode', async () => {
    const state = getDailyCascadeState()
    state.setMode('weekly')
    expect(state.ensureLayout()).toBeNull()
    await state.loadWeekly()
    initSessionRng(state.getSeed())
    state.weeklyLayout(state.getSeed())
    expect(state.ensureLayout()).not.toBeNull()
  })

  it('gets its own leaderboard board, by seed, whichever way the machine was selected', async () => {
    const state = getDailyCascadeState()
    expect(state.getLeaderboardMapId('neon-helix')).toBe('neon-helix')
    await state.loadWeekly()
    initSessionRng(0xabc)
    state.weeklyLayout(0xabc) // e.g. a share link on a vanilla start
    expect(state.getLeaderboardMapId('neon-helix')).toBe('weekly-machine-abc')
    state.clearWeekly()
    expect(state.getLeaderboardMapId('neon-helix')).toBe('neon-helix')
  })
})

describe('replay tapes remember the machine', () => {
  const payload = (machine?: 'weekly'): ReplayPayload => ({
    version: REPLAY_SCHEMA_VERSION,
    buildId: 'vitest',
    mapId: 'neon-helix',
    seed: 4242,
    physicsEngine: 'wasm-owner',
    renderer: 'webgl2',
    createdAt: '2026-10-29T00:00:00.000Z',
    frames: [],
    finalScore: 0,
    ...(machine ? { machine } : {}),
  })

  it('round-trips through JSON, and stays absent on other tables', () => {
    expect(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload('weekly'))).machine).toBe('weekly')
    expect('machine' in ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload()))).toBe(false)
  })

  it('is carried from start() to stop()', () => {
    const recorder = new ReplayRecorder()
    const { frames: _frames, finalScore: _score, ...metadata } = payload('weekly')
    recorder.start(metadata)
    expect(recorder.stop(0)?.machine).toBe('weekly')
  })
})

/** A LifecycleHost that records what `startGame` does and in which order. */
function makeHost(over: Record<string, unknown> = {}) {
  const calls: Array<{ machine: StartMachine; sessionSeed: number }> = []
  const recorderStart = vi.fn()
  const target: Record<string, unknown> = {
    applyDailyCascadeOnStart: vi.fn((machine: StartMachine) => calls.push({ machine, sessionSeed: getSessionSeed() })),
    replayRecorder: { start: recorderStart, isRecording: () => false },
    replayRunner: undefined,
    physics: { getWasmMode: () => 'wasm-owner' },
    currentMapId: 'neon-helix',
    campaignStartSelected: false,
    nudgeState: {},
    goldBallStack: [],
    soundSystem: { init: vi.fn(() => Promise.reject(new Error('no audio in tests'))) },
    timers: { setTimeout: vi.fn() },
    signal: new AbortController().signal,
    // Optional collaborators startGame reaches through `?.`: absent here.
    uiManager: null,
    ballManager: null,
    ballStackVisual: null,
    gameObjects: null,
    effects: null,
    display: null,
    ...over,
  }
  // Everything else startGame touches (HUD refresh, ball reset, game state) is a no-op.
  const host = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : (t[key] = vi.fn())),
  }) as unknown as LifecycleHost
  return { host, calls, recorderStart }
}

describe('startGame order', () => {
  beforeEach(() => {
    resetDailyCascadeState()
    resetChallengeSystem()
  })
  afterEach(() => {
    resetChallengeSystem()
    resetDailyCascadeState()
  })

  it('seeds the session RNG with the machine seed before the table is rebuilt (share link)', async () => {
    getChallengeSystem().setActiveChallenge({ seed: 20261029, targetScore: 1000, mapId: 'neon-helix' })
    const { host, calls, recorderStart } = makeHost()
    await new GameLifecycle(host).startGame()

    expect(calls).toEqual([{ machine: { kind: 'weekly', seed: 20261029 }, sessionSeed: 20261029 }])
    expect(recorderStart).toHaveBeenCalledWith(expect.objectContaining({ seed: 20261029, machine: 'weekly' }))
  })

  it('plays the ISO week’s machine in Weekly mode', async () => {
    const state = getDailyCascadeState()
    state.setMode('weekly')
    const { host, calls, recorderStart } = makeHost()
    await new GameLifecycle(host).startGame()

    const seed = seedFromWeeklyId(weeklySeedId())
    expect(calls).toEqual([{ machine: { kind: 'weekly', seed }, sessionSeed: seed }])
    expect(recorderStart).toHaveBeenCalledWith(expect.objectContaining({ seed, machine: 'weekly' }))
  })

  it('does not start a game on a disposed Game while the weekly generator loads', async () => {
    getChallengeSystem().setActiveChallenge({ seed: 9, targetScore: 1, mapId: 'neon-helix' })
    const abort = new AbortController()
    const { host, calls, recorderStart } = makeHost({ signal: abort.signal })
    const started = new GameLifecycle(host).startGame()
    abort.abort() // dispose() lands while the lazy chunk is pending
    await started
    expect(calls).toEqual([])
    expect(recorderStart).not.toHaveBeenCalled()
  })

  it('leaves vanilla tapes unflagged', async () => {
    const { host, calls, recorderStart } = makeHost()
    await new GameLifecycle(host).startGame()
    expect(calls[0]!.machine).toEqual({ kind: 'vanilla' })
    expect(recorderStart.mock.calls[0]![0]).not.toHaveProperty('machine')
  })

  it('a spectator of a weekly tape rebuilds the recorder’s descriptor from the tape’s seed', async () => {
    // The recorder's machine.
    initSessionRng(555)
    const recorded = weeklyMachineHash(generateWeeklyMachine(555))

    // The spectator selected nothing: the tape alone decides.
    const runner = {
      isPlaying: () => true,
      getPayload: () => ({ seed: 555, machine: 'weekly' as const }),
    }
    const { host, calls } = makeHost({ replayRunner: runner })
    await new GameLifecycle(host).startGame()

    expect(calls).toEqual([{ machine: { kind: 'weekly', seed: 555 }, sessionSeed: 555 }])
    // Same descriptor on the spectator's side of the RNG.
    initSessionRng(calls[0]!.sessionSeed)
    expect(weeklyMachineHash(generateWeeklyMachine(555))).toBe(recorded)
  })
})
