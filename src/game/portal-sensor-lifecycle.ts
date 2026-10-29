/**
 * Exit-portal sensor lifecycle: the three places a portal's physics sensor is
 * wired to the rest of the game, kept in one module so the register / entry /
 * unregister halves cannot drift apart (and so tests drive the real thing).
 *
 *   open        `registerOpenPortal`     the sensor body becomes a zone and its handle
 *                                        is guarded in the collision dispatcher
 *   entry       `wirePortalEntry`        the engine's begin contact → `onPortalContact`
 *                                        → `AdventureMode.enterExitPortal`
 *   teardown    `unregisterClosedPortal` PORTAL_DEACTIVATED, from every path that closes
 *                                        a portal (entry, replacement, switchZone,
 *                                        switchToTrack, end)
 *
 * Entry is contact-driven: nothing samples a ball position. The portal is a
 * C++ sensor volume swept against the ball each substep, so a ball cannot skip
 * it between frames, and on the worker the contact arrives with the step
 * result instead of being re-tested against a pose a frame late.
 */

import type { ExitPortalKind } from '../adventure/adventure-portal-types'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'

export interface PortalLifecycleHost {
  readonly adventureMode: {
    getPortalSensorHandle(): number
    getPortalId(): string | null
    enterExitPortal(portalId: string): boolean
  } | null
  readonly physicsController: {
    registerPortalSensor(handle: number): void
    unregisterPortalSensor(handle: number): void
  } | null
  readonly zoneTriggerSystem: Pick<ZoneTriggerSystem, 'registerPortalBody' | 'unregisterPortalZone' | 'addCallback'> | null
}

/** Payload of the `PORTAL_DEACTIVATED` adventure event. */
export interface ClosedPortal {
  handle: number
  id: string
}

/**
 * Register the portal `AdventureMode.activateExitPortal()` just opened. A sensor
 * that has no handle (-1) was not created and registers nothing.
 */
export function registerOpenPortal(host: PortalLifecycleHost, kind: ExitPortalKind): boolean {
  const handle = host.adventureMode?.getPortalSensorHandle() ?? -1
  const id = host.adventureMode?.getPortalId() ?? null
  if (handle < 0 || id === null) return false
  host.physicsController?.registerPortalSensor(handle)
  host.zoneTriggerSystem?.registerPortalBody(id, handle, kind)
  return true
}

/**
 * Unregister a portal that closed. Both halves read the payload, never
 * `getPortalSensorHandle()` / `getPortalId()`, which already report "none" when
 * the event fires. Safe for a portal that was never registered.
 */
export function unregisterClosedPortal(host: PortalLifecycleHost, closed: ClosedPortal): void {
  host.physicsController?.unregisterPortalSensor(closed.handle)
  host.zoneTriggerSystem?.unregisterPortalZone(closed.id)
}

/** Complete the active portal when the zone system reports a ball touched it. Returns the remover. */
export function wirePortalEntry(host: PortalLifecycleHost): () => void {
  return host.zoneTriggerSystem?.addCallback({
    onPortalContact: (portalId) => {
      host.adventureMode?.enterExitPortal(portalId)
    },
  }) ?? (() => {})
}
