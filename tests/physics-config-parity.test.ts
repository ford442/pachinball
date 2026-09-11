import { describe, it, expect, vi } from 'vitest'
import { PhysicsConfig, GameConfig } from '../src/config'

describe('physics config — single source of truth', () => {
  it('has no leftover GameConfig.physics duplicate', () => {
    expect('physics' in GameConfig).toBe(false)
  })

  it('keeps PhysicsConfig.bumper.restitution and surfaces.bumper.restitution identical', () => {
    expect(PhysicsConfig.surfaces.bumper.restitution).toBe(PhysicsConfig.bumper.restitution)
  })

  it('keeps PhysicsConfig.flipper restitution/friction identical to surfaces.flipper', () => {
    expect(PhysicsConfig.surfaces.flipper.restitution).toBe(PhysicsConfig.flipper.restitution)
    expect(PhysicsConfig.surfaces.flipper.friction).toBe(PhysicsConfig.flipper.friction)
  })
})

describe('WasmOwner reads bumper surface physics from PhysicsConfig', () => {
  it('creates bumper bodies with PhysicsConfig.surfaces.bumper values', async () => {
    const { WasmOwner } = await import('../src/game/physics/wasm-owner')

    const engine = {
      addStaticPlane: vi.fn(),
      clearStaticGeometry: vi.fn(),
      createBody: vi.fn(() => 1),
      setBodyRotation: vi.fn(),
      createHinge: vi.fn(() => 1),
      setHingeMotor: vi.fn(),
      getHingeAngle: vi.fn(() => 0),
      getAngularVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      removeBody: vi.fn(),
      removeHinge: vi.fn(),
      applyImpulse: vi.fn(),
      getPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      getRotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    }

    const bumperBody = {
      handle: 1,
      translation: () => ({ x: 0, y: 0.5, z: 8 }),
      linvel: () => ({ x: 0, y: 0, z: 0 }),
      setEnabled: vi.fn(),
    }

    const owner = new WasmOwner(engine as never)
    owner.rebuild(
      [],
      [bumperBody as never],
      [{ mesh: { scaling: { x: 1 } }, body: bumperBody } as never],
      [],
      [],
    )

    expect(engine.createBody).toHaveBeenCalledWith(
      expect.objectContaining({
        restitution: PhysicsConfig.surfaces.bumper.restitution,
        friction: PhysicsConfig.surfaces.bumper.friction,
      }),
    )
  })
})
