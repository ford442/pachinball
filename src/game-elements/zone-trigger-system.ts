/**
 * Zone Trigger System - Dynamic Adventure Mode zone policy
 *
 * Spatial tests live in the physics engine. Every zone (a scenario zone, an
 * obstacle's footprint, an exit portal) is a ball-filtered sensor volume, and
 * the engine reports when a ball begins and stops overlapping it — swept over
 * the substep, so a zone thinner than one frame of travel is still entered,
 * and on the worker the contacts arrive with the step result instead of being
 * re-derived from a pose a frame late. This class holds only what the engine
 * cannot know:
 *
 * - which zone is current / previous, and whether a transition is major
 * - the boundary-flicker debounce, counted in sim steps (`simClockSteps()`),
 *   never wall time, so a replay debounces exactly as the live run did
 * - the callbacks `Game` uses for visuals, audio and portal entry
 *
 * Feed it with `contactBegin` / `contactEnd` (CollisionDispatcher does). Camera
 * cuts and score rules stay in the callbacks; nothing here polls a position.
 */

import { parseHexColorUnit } from '../core/color'
import type { PhysicsBody } from '../core/physics-api'
import { FIXED_TIMESTEP, simClockSteps } from '../core/sim-clock'
import type { DynamicScenario, ScenarioZone } from './dynamic-scenarios'

export interface ZoneBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY?: number
  maxY?: number
}

/** Vertical extent of a zone that does not declare one (a scenario zone spans the whole table). */
export const ZONE_MIN_Y = -5
export const ZONE_MAX_Y = 30

/**
 * Re-entry window, in fixed sim steps: the former 200 ms boundary debounce.
 * A ball that touches a zone's edge, leaves and returns inside this window is
 * one visit, not three.
 */
export const ZONE_DEBOUNCE_STEPS = Math.round(200 / (FIXED_TIMESTEP * 1000))

export interface ZoneTriggerCallback {
  onZoneEnter: (zone: ScenarioZone, fromZone: ScenarioZone | null, isMajor: boolean) => void
  onZoneExit?: (zone: ScenarioZone, toZone: ScenarioZone | null) => void
  /**
   * Fired when a ball begins overlapping a registered exit-portal sensor, right
   * after `onZoneEnter` for the same entry. Carries the typed portal metadata.
   *
   * @param portalId   The portal zone id (e.g. `NEON_HELIX-exit-portal`).
   * @param kind       Whether this is a success or timeout portal.
   */
  onPortalContact?: (portalId: string, kind: 'success' | 'timeout') => void
}

/**
 * Where zone volumes live in the physics world. `ZoneSensors` is the real one;
 * tests pass a fake. Every volume is a sensor filtered to the ball group.
 */
export interface ZoneSensorSink {
  /** Author a new sensor volume for zone `id` from its bounds (replaces an earlier one). */
  author(id: string, bounds: ZoneBounds): void
  /** Claim an existing sensor body (an adventure exit portal's) as zone `id`. */
  adopt(id: string, bodyHandle: number): void
  /** Drop zone `id`'s mapping and remove the body if it was authored here. */
  release(id: string): void
  /** The zone a physics body stands for, or null. */
  zoneIdOf(bodyHandle: number): string | null
  /** Bodies authored here — the owner path exports these with the table. */
  bodies(): readonly PhysicsBody[]
  dispose(): void
}

type PortalKind = 'success' | 'timeout'

interface ZoneEntry {
  zone: ScenarioZone
  portalKind?: PortalKind
  /** Loaded by `loadScenario` (replaced with the next scenario) rather than registered ad hoc. */
  fromScenario: boolean
  /** Balls currently overlapping the zone's sensor. */
  occupants: Set<number>
  /** `onZoneEnter` was delivered for this visit and no exit has balanced it yet. */
  announced: boolean
  enteredAtStep: number
  /** Sim step an exit was held back for the debounce window; null when none. */
  heldExitAtStep: number | null
}

/**
 * Zone Trigger System - turns sensor contacts into zone transitions
 */
export class ZoneTriggerSystem {
  private scenario: DynamicScenario | null = null
  private zones: Map<string, ZoneEntry> = new Map()
  private currentZoneId: string | null = null
  private previousZoneId: string | null = null
  /** The current zone's `onZoneExit` has been delivered, so a later transition does not repeat it. */
  private currentExitFired = false
  private sensors: ZoneSensorSink | null = null
  private callback: ZoneTriggerCallback | null = null
  private extraCallbacks: Set<Partial<ZoneTriggerCallback>> = new Set()
  private zoneEntriesThisBall = 0

  /** `clock` is `simClockSteps` in the game, a test-controlled counter in tests. */
  constructor(private readonly debug = false, private readonly clock: () => number = simClockSteps) {}

  /** Attach the physics-side sensor registry (before any zone is registered). */
  setSensors(sensors: ZoneSensorSink | null): void {
    this.sensors = sensors
  }

  /** Bodies the owner path must export with the table (the authored zone volumes). */
  getSensorBodies(): readonly PhysicsBody[] {
    return this.sensors?.bodies() ?? []
  }

  /** The zone a physics body is the sensor of, or null. CollisionDispatcher routes contacts with it. */
  zoneIdOfBody(bodyHandle: number): string | null {
    return this.sensors?.zoneIdOf(bodyHandle) ?? null
  }

  /** Register an ad-hoc obstacle zone (not part of a loaded scenario). */
  registerObstacleZone(id: string, bounds: ZoneBounds, metadata?: Record<string, unknown>): void {
    this.addZone(id, syntheticZone(id, bounds, metadata), false)
    this.sensors?.author(id, bounds)
  }

  /**
   * Register an exit-portal zone from bounds, authoring its sensor, so that
   * `onPortalContact` fires when a ball enters it. Portal ids follow
   * `<trackId>-exit-portal`; `kind` is `'success'` for a win, `'timeout'` for the escape portal.
   */
  registerPortalZone(id: string, bounds: ZoneBounds, kind: PortalKind): void {
    this.addZone(id, syntheticZone(id, bounds, { portalKind: kind }), false, kind)
    this.sensors?.author(id, bounds)
  }

  /**
   * Register an exit portal whose sensor body already exists — the adventure
   * track's cylinder, on `ADVENTURE_GROUP`. No second volume is authored; the
   * body's contacts reach this zone until it is unregistered.
   */
  registerPortalBody(id: string, bodyHandle: number, kind: PortalKind): void {
    this.addZone(id, syntheticZone(id, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, { portalKind: kind }), false, kind)
    this.sensors?.adopt(id, bodyHandle)
  }

  /** Unregister an obstacle zone. Safe if it was never registered. */
  unregisterObstacleZone(id: string): void {
    this.removeZone(id)
  }

  /** Unregister a portal zone. Safe if it was never registered (every portal deactivation path calls it). */
  unregisterPortalZone(id: string): void {
    this.removeZone(id)
  }

  /** Load a scenario: its zones replace the previous scenario's; ad-hoc obstacle and portal zones stay. */
  loadScenario(scenario: DynamicScenario): void {
    this.removeZones((entry) => entry.fromScenario)
    this.scenario = scenario
    for (const zone of scenario.zones) {
      this.addZone(zone.id, zone, true)
      this.sensors?.author(zone.id, createZoneBounds(zone))
    }
    if (this.debug) console.log(`[ZoneTriggerSystem] Loaded scenario: ${scenario.name} with ${scenario.zones.length} zones`)
  }

  /** Drop the loaded scenario's zones and callback; obstacle and portal zones stay. */
  unloadScenario(): void {
    this.removeZones((entry) => entry.fromScenario)
    this.scenario = null
    this.callback = null
  }

  /** Set the callback for zone events (the scenario's; replaces the previous one). */
  setCallback(callback: ZoneTriggerCallback): void {
    this.callback = callback
  }

  /** Add a listener that survives `setCallback` — wiring that outlives any scenario, such as portal entry. */
  addCallback(callback: Partial<ZoneTriggerCallback>): () => void {
    this.extraCallbacks.add(callback)
    return () => {
      this.extraCallbacks.delete(callback)
    }
  }

  /**
   * A ball began overlapping zone `zoneId`'s sensor. `ballKey` is the ball's
   * dispatch key; a zone with several balls inside is entered by the first and left by the last.
   */
  contactBegin(zoneId: string, ballKey: number): void {
    const entry = this.zones.get(zoneId)
    if (!entry) return
    const now = this.clock()
    this.flushHeldExits(now)

    // A repeat begin for a ball already inside is not an entry (static ids shift when
    // the table is re-exported, and the engine then reports the same overlap again).
    if (entry.occupants.has(ballKey)) return
    entry.occupants.add(ballKey)
    if (entry.occupants.size > 1) return

    if (entry.heldExitAtStep !== null) {
      const flicker = within(entry.heldExitAtStep, now)
      entry.heldExitAtStep = null
      if (flicker) return // straight back across the edge: still the same visit
      this.announceExit(entry, null)
    }
    this.announceEnter(entry, now)
  }

  /** A ball stopped overlapping zone `zoneId`'s sensor. */
  contactEnd(zoneId: string, ballKey: number): void {
    const entry = this.zones.get(zoneId)
    if (!entry) return
    const now = this.clock()
    this.flushHeldExits(now)

    // An end for a ball that was never inside (a stale pair from before a re-export) is not an exit.
    if (!entry.occupants.delete(ballKey)) return
    if (entry.occupants.size > 0 || !entry.announced) return

    // An exit this soon after the entry is edge jitter: hold it for the next begin to cancel,
    // or the next zone event to confirm.
    if (within(entry.enteredAtStep, now)) {
      entry.heldExitAtStep = now
      return
    }
    this.announceExit(entry, null)
  }

  /** Announce the exits held back for the debounce window that have since proven real. */
  private flushHeldExits(now: number): void {
    for (const entry of this.zones.values()) {
      if (entry.heldExitAtStep === null || entry.occupants.size > 0 || within(entry.heldExitAtStep, now)) continue
      entry.heldExitAtStep = null
      this.announceExit(entry, null)
    }
  }

  private announceEnter(entry: ZoneEntry, now: number): void {
    const zone = entry.zone

    // Leaving the current zone for this one (zones may overlap, so it can still be occupied).
    if (this.currentZoneId && this.currentZoneId !== zone.id && !this.currentExitFired) {
      const leaving = this.zones.get(this.currentZoneId)
      if (leaving) this.announceExit(leaving, zone)
    }

    this.previousZoneId = this.currentZoneId
    this.currentZoneId = zone.id
    this.currentExitFired = false
    entry.announced = true
    entry.enteredAtStep = now
    this.zoneEntriesThisBall++

    const previous = this.previousZoneId ? this.zones.get(this.previousZoneId)?.zone ?? null : null
    const isMajor = isMajorTransition(previous, zone)
    if (this.debug) console.log(`[ZoneTriggerSystem] Zone transition: ${previous?.id ?? null} -> ${zone.id} (${isMajor ? 'MAJOR' : 'minor'})`)

    this.emit((cb) => cb.onZoneEnter?.(zone, previous, isMajor))
    const kind = entry.portalKind
    if (kind !== undefined) this.emit((cb) => cb.onPortalContact?.(zone.id, kind))
  }

  private announceExit(entry: ZoneEntry, toZone: ScenarioZone | null): void {
    entry.announced = false
    // The current zone stays current until another is entered: this only reports the exit.
    if (this.currentZoneId !== entry.zone.id || this.currentExitFired) return
    this.currentExitFired = true
    this.emit((cb) => cb.onZoneExit?.(entry.zone, toZone))
  }

  /** Invoke every callback; one that throws cannot starve the rest. */
  private emit(invoke: (cb: Partial<ZoneTriggerCallback>) => void): void {
    const targets = this.callback ? [this.callback, ...this.extraCallbacks] : [...this.extraCallbacks]
    for (const cb of targets) {
      try {
        invoke(cb)
      } catch (err) {
        console.error('[ZoneTriggerSystem] zone callback threw', err)
      }
    }
  }

  private addZone(id: string, zone: ScenarioZone, fromScenario: boolean, portalKind?: PortalKind): void {
    this.removeZone(id)
    this.zones.set(id, {
      zone,
      ...(portalKind !== undefined ? { portalKind } : {}),
      fromScenario,
      occupants: new Set(),
      announced: false,
      enteredAtStep: 0,
      heldExitAtStep: null,
    })
  }

  /** Forget a zone and its sensor. */
  private removeZone(id: string): void {
    this.zones.delete(id)
    this.sensors?.release(id)
    if (this.currentZoneId === id) this.currentZoneId = null
    if (this.previousZoneId === id) this.previousZoneId = null
  }

  private removeZones(matching: (entry: ZoneEntry) => boolean): void {
    for (const [id, entry] of [...this.zones]) {
      if (matching(entry)) this.removeZone(id)
    }
  }

  getCurrentZoneId(): string | null {
    return this.currentZoneId
  }

  getCurrentZone(): ScenarioZone | null {
    return this.currentZoneId ? this.zones.get(this.currentZoneId)?.zone ?? null : null
  }

  getPreviousZoneId(): string | null {
    return this.previousZoneId
  }

  /** Zones of the loaded scenario. */
  getAllZones(): ScenarioZone[] {
    return this.scenario?.zones ?? []
  }

  isInZone(): boolean {
    return this.currentZoneId !== null
  }

  /** Per-ball zone entry count (instrumentation). */
  getZoneEntriesThisBall(): number {
    return this.zoneEntriesThisBall
  }

  /** Reset per-ball counters (called on new ball launch). */
  resetBallCounters(): void {
    this.zoneEntriesThisBall = 0
  }

  /** Clear the ad-hoc obstacle and portal zones (and their sensors); scenario zones stay. */
  clearObstacleZones(): void {
    this.removeZones((entry) => !entry.fromScenario)
  }

  reset(): void {
    this.currentZoneId = null
    this.previousZoneId = null
    this.currentExitFired = false
    for (const entry of this.zones.values()) {
      entry.occupants.clear()
      entry.announced = false
      entry.enteredAtStep = 0
      entry.heldExitAtStep = null
    }
  }

  dispose(): void {
    this.removeZones(() => true)
    this.sensors?.dispose()
    this.sensors = null
    this.scenario = null
    this.callback = null
    this.extraCallbacks.clear()
    this.reset()
  }
}

/** `last` and `now` are on the same clock and closer than the debounce; a clock that went backwards never debounces. */
function within(last: number, now: number): boolean {
  return now >= last && now - last < ZONE_DEBOUNCE_STEPS
}

/** Zone placeholder for something that is not a scenario zone (an obstacle footprint, an exit portal). */
function syntheticZone(id: string, bounds: ZoneBounds, metadata?: Record<string, unknown>): ScenarioZone {
  return {
    id,
    name: id,
    position: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    width: bounds.maxX - bounds.minX,
    depth: bounds.maxZ - bounds.minZ,
    mapConfig: {
      baseColor: (metadata?.['color'] as string) || '#ffffff',
      accentColor: '#000000',
      backgroundPattern: 'hex',
      scanlineIntensity: 0.1,
      glowIntensity: 0.3,
      animationSpeed: 0,
    },
    mechanics: [],
    storyText: `Obstacle zone: ${id}`,
    musicTrack: 'default',
  }
}

/** A first entry is always major; otherwise a change of pattern or a large colour shift is. */
function isMajorTransition(from: ScenarioZone | null, to: ScenarioZone): boolean {
  if (!from) return true
  if (from.id === to.id) return false
  if (from.mapConfig.backgroundPattern !== to.mapConfig.backgroundPattern) return true
  const a = parseHexColorUnit(from.mapConfig.baseColor)
  const b = parseHexColorUnit(to.mapConfig.baseColor)
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) / Math.sqrt(3) > 0.5
}

/**
 * Create zone bounds from a scenario zone
 */
export function createZoneBounds(zone: ScenarioZone): ZoneBounds {
  return {
    minX: zone.position.x - zone.width / 2,
    maxX: zone.position.x + zone.width / 2,
    minZ: zone.position.z - zone.depth / 2,
    maxZ: zone.position.z + zone.depth / 2,
    minY: ZONE_MIN_Y,
    maxY: ZONE_MAX_Y,
  }
}
