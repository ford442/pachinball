/**
 * Every way an exit portal closes unregisters it.
 *
 * A portal's sensor is registered twice when it opens — its body handle with
 * CollisionDispatcher (so it never reaches the obstacle handlers) and its zone
 * with ZoneTriggerSystem (so the engine's begin contact completes it). Both must
 * go on EVERY path that tears the portal down, or a stale handle / zone outlives
 * the sensor body (see AGENTS.md "Stale Portal Handles").
 *
 * The real AdventureMode runs against the real WasmTableWorld; the real
 * `portal-sensor-lifecycle` handlers play GameSystemsInitializer's part, and a
 * real CollisionDispatcher and ZoneTriggerSystem hold the registrations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { AdventureMode } from '../src/adventure/adventure-mode'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { WASM_PHYSICS_API } from '../src/wasm/wasm-physics-api'
import { CollisionDispatcher } from '../src/game/physics/collision-dispatch'
import {
  registerOpenPortal,
  unregisterClosedPortal,
  wirePortalEntry,
  type ClosedPortal,
  type PortalLifecycleHost,
} from '../src/game/portal-sensor-lifecycle'
import { ZoneTriggerSystem } from '../src/game-elements/zone-trigger-system'
import { ZoneSensors } from '../src/game-elements/zone-sensors'
import { makeFakeWasmEngine, asSimEngine } from './helpers/fake-wasm-engine'

function makeRig() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const scene = {
    getEngine: () => ({ getRenderingCanvas: () => ({ addEventListener: vi.fn() }) }),
    activeCamera: null,
    activeCameras: [],
  }
  const mode = new AdventureMode(scene as never, world, WASM_PHYSICS_API)
  // The track builders are not under test: a no-op build leaves just the portal to manage.
  ;(mode as unknown as { buildTrack: () => Promise<void> }).buildTrack = vi.fn(async () => {})

  const zones = new ZoneTriggerSystem(false, () => 0)
  zones.setSensors(new ZoneSensors(world, WASM_PHYSICS_API))
  const bus = new EventBus()
  const dispatcher = new CollisionDispatcher(
    { eventBus: bus, zoneTriggerSystem: zones } as unknown as ConstructorParameters<typeof CollisionDispatcher>[0],
    {} as never,
    () => null,
  )
  const host: PortalLifecycleHost = {
    adventureMode: mode,
    physicsController: dispatcher,
    zoneTriggerSystem: zones,
  }

  // GameSystemsInitializer's adventure listener, reduced to the portal events.
  const events: Array<{ event: string; data: unknown }> = []
  mode.setEventListener((event, data) => {
    events.push({ event, data })
    if (event === 'PORTAL_DEACTIVATED') unregisterClosedPortal(host, data as ClosedPortal)
  })
  wirePortalEntry(host)

  /** What handlePortalOpen does after a successful activateExitPortal(). */
  const openPortal = (track: AdventureTrackType = AdventureTrackType.NEON_HELIX, kind: 'success' | 'timeout' = 'success') => {
    expect(mode.activateExitPortal(track, kind)).toBe(true)
    expect(registerOpenPortal(host, kind)).toBe(true)
  }
  const registered = () => ({
    handles: dispatcher.getPortalSensorHandleSetSize(),
    zoneRouted: mode.getPortalSensorHandle() >= 0 ? zones.zoneIdOfBody(mode.getPortalSensorHandle()) : null,
  })
  const deactivated = () =>
    events.filter((e) => e.event === 'PORTAL_DEACTIVATED').map((e) => e.data as ClosedPortal)

  return { engine, world, mode, zones, dispatcher, host, events, openPortal, registered, deactivated }
}

async function startMode(mode: AdventureMode) {
  const ball = { setLinvel: vi.fn(), setAngvel: vi.fn(), setTranslation: vi.fn(), numColliders: vi.fn(() => 0), collider: vi.fn() }
  await mode.start(ball as never, {} as never, undefined, AdventureTrackType.NEON_HELIX)
  // The shared Babylon mock's camera has no dispose(); end() calls it.
  const camera = (mode as unknown as { followCamera: { dispose?: () => void } | null }).followCamera
  if (camera) camera.dispose = vi.fn()
}

describe('exit portal registration across deactivation paths', () => {
  let rig: ReturnType<typeof makeRig>

  beforeEach(async () => {
    rig = makeRig()
    await startMode(rig.mode)
    rig.events.length = 0
  })

  it('opening a portal registers its handle with the dispatcher and its zone with the zone system', () => {
    rig.openPortal()
    const handle = rig.mode.getPortalSensorHandle()
    expect(handle).toBeGreaterThanOrEqual(0)
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(1)
    expect(rig.zones.zoneIdOfBody(handle)).toBe('NEON_HELIX-exit-portal')
  })

  it('PORTAL_DEACTIVATED carries the handle and the zone id', () => {
    rig.openPortal()
    const handle = rig.mode.getPortalSensorHandle()
    rig.mode.deactivateExitPortal()
    expect(rig.deactivated()).toEqual([{ handle, id: 'NEON_HELIX-exit-portal' }])
  })

  it('path: entry — enterExitPortal emits PORTAL_ENTERED, then unregisters', () => {
    rig.openPortal()
    rig.events.length = 0 // PORTAL_ACTIVATED is not under test
    const handle = rig.mode.getPortalSensorHandle()

    expect(rig.mode.enterExitPortal('NEON_HELIX-exit-portal')).toBe(true)

    expect(rig.events.map((e) => e.event)).toEqual(['PORTAL_ENTERED', 'PORTAL_DEACTIVATED'])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
    expect(rig.zones.zoneIdOfBody(handle)).toBeNull()
    expect(rig.mode.getPortalSensorHandle()).toBe(-1)
  })

  it('path: a ball touching the portal completes it through the zone system', () => {
    rig.openPortal()
    rig.events.length = 0 // PORTAL_ACTIVATED is not under test
    const handle = rig.mode.getPortalSensorHandle()
    const zoneId = rig.zones.zoneIdOfBody(handle)!

    rig.zones.contactBegin(zoneId, 1) // the engine's begin contact, via CollisionDispatcher

    expect(rig.events.map((e) => e.event)).toEqual(['PORTAL_ENTERED', 'PORTAL_DEACTIVATED'])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
    // A second touch of the closed portal does nothing.
    rig.events.length = 0
    rig.zones.contactBegin(zoneId, 1)
    expect(rig.events).toEqual([])
  })

  it('enterExitPortal ignores an id that is not the active portal', () => {
    rig.openPortal()
    rig.events.length = 0 // PORTAL_ACTIVATED is not under test
    expect(rig.mode.enterExitPortal('CYBER_CORE-exit-portal')).toBe(false)
    expect(rig.events).toEqual([])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })

  it('path: exit-portal replacement — activating a second portal unregisters the first', () => {
    rig.openPortal(AdventureTrackType.NEON_HELIX, 'timeout')
    const first = rig.mode.getPortalSensorHandle()

    rig.openPortal(AdventureTrackType.NEON_HELIX, 'success')
    const second = rig.mode.getPortalSensorHandle()

    expect(second).not.toBe(first)
    expect(rig.deactivated()).toEqual([{ handle: first, id: 'NEON_HELIX-exit-portal' }])
    // Exactly one portal is registered, and it is the new one.
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(1)
    expect(rig.zones.zoneIdOfBody(first)).toBeNull()
    expect(rig.zones.zoneIdOfBody(second)).toBe('NEON_HELIX-exit-portal')
  })

  it('path: switchToTrack() unregisters the open portal', async () => {
    rig.openPortal()
    const handle = rig.mode.getPortalSensorHandle()

    expect(await rig.mode.switchToTrack(AdventureTrackType.CYBER_CORE)).toBe(true)

    expect(rig.deactivated()).toEqual([{ handle, id: 'NEON_HELIX-exit-portal' }])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
    expect(rig.zones.zoneIdOfBody(handle)).toBeNull()
  })

  it('path: switchZone() unregisters the open portal', () => {
    rig.openPortal()
    const handle = rig.mode.getPortalSensorHandle()

    expect(rig.mode.switchZone(AdventureTrackType.CYBER_CORE)).toBe(true)

    expect(rig.deactivated()).toEqual([{ handle, id: 'NEON_HELIX-exit-portal' }])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
    expect(rig.zones.zoneIdOfBody(handle)).toBeNull()
  })

  it('path: end() unregisters the open portal', () => {
    rig.openPortal()
    const handle = rig.mode.getPortalSensorHandle()

    rig.mode.end()

    expect(rig.deactivated()).toEqual([{ handle, id: 'NEON_HELIX-exit-portal' }])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
    expect(rig.zones.zoneIdOfBody(handle)).toBeNull()
  })

  it('closing with no portal open registers and emits nothing', async () => {
    rig.mode.deactivateExitPortal()
    await rig.mode.switchToTrack(AdventureTrackType.CYBER_CORE)
    rig.mode.end()
    expect(rig.deactivated()).toEqual([])
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
  })

  it('a portal cannot be opened once adventure has ended, and registers nothing', () => {
    rig.mode.end()
    rig.events.length = 0
    expect(rig.mode.activateExitPortal(AdventureTrackType.NEON_HELIX, 'success')).toBe(false)
    expect(registerOpenPortal(rig.host, 'success')).toBe(false)
    expect(rig.dispatcher.getPortalSensorHandleSetSize()).toBe(0)
  })
})

describe('AdventureMode.end() clears the current and previous zone', () => {
  it('after a track switch has set both', async () => {
    const { mode } = makeRig()
    await startMode(mode)
    await mode.switchToTrack(AdventureTrackType.CYBER_CORE)
    expect(mode.getCurrentZone()).toBe(AdventureTrackType.CYBER_CORE)
    expect(mode.getPreviousZone()).toBe(AdventureTrackType.NEON_HELIX)

    mode.end()

    expect(mode.getCurrentZone()).toBeNull()
    expect(mode.getPreviousZone()).toBeNull()
  })

  it('after a zone switch', async () => {
    const { mode } = makeRig()
    await startMode(mode)
    mode.switchZone(AdventureTrackType.CYBER_CORE)

    mode.end()

    expect(mode.getCurrentZone()).toBeNull()
    expect(mode.getPreviousZone()).toBeNull()
  })
})
