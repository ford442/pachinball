/**
 * Zones and exit portals are C++ sensor volumes; their begin / end contacts —
 * not a sampled ball pose — drive ZoneTriggerSystem, on `wasm-owner` and on
 * `wasm-worker`.
 *
 * The real TypeScript chain runs here: WasmTableWorld → ZoneSensors (authors the
 * sensor) → WasmOwner (exports it as a C++ SensorVolume) → the engine's contact
 * buffer → EventBus 'wasm:physics:contact' → CollisionDispatcher →
 * ZoneTriggerSystem → callbacks. The engine itself is the in-memory fake, so
 * the swept overlap that produces a thin crossing's Enter/Exit is pinned where
 * it lives, in native/tests/sensor_volume_test.cpp ("… crossing a thin sensor
 * in one substep emits begin, then end"); these tests play that engine's side
 * of the contract: Enter on the step a thin volume is crossed, Exit on the next,
 * with the ball's pose never inside the volume at any sample.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { WASM_PHYSICS_API } from '../src/wasm/wasm-physics-api'
import { unpackCollisionGroups, type WasmBody } from '../src/wasm/wasm-body'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'
import { CONTACT_STRIDE, ContactPhase, encodeContactBuffer, decodeContactBuffer, toWasmContactEvent, type PhysicsContact } from '../src/wasm/contact-buffer'
import { WasmVolumeShape } from '../src/wasm/physics-module-adventure'
import { WasmOwner } from '../src/game/physics/wasm-owner'
import { CollisionDispatcher } from '../src/game/physics/collision-dispatch'
import { registerOpenPortal, unregisterClosedPortal, wirePortalEntry, type PortalLifecycleHost } from '../src/game/portal-sensor-lifecycle'
import { ZoneTriggerSystem } from '../src/game-elements/zone-trigger-system'
import { ZoneSensors } from '../src/game-elements/zone-sensors'
import { ADVENTURE_GROUP, CollisionGroups, COLLISION_GROUP_PRESETS } from '../src/game-elements/physics'
import { getScenario } from '../src/game-elements/dynamic-scenarios'
import { cylinderDesc } from '../src/adventure/track-collider-descriptors'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { makeFakeWasmEngine, asSimEngine } from './helpers/fake-wasm-engine'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

const BALL_RADIUS = 0.25
/** A zone 4 cm thick across the table: far thinner than the ball, and than one frame of travel. */
const THIN_ZONE = { minX: -0.02, maxX: 0.02, minZ: -2, maxZ: 2, minY: -1, maxY: 2 }

function buildRig() {
  const engine = makeFakeWasmEngine()
  const sim = asSimEngine(engine)
  const world = new WasmTableWorld(sim, { x: 0, y: -9.81, z: -5 })
  const owner = new WasmOwner(sim, world)
  const clock = { step: 0 }
  const zones = new ZoneTriggerSystem(false, () => clock.step)
  zones.setSensors(new ZoneSensors(world, WASM_PHYSICS_API))
  owner.setTableScope(() => zones.getSensorBodies())
  owner.rebuild([])

  const bus = new EventBus()
  const host = { eventBus: bus, zoneTriggerSystem: zones } as unknown as ConstructorParameters<typeof CollisionDispatcher>[0]
  const dispatcher = new CollisionDispatcher(host, {} as never, () => owner)
  // The same wiring GamePhysicsController installs in its constructor.
  bus.on('wasm:physics:contact', (evt) => dispatcher.onWasmContact(evt))

  const ball = world.createRigidBody(WASM_PHYSICS_API.RigidBodyDesc.dynamic().setTranslation(-1, 0.5, 0))
  world.createCollider(
    WASM_PHYSICS_API.ColliderDesc.ball(BALL_RADIUS).setDensity(1).setCollisionGroups(COLLISION_GROUP_PRESETS.BALL),
    ball,
  )
  dispatcher.rebuildHandleCaches()

  const events: string[] = []
  zones.setCallback({
    onZoneEnter: (zone) => events.push(`enter ${zone.id}`),
    onZoneExit: (zone) => events.push(`exit ${zone.id}`),
    onPortalContact: (id, kind) => events.push(`portal ${id} ${kind}`),
  })

  return { engine, world, owner, zones, bus, dispatcher, ball, clock, events }
}

type Rig = ReturnType<typeof buildRig>

/** What the engine's contact buffer holds for a ball touching / leaving sensor volume `sensorId`. */
function sensorContact(ballId: number, sensorId: number, phase: ContactPhase): PhysicsContact {
  return {
    bodyId1: ballId,
    bodyId2: sensorId,
    normal: { x: 1, y: 0, z: 0 },
    point: { x: 0, y: 0.5, z: 0 },
    impulse: 0,
    phase,
    isSensor: true,
  }
}

/** The owner path: PhysicsModule decodes the packed buffer and emits each contact on the bus. */
function deliverToOwner(rig: Rig, contacts: PhysicsContact[]): void {
  const packed = encodeContactBuffer(contacts)
  for (const contact of decodeContactBuffer(packed, contacts.length)) {
    rig.bus.emit('wasm:physics:contact', toWasmContactEvent(contact))
  }
}

/** The worker path: the contacts of one step ride that step's `step-result`. */
function deliverToWorker(client: PhysicsWorkerClient, contacts: PhysicsContact[], stepCount: number): void {
  const packed = encodeContactBuffer(contacts)
  client.receiveWorkerMessage({
    type: 'step-result',
    alpha: 0,
    stepCount,
    stepMs: 0.4,
    transformBuffer: new ArrayBuffer(0),
    contactBuffer: packed.buffer as ArrayBuffer,
    contactCount: contacts.length,
    hingeBuffer: new ArrayBuffer(0),
  })
}

function workerClient(rig: Rig): PhysicsWorkerClient {
  const client = new PhysicsWorkerClient({ sharedTransport: false })
  client.init(rig.bus)
  return client
}

describe('ZoneSensors — zones as C++ sensor volumes', () => {
  it('exports a ball-filtered box SensorVolume per zone, in the owner table scope', () => {
    const { engine, owner, zones } = buildRig()
    zones.registerObstacleZone('launcher-zone-0', { minX: -1, maxX: 1, minZ: 2, maxZ: 4, minY: -1, maxY: 2 })
    owner.syncStatics()

    expect(engine.addSensorVolume).toHaveBeenCalledTimes(1)
    expect(engine.addSensorVolume).toHaveBeenCalledWith(
      { x: 0, y: 0.5, z: 3 },
      { x: 1, y: 1.5, z: 1 },
      expect.objectContaining({ w: 1 }),
      WasmVolumeShape.Box,
    )
    // Nothing the owner was told to export was left out of the C++ world.
    expect(owner.getTableUnsupported()).toEqual([])
  })

  it('sets each volume to the SENSOR group, filtered to BALL — never ADVENTURE_GROUP', () => {
    const { engine, owner, zones } = buildRig()
    zones.registerObstacleZone('z', THIN_ZONE)
    owner.syncStatics()

    const call = engine.setCollisionGroups.mock.calls.find(([id]) => id === -4000)
    expect(call).toBeDefined()
    const [, membership, filter] = call!
    expect(membership).toBe(CollisionGroups.SENSOR)
    expect(filter).toBe(CollisionGroups.BALL)
    expect(membership & ADVENTURE_GROUP).toBe(0)

    // And the authored collider itself carries the shared SENSOR preset.
    const [body] = zones.getSensorBodies() as WasmBody[]
    expect(unpackCollisionGroups(body!.collider(0).collisionGroups())).toEqual({
      membership: CollisionGroups.SENSOR,
      filter: CollisionGroups.BALL,
    })
    expect(body!.collider(0).isSensor()).toBe(true)
  })

  it('every table zone body stays off ADVENTURE_GROUP, including a whole scenario', () => {
    const { owner, zones } = buildRig()
    const samurai = getScenario('samurai-realm')!
    zones.loadScenario(samurai)
    zones.registerPortalZone('p', THIN_ZONE, 'success')
    owner.syncStatics()

    const bodies = zones.getSensorBodies() as WasmBody[]
    expect(bodies).toHaveLength(samurai.zones.length + 1)
    for (const body of bodies) {
      const { membership } = unpackCollisionGroups(body.collider(0).collisionGroups())
      expect(membership & ADVENTURE_GROUP).toBe(0)
    }
  })

  it('loading a scenario exports one volume per zone; a new scenario replaces them', () => {
    const { engine, owner, zones, world } = buildRig()
    const samurai = getScenario('samurai-realm')!
    zones.loadScenario(samurai)
    owner.syncStatics()
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(samurai.zones.length)
    const before = world.allBodies().length

    const noir = getScenario('cyber-noir')!
    zones.loadScenario(noir)
    expect(world.allBodies().length).toBe(before - samurai.zones.length + noir.zones.length)
  })

  it('unregistering a zone removes its body from the world, so the next export drops the volume', () => {
    const { owner, zones, world } = buildRig()
    zones.registerObstacleZone('z', THIN_ZONE)
    owner.syncStatics()
    expect(world.allBodies()).toHaveLength(2) // the ball and the zone

    zones.unregisterObstacleZone('z')
    expect(zones.getSensorBodies()).toEqual([])
    expect(world.allBodies()).toHaveLength(1)
  })
})

describe('wasm-owner — a ball crossing a zone thinner than one frame of travel', () => {
  it('fires onZoneEnter from the engine\'s begin contact without reading any ball pose', () => {
    const rig = buildRig()
    rig.zones.registerObstacleZone('thin-zone', THIN_ZONE)
    rig.owner.syncStatics()
    const sensorId = -4000
    const ballId = rig.ball.link!.id
    const translation = vi.spyOn(rig.ball, 'translation')

    // Frame k: the ball is 1 m before the zone. Frame k+1: 1 m past it. At neither
    // sample is it inside (|x| ≥ 1 vs a zone half-thickness of 2 cm + a 25 cm radius).
    rig.engine.setBodyPosition(ballId, -1, 0.5, 0)
    const sampledX = [rig.engine.getPosition(ballId).x]
    rig.engine.setBodyPosition(ballId, 1, 0.5, 0)
    sampledX.push(rig.engine.getPosition(ballId).x)
    for (const x of sampledX) expect(Math.abs(x)).toBeGreaterThan(THIN_ZONE.maxX + BALL_RADIUS)

    // The engine swept the substep: Enter on the step it was crossed…
    deliverToOwner(rig, [sensorContact(ballId, sensorId, ContactPhase.Enter)])
    expect(rig.events).toEqual(['enter thin-zone'])
    expect(rig.zones.getCurrentZoneId()).toBe('thin-zone')

    // …Exit on the next. It is inside the debounce window, so it is held, not lost.
    rig.clock.step += 1
    deliverToOwner(rig, [sensorContact(ballId, sensorId, ContactPhase.Exit)])
    rig.clock.step += 20
    rig.zones.registerObstacleZone('next-zone', THIN_ZONE)
    rig.zones.contactBegin('next-zone', ballId) // the next zone event confirms the held exit
    expect(rig.events).toEqual(['enter thin-zone', 'exit thin-zone', 'enter next-zone'])

    expect(translation).not.toHaveBeenCalled()
    // A zone contact is consumed by the zone system, never counted as an obstacle hit.
    expect(rig.dispatcher.getRawCollisionEvents()).toBe(0)
  })

  it('debounces a ball sitting on the zone edge in sim steps, however long the frames took', () => {
    const rig = buildRig()
    rig.zones.registerObstacleZone('edge', THIN_ZONE)
    rig.owner.syncStatics()
    const ballId = rig.ball.link!.id
    vi.spyOn(performance, 'now').mockImplementation(() => Math.random() * 1e9)

    for (let i = 0; i < 3; i++) {
      deliverToOwner(rig, [sensorContact(ballId, -4000, ContactPhase.Enter)])
      rig.clock.step += 1
      deliverToOwner(rig, [sensorContact(ballId, -4000, ContactPhase.Exit)])
      rig.clock.step += 1
    }
    vi.restoreAllMocks()

    expect(rig.events).toEqual(['enter edge'])
  })

  it('ignores Stay contacts and Exit contacts that are not zone sensors', () => {
    const rig = buildRig()
    rig.zones.registerObstacleZone('z', THIN_ZONE)
    rig.owner.syncStatics()
    const ballId = rig.ball.link!.id

    deliverToOwner(rig, [
      sensorContact(ballId, -4000, ContactPhase.Stay),
      sensorContact(ballId, -4999, ContactPhase.Exit), // not a body the owner knows
    ])
    expect(rig.events).toEqual([])
  })

  it('a contact for a zone unregistered meanwhile is ignored', () => {
    const rig = buildRig()
    rig.zones.registerObstacleZone('z', THIN_ZONE)
    rig.owner.syncStatics()
    const ballId = rig.ball.link!.id
    rig.zones.unregisterObstacleZone('z')

    deliverToOwner(rig, [sensorContact(ballId, -4000, ContactPhase.Enter)])
    expect(rig.events).toEqual([])
  })
})

describe('wasm-worker — contacts come from the step result, not the late pose', () => {
  it('fires onZoneEnter when the step result with the Enter arrives frames after the ball moved on', () => {
    const rig = buildRig()
    rig.zones.registerObstacleZone('thin-zone', THIN_ZONE)
    rig.owner.syncStatics()
    const client = workerClient(rig)
    const ballId = rig.ball.link!.id
    const translation = vi.spyOn(rig.ball, 'translation')

    // The ball crossed in step 10 and is already far past the zone when the worker's
    // step-10 result reaches the render thread (steps 11 and 12 have been applied).
    rig.engine.setBodyPosition(ballId, 6, 0.5, 0)
    deliverToWorker(client, [], 12)
    expect(rig.events).toEqual([])

    deliverToWorker(client, [sensorContact(ballId, -4000, ContactPhase.Enter)], 10)
    expect(rig.events).toEqual(['enter thin-zone'])
    expect(translation).not.toHaveBeenCalled()
  })

  it('delivers Enter then Exit from consecutive step results, in order', () => {
    const rig = buildRig()
    rig.zones.registerObstacleZone('thin-zone', THIN_ZONE)
    rig.owner.syncStatics()
    const client = workerClient(rig)
    const ballId = rig.ball.link!.id

    deliverToWorker(client, [sensorContact(ballId, -4000, ContactPhase.Enter)], 10)
    rig.clock.step += 30
    deliverToWorker(client, [sensorContact(ballId, -4000, ContactPhase.Exit)], 11)

    expect(rig.events).toEqual(['enter thin-zone', 'exit thin-zone'])
  })
})

describe('exit portals — the adventure sensor body is the zone', () => {
  const PORTAL_ID = 'NEON_HELIX-exit-portal'
  const PORTAL_HANDLE = 900

  /** A track whose only collider is the portal's cylinder sensor, exported like any adventure body. */
  function openPortal(rig: Rig) {
    const portalBody = { handle: PORTAL_HANDLE }
    rig.owner.syncAdventureTrack({
      epoch: 1,
      descriptors: [cylinderDesc({ x: 0, y: 2, z: 45 }, 0.8, 1.9, { sensor: true, collisionEvents: true, label: 'exitPortalSensor' })],
      unexported: [],
      bodyForDescriptor: (i) => (i === 0 ? (portalBody as never) : null),
    })
    rig.dispatcher.rebuildHandleCaches()

    const enterExitPortal = vi.fn((id: string) => id === PORTAL_ID)
    const host: PortalLifecycleHost = {
      adventureMode: { getPortalSensorHandle: () => PORTAL_HANDLE, getPortalId: () => PORTAL_ID, enterExitPortal },
      physicsController: {
        registerPortalSensor: (h) => rig.dispatcher.registerPortalSensor(h),
        unregisterPortalSensor: (h) => rig.dispatcher.unregisterPortalSensor(h),
      },
      zoneTriggerSystem: rig.zones,
    }
    wirePortalEntry(host)
    expect(registerOpenPortal(host, 'success')).toBe(true)
    return { host, enterExitPortal, sensorId: -4000 }
  }

  it('registers one handle with the dispatcher and the zone system, and exports a single volume', () => {
    const rig = buildRig()
    const { sensorId } = openPortal(rig)

    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(1)
    expect(rig.zones.zoneIdOfBody(PORTAL_HANDLE)).toBe(PORTAL_ID)
    expect(rig.engine.addSensorVolume).toHaveBeenCalledTimes(1) // the adventure cylinder; no second volume authored
    expect(rig.owner.resolveContactId(sensorId)?.body).toMatchObject({ handle: PORTAL_HANDLE })
  })

  it('completes the portal on the first begin contact: onPortalContact → enterExitPortal', () => {
    const rig = buildRig()
    const { enterExitPortal, sensorId } = openPortal(rig)
    const ballId = rig.ball.link!.id

    deliverToOwner(rig, [sensorContact(ballId, sensorId, ContactPhase.Enter)])

    expect(rig.events).toEqual([`enter ${PORTAL_ID}`, `portal ${PORTAL_ID} success`])
    expect(enterExitPortal).toHaveBeenCalledExactlyOnceWith(PORTAL_ID)
  })

  it('does the same when the begin contact arrives with a worker step result', () => {
    const rig = buildRig()
    const { enterExitPortal, sensorId } = openPortal(rig)
    const client = workerClient(rig)

    deliverToWorker(client, [sensorContact(rig.ball.link!.id, sensorId, ContactPhase.Enter)], 7)

    expect(enterExitPortal).toHaveBeenCalledExactlyOnceWith(PORTAL_ID)
  })

  it('stops routing once the portal closes: PORTAL_DEACTIVATED unregisters the handle and the zone', () => {
    const rig = buildRig()
    const { host, enterExitPortal, sensorId } = openPortal(rig)

    unregisterClosedPortal(host, { handle: PORTAL_HANDLE, id: PORTAL_ID })

    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
    expect(rig.zones.zoneIdOfBody(PORTAL_HANDLE)).toBeNull()
    deliverToOwner(rig, [sensorContact(rig.ball.link!.id, sensorId, ContactPhase.Enter)])
    expect(enterExitPortal).not.toHaveBeenCalled()
    expect(rig.events).toEqual([])
  })

  it('unregistering a portal that was never registered is a no-op', () => {
    const rig = buildRig()
    const { host } = openPortal(rig)
    expect(() => unregisterClosedPortal(host, { handle: 12345, id: 'other-exit-portal' })).not.toThrow()
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })

  it('registers nothing for a portal whose sensor was not created', () => {
    const rig = buildRig()
    const host: PortalLifecycleHost = {
      adventureMode: { getPortalSensorHandle: () => -1, getPortalId: () => null, enterExitPortal: () => false },
      physicsController: {
        registerPortalSensor: (h) => rig.dispatcher.registerPortalSensor(h),
        unregisterPortalSensor: (h) => rig.dispatcher.unregisterPortalSensor(h),
      },
      zoneTriggerSystem: rig.zones,
    }
    expect(registerOpenPortal(host, 'success')).toBe(false)
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
  })
})

describe('rapier mode — collision events reach the zone system by collider handle', () => {
  function setup() {
    const zoneBody = { handle: 2, isFixed: () => true }
    const ballBody = { handle: 1, isFixed: () => false }
    const colliders = new Map([[20, zoneBody], [10, ballBody]])
    const bodies = new Map([[2, zoneBody], [1, ballBody]])
    const world = {
      getCollider: (h: number) => (colliders.has(h) ? { parent: () => colliders.get(h) } : null),
      getRigidBody: (h: number) => bodies.get(h) ?? null,
    }
    const clock = { step: 0 }
    const zones = new ZoneTriggerSystem(false, () => clock.step)
    zones.setSensors({
      author: vi.fn(),
      adopt: vi.fn(),
      release: vi.fn(),
      zoneIdOf: (handle: number) => (handle === 2 ? 'rapier-zone' : null),
      bodies: () => [],
      dispose: vi.fn(),
    })
    zones.registerObstacleZone('rapier-zone', THIN_ZONE)
    const events: string[] = []
    zones.setCallback({ onZoneEnter: () => events.push('enter'), onZoneExit: () => events.push('exit') })
    const host = { eventBus: new EventBus(), zoneTriggerSystem: zones, physics: { getWorld: () => world } }
    const dispatcher = new CollisionDispatcher(host as never, {} as never, () => null)
    return { dispatcher, events, zones, clock }
  }

  it('routes a started collision between a ball and a zone sensor to contactBegin', () => {
    const { dispatcher, events } = setup()
    dispatcher.processCollision(10, 20, true)
    expect(events).toEqual(['enter'])
  })

  it('routes an ended collision to contactEnd (collider handles in either order), and ignores unknown pairs', () => {
    const { dispatcher, events, clock } = setup()
    dispatcher.processCollision(20, 10, true)
    clock.step += 30 // past the debounce window, so the exit is announced at once
    dispatcher.processCollision(99, 98, false) // colliders no world knows
    expect(events).toEqual(['enter'])

    dispatcher.processCollision(20, 10, false)
    expect(events).toEqual(['enter', 'exit'])
  })
})

describe('GamePhysicsController — zones on the owner path, end to end', () => {
  function setup() {
    const engine = makeFakeWasmEngine()
    const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
    const eventBus = new EventBus()
    const clock = { step: 0 }
    const zones = new ZoneTriggerSystem(false, () => clock.step)
    zones.setSensors(new ZoneSensors(world, WASM_PHYSICS_API))

    const ball = world.createRigidBody(WASM_PHYSICS_API.RigidBodyDesc.dynamic().setTranslation(-1, 0.5, 0))
    world.createCollider(WASM_PHYSICS_API.ColliderDesc.ball(BALL_RADIUS).setDensity(1), ball)
    const gameObjects = makeGameObjectsStub()
    const ballManager = makeBallManagerStub({ getBallBodies: vi.fn(() => [ball]), getBallBody: vi.fn(() => ball) })
    const physics = {
      step: vi.fn(() => 1),
      getWorld: () => world,
      getRapier: vi.fn(() => null),
      isWasmActive: () => true,
      isWasmOwnerMode: () => true,
      getWasmEngine: () => asSimEngine(engine),
      getWasmTableWorld: () => world,
      getWasmMode: () => 'wasm-owner' as const,
      setMirrorOverheadMs: vi.fn(),
      getLastMirrorOverheadMs: () => 0,
      setWasmDebugColliders: vi.fn(),
    }
    const host = makePhysicsHostShell({ physics, eventBus, ballManager, gameObjects, zoneTriggerSystem: zones })
    const controller = new GamePhysicsController(host)
    controller.rebuildHandleCaches()

    const events: string[] = []
    zones.setCallback({ onZoneEnter: (z) => events.push(`enter ${z.id}`), onZoneExit: (z) => events.push(`exit ${z.id}`) })
    return { engine, world, eventBus, zones, controller, ball, clock, events }
  }

  it('exports zone volumes with the table and routes the engine\'s contacts to the zone system', () => {
    const { engine, eventBus, zones, controller, ball, events } = setup()
    zones.registerObstacleZone('thin-zone', THIN_ZONE)
    controller.rebuildHandleCaches() // what a table edit / scenario load is followed by

    expect(engine.addSensorVolume).toHaveBeenCalledTimes(1)
    expect(controller.getTableUnexported()).toEqual([])

    eventBus.emit('wasm:physics:contacts', { data: encodeContactBuffer([sensorContact(ball.link!.id, -4000, ContactPhase.Enter)]), count: 1, stride: CONTACT_STRIDE })
    expect(events).toEqual(['enter thin-zone'])
  })

  it('a frame no longer polls zones: stepPhysics runs with a zone system that has no update()', () => {
    const { zones, controller } = setup()
    expect('update' in zones).toBe(false)
    zones.registerObstacleZone('z', THIN_ZONE)
    expect(() => controller.stepPhysics(null, null)).not.toThrow()
  })
})
