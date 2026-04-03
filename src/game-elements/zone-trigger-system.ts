/**
 * Zone Trigger System - Dynamic Adventure Mode Zone Detection
 * 
 * Tracks ball position and triggers zone transitions when the ball
 * crosses into new zones. Works with DynamicScenario configurations
 * to enable multi-zone maps with seamless transitions.
 * 
 * Features:
 * - Position-based zone detection (3D bounding boxes)
 * - Smooth zone transition debouncing (prevents flickering)
 * - Integration with path mechanics for zone-specific gameplay
 * - Callback system for Game.ts to handle visual/audio changes
 */

import { Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { DynamicScenario, ScenarioZone } from './dynamic-scenarios'

export interface ZoneBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY?: number
  maxY?: number
}

export interface ZoneTriggerCallback {
  onZoneEnter: (zone: ScenarioZone, fromZone: ScenarioZone | null, isMajor: boolean) => void
  onZoneExit?: (zone: ScenarioZone, toZone: ScenarioZone | null) => void
  onZoneProgress?: (zone: ScenarioZone, progress: number) => void
}

export interface ActiveZone {
  zone: ScenarioZone
  bounds: ZoneBounds
  entryTime: number
  entryPosition: Vector3
}

/**
 * Zone Trigger System - Monitors ball position and triggers zone transitions
 */
export class ZoneTriggerSystem {
  private scenario: DynamicScenario | null = null
  private activeZones: Map<string, ActiveZone> = new Map()
  private currentZoneId: string | null = null
  private previousZoneId: string | null = null
  
  // Debounce timing to prevent zone flicker at boundaries
  private readonly ZONE_DEBOUNCE_MS = 200
  private lastTransitionTime = 0
  
  // Progress tracking for current zone
  private zoneEntryPosition: Vector3 | null = null
  
  // Callbacks
  private callback: ZoneTriggerCallback | null = null
  
  // Debug mode
  private debug = false

  constructor(debug = false) {
    this.debug = debug
  }

  /**
   * Load a scenario and initialize zone detection
   */
  loadScenario(scenario: DynamicScenario): void {
    this.scenario = scenario
    this.activeZones.clear()
    this.currentZoneId = null
    this.previousZoneId = null
    this.zoneEntryPosition = null
    
    // Pre-calculate zone bounds from scenario zones
    for (const zone of scenario.zones) {
      const bounds: ZoneBounds = {
        minX: zone.position.x - zone.width / 2,
        maxX: zone.position.x + zone.width / 2,
        minZ: zone.position.z - zone.depth / 2,
        maxZ: zone.position.z + zone.depth / 2,
        minY: -5, // Allow some vertical tolerance
        maxY: 30, // Ceiling for zone detection
      }
      
      this.activeZones.set(zone.id, {
        zone,
        bounds,
        entryTime: 0,
        entryPosition: Vector3.Zero(),
      })
    }
    
    if (this.debug) {
      console.log(`[ZoneTriggerSystem] Loaded scenario: ${scenario.name} with ${scenario.zones.length} zones`)
    }
  }

  /**
   * Set the callback for zone events
   */
  setCallback(callback: ZoneTriggerCallback): void {
    this.callback = callback
  }

  /**
   * Update zone detection based on ball position
   * Call this every frame from the game loop
   */
  update(ballBodies: RAPIER.RigidBody[]): void {
    if (!this.scenario || this.activeZones.size === 0 || ballBodies.length === 0) {
      return
    }
    
    // Use the first ball for zone detection (primary ball)
    const ball = ballBodies[0]
    const pos = ball.translation()
    const ballPos = new Vector3(pos.x, pos.y, pos.z)
    
    // Find which zone the ball is currently in
    const containingZone = this.findContainingZone(ballPos)
    
    // Check for zone transition
    if (containingZone && containingZone.zone.id !== this.currentZoneId) {
      this.handleZoneTransition(containingZone, ballPos)
    } else if (!containingZone && this.currentZoneId) {
      // Ball left all zones (in transition area)
      this.handleZoneExit(null)
    }
    
    // Update progress within current zone
    if (containingZone && this.callback?.onZoneProgress) {
      const progress = this.calculateZoneProgress(containingZone, ballPos)
      this.callback.onZoneProgress(containingZone.zone, progress)
    }
  }

  /**
   * Find which zone contains the given position
   */
  private findContainingZone(position: Vector3): ActiveZone | null {
    for (const activeZone of this.activeZones.values()) {
      if (this.isPositionInZone(position, activeZone.bounds)) {
        return activeZone
      }
    }
    return null
  }

  /**
   * Check if position is within zone bounds
   */
  private isPositionInZone(position: Vector3, bounds: ZoneBounds): boolean {
    return (
      position.x >= bounds.minX &&
      position.x <= bounds.maxX &&
      position.z >= bounds.minZ &&
      position.z <= bounds.maxZ &&
      (bounds.minY === undefined || position.y >= bounds.minY) &&
      (bounds.maxY === undefined || position.y <= bounds.maxY)
    )
  }

  /**
   * Handle zone transition
   */
  private handleZoneTransition(newZone: ActiveZone, entryPosition: Vector3): void {
    const now = performance.now()
    
    // Debounce: prevent rapid zone switching
    if (now - this.lastTransitionTime < this.ZONE_DEBOUNCE_MS) {
      return
    }
    
    // Update previous zone
    this.previousZoneId = this.currentZoneId
    
    // Exit current zone if any
    if (this.currentZoneId) {
      const previousZone = this.activeZones.get(this.currentZoneId)
      if (previousZone) {
        this.handleZoneExit(newZone.zone)
      }
    }
    
    // Enter new zone
    this.currentZoneId = newZone.zone.id
    newZone.entryTime = now
    newZone.entryPosition = entryPosition.clone()
    this.zoneEntryPosition = entryPosition.clone()
    this.lastTransitionTime = now
    
    // Determine if this is a major transition
    const isMajor = this.isMajorZoneTransition(this.previousZoneId, this.currentZoneId)
    
    // Get previous zone for callback
    const previousZone = this.previousZoneId ? this.activeZones.get(this.previousZoneId)?.zone || null : null
    
    if (this.debug) {
      console.log(`[ZoneTriggerSystem] Zone transition: ${this.previousZoneId} -> ${this.currentZoneId} (${isMajor ? 'MAJOR' : 'minor'})`)
    }
    
    // Trigger callback
    this.callback?.onZoneEnter(newZone.zone, previousZone, isMajor)
  }

  /**
   * Handle zone exit
   */
  private handleZoneExit(toZone: ScenarioZone | null): void {
    if (!this.currentZoneId) return
    
    const exitingZone = this.activeZones.get(this.currentZoneId)
    if (!exitingZone) return
    
    // Zone exit tracking
    
    if (this.debug) {
      console.log(`[ZoneTriggerSystem] Zone exit: ${exitingZone.zone.id} -> ${toZone?.id || 'none'}`)
    }
    
    this.callback?.onZoneExit?.(exitingZone.zone, toZone)
    
    // Don't clear currentZoneId immediately - wait for new zone entry
    // This prevents flickering in transition areas
  }

  /**
   * Calculate progress through current zone (0-1)
   */
  private calculateZoneProgress(activeZone: ActiveZone, currentPosition: Vector3): number {
    const bounds = activeZone.bounds
    
    // Calculate progress based on Z position (assuming forward progression)
    const zoneDepth = bounds.maxZ - bounds.minZ
    const progress = (currentPosition.z - bounds.minZ) / zoneDepth
    
    return Math.max(0, Math.min(1, progress))
  }

  /**
   * Determine if transition between zones is major (triggers stronger effects)
   */
  private isMajorZoneTransition(fromId: string | null, toId: string): boolean {
    if (!fromId) return true // First entry is always major
    if (fromId === toId) return false
    
    // Get zone configs
    const fromZone = this.activeZones.get(fromId)?.zone
    const toZone = this.activeZones.get(toId)?.zone
    
    if (!fromZone || !toZone) return true
    
    // Major transition if theme changes significantly
    // This is determined by comparing map configs
    const fromPattern = fromZone.mapConfig.backgroundPattern
    const toPattern = toZone.mapConfig.backgroundPattern
    
    // Major if pattern type changes
    if (fromPattern !== toPattern) return true
    
    // Major if color changes significantly (compare hue difference)
    const fromColor = this.hexToRgb(fromZone.mapConfig.baseColor)
    const toColor = this.hexToRgb(toZone.mapConfig.baseColor)
    const colorDistance = this.calculateColorDistance(fromColor, toColor)
    
    // Major if color distance is large
    if (colorDistance > 0.5) return true
    
    return false
  }

  /**
   * Convert hex color to RGB object
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '')
    return {
      r: parseInt(clean.substring(0, 2), 16) / 255,
      g: parseInt(clean.substring(2, 4), 16) / 255,
      b: parseInt(clean.substring(4, 6), 16) / 255,
    }
  }

  /**
   * Calculate Euclidean distance between two colors (normalized 0-1)
   */
  private calculateColorDistance(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
    const dr = c1.r - c2.r
    const dg = c1.g - c2.g
    const db = c1.b - c2.b
    return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3)
  }

  /**
   * Get current zone ID
   */
  getCurrentZoneId(): string | null {
    return this.currentZoneId
  }

  /**
   * Get current zone config
   */
  getCurrentZone(): ScenarioZone | null {
    if (!this.currentZoneId) return null
    return this.activeZones.get(this.currentZoneId)?.zone || null
  }

  /**
   * Get previous zone ID
   */
  getPreviousZoneId(): string | null {
    return this.previousZoneId
  }

  /**
   * Get all zones in current scenario
   */
  getAllZones(): ScenarioZone[] {
    if (!this.scenario) return []
    return this.scenario.zones
  }

  /**
   * Check if ball is in any zone
   */
  isInZone(): boolean {
    return this.currentZoneId !== null
  }

  /**
   * Get zone progress (0-1) for current zone
   */
  getCurrentZoneProgress(): number {
    if (!this.currentZoneId || !this.zoneEntryPosition) return 0
    
    const activeZone = this.activeZones.get(this.currentZoneId)
    if (!activeZone) return 0
    
    // Return cached progress from last update
    const bounds = activeZone.bounds
    const zoneDepth = bounds.maxZ - bounds.minZ
    return (activeZone.entryPosition.z - bounds.minZ) / zoneDepth
  }

  /**
   * Reset the zone system
   */
  reset(): void {
    this.currentZoneId = null
    this.previousZoneId = null
    this.zoneEntryPosition = null
    this.lastTransitionTime = 0
    
    // Reset entry times
    for (const activeZone of this.activeZones.values()) {
      activeZone.entryTime = 0
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.activeZones.clear()
    this.scenario = null
    this.callback = null
    this.reset()
  }
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
    minY: -5,
    maxY: 30,
  }
}

/**
 * Check if two zones are adjacent (for transition optimization)
 */
export function areZonesAdjacent(zone1: ScenarioZone, zone2: ScenarioZone): boolean {
  const dx = Math.abs(zone1.position.x - zone2.position.x)
  const dz = Math.abs(zone1.position.z - zone2.position.z)
  
  const widthSum = (zone1.width + zone2.width) / 2
  const depthSum = (zone1.depth + zone2.depth) / 2
  
  // Zones are adjacent if they're close enough
  return dx < widthSum + 2 && dz < depthSum + 2
}

/**
 * Get the recommended transition type between zones
 */
export function getZoneTransitionType(
  fromZone: ScenarioZone | null,
  toZone: ScenarioZone
): 'instant' | 'fade' | 'crossfade' | 'wipe' {
  if (!fromZone) return 'fade'
  
  // Use crossfade for major theme changes
  const colorDistance = calculateHexColorDistance(
    fromZone.mapConfig.baseColor,
    toZone.mapConfig.baseColor
  )
  
  if (colorDistance > 0.6) return 'crossfade'
  if (colorDistance > 0.3) return 'fade'
  if (areZonesAdjacent(fromZone, toZone)) return 'wipe'
  
  return 'instant'
}

/**
 * Calculate color distance between two hex colors
 */
function calculateHexColorDistance(hex1: string, hex2: string): number {
  const c1 = hexToRgb(hex1)
  const c2 = hexToRgb(hex2)
  const dr = c1.r - c2.r
  const dg = c1.g - c2.g
  const db = c1.b - c2.b
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.substring(0, 2), 16) / 255,
    g: parseInt(clean.substring(2, 4), 16) / 255,
    b: parseInt(clean.substring(4, 6), 16) / 255,
  }
}
