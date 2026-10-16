/**
 * #441 — nudge cooldown, tilt warnings, the tilt penalty and warning decay run
 * on the gameplay sim clock (fixed steps the engine took), never wall time:
 * no `performance.now()` read decides a nudge, and no timer ends the penalty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { GAME_TUNING, GameConfig } from '../src/config'
import { FIXED_TIMESTEP } from '../src/core/sim-clock'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

const STEP_MS = FIXED_TIMESTEP * 1000

function makeTable() {
  let engineSteps = 0
  const applyImpulse = vi.fn()
  const ball = {
    translation: () => ({ x: 0, y: 0, z: 0 }),
    linvel: () => ({ x: 0, y: 0, z: 0 }),
    applyImpulse,
  }
  const physics = {
    // One fixed step per frame, whatever the render delta says.
    step: vi.fn(() => { engineSteps++; return 1 }),
    getStepCount: () => engineSteps,
    getWorld: () => null,
    isWasmActive: () => false,
    isWasmOwnerMode: () => false,
  }
  const host = makePhysicsHostShell({
    physics,
    ballManager: makeBallManagerStub({ getBallBody: vi.fn(() => ball) }),
    gameObjects: makeGameObjectsStub(),
  })
  // A wildly wrong render delta: gameplay timers must not follow it.
  ;(host.engine.getDeltaTime as ReturnType<typeof vi.fn>).mockReturnValue(1000)
  const controller = new GamePhysicsController(host)
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) controller.stepPhysics(null, null, null, null)
  }
  const nudge = () => controller.applyNudge({ x: 1, y: 0, z: 0 })
  return {
    host, controller, frames, nudge, applyImpulse,
    jumpEngineCounter: (to: number) => { engineSteps = to },
  }
}

const cooldownSteps = Math.ceil(GAME_TUNING.timing.nudgeCooldownMs / STEP_MS)
const penaltySteps = Math.round(GameConfig.nudge.tiltPenaltyTime / STEP_MS)

describe('nudge / tilt on the sim clock (#441)', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('gameplay read wall-clock time')
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('the gameplay clock counts engine steps, not render delta', () => {
    const t = makeTable()
    t.frames(30)
    expect(t.controller.simClock.steps()).toBe(30)
    expect(t.controller.simClock.ms()).toBeCloseTo(30 * STEP_MS, 9)
  })

  it('nudges inside the cooldown warn, and the third warning tilts', () => {
    const t = makeTable()
    t.frames(1)
    t.nudge()
    expect(t.host.nudgeState.tiltWarnings).toBe(0)
    for (let w = 1; w <= GameConfig.nudge.maxTiltWarnings; w++) {
      t.frames(cooldownSteps - 2)
      t.nudge()
      if (w < GameConfig.nudge.maxTiltWarnings) expect(t.host.nudgeState.tiltWarnings).toBe(w)
    }
    expect(t.host.nudgeState.tiltActive).toBe(true)
    expect(t.host.tiltActive).toBe(true)
  })

  it('a nudge after the cooldown is not a warning', () => {
    const t = makeTable()
    t.frames(1)
    t.nudge()
    t.frames(cooldownSteps + 1)
    t.nudge()
    expect(t.host.nudgeState.tiltWarnings).toBe(0)
    expect(t.applyImpulse).toHaveBeenCalledTimes(2)
  })

  it('the tilt penalty ends after tiltPenaltyTime of sim steps, with no timer', () => {
    const t = makeTable()
    t.frames(1)
    t.controller.triggerTilt()
    expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === GameConfig.nudge.tiltPenaltyTime)).toBe(false)

    t.frames(penaltySteps - 2)
    expect(t.host.nudgeState.tiltActive).toBe(true)
    // Locked out: a nudge while tilted does nothing.
    t.nudge()
    expect(t.applyImpulse).not.toHaveBeenCalled()

    t.frames(3)
    expect(t.host.nudgeState.tiltActive).toBe(false)
    expect(t.host.tiltActive).toBe(false)
    expect(t.host.nudgeState.tiltWarnings).toBe(0)
  })

  it('warnings decay one per sim second once tiltDecayTime has passed without a nudge', () => {
    const t = makeTable()
    t.frames(1)
    t.nudge()
    t.frames(2)
    t.nudge()
    expect(t.host.nudgeState.tiltWarnings).toBe(1)
    const decaySteps = Math.ceil(GameConfig.nudge.tiltDecayTime / STEP_MS)
    t.frames(decaySteps - 1)
    expect(t.host.nudgeState.tiltWarnings).toBe(1)
    t.frames(30) // half a sim second past the decay threshold
    expect(t.host.nudgeState.tiltWarnings).toBeGreaterThan(0.4)
    expect(t.host.nudgeState.tiltWarnings).toBeLessThan(0.6)
    t.frames(60)
    expect(t.host.nudgeState.tiltWarnings).toBe(0)
  })

  it('an engine counter that goes backwards (new world) neither rewinds nor advances the clock', () => {
    const t = makeTable()
    t.frames(10)
    t.nudge()
    const before = t.controller.simClock.ms()
    t.jumpEngineCounter(0)
    t.frames(1)
    // The rewind frame counts as zero; the clock never runs backwards.
    expect(t.controller.simClock.ms()).toBeCloseTo(before, 9)
    t.frames(cooldownSteps + 1)
    t.nudge()
    expect(t.host.nudgeState.tiltWarnings).toBe(0)
  })
})
