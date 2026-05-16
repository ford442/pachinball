import { Scene, MeshBuilder, Mesh, TransformNode } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { PALETTE, QualityTier } from '../game-elements/visual-language'
import type { EventBus } from '../game/event-bus'
import { ObstacleEventBusIntegration } from '../game-elements/obstacle-eventbus-integration'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'

export interface LauncherState {
  mesh: Mesh
  body: RAPIER.RigidBody
  id: string
  chargeMesh: Mesh
  isCharging: boolean
  chargeLevel: number
  maxChargeTime: number
  cooldownTimer: number
  cooldownDuration: number
  direction: { x: number; y: number; z: number }
  minForce: number
  maxForce: number
  launcherColor: string
}

export class LauncherBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>
  private eventBus: ObstacleEventBusIntegration | null = null
  private zoneTriggerSystem: ZoneTriggerSystem | null = null
  private launcherCounter: number = 0
  private meshes: Mesh[] = []
  private bodies: RAPIER.RigidBody[] = []
  private qualityTier: QualityTier
  private registeredZoneIds: string[] = []

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    qualityTier: QualityTier = QualityTier.MEDIUM,
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.matLib = getMaterialLibrary(scene)
    this.qualityTier = qualityTier
  }

  /**
   * Set EventBus for emitting launcher events
   */
  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  /**
   * Set ZoneTriggerSystem for registering launcher hitbox regions
   */
  setZoneTriggerSystem(zoneTriggerSystem: ZoneTriggerSystem | null): void {
    this.zoneTriggerSystem = zoneTriggerSystem
  }

  /**
   * Create a launcher mechanism
   */
  createLauncher(
    x: number,
    z: number,
    colorHex: string = PALETTE.CYAN,
    scale: number = 1.0,
    directionX: number = 0,
    directionY: number = 1,
    directionZ: number = 0
  ): { state: LauncherState; bindings: PhysicsBinding[] } {
    const bindings: PhysicsBinding[] = []

    const launcherRoot = new TransformNode('launcherRoot', this.scene)
    launcherRoot.position.set(x, 0.5, z)

    // Main launcher body (box)
    const launcherMesh = MeshBuilder.CreateBox('launcherBody', {
      width: 0.6 * scale,
      height: 0.8 * scale,
      depth: 0.4 * scale
    }, this.scene) as Mesh

    launcherMesh.parent = launcherRoot
    launcherMesh.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    // Charge indicator (glowing sphere that grows)
    const chargeMesh = MeshBuilder.CreateSphere('launcherCharge', {
      diameter: 0.3 * scale,
      segments: this.qualityTier === QualityTier.LOW ? 8 : 16
    }, this.scene) as Mesh

    chargeMesh.position.y = 0.5 * scale
    chargeMesh.parent = launcherRoot
    chargeMesh.material = this.matLib.getEnhancedBumperRingMaterial(colorHex)

    // Rim accent (skip on LOW quality)
    let rimMesh: Mesh | null = null
    if (this.qualityTier !== QualityTier.LOW) {
      rimMesh = MeshBuilder.CreateTorus('launcherRim', {
        diameter: 0.8 * scale,
        thickness: 0.06 * scale,
        tessellation: this.qualityTier === QualityTier.HIGH ? 24 : 12
      }, this.scene) as Mesh

      rimMesh.parent = launcherRoot
      rimMesh.material = this.matLib.getEnhancedBumperRingMaterial(colorHex)
    }

    // Physics body
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
    )

    // Launcher trigger zone (sensor)
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.3 * scale, 0.4 * scale, 0.2 * scale)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    // Normalize direction
    const dirMagnitude = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ)
    const normalizedDirection = {
      x: directionX / dirMagnitude,
      y: directionY / dirMagnitude,
      z: directionZ / dirMagnitude
    }

    const launcherId = `launcher-${this.launcherCounter++}`

    const state: LauncherState = {
      mesh: launcherMesh,
      body,
      id: launcherId,
      chargeMesh,
      isCharging: false,
      chargeLevel: 0,
      maxChargeTime: 1.5, // 1.5 seconds to full charge
      cooldownTimer: 0,
      cooldownDuration: 0.5, // 0.5 second cooldown
      direction: normalizedDirection,
      minForce: 15.0,
      maxForce: 40.0,
      launcherColor: colorHex
    }

    bindings.push({ mesh: launcherRoot as unknown as Mesh, rigidBody: body })

    this.meshes.push(launcherMesh, chargeMesh)
    if (rimMesh) this.meshes.push(rimMesh)
    this.bodies.push(body)

    // Register with ZoneTriggerSystem
    if (this.zoneTriggerSystem) {
      const zoneId = `launcher-zone-${launcherId}`
      this.zoneTriggerSystem.registerObstacleZone(zoneId, {
        minX: x - 0.35 * scale,
        maxX: x + 0.35 * scale,
        minZ: z - 0.25 * scale,
        maxZ: z + 0.25 * scale,
        minY: 0,
        maxY: 1.0 * scale,
      }, { color: colorHex, type: 'launcher' })
      this.registeredZoneIds.push(zoneId)
    }

    return { state, bindings }
  }

  /**
   * Start charging the launcher
   */
  startCharge(state: LauncherState): void {
    if (state.cooldownTimer <= 0) {
      state.isCharging = true
      state.chargeLevel = 0
    }
  }

  /**
   * Update launcher charging animation
   */
  updateLauncher(state: LauncherState, dt: number): void {
    // Update cooldown
    if (state.cooldownTimer > 0) {
      state.cooldownTimer -= dt
    }

    // Update charging
    if (state.isCharging) {
      state.chargeLevel += dt / state.maxChargeTime
      state.chargeLevel = Math.min(state.chargeLevel, 1.0)

      // Visual feedback: grow charge indicator
      if (state.chargeMesh) {
        state.chargeMesh.scaling.set(
          1.0 + state.chargeLevel * 0.5,
          1.0 + state.chargeLevel * 0.5,
          1.0 + state.chargeLevel * 0.5
        )

        // Brighten with charge
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mat = state.chargeMesh.material as any
        if (mat && mat.emissiveColor) {
          const intensity = 0.5 + state.chargeLevel * 0.5
          mat.emissiveColor.scaleToRef(intensity, mat.emissiveColor)
        }
      }

      // Emit charge event
      if (this.eventBus) {
        this.eventBus.emitLauncherCharged(state.id, state.chargeLevel)
      }
    }
  }

  /**
   * Fire the launcher, returns the force to apply
   */
  fireLauncher(state: LauncherState): { force: { x: number; y: number; z: number }; wasCharged: boolean } {
    const chargeRatio = state.isCharging ? state.chargeLevel : 1.0
    const force = state.minForce + (state.maxForce - state.minForce) * chargeRatio

    // Reset charge indicator
    if (state.chargeMesh) {
      state.chargeMesh.scaling.set(1, 1, 1)
    }

    state.isCharging = false
    state.chargeLevel = 0
    state.cooldownTimer = state.cooldownDuration

    const forceVec = {
      x: state.direction.x * force,
      y: state.direction.y * force,
      z: state.direction.z * force
    }

    // Emit fire event
    if (this.eventBus) {
      this.eventBus.emitLauncherFired(state.id, 'ball-id', forceVec, chargeRatio)
      this.eventBus.emitPointsAwarded(50, 'launcher-fired')
      this.eventBus.emitPlaySound('launcher-fire')
      this.eventBus.emitFlashEffect(0.5, '#0099ff', 0.2)
    }

    return {
      force: forceVec,
      wasCharged: chargeRatio > 0.5
    }
  }

  /**
   * Trigger launcher immediately with full force
   */
  triggerLauncher(state: LauncherState, force: number = 1.0): { x: number; y: number; z: number } {
    const actualForce = state.minForce + (state.maxForce - state.minForce) * force
    state.cooldownTimer = state.cooldownDuration

    const forceVec = {
      x: state.direction.x * actualForce,
      y: state.direction.y * actualForce,
      z: state.direction.z * actualForce
    }

    // Emit trigger event
    if (this.eventBus) {
      this.eventBus.emitLauncherTriggered(state.id, 'ball-id')
      this.eventBus.emitPointsAwarded(75, 'launcher-triggered')
      this.eventBus.emitPlaySound('launcher-trigger')
      this.eventBus.emitFlashEffect(0.6, '#00ff99', 0.3)
    }

    return forceVec
  }

  /**
   * Clean up all meshes and physics bodies created by this builder
   */
  dispose(): void {
    for (const mesh of this.meshes) {
      if (!mesh.isDisposed()) {
        mesh.dispose()
      }
    }
    this.meshes = []

    for (const body of this.bodies) {
      this.world.removeRigidBody(body)
    }
    this.bodies = []

    for (const zoneId of this.registeredZoneIds) {
      this.zoneTriggerSystem?.unregisterObstacleZone(zoneId)
    }
    this.registeredZoneIds = []

    this.eventBus = null
    this.zoneTriggerSystem = null
  }
}
