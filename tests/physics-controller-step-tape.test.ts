/**
 * #444 — the tape is one input frame per fixed physics step. Whatever the
 * display rate, the controller records one frame per step the engine takes,
 * and a replay consumes one frame per step, so a 144 Hz recording and a 30 Hz
 * playback line up step for step. Gameplay updates run per step; nothing
 * replays while the game is not PLAYING.
 */
import { describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import type { InputFrame } from '../src/game-elements/types'
import { ReplayRecorder } from '../src/replay/replay-recorder'
import { ReplayRunner } from '../src/replay/replay-runner'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

function makeTable(frameMs: number) {
  const stepDts: number[] = []
  const physics = {
    step: vi.fn((dt: number) => { stepDts.push(dt); return 0 }),
    getStepCount: () => stepDts.length,
    getWorld: () => null,
    isWasmActive: () => false,
    isWasmOwnerMode: () => false,
  }
  const host = makePhysicsHostShell({ physics, ballManager: makeBallManagerStub(), gameObjects: makeGameObjectsStub() })
  ;(host.engine.getDeltaTime as ReturnType<typeof vi.fn>).mockReturnValue(frameMs)
  const flips: boolean[] = []
  const actions = {
    handleFlipperLeft: (pressed: boolean) => { flips.push(pressed) },
    handleFlipperRight: () => {},
    handlePlunger: () => true,
  }
  return { host, controller: new GamePhysicsController(host), stepDts, flips, actions }
}

/** Live input: the left flipper is down on every third step it is read. */
function liveInput() {
  let read = 0
  return {
    update: () => {},
    processBufferedInputs: (): InputFrame => ({
      flipperLeft: read++ % 3 === 0, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: 0,
    }),
  }
}

const META = {
  version: 3, buildId: 't', mapId: 'neon-helix', seed: 1, physicsEngine: 'rapier' as const,
  renderer: 'webgl2' as const, createdAt: '2026-10-16T00:00:00.000Z',
}

describe('one tape frame per fixed step (#444)', () => {
  it('records one frame per engine step at 144 Hz, and hands the engine whole steps only', () => {
    const t = makeTable(1000 / 144)
    const recorder = new ReplayRecorder()
    recorder.start(META)
    const input = liveInput()
    for (let f = 0; f < 288; f++) t.controller.stepPhysics(input, t.actions, null, recorder)
    // Two wall seconds: ~120 steps over 288 render frames.
    expect(t.stepDts.length).toBeGreaterThanOrEqual(119)
    expect(t.stepDts.length).toBeLessThanOrEqual(120)
    expect(recorder.getFrameCount()).toBe(t.stepDts.length)
    expect(new Set(t.stepDts)).toEqual(new Set([1 / 60]))
  })

  it('a 30 Hz replay consumes two tape frames per render frame, in order', () => {
    const live = makeTable(1000 / 144)
    const recorder = new ReplayRecorder()
    recorder.start(META)
    const input = liveInput()
    while (recorder.getFrameCount() < 90) live.controller.stepPhysics(input, live.actions, null, recorder)
    const payload = recorder.stop(0)!

    const spectator = makeTable(1000 / 30)
    const runner = new ReplayRunner()
    runner.load(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(payload)))
    for (let f = 0; f < 45; f++) {
      spectator.controller.stepPhysics(null, spectator.actions, runner, null)
      expect(runner.getProgress().currentFrame).toBe(2 * (f + 1))
    }
    expect(spectator.stepDts).toHaveLength(90)
    // The flipper saw the same press / release sequence, step for step.
    expect(spectator.flips).toEqual(live.flips)
  })

  it('a replay waits while the game is not PLAYING', () => {
    const t = makeTable(1000 / 60)
    const runner = new ReplayRunner()
    runner.load({ ...META, finalScore: 0, frames: Array.from({ length: 10 }, () => liveInput().processBufferedInputs()) })
    ;(t.host.stateManager.isPlaying as ReturnType<typeof vi.fn>).mockReturnValue(false)
    for (let f = 0; f < 5; f++) t.controller.stepPhysics(null, t.actions, runner, null)
    expect(runner.getProgress().currentFrame).toBe(0)
    expect(t.stepDts).toHaveLength(0)
  })

  it('advances table mechanics and adventure clocks once per step at the fixed rate', () => {
    const t = makeTable(1000 / 30)
    const updateGate = vi.fn()
    const stepAdventureProgression = vi.fn()
    Object.assign(t.host, {
      movingGateBuilder: { updateGate },
      gateStates: [{}],
      stepAdventureProgression,
    })
    for (let f = 0; f < 3; f++) t.controller.stepPhysics(null, null, null, null)
    expect(updateGate).toHaveBeenCalledTimes(6)
    expect(updateGate.mock.calls.every(([, dt]) => dt === 1 / 60)).toBe(true)
    expect(stepAdventureProgression).toHaveBeenCalledTimes(6)
  })

  it('a live tape that runs dry waits for its next chunk without stepping (#444 Slice E)', () => {
    const t = makeTable(1000 / 60)
    const afterFixedStep = vi.fn()
    Object.assign(t.host, { afterFixedStep })
    const runner = new ReplayRunner()
    const frames = () => Array.from({ length: 4 }, () => liveInput().processBufferedInputs())
    runner.load({ ...META, finalScore: 0, frames: frames() }, true)
    for (let f = 0; f < 10; f++) t.controller.stepPhysics(null, t.actions, runner, null)
    // Four frames, four steps; then nothing steps (and no live input is read) until more arrive.
    expect(t.stepDts).toHaveLength(4)
    expect(afterFixedStep).toHaveBeenCalledTimes(4)
    expect(runner.isStarved()).toBe(true)
    expect(runner.isPlaying()).toBe(true)

    runner.append(frames())
    for (let f = 0; f < 10; f++) t.controller.stepPhysics(null, t.actions, runner, null)
    expect(t.stepDts).toHaveLength(8)
    // The run is over: playback ends with its last frame, as any replay.
    runner.endStream()
    expect(runner.isStarved()).toBe(false)
    t.controller.stepPhysics(null, t.actions, runner, null)
    expect(runner.isPlaying()).toBe(false)
  })
})
