/**
 * Track teardown instrumentation — counts disposed resources after adventure track switches.
 */

export interface TrackTeardownStats {
  meshesDisposed: number
  materialsDisposed: number
  bodiesRemoved: number
  conveyorZonesRemoved: number
  gravityWellsRemoved: number
  dampingZonesRemoved: number
  resetSensorsRemoved: number
  chromaGatesRemoved: number
  adventureSensorRemoved: number
  /** Exit portal mesh + sensor removed during track switch (deactivateExitPortal). */
  exitPortalsRemoved: number
  lingeringBodies: number
}

export interface TrackResourceCounts {
  meshes: number
  materials: number
  bodies: number
  colliders: number
}

export function createEmptyTeardownStats(): TrackTeardownStats {
  return {
    meshesDisposed: 0,
    materialsDisposed: 0,
    bodiesRemoved: 0,
    conveyorZonesRemoved: 0,
    gravityWellsRemoved: 0,
    dampingZonesRemoved: 0,
    resetSensorsRemoved: 0,
    chromaGatesRemoved: 0,
    adventureSensorRemoved: 0,
    exitPortalsRemoved: 0,
    lingeringBodies: 0,
  }
}

/** Documented teardown contract — every counter must reach zero lingering bodies. */
export const PLAYFIELD_TEARDOWN_FIELDS: ReadonlyArray<keyof TrackTeardownStats> = [
  'meshesDisposed',
  'materialsDisposed',
  'bodiesRemoved',
  'conveyorZonesRemoved',
  'gravityWellsRemoved',
  'dampingZonesRemoved',
  'resetSensorsRemoved',
  'chromaGatesRemoved',
  'adventureSensorRemoved',
  'exitPortalsRemoved',
  'lingeringBodies',
] as const