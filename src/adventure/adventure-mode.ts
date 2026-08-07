/**
 * Adventure Mode Orchestrator
 *
 * Main controller for adventure mode that handles track selection, camera management,
 * physics updates, and event dispatching.
 */

import {
  type Camera,
  ArcRotateCamera,
  Vector3,
  Mesh,
  Quaternion,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import { AdventurePortalMixin } from './adventure-portal'
import { CAMERA_PRESETS } from './camera-presets'
import { AdventureTrackType, type AdventureCallback, type CameraPreset } from './adventure-types'
import { getTrackStartAnchor } from './portal-routing'
import { getTrackManifest } from './manifests'
import { TRACK_CATALOG } from '../game-elements/adventure-track-progression'
import {
  createEmptyTeardownStats,
  type TrackResourceCounts,
  type TrackTeardownStats,
} from '../game-elements/track-teardown-stats'
import { FALLOUT_Y_THRESHOLD } from './adventure-portal-types'

import { getDataTrackDefinition } from './track-data-registry'
import {
  formatTrackValidationErrors,
  validateTrackDefinition,
} from './track-schema'

export { AdventureTrackType, CAMERA_PRESETS }
export type { AdventureCallback, CameraPreset }

export class AdventureMode extends AdventurePortalMixin {
  /** Current zone/track type for zone transition detection */
  private currentZone: AdventureTrackType | null = null
  /** Previous zone for transition intensity calculation */
  private previousZone: AdventureTrackType | null = null

  /** Soft-fail message from the last rejected data-track load (HUD). */
  private lastTrackLoadError: string | null = null

  private activeBallBodies: RAPIER.RigidBody[] = []
  private lastTeardownStats: TrackTeardownStats | null = null

  getLastTeardownStats(): TrackTeardownStats | null {
    return this.lastTeardownStats
  }

  /** Soft-fail reason from the last rejected declarative track load. */
  getLastTrackLoadError(): string | null {
    return this.lastTrackLoadError
  }

  getTrackResourceCounts(): TrackResourceCounts {
    let colliders = 0
    for (const body of this.adventureBodies) {
      colliders += body.numColliders()
    }
    for (const zone of this.conveyorZones) {
      colliders += zone.sensor.numColliders()
    }
    for (const well of this.gravityWells) {
      colliders += well.sensor.numColliders()
    }
    for (const zone of this.dampingZones) {
      colliders += zone.sensor.numColliders()
    }
    for (const gate of this.chromaGates) {
      colliders += gate.sensor.numColliders()
    }
    if (this.adventureSensor) {
      colliders += this.adventureSensor.numColliders()
    }
    for (const sensor of this.resetSensors) {
      colliders += sensor.numColliders()
    }
    if (this.exitPortal) {
      colliders += this.exitPortal.sensor.numColliders()
    }

    return {
      meshes: this.adventureTrack.length,
      materials: this.materials.length,
      bodies:
        this.adventureBodies.length +
        this.conveyorZones.length +
        this.gravityWells.length +
        this.dampingZones.length +
        this.chromaGates.length +
        this.resetSensors.length +
        (this.adventureSensor ? 1 : 0) +
        (this.exitPortal ? 1 : 0),
      colliders,
    }
  }

  /**
   * Get current zone/track type
   */
  getCurrentZone(): AdventureTrackType | null {
    return this.currentZone
  }

  /**
   * Get previous zone (for transition effects)
   */
  getPreviousZone(): AdventureTrackType | null {
    return this.previousZone
  }

  /**
   * Update physics and animation state
   */
  update(dt: number = 0.016, ballBodies: RAPIER.RigidBody[] = []): void {
    if (!this.adventureActive) return

    this.timeAccumulator += dt
    this.activeBallBodies = ballBodies
    this.updateExitPortal(dt, ballBodies)
    this.recoverFallenBalls(ballBodies)

    // Camera update
    if (this.followCamera && ballBodies.length > 0 && this.currentCameraPreset) {
      this.updateCinematicCamera(ballBodies[0], dt)
    }

    // Animate Obstacles
    for (const obst of this.animatedObstacles) {
      if (obst.type === 'PISTON') {
        const yOffset = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
        const newY = obst.basePos.y + yOffset
        obst.body.setNextKinematicTranslation({ x: obst.basePos.x, y: newY, z: obst.basePos.z })
      } else if (obst.type === 'OSCILLATOR') {
        const offset = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
        const axis = obst.axis || new Vector3(0, 1, 0)
        const move = axis.scale(offset)
        const newPos = obst.basePos.add(move)
        obst.body.setNextKinematicTranslation({ x: newPos.x, y: newPos.y, z: newPos.z })
      } else if (obst.type === 'ROTATING_OSCILLATOR') {
        const angle = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
        const axis = obst.axis || new Vector3(0, 1, 0)
        const baseRot = obst.baseRot || new Quaternion()
        const offsetRot = Quaternion.RotationAxis(axis, angle)
        const newRot = baseRot.multiply(offsetRot)
        obst.body.setNextKinematicRotation({ x: newRot.x, y: newRot.y, z: newRot.z, w: newRot.w })
      }
    }

    // Apply Conveyor Forces
    for (const zone of this.conveyorZones) {
      const sensorHandle = zone.sensor.collider(0)
      for (const ball of ballBodies) {
        const ballHandle = ball.collider(0)
        if (this.world.intersectionPair(sensorHandle, ballHandle)) {
          const imp = zone.force.scale(dt)
          ball.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true)
        }
      }
    }

    // Apply Gravity Wells
    for (const well of this.gravityWells) {
      const sensorHandle = well.sensor.collider(0)
      for (const ball of ballBodies) {
        const ballHandle = ball.collider(0)
        if (this.world.intersectionPair(sensorHandle, ballHandle)) {
          const ballPos = ball.translation()
          const dir = well.center.subtract(new Vector3(ballPos.x, ballPos.y, ballPos.z)).normalize()
          const imp = dir.scale(well.strength * dt)
          ball.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true)
        }
      }
    }

    // Apply Damping Zones
    for (const zone of this.dampingZones) {
      const sensorHandle = zone.sensor.collider(0)
      for (const ball of ballBodies) {
        const ballHandle = ball.collider(0)
        if (this.world.intersectionPair(sensorHandle, ballHandle)) {
          const vel = ball.linvel()
          const force = {
            x: -vel.x * zone.damping,
            y: -vel.y * zone.damping,
            z: -vel.z * zone.damping
          }
          ball.applyImpulse({ x: force.x * dt, y: force.y * dt, z: force.z * dt }, true)
        }
      }
    }

    // Apply Chroma Gates
    for (const gate of this.chromaGates) {
      const sensorHandle = gate.sensor.collider(0)
      for (const ball of ballBodies) {
        const ballHandle = ball.collider(0)
        if (this.world.intersectionPair(sensorHandle, ballHandle)) {
          this.setBallColorState(ball, gate.colorType)
        }
      }
    }

    // Sync kinematic bodies to visuals
    const allBindings = [...this.kinematicBindings, ...this.animatedObstacles]
    for (const binding of allBindings) {
      if (!binding.body || !binding.mesh) continue
      const pos = binding.body.translation()
      const rot = binding.body.rotation()
      binding.mesh.position.set(pos.x, pos.y, pos.z)
      if (!binding.mesh.rotationQuaternion) {
        binding.mesh.rotationQuaternion = new Quaternion(rot.x, rot.y, rot.z, rot.w)
      } else {
        binding.mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w)
      }
    }
  }

  /**
   * Activates Adventure Mode
   */
  start(
    ballBody: RAPIER.RigidBody,
    currentCamera: Camera,
    ballMesh: Mesh | undefined,
    trackType: AdventureTrackType = AdventureTrackType.CYBER_CORE
  ): void {
    if (this.adventureActive) return
    this.adventureActive = true

    // Track zone transition
    this.previousZone = this.currentZone
    this.currentZone = trackType

    // Reset camera transition timer for cinematic entry
    this.cameraTransitionTime = 0

    // Notify the Game class to update the Display
    if (this.onEvent) this.onEvent('START', trackType)

    // Emit zone enter event for initial zone
    if (this.onEvent) this.onEvent('ZONE_ENTER', {
      zone: trackType,
      previousZone: this.previousZone,
      isMajor: true
    })

    // Build the selected track
    this.buildTrack(trackType)

    // Reset ball velocity
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setTranslation({ x: this.currentStartPos.x, y: this.currentStartPos.y, z: this.currentStartPos.z }, true)

    // Store original camera to restore later
    this.tableCamera = currentCamera
    this.currentBallMesh = ballMesh || null
    this.activeBallBodies = [ballBody]

    // Load track-specific camera preset. JSON schema override wins, then the
    // manifest's cameraPresetId, then the track id itself, then DEFAULT.
    const dataDef = getDataTrackDefinition(trackType)
    const presetKey =
      dataDef?.cameraPresetId ??
      getTrackManifest(trackType)?.cameraPresetId ??
      (trackType as string)
    this.currentCameraPreset = CAMERA_PRESETS[presetKey] || CAMERA_PRESETS.DEFAULT
    const preset = this.currentCameraPreset

    // Create new RPG-style Isometric Camera with preset configuration
    this.followCamera = new ArcRotateCamera(
      'adventureCam',
      preset.alpha,
      preset.beta,
      preset.radius,
      Vector3.Zero(),
      this.scene
    )

    // Apply preset camera settings
    this.followCamera.fov = preset.fov
    this.followCamera.lowerRadiusLimit = preset.minRadius
    this.followCamera.upperRadiusLimit = preset.maxRadius
    this.followCamera.lowerBetaLimit = preset.minBeta
    this.followCamera.upperBetaLimit = preset.maxBeta

    this.followCamera.attachControl(this.scene.getEngine().getRenderingCanvas(), true)

    if (ballMesh) {
      this.followCamera.lockedTarget = ballMesh
    }

    this.scene.activeCamera = this.followCamera
    this.scene.activeCameras = [this.followCamera]
  }

  /**
   * Build the specified track
   */
  private buildTrack(trackType: AdventureTrackType): void {
    // Reset per-track state so each builder starts fresh
    this.portalPosition = null
    this.currentTrackInfo = TRACK_CATALOG[trackType] ?? null
    this.currentStartPos = getTrackStartAnchor(trackType)

    const manifest = getTrackManifest(trackType)

    if (!manifest) {
      // No manifest survived registry validation for this id. Report it rather
      // than silently leaving an empty world the player can fall through.
      this.lastTrackLoadError = `No registered track manifest for ${trackType}`
      console.error(`[AdventureMode] ${this.lastTrackLoadError}`)
      return
    }

    if (manifest.buildKind === 'json') {
      const dataDef = getDataTrackDefinition(trackType)
      if (!dataDef) {
        this.lastTrackLoadError =
          `Track ${trackType} declares data path ${manifest.dataPath} but no valid ` +
          'definition was loaded for it'
        console.error(`[AdventureMode] ${this.lastTrackLoadError}`)
        return
      }
      this.buildFromDefinition(dataDef)
      this.applyDefaultAdventureCollisionGroups()
      return
    }

    manifest.builder(this)
    this.applyDefaultAdventureCollisionGroups()
  }

  /**
   * Switch to a new zone in Dynamic Adventure Mode
   */
  switchZone(newZone: AdventureTrackType, ballPosition?: Vector3): boolean {
    if (!this.adventureActive) {
      console.warn('[AdventureMode] Cannot switch zone: adventure not active')
      return false
    }

    if (this.currentZone === newZone) {
      return false
    }

    this.deactivateExitPortal()

    this.previousZone = this.currentZone
    this.currentZone = newZone

    // Reset camera transition timer for smooth zone switch
    this.cameraTransitionTime = 0

    this.currentCameraPreset = CAMERA_PRESETS[newZone as string] || CAMERA_PRESETS.DEFAULT
    if (this.currentCameraPreset) {
      this.applyCameraPresetTransition(this.currentCameraPreset, 0.7)
    }

    if (this.onEvent) {
      this.onEvent('ZONE_ENTER', {
        zone: newZone,
        previousZone: this.previousZone,
        isMajor: this.isMajorZoneTransition(this.previousZone, newZone),
        ballPosition: ballPosition,
      })
    }

    console.log(`[AdventureMode] Zone switched: ${this.previousZone} -> ${newZone}`)
    return true
  }

  /**
   * Determine if a zone transition is "major" (triggers stronger effects)
   */
  private isMajorZoneTransition(from: AdventureTrackType | null, to: AdventureTrackType): boolean {
    if (!from) return true

    const dangerZones = [
      AdventureTrackType.SINGULARITY_WELL,
      AdventureTrackType.FIREWALL_BREACH,
      AdventureTrackType.GLITCH_SPIRE,
      AdventureTrackType.SOLAR_FLARE,
    ]

    const calmZones = [
      AdventureTrackType.DIGITAL_ZEN_GARDEN,
      AdventureTrackType.SYNTHWAVE_SURF,
      AdventureTrackType.RETRO_WAVE_HILLS,
    ]

    const techZones = [
      AdventureTrackType.CYBER_CORE,
      AdventureTrackType.CPU_CORE,
      AdventureTrackType.NEURAL_NETWORK,
      AdventureTrackType.MAGNETIC_STORAGE,
    ]

    const fromDanger = dangerZones.includes(from)
    const toDanger = dangerZones.includes(to)
    const fromCalm = calmZones.includes(from)
    const toCalm = calmZones.includes(to)
    const fromTech = techZones.includes(from)
    const toTech = techZones.includes(to)

    if (fromDanger !== toDanger) return true
    if (fromCalm !== toCalm) return true
    if (fromTech !== toTech) return true

    return false
  }

  /**
   * Switch to a new track while keeping adventure mode active.
   * Tears down the old track's geometry and physics, builds the new track,
   * and resets the camera transition for a cinematic entry.
   */
  switchToTrack(newZone: AdventureTrackType): boolean {
    if (!this.adventureActive) {
      console.warn('[AdventureMode] Cannot switch track: adventure not active')
      return false
    }

    // Validate declarative tracks before teardown so a bad JSON never clears a healthy world
    const dataDef = getDataTrackDefinition(newZone)
    if (dataDef) {
      const validation = validateTrackDefinition(dataDef)
      if (!validation.ok) {
        this.lastTrackLoadError = formatTrackValidationErrors(validation.errors)
        console.warn(`[AdventureMode] ${this.lastTrackLoadError}`)
        return false
      }
    }
    this.lastTrackLoadError = null

    this.deactivateExitPortal()

    const zoneChanged = this.currentZone !== newZone
    if (zoneChanged) {
      this.previousZone = this.currentZone
      this.currentZone = newZone
    }

    // Reset camera transition timer for cinematic entry
    this.cameraTransitionTime = 0

    const presetKey = dataDef?.cameraPresetId ?? (newZone as string)
    this.currentCameraPreset = CAMERA_PRESETS[presetKey] || CAMERA_PRESETS.DEFAULT

    // Tear down old track geometry and physics
    this.clearTrack()

    // Build new track
    this.buildTrack(newZone)
    this.teleportActiveBallsToStart()

    // Update follow-camera preset without recreating the camera
    if (this.followCamera && this.currentCameraPreset) {
      this.applyCameraPresetTransition(this.currentCameraPreset, 0.7)
    }

    if (zoneChanged && this.onEvent) {
      this.onEvent('ZONE_ENTER', {
        zone: newZone,
        previousZone: this.previousZone,
        isMajor: this.isMajorZoneTransition(this.previousZone, newZone),
      })
    }

    console.log(`[AdventureMode] Track switched: ${this.previousZone} -> ${newZone}`)
    return true
  }

  /**
   * End adventure mode and cleanup
   */
  end(): void {
    if (!this.adventureActive) return
    this.adventureActive = false
    this.deactivateExitPortal()

    if (this.onEvent) this.onEvent('END')
    this.currentZone = null
    this.previousZone = null

    // Restore Table Camera
    if (this.tableCamera) {
      this.scene.activeCamera = this.tableCamera
      this.scene.activeCameras = [this.tableCamera]
      this.followCamera?.dispose()
      this.followCamera = null
    }

    this.currentBallMesh = null
    this.currentCameraPreset = null
    this.resetBallCollisionGroups()
    this.activeBallBodies = []

    this.clearTrack()
  }

  respawnBallAtStart(ballBody: RAPIER.RigidBody, index = 0): void {
    const lateralOffset = index * 0.35
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setTranslation({
      x: this.currentStartPos.x + lateralOffset,
      y: this.currentStartPos.y,
      z: this.currentStartPos.z,
    }, true)
  }

  private recoverFallenBalls(ballBodies: RAPIER.RigidBody[]): void {
    for (const [index, ballBody] of ballBodies.entries()) {
      const pos = ballBody.translation()
      if (pos.y < FALLOUT_Y_THRESHOLD) {
        this.respawnBallAtStart(ballBody, index)
      }
    }
  }

  private teleportActiveBallsToStart(): void {
    for (const [index, ballBody] of this.activeBallBodies.entries()) {
      this.respawnBallAtStart(ballBody, index)
    }
  }

  private resetBallCollisionGroups(): void {
    for (const ballBody of this.activeBallBodies) {
      const colliderCount = ballBody.numColliders()
      for (let i = 0; i < colliderCount; i++) {
        ballBody.collider(i).setCollisionGroups(COLLISION_GROUP_PRESETS.BALL)
      }
    }
  }

  /**
   * Dispose all track-specific geometry and physics bodies.
   * Called by both switchToTrack() and end().
   */
  private clearTrack(): void {
    const stats = createEmptyTeardownStats()
    stats.meshesDisposed = this.adventureTrack.length
    stats.materialsDisposed = this.materials.length
    stats.bodiesRemoved = this.adventureBodies.length
    stats.conveyorZonesRemoved = this.conveyorZones.length
    stats.gravityWellsRemoved = this.gravityWells.length
    stats.dampingZonesRemoved = this.dampingZones.length
    stats.resetSensorsRemoved = this.resetSensors.length
    stats.chromaGatesRemoved = this.chromaGates.length
    stats.adventureSensorRemoved = this.adventureSensor ? 1 : 0
    stats.exitPortalsRemoved = this.portalsRemovedSinceClear
    this.portalsRemovedSinceClear = 0

    this.timeAccumulator = 0
    this.portalPosition = null
    this.currentTrackInfo = null
    this.restoreTrackGravity()

    // Cleanup Visuals — dispose materials/textures to avoid GPU leaks across long sessions
    for (const mesh of this.adventureTrack) {
      mesh.dispose(false, true)
    }
    this.adventureTrack = []
    for (const mat of this.materials) {
      mat.dispose()
    }
    this.materials = []
    this.kinematicBindings = []
    this.animatedObstacles = []

    // Cleanup Physics — remove every adventure-owned body from the Rapier world
    for (const body of this.adventureBodies) {
      if (this.world.getRigidBody(body.handle)) {
        this.world.removeRigidBody(body)
      } else {
        stats.lingeringBodies++
      }
    }
    this.adventureBodies = []

    for (const zone of this.conveyorZones) {
      if (this.world.getRigidBody(zone.sensor.handle)) {
        this.world.removeRigidBody(zone.sensor)
      } else {
        stats.lingeringBodies++
      }
    }
    this.conveyorZones = []

    for (const well of this.gravityWells) {
      if (this.world.getRigidBody(well.sensor.handle)) {
        this.world.removeRigidBody(well.sensor)
      } else {
        stats.lingeringBodies++
      }
    }
    this.gravityWells = []

    for (const zone of this.dampingZones) {
      if (this.world.getRigidBody(zone.sensor.handle)) {
        this.world.removeRigidBody(zone.sensor)
      } else {
        stats.lingeringBodies++
      }
    }
    this.dampingZones = []

    if (this.adventureSensor) {
      if (this.world.getRigidBody(this.adventureSensor.handle)) {
        this.world.removeRigidBody(this.adventureSensor)
      } else {
        stats.lingeringBodies++
      }
      this.adventureSensor = null
    }

    for (const sensor of this.resetSensors) {
      if (this.world.getRigidBody(sensor.handle)) {
        this.world.removeRigidBody(sensor)
      } else {
        stats.lingeringBodies++
      }
    }
    this.resetSensors = []

    for (const gate of this.chromaGates) {
      if (this.world.getRigidBody(gate.sensor.handle)) {
        this.world.removeRigidBody(gate.sensor)
      } else {
        stats.lingeringBodies++
      }
    }
    this.chromaGates = []

    this.lastTeardownStats = stats
    if (stats.lingeringBodies > 0) {
      console.warn('[AdventureMode] Track teardown left lingering bodies:', stats)
    }
  }
}
