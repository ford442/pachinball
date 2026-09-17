/**
 * WasmOwner's adventure bridge (#383 Slice B): exporting a track's collider
 * descriptors into C++, mapping their handles back for contact dispatch,
 * driving the exported kinematic movers, and deciding whether Rapier may be
 * left unstepped.
 */

import { describe, it, expect, vi } from 'vitest'

import { WasmOwner, type AdventureTrackState } from '../src/game/physics/wasm-owner'
import {
  boxDesc,
  cylinderDesc,
  type AdventureColliderDesc,
} from '../src/adventure/track-collider-descriptors'
import type { WasmPhysicsEngine } from '../src/wasm'

function makeEngine() {
  let nextBox = -1000
  let nextCylinder = -5000
  let nextSphere = -8000
  let nextMover = -3000
  let nextSensor = -4000
  return {
    clearStaticGeometry: vi.fn(),
    addStaticPlane: vi.fn(),
    addStaticBox: vi.fn(() => nextBox--),
    addStaticCapsule: vi.fn(() => -2000),
    addStaticCylinder: vi.fn(() => nextCylinder--),
    addStaticSphere: vi.fn(() => nextSphere--),
    addKinematicMover: vi.fn(() => nextMover--),
    addSensorVolume: vi.fn(() => nextSensor--),
    setNextKinematicTransform: vi.fn(),
    setCollisionGroups: vi.fn(),
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
}

/** Minimal Rapier kinematic body: a pending pose plus a committed one. */
function fakeKinematicBody(handle: number) {
  const next = { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } }
  const committed = { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } }
  return {
    handle,
    setNext(p: { x: number; y: number; z: number }) {
      next.p = p
    },
    nextTranslation: () => next.p,
    nextRotation: () => next.q,
    setTranslation: vi.fn((p: { x: number; y: number; z: number }) => {
      committed.p = p
    }),
    setRotation: vi.fn((q: { x: number; y: number; z: number; w: number }) => {
      committed.q = q
    }),
    committed,
    translation: () => committed.p,
    rotation: () => committed.q,
    setEnabled: vi.fn(),
  }
}

function fakeBody(handle: number) {
  return { handle, setEnabled: vi.fn() }
}

function trackState(
  descriptors: AdventureColliderDesc[],
  bodies: Record<number, unknown>,
  over: Partial<AdventureTrackState> = {}
): AdventureTrackState {
  return {
    epoch: 1,
    descriptors,
    unexported: [],
    bodyForDescriptor: (i) => (bodies[i] ?? null) as never,
    ...over,
  }
}

/** A synthwave-surf-shaped track: rotated ramp slabs, a goal sensor, pistons. */
function synthwaveLikeTrack(): AdventureColliderDesc[] {
  return [
    boxDesc({ x: 0, y: 0, z: 5 }, { x: 4, y: 0.25, z: 7.5 }, {
      rotation: { x: 0.2164, y: 0, z: 0, w: 0.9763 },
      friction: 0.5,
      label: 'straightRamp',
    }),
    boxDesc({ x: 0, y: 0, z: 20 }, { x: 5, y: 0.25, z: 10 }, { label: 'straightRamp' }),
    boxDesc({ x: -3, y: 1.5, z: 12 }, { x: 0.75, y: 1.5, z: 0.75 }, {
      motion: 'kinematic-position',
      label: 'eqPiston',
    }),
    boxDesc({ x: 0, y: -1, z: 40 }, { x: 4, y: 0.5, z: 4 }, { label: 'basin' }),
    boxDesc({ x: 0, y: -0.5, z: 40 }, { x: 2, y: 1, z: 1 }, {
      sensor: true,
      collisionEvents: true,
      label: 'basinGoalSensor',
    }),
  ]
}

describe('WasmOwner.syncAdventureTrack', () => {
  it('leaves Rapier unstepped for a track it can fully express', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const descs = synthwaveLikeTrack()
    const owned = owner.syncAdventureTrack(
      trackState(descs, { 2: fakeKinematicBody(70) })
    )

    expect(owned).toBe(true)
    expect(owner.isAdventureOwned()).toBe(true)
    expect(owner.getAdventureUnsupported()).toEqual([])
    // 3 solid boxes (two ramp slabs + the basin); the piston is a mover and
    // the goal is a sensor volume.
    expect(engine.addStaticBox).toHaveBeenCalledTimes(3)
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(1)
    expect(engine.addKinematicMover).toHaveBeenCalledTimes(1)
  })

  it('keeps Rapier stepping for a track with an inexpressible collider', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const descs: AdventureColliderDesc[] = [
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
      // A dynamic body — no track builds one and C++ has no route for it.
      boxDesc({ x: 0, y: 2, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'dynamic', density: 1 }),
    ]
    expect(owner.syncAdventureTrack(trackState(descs, {}))).toBe(false)
    expect(owner.isAdventureOwned()).toBe(false)
    expect(owner.getAdventureUnsupported().map((u) => u.index)).toEqual([1])
  })

  it('keeps Rapier stepping for a track with geometry built outside the descriptor path', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const owned = owner.syncAdventureTrack(
      trackState([boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })], {}, {
        unexported: ['prism convexHull'],
      })
    )
    expect(owned).toBe(false)
    expect(owner.isAdventureOwned()).toBe(false)
  })

  it('stays unstepped when an exit portal sensor is added to an owned track', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const descs = synthwaveLikeTrack()
    const bodies = { 2: fakeKinematicBody(70) }
    expect(owner.syncAdventureTrack(trackState(descs, bodies))).toBe(true)

    // Portal entry goes through the physics bridge, so its cylinder sensor is
    // just more exported geometry — no reason to wake Rapier.
    const withPortal = [
      ...descs,
      cylinderDesc({ x: 0, y: 2, z: 45 }, 0.8, 1.9, { sensor: true, collisionEvents: true, label: 'exitPortalSensor' }),
    ]
    expect(owner.syncAdventureTrack(trackState(withPortal, bodies, { epoch: 2 }))).toBe(true)
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(3)
  })

  it('allows Rapier to stay unstepped when no adventure track is running', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])
    expect(owner.syncAdventureTrack(null)).toBe(true)
  })

  it('re-exports the static scene only when the collider epoch changes', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])
    engine.clearStaticGeometry.mockClear()
    engine.addStaticBox.mockClear()

    const descs = synthwaveLikeTrack()
    const bodies = { 2: fakeKinematicBody(70) }
    owner.syncAdventureTrack(trackState(descs, bodies))
    expect(engine.clearStaticGeometry).toHaveBeenCalledTimes(1)
    expect(engine.addStaticBox).toHaveBeenCalledTimes(3)

    // Same epoch on the next five frames: no re-export.
    for (let i = 0; i < 5; i++) owner.syncAdventureTrack(trackState(descs, bodies))
    expect(engine.clearStaticGeometry).toHaveBeenCalledTimes(1)
    expect(engine.addStaticBox).toHaveBeenCalledTimes(3)

    // A new track bumps the epoch and rewrites the whole static scene.
    owner.syncAdventureTrack(trackState(descs, bodies, { epoch: 2 }))
    expect(engine.clearStaticGeometry).toHaveBeenCalledTimes(2)
    expect(engine.addStaticBox).toHaveBeenCalledTimes(6)
  })

  it('clears the previous track rather than stacking a second copy', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const bodies = { 2: fakeKinematicBody(70) }
    owner.syncAdventureTrack(trackState(synthwaveLikeTrack(), bodies))
    engine.clearStaticGeometry.mockClear()

    // Track torn down: the exporter must clear and export nothing adventure-side.
    owner.syncAdventureTrack(null)
    expect(engine.clearStaticGeometry).toHaveBeenCalledTimes(1)
    expect(owner.getAdventureUnsupported()).toEqual([])
  })

  it('maps exported C++ handles back to their Rapier bodies for contact dispatch', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const goalSensor = fakeBody(99)
    const descs = synthwaveLikeTrack()
    owner.syncAdventureTrack(
      trackState(descs, { 2: fakeKinematicBody(70), 4: goalSensor })
    )

    // The goal sensor is descriptor 4, the only sensor volume: handle -4000.
    expect(owner.getRapierBody(-4000)).toBe(goalSensor)
  })

  it('drops the previous track’s handle mappings on a re-export', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const oldSensor = fakeBody(99)
    owner.syncAdventureTrack(
      trackState(synthwaveLikeTrack(), { 2: fakeKinematicBody(70), 4: oldSensor })
    )
    expect(owner.getRapierBody(-4000)).toBe(oldSensor)

    owner.syncAdventureTrack(
      trackState([boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })], {}, { epoch: 2 })
    )
    expect(owner.getRapierBody(-4000)).toBeUndefined()
  })

  it('pushes each animated obstacle pending pose into its C++ mover', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const piston = fakeKinematicBody(70)
    const descs = synthwaveLikeTrack()
    owner.syncAdventureTrack(trackState(descs, { 2: piston }))

    piston.setNext({ x: -3, y: 2.4, z: 12 })
    owner.driveAdventure(1 / 60)

    expect(engine.setNextKinematicTransform).toHaveBeenLastCalledWith(
      -3000,
      { x: -3, y: 2.4, z: 12 },
      { x: 0, y: 0, z: 0, w: 1 }
    )
    // The Rapier puppet is committed too, so mesh sync still tracks the piston
    // even though Rapier never stepped.
    expect(piston.committed.p).toEqual({ x: -3, y: 2.4, z: 12 })
  })

  it('does not drive movers for a track that is not fully owned', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const piston = fakeKinematicBody(70)
    const descs = [
      ...synthwaveLikeTrack(),
      boxDesc({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { motion: 'dynamic', density: 1 }),
    ]
    expect(owner.syncAdventureTrack(trackState(descs, { 2: piston }))).toBe(false)
    owner.driveAdventure(1 / 60)
    expect(engine.setNextKinematicTransform).not.toHaveBeenCalled()
  })

  it('integrates a spinning platter in TS and carries its teeth with it', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])

    const platterBody = fakeKinematicBody(80)
    const descs: AdventureColliderDesc[] = [
      cylinderDesc({ x: 0, y: 0, z: 0 }, 0.25, 5, {
        motion: 'kinematic-velocity',
        angularVelocity: { x: 0, y: Math.PI, z: 0 },
      }),
      { ...boxDesc({ x: 4, y: 0.75, z: 0 }, { x: 0.5, y: 0.5, z: 1 }), parentIndex: 0 },
    ]
    expect(owner.syncAdventureTrack(trackState(descs, { 0: platterBody, 1: platterBody }))).toBe(true)

    // Half a second at π rad/s is a quarter turn about +Y: local +X → world -Z.
    owner.driveAdventure(0.25)
    owner.driveAdventure(0.25)

    const quarter = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
    const [, toothPos, toothRot] = engine.setNextKinematicTransform.mock.calls.at(-1) as unknown as [
      number,
      { x: number; y: number; z: number },
      { x: number; y: number; z: number; w: number },
    ]
    expect(toothPos.x).toBeCloseTo(0, 6)
    expect(toothPos.y).toBeCloseTo(0.75, 6)
    expect(toothPos.z).toBeCloseTo(-4, 6)
    expect(toothRot.y).toBeCloseTo(quarter.y, 6)
    expect(toothRot.w).toBeCloseTo(quarter.w, 6)
    // The platter pose is committed to its Rapier body once per tick, not per collider.
    expect(platterBody.committed.q.y).toBeCloseTo(quarter.y, 6)
    expect(platterBody.setRotation).toHaveBeenCalledTimes(2)
  })

  it('answers bridge overlaps for sensors riding a moving body analytically', () => {
    const engine = makeEngine()
    const ballPos = { x: 0, y: 0, z: 0 }
    engine.getPosition.mockImplementation(() => ballPos)
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    const ball = {
      handle: 1,
      translation: () => ({ x: 0, y: 0, z: 0 }),
      linvel: () => ({ x: 0, y: 0, z: 0 }),
      setEnabled: vi.fn(),
    }
    owner.rebuild([ball as never], [], [], [], [])

    const wheelBody = fakeKinematicBody(90)
    const descs: AdventureColliderDesc[] = [
      cylinderDesc({ x: 0, y: 0, z: 0 }, 0.5, 1, {
        sensor: true,
        motion: 'kinematic-velocity',
        angularVelocity: { x: 0, y: Math.PI, z: 0 },
        localPosition: { x: 3, y: 0.5, z: 0 },
      }),
    ]
    expect(owner.syncAdventureTrack(trackState(descs, { 0: wheelBody }))).toBe(true)
    const bridge = owner.getPhysicsBridge()

    ballPos.x = 3
    ballPos.y = 0.5
    expect(bridge.overlaps(wheelBody as never, ball as never)).toBe(true)

    // A quarter turn carries the pocket from +X to -Z; the ball left behind misses it.
    owner.driveAdventure(0.5)
    expect(bridge.overlaps(wheelBody as never, ball as never)).toBe(false)
    ballPos.x = 0
    ballPos.z = -3
    expect(bridge.overlaps(wheelBody as never, ball as never)).toBe(true)
  })

  it('reports adventure colliders in the debug-draw geometry', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [])
    const before = owner.getDebugColliders().length

    owner.syncAdventureTrack(
      trackState(synthwaveLikeTrack(), { 2: fakeKinematicBody(70) })
    )
    expect(owner.getDebugColliders().length).toBe(before + 5)
  })
})
