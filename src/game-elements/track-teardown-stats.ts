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
    lingeringBodies: 0,
  }
}