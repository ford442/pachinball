/**
 * ReplayRecorder & ReplayRunner Unit & Deterministic Parity Tests.
 * Verifies that recording input streams under fixed seed + fixed physics steps
 * reproduces identical simulation state (ball position, velocity, step count, score).
 */

import { describe, it, expect } from 'vitest'
import {
  ReplayRecorder,
  ReplayRunner,
  initSessionRng,
  getSessionRng,
  type InputFrame,
  type ReplayPayload,
} from '../src/game-elements'

describe('ReplayRecorder & ReplayRunner schema & serialization', () => {
  it('records frames and serializes/deserializes correctly', () => {
    const recorder = new ReplayRecorder()
    recorder.start({
      version: 1,
      buildId: 'test-build-1',
      mapId: 'neon-helix',
      seed: 0xfeed1234,
      physicsEngine: 'rapier',
      renderer: 'webgl2',
      createdAt: '2026-08-07T00:00:00.000Z',
    })

    expect(recorder.isRecording()).toBe(true)

    const f1: InputFrame = { flipperLeft: true, flipperRight: null, plunger: false, nudge: null, timestamp: 100 }
    const f2: InputFrame = { flipperLeft: null, flipperRight: true, plunger: true, nudge: { x: 1, y: 0, z: 0 }, timestamp: 116 }

    recorder.recordFrame(f1)
    recorder.recordFrame(f2)

    expect(recorder.getFrameCount()).toBe(2)

    const payload = recorder.stop(1500)
    expect(payload).not.toBeNull()
    expect(payload?.finalScore).toBe(1500)
    expect(payload?.frames).toHaveLength(2)

    const json = ReplayRecorder.toJSON(payload!)
    const deserialized = ReplayRecorder.fromJSON(json)

    expect(deserialized.seed).toBe(0xfeed1234)
    expect(deserialized.finalScore).toBe(1500)
    expect(deserialized.frames[0]?.flipperLeft).toBe(true)
    expect(deserialized.frames[1]?.nudge).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('saves to and loads from localStorage correctly', () => {
    const store = new Map<string, string>()
    const fakeLocalStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    }
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeLocalStorage,
      writable: true,
      configurable: true,
    })

    const payload: ReplayPayload = {
      version: 1,
      buildId: 'test-build-ls',
      mapId: 'cyber-core',
      seed: 88888,
      physicsEngine: 'rapier',
      renderer: 'webgl2',
      createdAt: '2026-08-07T00:00:00.000Z',
      finalScore: 2500,
      frames: [{ flipperLeft: true, flipperRight: false, plunger: true, nudge: null, timestamp: 50 }],
    }

    ReplayRecorder.saveToLocalStorage('test_replay_ls', payload)
    const loaded = ReplayRecorder.loadFromLocalStorage('test_replay_ls')

    expect(loaded).not.toBeNull()
    expect(loaded?.seed).toBe(88888)
    expect(loaded?.finalScore).toBe(2500)
    expect(loaded?.mapId).toBe('cyber-core')
  })

  it('ReplayRunner streams frames sequentially and resets', () => {
    const payload: ReplayPayload = {
      version: 1,
      buildId: 'test-build-1',
      mapId: 'neon-helix',
      seed: 42,
      physicsEngine: 'rapier',
      renderer: 'webgl2',
      createdAt: '2026-08-07T00:00:00.000Z',
      finalScore: 500,
      frames: [
        { flipperLeft: true, flipperRight: false, plunger: false, nudge: null, timestamp: 10 },
        { flipperLeft: false, flipperRight: true, plunger: false, nudge: null, timestamp: 26 },
      ],
    }

    const runner = new ReplayRunner()
    runner.load(payload)

    expect(runner.isPlaying()).toBe(true)
    expect(runner.getProgress()).toEqual({ currentFrame: 0, totalFrames: 2 })

    const frame1 = runner.getNextFrame()
    expect(frame1?.flipperLeft).toBe(true)

    const frame2 = runner.getNextFrame()
    expect(frame2?.flipperRight).toBe(true)

    const frame3 = runner.getNextFrame()
    expect(frame3).toBeNull()
    expect(runner.isPlaying()).toBe(false)

    runner.reset()
    expect(runner.isPlaying()).toBe(true)
    expect(runner.getNextFrame()?.flipperLeft).toBe(true)
  })
})

describe('Replay Physics Parity (Deterministic Integration)', () => {
  it('record N physics ticks -> reset -> replay -> exact ball position & velocity parity within epsilon', () => {
    const seed = 0xabcdef01
    const totalTicks = 300 // 5 seconds at 60 FPS
    const dt = 1 / 60

    // Helper: Simulate 1 physics step integrating gravity, nudges, and seeded feeder impulses
    function stepBall(
      pos: { x: number; y: number; z: number },
      vel: { x: number; y: number; z: number },
      frame: InputFrame,
      tick: number
    ): number {
      let scoreAwarded = 0

      // Apply gravity
      vel.y += -9.81 * dt

      // Apply input nudge force
      if (frame.nudge) {
        vel.x += frame.nudge.x * 2.0 * dt
        vel.y += frame.nudge.y * 2.0 * dt
        vel.z += frame.nudge.z * 2.0 * dt
      }

      // Apply plunger impulse
      if (frame.plunger) {
        vel.y += 12.0
      }

      // Apply seeded random feeder impulse every 45 ticks
      if (tick % 45 === 0) {
        const rng = getSessionRng()
        const rx = (rng.next() - 0.5) * 6
        const rz = (rng.next() - 0.5) * 6
        vel.x += rx
        vel.z += rz
        scoreAwarded += 250
      }

      // Integrate position
      pos.x += vel.x * dt
      pos.y += vel.y * dt
      pos.z += vel.z * dt

      // Bounce off floor at y = 0
      if (pos.y < 0) {
        pos.y = 0
        vel.y = Math.abs(vel.y) * 0.7
        scoreAwarded += 100
      }

      return scoreAwarded
    }

    // --- RUN 1: Live play recording ---
    initSessionRng(seed)
    const pos1 = { x: 0, y: 10, z: 0 }
    const vel1 = { x: 0, y: 0, z: 0 }
    let score1 = 0

    const recorder = new ReplayRecorder()
    recorder.start({
      version: 1,
      buildId: 'ci-parity-test',
      mapId: 'neon-helix',
      seed,
      physicsEngine: 'rapier',
      renderer: 'webgl2',
      createdAt: new Date().toISOString(),
    })

    for (let tick = 0; tick < totalTicks; tick++) {
      const flipperL = tick === 30 ? true : tick === 60 ? false : null
      const flipperR = tick === 40 ? true : tick === 70 ? false : null
      const plunge = tick === 10
      const nudge = tick === 90 ? { x: 2, y: 0, z: 1 } : null

      const frame: InputFrame = {
        flipperLeft: flipperL,
        flipperRight: flipperR,
        plunger: plunge,
        nudge,
        timestamp: tick * 16.66,
      }

      recorder.recordFrame(frame)
      score1 += stepBall(pos1, vel1, frame, tick)
    }

    const recordedPayload = recorder.stop(score1)!

    // --- RUN 2: Replay playback execution ---
    initSessionRng(seed) // Re-seed session RNG to identical initial seed
    const pos2 = { x: 0, y: 10, z: 0 }
    const vel2 = { x: 0, y: 0, z: 0 }
    let score2 = 0

    const runner = new ReplayRunner()
    runner.load(recordedPayload)

    let replayTick = 0
    while (runner.isPlaying()) {
      const frame = runner.getNextFrame()
      if (!frame) break

      score2 += stepBall(pos2, vel2, frame, replayTick)
      replayTick++
    }

    // Assert complete determinism and parity
    expect(replayTick).toBe(totalTicks)
    expect(score2).toBe(score1)

    expect(pos2.x).toBeCloseTo(pos1.x, 10)
    expect(pos2.y).toBeCloseTo(pos1.y, 10)
    expect(pos2.z).toBeCloseTo(pos1.z, 10)

    expect(vel2.x).toBeCloseTo(vel1.x, 10)
    expect(vel2.y).toBeCloseTo(vel1.y, 10)
    expect(vel2.z).toBeCloseTo(vel1.z, 10)
  })
})
