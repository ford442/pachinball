/**
 * The EventBus routes the physics controller owns: effect events to `EffectsSystem`, drained WASM
 * contact batches to the collision dispatcher, and the worker-fallback notice.
 *
 * Split out of `physics-controller.ts`'s constructor. Returns the unsubscribers; the controller
 * calls them from `dispose()`.
 */

import type { PhysicsHost } from './types'
import type { CollisionDispatcher } from './collision-dispatch'

export function routePhysicsEvents(host: PhysicsHost, collisionDispatcher: CollisionDispatcher): Array<() => void> {
  const unsubscribers: Array<() => void> = []

  // Route 'effect:flash' to EffectsSystem (respects accessibility guards internally)
  unsubscribers.push(
    host.eventBus.on('effect:flash', (data) => {
      if (data.color) {
        host.effects?.flashVignette(data.color, data.duration * 1000)
      }
    })
  )

  // Route 'effect:shake' to EffectsSystem
  unsubscribers.push(
    host.eventBus.on('effect:shake', (data) => {
      if (!host.accessibility.reducedMotion) {
        host.effects?.addCameraShake(data.amount)
      }
    })
  )

  // Route WASM contacts to the same dispatcher used for Rapier collisions, as one batch per
  // drained buffer (#488 §5): with no per-contact subscriber left, the engines build no
  // per-contact payloads at all. The dispatcher maps WASM ids back to the bodies scoring expects.
  unsubscribers.push(
    host.eventBus.on('wasm:physics:contacts', (batch) => {
      collisionDispatcher.onWasmContactBatch(batch)
    })
  )

  // A dead physics worker's world moved in-process (#503 A2): tell the bus, and the player.
  host.physics.setEngineSwitchListener?.((change) => {
    host.eventBus.emit('physics:engine-switched', { ...change })
  })
  unsubscribers.push(
    host.eventBus.on('physics:engine-switched', () => {
      host.uiManager?.showMessage('Physics worker stopped — switched to in-process physics', 4000)
    }),
    () => host.physics.setEngineSwitchListener?.(null),
  )

  return unsubscribers
}
