/**
 * Unit test verifying that TypeScript declarations (src/wasm/wasm-types.ts)
 * match the exported Embind surface (native/src/bindings.cpp).
 */

import { describe, it, expect } from 'vitest'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { BodyType, Shape } from '../src/wasm/wasm-types'

describe('Embind surface and type declaration consistency', () => {
  it('WasmPhysicsEngine wrapper exposes all expected WasmPhysicsWorldInstance methods', () => {
    const engine = new WasmPhysicsEngine()

    // Key API methods declared in WasmPhysicsWorldInstance & implemented in wrapper
    const requiredMethods: (keyof WasmPhysicsEngine)[] = [
      'load',
      'init',
      'step',
      'createBody',
      'removeBody',
      'applyForce',
      'applyImpulse',
      'setVelocity',
      'setAngularVelocity',
      'setBodyPosition',
      'setBodyRotation',
      'addStaticPlane',
      'addStaticBox',
      'addStaticCapsule',
      'getPosition',
      'getVelocity',
      'getAngularVelocity',
      'getRotation',
      'getActiveBodyCount',
      'setGravity',
      'dispose',
    ]

    for (const method of requiredMethods) {
      expect(typeof engine[method]).toBe('function')
    }
  })

  it('BodyType and Shape enum constants match C++ backend definitions', () => {
    expect(BodyType.Dynamic).toBe(0)
    expect(BodyType.Static).toBe(1)
    expect(BodyType.Kinematic).toBe(2)

    expect(Shape.Sphere).toBe(0)
    expect(Shape.Capsule).toBe(1)
  })
})
