/**
 * Pose maths WasmOwner uses to drive moving adventure bodies without a
 * stepping Rapier world (#383 cutover).
 */

import { describe, expect, it } from 'vitest'

import {
  composePose,
  integrateSpin,
  sphereTouchesVolume,
  type Pose,
} from '../src/game/physics/adventure-kinematics'

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const AT_ORIGIN: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY }

describe('integrateSpin', () => {
  it('lands exactly on N·dt·ω however the time is sliced', () => {
    let coarse = IDENTITY
    let fine = IDENTITY
    const omega = { x: 0, y: 2, z: 0 }
    for (let i = 0; i < 3; i++) coarse = integrateSpin(coarse, omega, 0.5)
    for (let i = 0; i < 90; i++) fine = integrateSpin(fine, omega, 1 / 60)
    // 1.5 s at 2 rad/s is 3 rad about +Y.
    expect(coarse.y).toBeCloseTo(Math.sin(1.5), 9)
    expect(coarse.w).toBeCloseTo(Math.cos(1.5), 9)
    expect(fine.y).toBeCloseTo(coarse.y, 9)
    expect(fine.w).toBeCloseTo(coarse.w, 9)
  })

  it('spins about an inclined axis without drifting off unit length', () => {
    let q = IDENTITY
    for (let i = 0; i < 10_000; i++) q = integrateSpin(q, { x: 0, y: Math.cos(0.3) * 4, z: Math.sin(0.3) * 4 }, 1 / 60)
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9)
    expect(q.x).toBeCloseTo(0, 9)
  })

  it('leaves the pose alone for zero spin or zero dt', () => {
    expect(integrateSpin(IDENTITY, { x: 0, y: 0, z: 0 }, 1)).toBe(IDENTITY)
    expect(integrateSpin(IDENTITY, { x: 0, y: 3, z: 0 }, 0)).toBe(IDENTITY)
  })
})

describe('composePose', () => {
  it('places a local offset in the parent frame', () => {
    const parent: Pose = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }
    const world = composePose(parent, { position: { x: 4, y: 0, z: 0 }, rotation: IDENTITY })
    expect(world.position.x).toBeCloseTo(1, 9)
    expect(world.position.y).toBeCloseTo(2, 9)
    expect(world.position.z).toBeCloseTo(-1, 9)
  })
})

describe('sphereTouchesVolume', () => {
  const r = 0.25

  it('box: touches within the radius of a face, misses beyond it', () => {
    const half = { x: 1, y: 1, z: 1 }
    expect(sphereTouchesVolume({ x: 1.2, y: 0, z: 0 }, r, 'box', half, AT_ORIGIN)).toBe(true)
    expect(sphereTouchesVolume({ x: 1.3, y: 0, z: 0 }, r, 'box', half, AT_ORIGIN)).toBe(false)
    // Corner region measures to the corner, not per axis.
    expect(sphereTouchesVolume({ x: 1.2, y: 1.2, z: 0 }, r, 'box', half, AT_ORIGIN)).toBe(false)
  })

  it('cylinder: measures radially on the side and along the axis past a cap', () => {
    const half = { x: 1, y: 0.5, z: 1 }
    expect(sphereTouchesVolume({ x: 0.9, y: 0, z: 0.5 }, r, 'cylinder', half, AT_ORIGIN)).toBe(true)
    expect(sphereTouchesVolume({ x: 0.9, y: 0, z: 0.9 }, r, 'cylinder', half, AT_ORIGIN)).toBe(false)
    expect(sphereTouchesVolume({ x: 0, y: 0.7, z: 0 }, r, 'cylinder', half, AT_ORIGIN)).toBe(true)
    expect(sphereTouchesVolume({ x: 0, y: 0.8, z: 0 }, r, 'cylinder', half, AT_ORIGIN)).toBe(false)
  })

  it('sphere: adds both radii', () => {
    const half = { x: 3, y: 3, z: 3 }
    expect(sphereTouchesVolume({ x: 0, y: 3.2, z: 0 }, r, 'sphere', half, AT_ORIGIN)).toBe(true)
    expect(sphereTouchesVolume({ x: 0, y: 3.3, z: 0 }, r, 'sphere', half, AT_ORIGIN)).toBe(false)
  })

  it('tests in the volume\'s own frame', () => {
    // A long thin box yawed a quarter turn lies along Z, not X.
    const pose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }
    const half = { x: 3, y: 0.1, z: 0.1 }
    expect(sphereTouchesVolume({ x: 0, y: 0, z: 2.5 }, r, 'box', half, pose)).toBe(true)
    expect(sphereTouchesVolume({ x: 2.5, y: 0, z: 0 }, r, 'box', half, pose)).toBe(false)
  })
})
