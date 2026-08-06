/**
 * CollisionDispatcher — collider→body handle-space conversion and obstacle/ball dispatch.
 *
 * This module owns the highest-risk logic in the physics pipeline: converting
 * Rapier collider handles (from drainCollisionEvents) into parent rigid-body
 * handles before any set-membership or scoring lookup. The actual per-obstacle
 * reactions live in `collision-handlers.ts` so this file stays focused on
 * handle-space routing.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { Mesh } from '@babylonjs/core'

import type { BumperVisual } from '../../game-elements/types'
import type { LaneSensorDef } from '../../objects/object-lane-sensors'
import type { WasmContactEvent } from '../../wasm'

import type { PhysicsHost } from './types'
import type { ScoringBridge } from './scoring-bridge'

/** Minimal WASM bridge surface used by collision dispatch. */
export interface WasmPhysicsBridge {
  getRapierBody(wasmId: number): RAPIER.RigidBody | undefined
}

import {
  handleBumperCollision,
  handleFlipperCollision,
  handleTargetCollision,
  handleSpinnerCollision,
  handleBallTrapCollision,
  handleLauncherCollision,
  handleGateCollision,
  handleLaneRolloverCollision,
  getBallMeshForBody as lookupBallMeshForBody,
  type CollisionHandlerContext,
} from './collision-handlers'

export class CollisionDispatcher {
  private readonly host: PhysicsHost
  private readonly scoringBridge: ScoringBridge
  private readonly getWasmBridge: () => WasmPhysicsBridge | null

  private lastCollisionTime: Map<string, number> = new Map()
  private lastColliderCollisionTime: Map<string, number> = new Map()
  private bumperHandleSet: Set<number> = new Set()
  private targetHandleSet: Set<number> = new Set()
  private ballHandleSet: Set<number> = new Set()
  private flipperHandleSet: Set<number> = new Set()
  private trapHandleSet: Set<number> = new Set()
  private gateHandleSet: Set<number> = new Set()
  private launcherHandleSet: Set<number> = new Set()
  private spinnerHandleSet: Set<number> = new Set()
  private bumperVisualMap: Map<number, BumperVisual> = new Map()
  private deathZoneHandle: number = -1

  private adventureSensorHandle: number = -1
  /** Handles of active exit-portal sensor bodies; collisions are silently skipped
   *  in the dispatcher since portal contact is detected via intersectionPair queries
   *  inside AdventureMode.updateExitPortal(). */
  private portalSensorHandleSet: Set<number> = new Set()
  private laneSensorHandleMap: Map<number, LaneSensorDef> = new Map()
  private laneRolloverAwardedKeys: Set<string> = new Set()
  private lastLaneHitId: string | null = null
  private eventBusUnsubscribers: Array<() => void> = []

  // Temporary Phase-0 collision-pipeline instrumentation (surfaced only when debug HUD is visible)
  private rawCollisionEvents = 0
  private knownObstacleMatches = 0
  private bumperMatches = 0

  private static readonly COLLISION_DEBOUNCE_MS = 16
  /** Minimum contact force to trigger visual effects */
  private static readonly CONTACT_FORCE_THRESHOLD = 5
  /** Force value used to normalize intensity to 0-1 range */
  private static readonly CONTACT_FORCE_MAX = 50
  /** Minimum force for camera shake */
  private static readonly HARD_IMPACT_THRESHOLD = 30
  /** Bloom energy multiplier for force-based effects */
  private static readonly BLOOM_FORCE_SCALE = 2
  /** Camera shake multiplier for force-based effects */
  private static readonly SHAKE_FORCE_SCALE = 0.5

  private readonly handlerContext: CollisionHandlerContext

  constructor(host: PhysicsHost, scoringBridge: ScoringBridge, getWasmBridge: () => WasmPhysicsBridge | null) {
    this.host = host
    this.scoringBridge = scoringBridge
    this.getWasmBridge = getWasmBridge
    this.handlerContext = {
      host: this.host,
      scoringBridge: this.scoringBridge,
      ballHandleSet: this.ballHandleSet,
      bumperVisualMap: this.bumperVisualMap,
      laneRolloverAwardedKeys: this.laneRolloverAwardedKeys,
      setLastLaneHit: (laneId: string) => {
        this.lastLaneHitId = laneId
      },
    }

    this.eventBusUnsubscribers.push(
      host.eventBus.on('ball:launched', () => {
        this.laneRolloverAwardedKeys.clear()
      }),
    )
  }

  dispose(): void {
    for (const unsub of this.eventBusUnsubscribers) {
      unsub()
    }
    this.eventBusUnsubscribers = []
  }

  rebuildHandleCaches(): void {
    this.bumperHandleSet.clear()
    this.targetHandleSet.clear()
    this.ballHandleSet.clear()
    this.flipperHandleSet.clear()
    this.trapHandleSet.clear()
    this.gateHandleSet.clear()
    this.launcherHandleSet.clear()
    this.spinnerHandleSet.clear()
    this.bumperVisualMap.clear()
    this.laneSensorHandleMap.clear()

    for (const b of (this.host.gameObjects?.getBumperBodies() || [])) {
      this.bumperHandleSet.add(b.handle)
    }
    // Build O(1) bumper visual lookup keyed by body handle
    for (const vis of (this.host.gameObjects?.getBumperVisuals() || [])) {
      this.bumperVisualMap.set(vis.body.handle, vis)
    }
    for (const b of (this.host.gameObjects?.getTargetBodies() || [])) {
      this.targetHandleSet.add(b.handle)
    }
    for (const b of (this.host.ballManager?.getBallBodies() || [])) {
      this.ballHandleSet.add(b.handle)
    }

    const flippers = this.host.gameObjects?.getAllFlippers() || new Map()
    for (const flipper of flippers.values()) {
      this.flipperHandleSet.add(flipper.body.handle)
    }

    for (const b of (this.host.ballTrapBuilder?.getBodies() || [])) {
      this.trapHandleSet.add(b.handle)
    }
    for (const b of (this.host.movingGateBuilder?.getBodies() || [])) {
      this.gateHandleSet.add(b.handle)
    }
    for (const b of (this.host.launcherBuilder?.getBodies() || [])) {
      this.launcherHandleSet.add(b.handle)
    }
    for (const b of (this.host.spinnerBuilder?.getBodies() || [])) {
      this.spinnerHandleSet.add(b.handle)
    }

    for (const sensor of (this.host.gameObjects?.getLaneSensors() || [])) {
      this.laneSensorHandleMap.set(sensor.body.handle, sensor)
    }

    const dz = this.host.gameObjects?.getDeathZoneBody()
    this.deathZoneHandle = dz ? dz.handle : -1

    const adventureSensor = this.host.adventureMode?.isActive()
      ? this.host.adventureMode.getSensor()
      : null
    this.adventureSensorHandle = adventureSensor ? adventureSensor.handle : -1

    // Portal sensor handles are registered/unregistered dynamically via
    // registerPortalSensor / unregisterPortalSensor and are intentionally NOT
    // reset here — portals may already be active when the cache is rebuilt.
  }

  /**
   * Register an exit-portal sensor body handle so the collision dispatcher
   * can skip it cleanly.  Portal contact is detected by intersectionPair
   * queries inside AdventureMode.updateExitPortal(); Rapier collision events
   * for the sensor body are redundant and must not reach other handlers.
   *
   * Call this immediately after AdventureMode.activateExitPortal() succeeds.
   */
  registerPortalSensor(handle: number): void {
    if (handle >= 0) {
      this.portalSensorHandleSet.add(handle)
    }
  }

  /**
   * Unregister a portal sensor handle when the portal is deactivated.
   * Safe to call with -1 or an unknown handle (no-op).
   */
  unregisterPortalSensor(handle: number): void {
    this.portalSensorHandleSet.delete(handle)
  }

  /** Number of registered exit-portal sensor handles — debug HUD diagnostics. */
  getPortalSensorHandleSetSize(): number {
    return this.portalSensorHandleSet.size
  }

  getRawCollisionEvents(): number {
    return this.rawCollisionEvents
  }
  getKnownObstacleMatches(): number {
    return this.knownObstacleMatches
  }
  getBumperMatches(): number {
    return this.bumperMatches
  }
  getLastLaneHit(): string | null {
    return this.lastLaneHitId
  }
  getLaneSensorHandleMapSize(): number {
    return this.laneSensorHandleMap.size
  }
  resetCollisionCounters(): void {
    this.rawCollisionEvents = 0
    this.knownObstacleMatches = 0
    this.bumperMatches = 0
  }

  /**
   * Entry point for Rapier collider-handle collision events. Mirrors the legacy
   * callback shape: collider-pair debounce, collider→body conversion, fixed-body
   * guard, then the body-pair debounce and obstacle dispatch.
   */
  processCollision(h1: number, h2: number, started: boolean): void {
    if (!started) return
    if (h1 === 0 || h2 === 0 || h1 === h2) return

    // First debounce in collider-handle space (the raw event index space).
    const colliderPairKey = h1 < h2 ? `${h1}_${h2}` : `${h2}_${h1}`
    const now = performance.now()
    const lastColliderTime = this.lastColliderCollisionTime.get(colliderPairKey) || 0
    if (now - lastColliderTime < CollisionDispatcher.COLLISION_DEBOUNCE_MS) return
    this.lastColliderCollisionTime.set(colliderPairKey, now)

    const world = this.host.physics.getWorld()
    if (!world) return

    // drainCollisionEvents reports collider handles; convert to parent body handles
    // before any rigid-body lookup or set membership test. Bumpers have multiple
    // colliders per body, so the spaces diverge immediately at table build time.
    const c1 = world.getCollider(h1)
    const c2 = world.getCollider(h2)
    const bh1 = c1?.parent()?.handle ?? -1
    const bh2 = c2?.parent()?.handle ?? -1
    if (bh1 < 0 || bh2 < 0) return

    const b1 = world.getRigidBody(bh1)
    const b2 = world.getRigidBody(bh2)
    if (!b1 || !b2) return
    if (b1.isFixed() && b2.isFixed()) return

    this.processBodyCollision(b1, b2, bh1, bh2)
  }

  /**
   * Handles contacts that originated in the WASM engine. The wrapper already emits
   * these on the EventBus as 'wasm:physics:contact'; we just map WASM IDs back to
   * the Rapier bodies that the rest of the game understands.
   */
  onWasmContact(evt: WasmContactEvent): void {
    const bridge = this.getWasmBridge()
    if (!bridge) return

    const b1 = bridge.getRapierBody(evt.bodyId1)
    const b2 = bridge.getRapierBody(evt.bodyId2)
    if (!b1 || !b2) return

    this.processBodyCollision(b1, b2, b1.handle, b2.handle)
  }

  /**
   * Body-pair debounce + raw-event accounting, then obstacle/ball dispatch.
   * Called both from the Rapier collider→body path and from the WASM contact path.
   */
  private processBodyCollision(b1: RAPIER.RigidBody, b2: RAPIER.RigidBody, bh1: number, bh2: number): void {
    this.rawCollisionEvents++

    const pairKey = bh1 < bh2 ? `${bh1}_${bh2}` : `${bh2}_${bh1}`
    const now = performance.now()
    const lastTime = this.lastCollisionTime.get(pairKey) || 0
    if (now - lastTime < CollisionDispatcher.COLLISION_DEBOUNCE_MS) return
    this.lastCollisionTime.set(pairKey, now)

    this.processCollisionBodies(b1, b2, bh1, bh2)
  }

  /**
   * Core obstacle/ball dispatch logic. Called both from the Rapier collider→body
   * path and from the WASM contact path, so the scoring/effects branches stay
   * identical regardless of backend.
   */
  private processCollisionBodies(
    b1: RAPIER.RigidBody,
    b2: RAPIER.RigidBody,
    bh1: number,
    bh2: number
  ): void {
    // Pre-flight guards — special non-obstacle handles (now in body-handle space)
    // Exit-portal sensors: contact is handled by intersectionPair queries in
    // AdventureMode.updateExitPortal(); skip here to avoid misrouting.
    if (this.portalSensorHandleSet.has(bh1) || this.portalSensorHandleSet.has(bh2)) {
      return
    }

    if (this.adventureSensorHandle >= 0 && (bh1 === this.adventureSensorHandle || bh2 === this.adventureSensorHandle)) {
      this.host.endAdventureMode()
      return
    }

    if (this.deathZoneHandle >= 0 && (bh1 === this.deathZoneHandle || bh2 === this.deathZoneHandle)) {
      this.scoringBridge.handleBallLoss(bh1 === this.deathZoneHandle ? b2 : b1)
      return
    }

    const laneHit = this.resolveLaneSensor(bh1, bh2)
    if (laneHit) {
      this.knownObstacleMatches++
      const ballBody = this.ballHandleSet.has(bh1) ? b1 : b2
      const ballHandle = this.ballHandleSet.has(bh1) ? bh1 : bh2
      handleLaneRolloverCollision(this.handlerContext, laneHit.sensor, ballBody, ballHandle)
      return
    }

    // Collision type dispatch — each branch resolves obstacle/ball bodies then delegates
    const h1IsBumper = this.bumperHandleSet.has(bh1)
    const h2IsBumper = this.bumperHandleSet.has(bh2)
    if (h1IsBumper || h2IsBumper) {
      this.knownObstacleMatches++
      this.bumperMatches++
      handleBumperCollision(this.handlerContext, h1IsBumper ? b1 : b2, h1IsBumper ? b2 : b1, h1IsBumper ? bh2 : bh1)
      return
    }

    const h1IsFlipper = this.flipperHandleSet.has(bh1)
    const h2IsFlipper = this.flipperHandleSet.has(bh2)
    if (h1IsFlipper || h2IsFlipper) {
      this.knownObstacleMatches++
      handleFlipperCollision(this.handlerContext, h1IsFlipper ? b1 : b2, h1IsFlipper ? b2 : b1, h1IsFlipper ? bh2 : bh1)
      return
    }

    const h1IsTarget = this.targetHandleSet.has(bh1)
    const h2IsTarget = this.targetHandleSet.has(bh2)
    if (h1IsTarget || h2IsTarget) {
      this.knownObstacleMatches++
      handleTargetCollision(this.handlerContext, h1IsTarget ? b1 : b2, h1IsTarget ? b2 : b1, h1IsTarget ? bh2 : bh1)
      return
    }

    const h1IsSpinner = this.spinnerHandleSet.has(bh1)
    const h2IsSpinner = this.spinnerHandleSet.has(bh2)
    if (h1IsSpinner || h2IsSpinner) {
      this.knownObstacleMatches++
      handleSpinnerCollision(this.handlerContext, h1IsSpinner ? b1 : b2, h1IsSpinner ? b2 : b1, h1IsSpinner ? bh2 : bh1)
      return
    }

    const h1IsTrap = this.trapHandleSet.has(bh1)
    const h2IsTrap = this.trapHandleSet.has(bh2)
    if (h1IsTrap || h2IsTrap) {
      this.knownObstacleMatches++
      handleBallTrapCollision(this.handlerContext, h1IsTrap ? b1 : b2, h1IsTrap ? b2 : b1, h1IsTrap ? bh2 : bh1)
      return
    }

    const h1IsLauncher = this.launcherHandleSet.has(bh1)
    const h2IsLauncher = this.launcherHandleSet.has(bh2)
    if (h1IsLauncher || h2IsLauncher) {
      this.knownObstacleMatches++
      handleLauncherCollision(this.handlerContext, h1IsLauncher ? b1 : b2, h1IsLauncher ? b2 : b1, h1IsLauncher ? bh2 : bh1)
      return
    }

    const h1IsGate = this.gateHandleSet.has(bh1)
    const h2IsGate = this.gateHandleSet.has(bh2)
    if (h1IsGate || h2IsGate) {
      this.knownObstacleMatches++
      handleGateCollision(this.handlerContext, h1IsGate ? b1 : b2, h1IsGate ? bh2 : bh1)
      return
    }
  }

  /**
   * Process contact force events for force-proportional effects.
   * Stronger hits produce bigger visual feedback (bloom, camera shake).
   */
  processContactForce(h1: number, h2: number, maxForce: number): void {
    // Ignore gentle contacts below threshold
    if (maxForce < CollisionDispatcher.CONTACT_FORCE_THRESHOLD) return

    const world = this.host.physics.getWorld()
    if (!world) return

    // Contact-force events report collider handles; convert to parent body handles
    // before looking up ball bodies.
    const c1 = world.getCollider(h1)
    const c2 = world.getCollider(h2)
    const bh1 = c1?.parent()?.handle ?? -1
    const bh2 = c2?.parent()?.handle ?? -1
    if (bh1 < 0 || bh2 < 0) return

    // Only apply force-based effects for ball contacts
    const h1IsBall = this.ballHandleSet.has(bh1)
    const h2IsBall = this.ballHandleSet.has(bh2)
    if (!h1IsBall && !h2IsBall) return

    // Normalize intensity (0-1) based on force magnitude
    const intensity = Math.min(maxForce / CollisionDispatcher.CONTACT_FORCE_MAX, 1.0)

    // Bloom energy scales with impact force
    this.host.effects?.setBloomEnergy(intensity * CollisionDispatcher.BLOOM_FORCE_SCALE)
    this.host.soundSystem.playImpact('peg', intensity * 18)

    // Hard impacts trigger camera shake
    if (maxForce > CollisionDispatcher.HARD_IMPACT_THRESHOLD) {
      this.host.effects?.addCameraShake(intensity * CollisionDispatcher.SHAKE_FORCE_SCALE)
    }
  }

  getBallMeshForBody(body: RAPIER.RigidBody): Mesh | null {
    return lookupBallMeshForBody(this.host, body)
  }

  private resolveLaneSensor(
    bh1: number,
    bh2: number,
  ): { sensor: LaneSensorDef; ballHandle: number } | null {
    const s1 = this.laneSensorHandleMap.get(bh1)
    if (s1) {
      if (!this.ballHandleSet.has(bh2)) return null
      return { sensor: s1, ballHandle: bh2 }
    }
    const s2 = this.laneSensorHandleMap.get(bh2)
    if (s2) {
      if (!this.ballHandleSet.has(bh1)) return null
      return { sensor: s2, ballHandle: bh1 }
    }
    return null
  }
}
