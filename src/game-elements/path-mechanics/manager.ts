import { Vector3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { PathMechanic } from './base'
import { MovingGate } from './moving-gate'
import { MagneticField } from './magnetic-field'
import { SpinnerLauncher } from './spinner-launcher'
import { JumpPad } from './jump-pad'
import { ReactivePegCluster } from './reactive-peg-cluster'
import type { MovingGateConfig, MagneticFieldConfig, SpinnerLauncherConfig, JumpPadConfig, ReactivePegClusterConfig } from './types'

export interface ZoneTrigger {
  minZ: number
  maxZ: number
  mechanicType: 'gate' | 'magnet' | 'spinner' | 'jumppad' | 'pegs'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any
  /** Optional callback when this trigger zone is entered */
  onEnter?: () => void
  /** Optional callback when this trigger zone is exited */
  onExit?: () => void
}

export interface PathMechanicsCallbacks {
  /** Called when ball enters any mechanic zone */
  onZoneEnter?: (zoneId: string, mechanicType: string) => void
  /** Called when ball exits any mechanic zone */
  onZoneExit?: (zoneId: string, mechanicType: string) => void
  /** Called when a mechanic is triggered (e.g., ball hits jumppad) */
  onMechanicTrigger?: (mechanicType: string, position: Vector3) => void
}

export class PathMechanicsManager {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private mechanics: Map<string, PathMechanic> = new Map()
  private zoneTriggers: ZoneTrigger[] = []
  private activeZones: Set<string> = new Set()
  private mapBaseColor = '#00d9ff'
  private mapAccentColor = '#ff00ff'
  private callbacks: PathMechanicsCallbacks = {}

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
  }

  setCallbacks(callbacks: PathMechanicsCallbacks): void {
    this.callbacks = callbacks
  }

  setZoneTriggers(triggers: ZoneTrigger[]): void {
    this.zoneTriggers = triggers
  }

  setMapColors(baseColor: string, accentColor: string): void {
    this.mapBaseColor = baseColor
    this.mapAccentColor = accentColor

    // Update all active mechanics
    for (const mechanic of this.mechanics.values()) {
      mechanic.setMapColors(baseColor, accentColor)
    }
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[], ballZ: number): void {
    // Check zone triggers
    for (const trigger of this.zoneTriggers) {
      const zoneId = `${trigger.mechanicType}_${trigger.minZ}_${trigger.maxZ}`
      const isInZone = ballZ >= trigger.minZ && ballZ <= trigger.maxZ

      if (isInZone && !this.activeZones.has(zoneId)) {
        // Entered zone - spawn mechanic
        this.spawnMechanic(zoneId, trigger)
        this.activeZones.add(zoneId)
        
        // Trigger callbacks
        trigger.onEnter?.()
        this.callbacks.onZoneEnter?.(zoneId, trigger.mechanicType)
      } else if (!isInZone && this.activeZones.has(zoneId)) {
        // Left zone - despawn mechanic
        this.despawnMechanic(zoneId)
        this.activeZones.delete(zoneId)
        
        // Trigger callbacks
        trigger.onExit?.()
        this.callbacks.onZoneExit?.(zoneId, trigger.mechanicType)
      }
    }

    // Update all active mechanics
    for (const mechanic of this.mechanics.values()) {
      mechanic.update(dt, ballBodies)
    }
  }

  private spawnMechanic(zoneId: string, trigger: ZoneTrigger): void {
    if (this.mechanics.has(zoneId)) return

    const position = new Vector3(0, 0, (trigger.minZ + trigger.maxZ) / 2)

    let mechanic: PathMechanic | null = null

    switch (trigger.mechanicType) {
      case 'gate':
        mechanic = new MovingGate(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          gateWidth: 8,
          openHeight: 4,
          closedHeight: 0.5,
          cycleDuration: 4,
          startOpen: false,
          ...trigger.config,
        } as MovingGateConfig)
        break

      case 'magnet':
        mechanic = new MagneticField(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          fieldRadius: 5,
          pullStrength: 20,
          liftForce: 8,
          ...trigger.config,
        } as MagneticFieldConfig)
        break

      case 'spinner':
        mechanic = new SpinnerLauncher(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          spinnerRadius: 2.5,
          launchForce: 30,
          spinSpeed: 8,
          ...trigger.config,
        } as SpinnerLauncherConfig)
        break

      case 'jumppad':
        mechanic = new JumpPad(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          launchAngle: 45,
          launchForce: 25,
          cooldown: 2,
          ...trigger.config,
        } as JumpPadConfig)
        break

      case 'pegs':
        mechanic = new ReactivePegCluster(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          pegCount: 10,
          clusterRadius: 4,
          activationScore: 2000,
          ...trigger.config,
        } as ReactivePegClusterConfig)
        break
    }

    if (mechanic) {
      this.mechanics.set(zoneId, mechanic)
    }
  }

  private despawnMechanic(zoneId: string): void {
    const mechanic = this.mechanics.get(zoneId)
    if (mechanic) {
      mechanic.despawn()
      this.mechanics.delete(zoneId)
    }
  }

  despawnAll(): void {
    for (const mechanic of this.mechanics.values()) {
      mechanic.despawn()
    }
    this.mechanics.clear()
    this.activeZones.clear()
  }

  getActiveMechanicsCount(): number {
    return this.mechanics.size
  }
}
