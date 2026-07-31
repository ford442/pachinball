/**
 * Portal sensor register/unregister lifecycle (#322).
 *
 * The kernel move relocated EventBus to src/core, so the portal wiring is
 * re-verified here — but against the *real* CollisionDispatcher rather than a
 * copy of its logic.
 *
 * tests/portal-entry.test.ts covers the same handle-set semantics with a
 * `PortalHandleTracker` class that re-implements the Set operations locally.
 * That documents intent but cannot fail if production drifts: it never touches
 * `CollisionDispatcher`. `collision-dispatch.ts` imports Babylon and Rapier as
 * types only, so the real class constructs in Node with a stub host — which
 * makes an honest test cheap.
 *
 * Covered here:
 *  - register/unregister maintain the real dispatcher's portal handle set
 *  - the `PORTAL_DEACTIVATED` adventure-callback branch in
 *    GameSystemsInitializer reaches `unregisterPortalSensor` with the handle
 *    AdventureMode emitted
 */

import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { CollisionDispatcher } from '../src/game/physics/collision-dispatch'

function buildDispatcher(): CollisionDispatcher {
  // Only `host.eventBus` is touched during construction (it subscribes to
  // 'ball:launched'); the rest of the physics host is unused by the portal
  // handle-set paths under test.
  const host = { eventBus: new EventBus() } as unknown as ConstructorParameters<
    typeof CollisionDispatcher
  >[0]
  const scoringBridge = {} as unknown as ConstructorParameters<typeof CollisionDispatcher>[1]
  return new CollisionDispatcher(host, scoringBridge, () => null)
}

describe('CollisionDispatcher — portal sensor handle set (real implementation)', () => {
  it('registers a valid handle', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(42)
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })

  it('ignores a negative handle from a not-yet-active sensor', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(-1)
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(0)
  })

  it('unregisters a previously registered handle', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(42)
    dispatcher.unregisterPortalSensor(42)
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(0)
  })

  it('treats unregistering an unknown handle as a no-op', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(7)
    expect(() => dispatcher.unregisterPortalSensor(999)).not.toThrow()
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })

  it('tracks concurrent portal handles independently', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(1)
    dispatcher.registerPortalSensor(2)
    dispatcher.unregisterPortalSensor(1)
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })

  it('does not double-count a handle registered twice', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(42)
    dispatcher.registerPortalSensor(42)
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })
})

/**
 * Mirrors the PORTAL_DEACTIVATED branch of the adventure callback in
 * `GameSystemsInitializer` (src/game/game-systems-init.ts). The initializer
 * itself transitively pulls in the Babylon/Rapier subsystem graph and cannot be
 * constructed under Node — the same constraint portal-activation-failure.test.ts
 * documents — so the branch is mirrored while the dispatcher it drives is real.
 */
interface PortalDeactivatedPayload {
  handle: number
}

function handleAdventureEvent(
  physicsController: { unregisterPortalSensor: (handle: number) => void },
  event: string,
  data: PortalDeactivatedPayload,
): void {
  switch (event) {
    case 'PORTAL_DEACTIVATED': {
      physicsController.unregisterPortalSensor(data.handle)
      break
    }
  }
}

describe('PORTAL_DEACTIVATED → unregisterPortalSensor', () => {
  it('clears the handle AdventureMode reported when the portal tore down', () => {
    const dispatcher = buildDispatcher()

    // activateExitPortal succeeded and handlePortalOpen registered the sensor.
    const sensorHandle = 314
    dispatcher.registerPortalSensor(sensorHandle)
    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(1)

    // AdventureMode.deactivateExitPortal() emits PORTAL_DEACTIVATED carrying the
    // handle — it must be read from the payload, not re-queried from
    // getPortalSensorHandle(), which already returns -1 by this point.
    handleAdventureEvent(dispatcher, 'PORTAL_DEACTIVATED', { handle: sensorHandle })

    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(0)
  })

  it('ignores adventure events that are not PORTAL_DEACTIVATED', () => {
    const controller = { unregisterPortalSensor: vi.fn() }
    handleAdventureEvent(controller, 'PORTAL_ENTERED', { handle: 1 })
    expect(controller.unregisterPortalSensor).not.toHaveBeenCalled()
  })

  it('leaves a second portal registered when only the first deactivates', () => {
    const dispatcher = buildDispatcher()
    dispatcher.registerPortalSensor(10)
    dispatcher.registerPortalSensor(20)

    handleAdventureEvent(dispatcher, 'PORTAL_DEACTIVATED', { handle: 10 })

    expect(dispatcher.getPortalSensorHandleSetSize()).toBe(1)
  })
})
