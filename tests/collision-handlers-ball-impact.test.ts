import { describe, expect, it, vi } from 'vitest'
import {
  handleBumperCollision,
  handleTargetCollision,
  type CollisionHandlerContext,
} from '../src/game/physics/collision-handlers'
import type { PhysicsBody } from '../src/core/physics-api'

/**
 * #528 / hot path: a contact names the ball by its body. The handlers never look a mesh up (the old
 * `getBallMeshForBody` scanned every table binding per contact); the ball view resolves it in O(1).
 */

function ballBody(vx: number, vy: number, vz: number): PhysicsBody {
  return {
    handle: 7,
    translation: () => ({ x: 1, y: 0.5, z: 2 }),
    linvel: () => ({ x: vx, y: vy, z: vz }),
    angvel: () => ({ x: 0, y: 0, z: 0 }),
  } as unknown as PhysicsBody
}

function makeCtx(overrides: { bumpers?: Map<PhysicsBody, unknown> } = {}) {
  const ballAnimator = { impactOnBody: vi.fn(), simpleImpactOnBody: vi.fn() }
  const scanned = vi.fn(() => {
    throw new Error('contact handlers must not scan binding lists')
  })
  const ctx = {
    host: {
      ballAnimator,
      soundSystem: { playImpact: vi.fn() },
      gameObjects: { getBindings: scanned, deactivateTarget: vi.fn(() => false) },
      ballManager: { getBindings: scanned },
      effects: null,
      hapticManager: null,
      eventBus: { emit: vi.fn() },
      updateHUD: vi.fn(),
      rebuildHandleCaches: vi.fn(),
    },
    ballHandleSet: new Set([7]),
    bumperVisualMap: overrides.bumpers ?? new Map(),
    scoringBridge: {},
    contactX: () => undefined,
  } as unknown as CollisionHandlerContext
  return { ctx, ballAnimator, scanned }
}

describe('contact handlers report ball impacts by body', () => {
  it('a target hit asks for a simple impact on the ball body, with speed-scaled intensity', () => {
    const { ctx, ballAnimator, scanned } = makeCtx()
    const ball = ballBody(0, 0, 10)
    handleTargetCollision(ctx, {} as PhysicsBody, ball, 7)
    expect(ballAnimator.simpleImpactOnBody).toHaveBeenCalledTimes(1)
    expect(ballAnimator.simpleImpactOnBody).toHaveBeenCalledWith(ball, 0.5)
    expect(scanned).not.toHaveBeenCalled()
  })

  it('a bumper hit asks for a squash along the impact normal on the ball body', () => {
    const bumper = {} as PhysicsBody
    const bumperBody = { translation: () => ({ x: 0, y: 0.5, z: 2 }) }
    const { ctx, ballAnimator, scanned } = makeCtx({
      bumpers: new Map([[bumper, { body: bumperBody, mesh: null, color: '#fff' }]]),
    })
    const ball = ballBody(0, 0, 20)
    // The rest of the bumper handler needs a full table; only the impact request is under test, so
    // let it run until it first touches something this stub does not provide.
    try {
      handleBumperCollision(ctx, bumper, ball, 7)
    } catch {
      // ignored: scoring / display wiring is out of scope here
    }
    expect(ballAnimator.impactOnBody).toHaveBeenCalledTimes(1)
    const [body, normal, intensity] = ballAnimator.impactOnBody.mock.calls[0] ?? []
    expect(body).toBe(ball)
    expect(normal).toEqual({ x: 1, y: 0, z: 0 }) // ball (1, .5, 2) minus bumper (0, .5, 2), normalised
    expect(intensity).toBe(1) // speed 20 → clamped to 1
    expect(scanned).not.toHaveBeenCalled()
  })

  it('does nothing visible when no animator is wired (headless replay)', () => {
    const { ctx } = makeCtx()
    ;(ctx.host as { ballAnimator: unknown }).ballAnimator = null
    expect(() => handleTargetCollision(ctx, {} as PhysicsBody, ballBody(0, 0, 10), 7)).not.toThrow()
  })
})
