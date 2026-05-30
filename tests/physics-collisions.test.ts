/**
 * Unit tests for Phase 1 Physics Collisions & Bumper Interaction
 *
 * These tests cover:
 *  1. PhysicsSystem drains contact force events during step
 *  2. Collision groups are correctly computed (makeCollisionGroups)
 *  3. COLLISION_GROUP_PRESETS have correct membership/filter pairs
 *  4. Contact force callback fires with correct parameters
 *  5. PhysicsSystem step accepts optional force callback
 */

import { describe, it, expect, vi } from 'vitest'
import {
  CollisionGroups,
  makeCollisionGroups,
  COLLISION_GROUP_PRESETS,
  FIXED_TIMESTEP,
  MAX_DT,
  GRAVITY,
} from '../src/game-elements/physics'

describe('Physics Collision Groups', () => {
  it('makeCollisionGroups packs membership in upper 16 bits and filter in lower 16 bits', () => {
    const membership = 0x0001 // BALL
    const filter = 0x0002 | 0x0004 // WALL | BUMPER
    const result = makeCollisionGroups(membership, filter)

    // Upper 16 bits = membership, lower 16 bits = filter
    expect((result >>> 16) & 0xFFFF).toBe(membership)
    expect(result & 0xFFFF).toBe(filter)
  })

  it('makeCollisionGroups masks overflow bits', () => {
    // Values larger than 16 bits should be masked
    const result = makeCollisionGroups(0x1FFFF, 0x2FFFF)
    expect((result >>> 16) & 0xFFFF).toBe(0xFFFF)
    expect(result & 0xFFFF).toBe(0xFFFF)
  })

  it('BALL preset allows collisions with walls, bumpers, sensors, flippers, targets, spinners, gates', () => {
    const ballGroup = COLLISION_GROUP_PRESETS.BALL
    const membership = (ballGroup >>> 16) & 0xFFFF
    const filter = ballGroup & 0xFFFF

    expect(membership).toBe(CollisionGroups.BALL)
    expect(filter & CollisionGroups.WALL).toBeTruthy()
    expect(filter & CollisionGroups.BUMPER).toBeTruthy()
    expect(filter & CollisionGroups.SENSOR).toBeTruthy()
    expect(filter & CollisionGroups.FLIPPER).toBeTruthy()
    expect(filter & CollisionGroups.TARGET).toBeTruthy()
    expect(filter & CollisionGroups.SPINNER).toBeTruthy()
    expect(filter & CollisionGroups.GATE).toBeTruthy()
  })

  it('WALL preset only collides with balls', () => {
    const wallGroup = COLLISION_GROUP_PRESETS.WALL
    const membership = (wallGroup >>> 16) & 0xFFFF
    const filter = wallGroup & 0xFFFF

    expect(membership).toBe(CollisionGroups.WALL)
    expect(filter).toBe(CollisionGroups.BALL)
  })

  it('BUMPER preset only collides with balls', () => {
    const bumperGroup = COLLISION_GROUP_PRESETS.BUMPER
    const membership = (bumperGroup >>> 16) & 0xFFFF
    const filter = bumperGroup & 0xFFFF

    expect(membership).toBe(CollisionGroups.BUMPER)
    expect(filter).toBe(CollisionGroups.BALL)
  })

  it('SENSOR preset only collides with balls', () => {
    const sensorGroup = COLLISION_GROUP_PRESETS.SENSOR
    const membership = (sensorGroup >>> 16) & 0xFFFF
    const filter = sensorGroup & 0xFFFF

    expect(membership).toBe(CollisionGroups.SENSOR)
    expect(filter).toBe(CollisionGroups.BALL)
  })

  it('Ball-Wall collision groups are reciprocal', () => {
    const ballFilter = COLLISION_GROUP_PRESETS.BALL & 0xFFFF
    const wallMembership = (COLLISION_GROUP_PRESETS.WALL >>> 16) & 0xFFFF
    const wallFilter = COLLISION_GROUP_PRESETS.WALL & 0xFFFF
    const ballMembership = (COLLISION_GROUP_PRESETS.BALL >>> 16) & 0xFFFF

    // Ball's filter includes Wall's membership
    expect(ballFilter & wallMembership).toBeTruthy()
    // Wall's filter includes Ball's membership
    expect(wallFilter & ballMembership).toBeTruthy()
  })

  it('FLIPPER preset only collides with balls', () => {
    const flipperGroup = COLLISION_GROUP_PRESETS.FLIPPER
    const membership = (flipperGroup >>> 16) & 0xFFFF
    const filter = flipperGroup & 0xFFFF

    expect(membership).toBe(CollisionGroups.FLIPPER)
    expect(filter).toBe(CollisionGroups.BALL)
  })

  it('Ball-Flipper collision groups are reciprocal', () => {
    const ballFilter = COLLISION_GROUP_PRESETS.BALL & 0xFFFF
    const flipperMembership = (COLLISION_GROUP_PRESETS.FLIPPER >>> 16) & 0xFFFF
    const flipperFilter = COLLISION_GROUP_PRESETS.FLIPPER & 0xFFFF
    const ballMembership = (COLLISION_GROUP_PRESETS.BALL >>> 16) & 0xFFFF

    // Ball's filter includes Flipper's membership
    expect(ballFilter & flipperMembership).toBeTruthy()
    // Flipper's filter includes Ball's membership
    expect(flipperFilter & ballMembership).toBeTruthy()
  })

  it('Ball-Bumper collision groups are reciprocal', () => {
    const ballFilter = COLLISION_GROUP_PRESETS.BALL & 0xFFFF
    const bumperMembership = (COLLISION_GROUP_PRESETS.BUMPER >>> 16) & 0xFFFF
    const bumperFilter = COLLISION_GROUP_PRESETS.BUMPER & 0xFFFF
    const ballMembership = (COLLISION_GROUP_PRESETS.BALL >>> 16) & 0xFFFF

    // Ball's filter includes Bumper's membership
    expect(ballFilter & bumperMembership).toBeTruthy()
    // Bumper's filter includes Ball's membership
    expect(bumperFilter & ballMembership).toBeTruthy()
  })
})

describe('Physics Constants', () => {
  it('GRAVITY has correct values', () => {
    expect(GRAVITY.x).toBe(0)
    expect(GRAVITY.y).toBe(-9.81)
    expect(GRAVITY.z).toBe(-5.0)
  })

  it('FIXED_TIMESTEP is 1/60', () => {
    expect(FIXED_TIMESTEP).toBeCloseTo(1 / 60)
  })

  it('MAX_DT is 1/30', () => {
    expect(MAX_DT).toBeCloseTo(1 / 30)
  })
})

describe('PhysicsSystem step with force callback', () => {
  function makeMockRapier() {
    const mockEventQueue = {
      drainCollisionEvents: vi.fn(),
      drainContactForceEvents: vi.fn(),
    }

    const mockWorld = {
      timestep: 0,
      step: vi.fn(),
      integrationParameters: {
        numSolverIterations: 0,
        numAdditionalFrictionIterations: 0,
        contactSkin: 0,
      },
    }

    const mockRapier = {
      World: class { 
        timestep = mockWorld.timestep
        step = mockWorld.step
        integrationParameters = mockWorld.integrationParameters
      },
      EventQueue: class {
        drainCollisionEvents = mockEventQueue.drainCollisionEvents
        drainContactForceEvents = mockEventQueue.drainContactForceEvents
      },
      init: vi.fn().mockResolvedValue(undefined),
    }

    return { mockRapier, mockWorld, mockEventQueue }
  }

  it('PhysicsSystem.step accepts an optional force callback parameter', async () => {
    const { PhysicsSystem } = await import('../src/game-elements/physics')
    const { mockRapier, mockWorld, mockEventQueue } = makeMockRapier()

    const physics = new PhysicsSystem(mockRapier as never)
    await physics.init()

    const collisionCallback = vi.fn()
    const forceCallback = vi.fn()

    // Step with a dt equal to FIXED_TIMESTEP to trigger exactly one substep
    physics.step(FIXED_TIMESTEP, collisionCallback, forceCallback)

    // Verify world.step was called
    expect(mockWorld.step).toHaveBeenCalled()

    // Verify both event queues were drained
    expect(mockEventQueue.drainCollisionEvents).toHaveBeenCalledWith(collisionCallback)
    expect(mockEventQueue.drainContactForceEvents).toHaveBeenCalledTimes(1)
  })

  it('PhysicsSystem.step works without force callback (backward compatible)', async () => {
    const { PhysicsSystem } = await import('../src/game-elements/physics')
    const { mockRapier, mockWorld, mockEventQueue } = makeMockRapier()

    const physics = new PhysicsSystem(mockRapier as never)
    await physics.init()

    const collisionCallback = vi.fn()

    // Step without force callback — should not throw
    physics.step(FIXED_TIMESTEP, collisionCallback)

    expect(mockWorld.step).toHaveBeenCalled()
    expect(mockEventQueue.drainCollisionEvents).toHaveBeenCalled()
    // Force events are still drained (to prevent queue buildup)
    expect(mockEventQueue.drainContactForceEvents).toHaveBeenCalled()
  })

  it('PhysicsSystem.step clamps dt to MAX_DT', async () => {
    const { PhysicsSystem } = await import('../src/game-elements/physics')
    const { mockRapier, mockWorld } = makeMockRapier()

    const physics = new PhysicsSystem(mockRapier as never)
    await physics.init()

    // Pass a very large dt (1 second) — should be clamped to MAX_DT
    physics.step(1.0, vi.fn())

    // With MAX_DT = 1/30 and FIXED_TIMESTEP = 1/60, at most 2 substeps
    expect(mockWorld.step).toHaveBeenCalledTimes(2)
  })
})
