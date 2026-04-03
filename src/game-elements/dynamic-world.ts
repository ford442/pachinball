/**
 * Dynamic World System - Free-ranging scrolling adventure mode
 *
 * Transforms the fixed pinball table into a scrolling journey where:
 * - The camera follows the ball smoothly through changing environments
 * - Zone triggers activate as the ball progresses, evolving:
 *   - Shader colors and effects
 *   - Backbox video and story
 *   - Music tracks
 *   - Interactive mechanics (bumpers, targets, etc.)
 *
 * Architecture:
 * - World scrolls vertically (negative Z direction)
 * - Zones are defined by Z-position ranges
 * - Smooth camera following with lookahead
 * - Fallback to fixed mode for backward compatibility
 */

import {
  Vector3,
  ArcRotateCamera,
  Color3,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  PointLight,
} from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type { TableMapType, TableMapConfig } from '../shaders/lcd-table'
import type { DisplaySystem } from './display'
import type { SoundSystem } from './sound-system'
import { color } from './visual-language'

export type WorldMode = 'fixed' | 'dynamic'

export interface WorldZone {
  id: string
  name: string
  startZ: number
  endZ: number
  mapType: TableMapType
  mapConfig: Partial<TableMapConfig>
  backboxVideo?: string
  storyText?: string
  musicTrack?: string
  spawnMechanics?: ZoneMechanic[]
}

export interface ZoneMechanic {
  type: 'bumper' | 'target' | 'ramp' | 'portal' | 'collectible'
  position: Vector3
  properties?: Record<string, unknown>
}

export interface DynamicWorldConfig {
  mode: WorldMode
  totalLength: number
  zones: WorldZone[]
  cameraLookahead: number
  cameraSmoothing: number
}

export const DEFAULT_DYNAMIC_CONFIG: DynamicWorldConfig = {
  mode: 'fixed',
  totalLength: 200,
  zones: [],
  cameraLookahead: 5,
  cameraSmoothing: 0.05,
}

/**
 * DynamicWorld manages the scrolling adventure experience
 */
export class DynamicWorld {
  private scene: Scene
  private camera: ArcRotateCamera
  private display: DisplaySystem
  private sound: SoundSystem
  private config: DynamicWorldConfig

  // State
  private currentZone: WorldZone | null = null
  private ballProgress = 0
  private cameraTargetZ = 0
  private activeMechanics: Mesh[] = []
  private zoneLights: PointLight[] = []

  // Visual feedback
  private zoneTransitionActive = false
  private zoneTransitionTime = 0

  constructor(
    scene: Scene,
    camera: ArcRotateCamera,
    display: DisplaySystem,
    sound: SoundSystem,
    config?: Partial<DynamicWorldConfig>
  ) {
    this.scene = scene
    this.camera = camera
    this.display = display
    this.sound = sound
    this.config = { ...DEFAULT_DYNAMIC_CONFIG, ...config }
  }

  /**
   * Initialize the dynamic world with zones
   */
  initialize(zones: WorldZone[]): void {
    this.config.zones = zones
    console.log(`[DynamicWorld] Initialized with ${zones.length} zones`)
  }

  /**
   * Main update called every frame
   * @param ballPos Current ball position
   * @param deltaTime Time since last frame
   */
  update(ballPos: Vector3, deltaTime: number): void {
    if (this.config.mode === 'fixed') return

    // Update ball progress (how far into the world)
    this.ballProgress = Math.abs(ballPos.z)

    // Smooth camera following with lookahead
    const targetZ = ballPos.z - this.config.cameraLookahead
    this.cameraTargetZ += (targetZ - this.cameraTargetZ) * this.config.cameraSmoothing

    // Update camera target
    this.camera.target.z = this.cameraTargetZ

    // Check for zone transitions
    this.checkZoneTransitions(ballPos, deltaTime)
  }

  /**
   * Check if ball has entered a new zone and trigger transitions
   */
  private checkZoneTransitions(ballPos: Vector3, deltaTime: number): void {
    const zone = this.getZoneAtPosition(ballPos.z)

    if (zone && zone.id !== this.currentZone?.id) {
      this.enterZone(zone).catch(console.error)
    }

    // Handle transition animation
    if (this.zoneTransitionActive) {
      this.zoneTransitionTime += deltaTime
      if (this.zoneTransitionTime > 1.0) {
        this.zoneTransitionActive = false
        this.zoneTransitionTime = 0
      }
    }
  }

  /**
   * Get the zone at a given Z position
   */
  private getZoneAtPosition(z: number): WorldZone | null {
    // In dynamic mode, Z is negative as we travel "up" the world
    const progress = Math.abs(z)

    for (const zone of this.config.zones) {
      if (progress >= zone.startZ && progress < zone.endZ) {
        return zone
      }
    }
    return null
  }

  /**
   * Enter a new zone - trigger all transitions
   */
  private async enterZone(zone: WorldZone): Promise<void> {
    console.log(`[DynamicWorld] Entering zone: ${zone.name}`)
    this.currentZone = zone
    this.zoneTransitionActive = true
    this.zoneTransitionTime = 0

    // Update shader/map colors
    if (zone.mapConfig) {
      this.updateMapColors(zone.mapConfig)
    }

    // Change backbox video (if display supports it)
    if (zone.backboxVideo && this.display) {
      // Video switching would go here - for now, use story text
      this.display.setStoryText(zone.storyText || `Entered ${zone.name}`)
    }

    // Change music
    if (zone.musicTrack) {
      this.sound.playMapMusic(zone.musicTrack)
    }

    // Spawn zone mechanics
    this.spawnZoneMechanics(zone)

    // Emit zone enter event
    this.onZoneEnter?.(zone)
  }

  /**
   * Update LCD table shader colors
   */
  private updateMapColors(config: Partial<TableMapConfig>): void {
    // This will be connected to the LCDTableState
    console.log('[DynamicWorld] Updating map colors:', config)
  }

  /**
   * Spawn mechanics for the current zone
   */
  private spawnZoneMechanics(zone: WorldZone): void {
    // Clear previous zone mechanics
    this.clearZoneMechanics()

    if (!zone.spawnMechanics) return

    for (const mechanic of zone.spawnMechanics) {
      const mesh = this.createMechanicMesh(mechanic)
      if (mesh) {
        this.activeMechanics.push(mesh)
      }
    }

    console.log(`[DynamicWorld] Spawned ${this.activeMechanics.length} mechanics`)
  }

  /**
   * Create a mesh for a zone mechanic
   */
  private createMechanicMesh(mechanic: ZoneMechanic): Mesh | null {
    switch (mechanic.type) {
      case 'bumper':
        return this.createBumper(mechanic.position)
      case 'target':
        return this.createTarget(mechanic.position)
      case 'collectible':
        return this.createCollectible(mechanic.position)
      default:
        return null
    }
  }

  private createBumper(pos: Vector3): Mesh {
    const bumper = MeshBuilder.CreateCylinder(
      'zoneBumper',
      { diameter: 1.5, height: 0.8 },
      this.scene
    )
    bumper.position = pos

    const mat = new StandardMaterial('bumperMat', this.scene)
    mat.emissiveColor = color('#ff6600')
    bumper.material = mat

    // Add glow light
    const light = new PointLight('bumperLight', pos.add(new Vector3(0, 2, 0)), this.scene)
    light.diffuse = Color3.FromHexString('#ff6600')
    light.intensity = 0.5
    light.range = 5
    this.zoneLights.push(light)

    return bumper
  }

  private createTarget(pos: Vector3): Mesh {
    const target = MeshBuilder.CreateBox(
      'zoneTarget',
      { width: 1, height: 0.2, depth: 1 },
      this.scene
    )
    target.position = pos

    const mat = new StandardMaterial('targetMat', this.scene)
    mat.emissiveColor = color('#00ff88')
    target.material = mat

    return target
  }

  private createCollectible(pos: Vector3): Mesh {
    const collectible = MeshBuilder.CreatePolyhedron(
      'zoneCollectible',
      { type: 1, size: 0.5 },
      this.scene
    )
    collectible.position = pos.add(new Vector3(0, 1, 0))

    const mat = new StandardMaterial('collectibleMat', this.scene)
    mat.emissiveColor = color('#ff00ff')
    collectible.material = mat

    // Rotate animation
    this.scene.onBeforeRenderObservable.add(() => {
      collectible.rotation.y += 0.02
      collectible.rotation.x += 0.01
    })

    return collectible
  }

  /**
   * Clear all zone-specific mechanics
   */
  private clearZoneMechanics(): void {
    for (const mesh of this.activeMechanics) {
      mesh.dispose()
    }
    this.activeMechanics = []

    for (const light of this.zoneLights) {
      light.dispose()
    }
    this.zoneLights = []
  }

  /**
   * Switch between fixed and dynamic mode
   */
  setMode(mode: WorldMode): void {
    if (this.config.mode === mode) return

    console.log(`[DynamicWorld] Switching to ${mode} mode`)
    this.config.mode = mode

    if (mode === 'fixed') {
      // Reset camera to fixed position
      this.camera.target.z = 2
      this.clearZoneMechanics()
    }
  }

  /**
   * Get current world progress (0-100%)
   */
  getProgress(): number {
    if (this.config.totalLength === 0) return 0
    return Math.min(100, (this.ballProgress / this.config.totalLength) * 100)
  }

  /**
   * Get current zone info for HUD
   */
  getCurrentZoneInfo(): { name: string; story?: string } | null {
    if (!this.currentZone) return null
    return {
      name: this.currentZone.name,
      story: this.currentZone.storyText,
    }
  }

  /**
   * Cleanup all dynamic world resources
   */
  dispose(): void {
    this.clearZoneMechanics()
  }

  // Event callback
  onZoneEnter?: (zone: WorldZone) => void
}

// Singleton instance
let dynamicWorldInstance: DynamicWorld | null = null

export function getDynamicWorld(
  scene?: Scene,
  camera?: ArcRotateCamera,
  display?: DisplaySystem,
  sound?: SoundSystem
): DynamicWorld {
  if (!dynamicWorldInstance && scene && camera && display && sound) {
    dynamicWorldInstance = new DynamicWorld(scene, camera, display, sound)
  }
  return dynamicWorldInstance!
}

export function resetDynamicWorld(): void {
  dynamicWorldInstance?.dispose()
  dynamicWorldInstance = null
}
