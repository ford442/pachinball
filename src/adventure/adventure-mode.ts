/**
 * Adventure Mode Orchestrator
 * 
 * Main controller for adventure mode that handles track selection, camera management,
 * physics updates, and event dispatching.
 */

import {
  ArcRotateCamera,
  type Camera,
  Vector3,
  Mesh,
  Quaternion,
  Scalar,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import { TrackBuilder } from './track-builder'
import { CAMERA_PRESETS } from './camera-presets'
import { AdventureTrackType, type AdventureCallback, type CameraPreset } from './adventure-types'
import { CameraEasing } from './camera-easing'
import { getTrackStartAnchor } from './portal-routing'
import { PALETTE } from '../game-elements/visual-language'
import { TRACK_CATALOG } from '../game-elements/adventure-track-progression'
import type { AccessibilityConfig } from '../game-elements/accessibility-config'
import {
  createEmptyTeardownStats,
  type TrackResourceCounts,
  type TrackTeardownStats,
} from '../game-elements/track-teardown-stats'

// Import all track builders
import { buildNeonHelix } from './tracks/neon-helix'
import { buildCyberCore } from './tracks/cyber-core'
import { buildQuantumGrid } from './tracks/quantum-grid'
import { buildSingularityWell } from './tracks/singularity-well'
import { buildGlitchSpire } from './tracks/glitch-spire'
import { buildRetroWaveHills } from './tracks/retro-wave-hills'
import { buildChronoCore } from './tracks/chrono-core'
import { buildHyperDrift } from './tracks/hyper-drift'
import { buildPachinkoHall } from './tracks/pachinko-hall'
import { buildPachinkoSpire } from './tracks/pachinko-spire'
import { buildOrbitalJunkyard } from './tracks/orbital-junkyard'
import { buildFirewallBreach } from './tracks/firewall-breach'
import { buildPrismPathway } from './tracks/prism-pathway'
import { buildMagneticStorage } from './tracks/magnetic-storage'
import { buildNeuralNetwork } from './tracks/neural-network'
import { buildNeonStronghold } from './tracks/neon-stronghold'
import { buildCasinoHeist } from './tracks/casino-heist'
import { buildCpuCore } from './tracks/cpu-core'
import { buildCryoChamber } from './tracks/cryo-chamber'
import { buildBioHazardLab } from './tracks/bio-hazard-lab'
import { buildGravityForge } from './tracks/gravity-forge'
import { buildTidalNexus } from './tracks/tidal-nexus'
import { buildDigitalZenGarden } from './tracks/digital-zen-garden'
import { buildSynthwaveSurf } from './tracks/synthwave-surf'
import { buildSolarFlare } from './tracks/solar-flare'
import { buildTeslaTower } from './tracks/tesla-tower'
import { buildNeonSkyline } from './tracks/neon-skyline'
import { buildPolychromeVoid } from './tracks/polychrome-void'

export { AdventureTrackType, CAMERA_PRESETS }
export type { AdventureCallback, CameraPreset }

type ExitPortalKind = 'success' | 'timeout'
type ExitPortalWorldMode = 'STATIONARY_TABLE' | 'EXTENDED_MAP'
const FALLOUT_Y_THRESHOLD = -25

interface ActiveExitPortal {
  id: string
  trackId: AdventureTrackType
  kind: ExitPortalKind
  mode: ExitPortalWorldMode
  root: Mesh
  core: Mesh
  sensor: RAPIER.RigidBody
  ringMaterial: StandardMaterial
  coreMaterial: StandardMaterial
  ringBase: Color3
  coreBase: Color3
  animationTime: number
}

export class AdventureMode extends TrackBuilder {
  /** Current camera preset for active track */
  protected currentCameraPreset: CameraPreset | null = CAMERA_PRESETS.DEFAULT
  /** Current zone/track type for zone transition detection */
  private currentZone: AdventureTrackType | null = null
  /** Previous zone for transition intensity calculation */
  private previousZone: AdventureTrackType | null = null

  /** Camera management */
  private tableCamera: Camera | null = null
  private followCamera: ArcRotateCamera | null = null

  /** Camera transition state for cinematic polish */
  private cameraTransitionTime = 0
  private cameraTransitionDuration = 0.8 // seconds for smooth entry
  private zoneCameraTransition:
    | {
        elapsed: number
        duration: number
        from: { alpha: number; beta: number; radius: number; fov: number }
        to: { alpha: number; beta: number; radius: number; fov: number }
      }
    | null = null
  private accessibility: AccessibilityConfig = {
    reducedMotion: false,
    cameraShakeEnabled: true,
    flashFrequencyMax: 2,
    scanlineIntensity: 0.25,
    effectIntensity: 1,
    maxCameraShakeIntensity: 0.08,
    hapticsEnabled: true,
    hapticIntensity: 1,
  }
  private exitPortal: ActiveExitPortal | null = null
  private activeBallBodies: RAPIER.RigidBody[] = []
  private lastTeardownStats: TrackTeardownStats | null = null
  /** Portals torn down since the last clearTrack() — merged into teardown stats. */
  private portalsRemovedSinceClear = 0

  /**
   * Return the Rapier body handle of the active exit portal sensor, or -1 when
   * no portal is currently active.  Callers use this to register/unregister the
   * handle with GamePhysicsController so the collision dispatcher skips it.
   */
  getPortalSensorHandle(): number {
    return this.exitPortal?.sensor.handle ?? -1
  }

  getLastTeardownStats(): TrackTeardownStats | null {
    return this.lastTeardownStats
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

  getFollowCamera(): ArcRotateCamera | null {
    return this.followCamera
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

  private updateCinematicCamera(ballBody: RAPIER.RigidBody, dt: number): void {
    if (!this.followCamera || !this.currentCameraPreset) return

    const preset = this.currentCameraPreset
    const ballPos = ballBody.translation()
    const velocity = ballBody.linvel()
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)

    // Speed-based radius
    const speedFactor = Math.min(speed / 30, 1)
    const targetRadius = preset.radius + (speedFactor * preset.speedRadiusFactor * 30)

    // Look-ahead targeting
    const horizontalSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2)
    const lookAheadDist = horizontalSpeed * preset.lookAheadTime

    let velocityDir = { x: 0, z: 0 }
    if (horizontalSpeed > 0.1) {
      velocityDir = {
        x: velocity.x / horizontalSpeed,
        z: velocity.z / horizontalSpeed
      }
    }

    const lookAheadPos = new Vector3(
      ballPos.x + velocityDir.x * lookAheadDist,
      ballPos.y,
      ballPos.z + velocityDir.z * lookAheadDist
    )

    // Blend between ball position and look-ahead
    const lookAheadBlend = Math.min(speed / 10, 0.5)
    const targetPosition = new Vector3(
      ballPos.x + (lookAheadPos.x - ballPos.x) * lookAheadBlend,
      ballPos.y + (lookAheadPos.y - ballPos.y) * lookAheadBlend * 0.3,
      ballPos.z + (lookAheadPos.z - ballPos.z) * lookAheadBlend
    )

    // Update transition time for cinematic entry
    if (this.cameraTransitionTime < this.cameraTransitionDuration) {
      this.cameraTransitionTime += dt
    }

    // Apply smoothing with easing during transition
    const baseSmoothing = preset.trackingSmoothing * dt
    const transitionAlpha = Math.min(1, this.cameraTransitionTime / this.cameraTransitionDuration)
    const easeInFactor = CameraEasing.easeOutCubic(transitionAlpha)
    const smoothing = baseSmoothing * (0.5 + easeInFactor * 0.5) // Start at 50% smoothing, reach 100%

    this.followCamera.target = new Vector3(
      this.followCamera.target.x + (targetPosition.x - this.followCamera.target.x) * smoothing,
      this.followCamera.target.y + (targetPosition.y - this.followCamera.target.y) * smoothing,
      this.followCamera.target.z + (targetPosition.z - this.followCamera.target.z) * smoothing
    )

    // Eased radius transition with responsive tracking
    const radiusDelta = (targetRadius - this.followCamera.radius) * (preset.trackingSmoothing * 0.4 * dt)
    this.followCamera.radius = Scalar.Clamp(
      this.followCamera.radius + radiusDelta,
      preset.minRadius,
      Math.min(preset.maxRadius, preset.radius + preset.maxRadiusExtension)
    )

    // Smooth FOV transitions with easing
    const targetFOV = preset.fov + (speedFactor * preset.speedFOVFactor * 30)
    const fovDelta = (targetFOV - this.followCamera.fov) * (preset.trackingSmoothing * 0.3 * dt)
    this.followCamera.fov = Scalar.Clamp(
      this.followCamera.fov + fovDelta,
      preset.fov - 0.3,
      preset.fov + 0.3
    )

    this.followCamera.beta = Scalar.Clamp(this.followCamera.beta, preset.minBeta, preset.maxBeta)
    this.updateZoneCameraTransition(dt)
  }

  setAccessibilityConfig(config: AccessibilityConfig): void {
    this.accessibility = config
  }

  private updateZoneCameraTransition(dt: number): void {
    if (!this.followCamera || !this.zoneCameraTransition) return

    const transition = this.zoneCameraTransition
    transition.elapsed += dt
    const progress = Math.min(1, transition.elapsed / transition.duration)
    const eased = CameraEasing.easeOutCubic(progress)

    this.followCamera.alpha = Scalar.Lerp(transition.from.alpha, transition.to.alpha, eased)
    this.followCamera.beta = Scalar.Lerp(transition.from.beta, transition.to.beta, eased)
    this.followCamera.radius = Scalar.Lerp(transition.from.radius, transition.to.radius, eased)
    this.followCamera.fov = Scalar.Lerp(transition.from.fov, transition.to.fov, eased)

    if (progress >= 1) {
      this.zoneCameraTransition = null
    }
  }

  private applyCameraPresetTransition(preset: CameraPreset, duration = 0.7): void {
    if (!this.followCamera) return

    const shouldCutInstantly =
      this.accessibility.reducedMotion || this.accessibility.maxCameraShakeIntensity <= 0

    this.followCamera.lowerRadiusLimit = preset.minRadius
    this.followCamera.upperRadiusLimit = preset.maxRadius
    this.followCamera.lowerBetaLimit = preset.minBeta
    this.followCamera.upperBetaLimit = preset.maxBeta

    if (shouldCutInstantly) {
      this.zoneCameraTransition = null
      this.followCamera.alpha = preset.alpha
      this.followCamera.beta = preset.beta
      this.followCamera.radius = preset.radius
      this.followCamera.fov = preset.fov
      return
    }

    this.zoneCameraTransition = {
      elapsed: 0,
      duration,
      from: {
        alpha: this.followCamera.alpha,
        beta: this.followCamera.beta,
        radius: this.followCamera.radius,
        fov: this.followCamera.fov,
      },
      to: {
        alpha: preset.alpha,
        beta: preset.beta,
        radius: preset.radius,
        fov: preset.fov,
      },
    }
  }

  activateExitPortal(
    trackId: AdventureTrackType,
    kind: ExitPortalKind,
    mode: ExitPortalWorldMode = 'STATIONARY_TABLE'
  ): boolean {
    if (!this.adventureActive) {
      return false
    }

    this.deactivateExitPortal()

    const position = this.getExitPortalPosition(trackId, mode)
    const isSuccess = kind === 'success'
    const ringHex = isSuccess ? PALETTE.CYAN : PALETTE.ALERT
    const coreHex = isSuccess ? PALETTE.GOLD : PALETTE.MAGENTA
    const portalRadius = mode === 'EXTENDED_MAP' ? 2.6 : 2.1
    const portalDepth = mode === 'EXTENDED_MAP' ? 1.0 : 0.8

    const portalParts = this.createExitPortal(position, ringHex, coreHex, portalRadius, portalDepth)

    this.exitPortal = {
      id: `${trackId}-exit-portal`,
      trackId,
      kind,
      mode,
      root: portalParts.root,
      core: portalParts.core,
      sensor: portalParts.sensor,
      ringMaterial: portalParts.ringMaterial,
      coreMaterial: portalParts.coreMaterial,
      ringBase: Color3.FromHexString(ringHex),
      coreBase: Color3.FromHexString(coreHex),
      animationTime: 0,
    }

    this.onEvent?.('PORTAL_ACTIVATED', {
      id: this.exitPortal.id,
      trackId,
      kind,
      mode,
      position,
    })

    return true
  }

  deactivateExitPortal(): void {
    if (!this.exitPortal) return

    const portal = this.exitPortal
    this.exitPortal = null

    this.onEvent?.('PORTAL_DEACTIVATED', { handle: portal.sensor.handle })

    portal.root.dispose()
    this.portalsRemovedSinceClear++

    if (this.world.getRigidBody(portal.sensor.handle)) {
      this.world.removeRigidBody(portal.sensor)
    }

    // createExitPortal() registers the sensor in adventureBodies — remove it here
    // so clearTrack() does not count an already-removed body as lingering.
    const bodyIndex = this.adventureBodies.indexOf(portal.sensor)
    if (bodyIndex >= 0) {
      this.adventureBodies.splice(bodyIndex, 1)
    }

    const portalMeshSet = new Set([portal.root, portal.core])
    this.adventureTrack = this.adventureTrack.filter(
      (mesh) => !portalMeshSet.has(mesh) && mesh.parent !== portal.root,
    )
    this.materials = this.materials.filter(
      (mat) => mat !== portal.ringMaterial && mat !== portal.coreMaterial,
    )
  }

  private getExitPortalPosition(trackId: AdventureTrackType, mode: ExitPortalWorldMode): Vector3 {
    // Use the builder-declared position when available (set by addExitPortal())
    if (this.portalPosition) {
      return this.portalPosition.clone()
    }
    // Fallback: generic formula relative to the track start anchor
    const anchor = getTrackStartAnchor(trackId)
    const zOffset = mode === 'EXTENDED_MAP' ? 95 : 55
    const yOffset = mode === 'EXTENDED_MAP' ? 2.2 : 1.4
    return new Vector3(anchor.x, anchor.y + yOffset, anchor.z + zOffset)
  }

  private updateExitPortal(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    const portal = this.exitPortal
    if (!portal) return

    portal.animationTime += dt

    if (this.accessibility.reducedMotion || this.accessibility.flashFrequencyMax <= 1) {
      portal.ringBase.scaleToRef(1.0, portal.ringMaterial.emissiveColor)
      portal.coreBase.scaleToRef(0.75, portal.coreMaterial.emissiveColor)
    } else {
      portal.root.rotation.z += dt * (portal.kind === 'success' ? 2.5 : 3.5)
      const pulse = 0.85 + Math.sin(portal.animationTime * (portal.kind === 'success' ? 6.0 : 8.0)) * 0.25
      portal.ringBase.scaleToRef(1.2 * pulse, portal.ringMaterial.emissiveColor)
      portal.coreBase.scaleToRef(0.85 * pulse, portal.coreMaterial.emissiveColor)
    }

    const sensorCollider = portal.sensor.collider(0)
    if (!sensorCollider) return

    const isAnyBallInside = ballBodies.some((candidateBall) => {
      const ballCollider = candidateBall.collider(0)
      return !!ballCollider && this.world.intersectionPair(sensorCollider, ballCollider)
    })
    if (!isAnyBallInside) return

    this.onEvent?.('PORTAL_ENTERED', {
      id: portal.id,
      trackId: portal.trackId,
      kind: portal.kind,
      position: portal.root.position.clone(),
    })

    this.deactivateExitPortal()
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

    // Load track-specific camera preset
    const presetKey = trackType as string
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

    switch (trackType) {
      case AdventureTrackType.CYBER_CORE:
        buildCyberCore(this)
        break
      case AdventureTrackType.PACHINKO_HALL:
        buildPachinkoHall(this)
        break
      case AdventureTrackType.QUANTUM_GRID:
        buildQuantumGrid(this)
        break
      case AdventureTrackType.SINGULARITY_WELL:
        buildSingularityWell(this)
        break
      case AdventureTrackType.GLITCH_SPIRE:
        buildGlitchSpire(this)
        break
      case AdventureTrackType.RETRO_WAVE_HILLS:
        buildRetroWaveHills(this)
        break
      case AdventureTrackType.CHRONO_CORE:
        buildChronoCore(this)
        break
      case AdventureTrackType.HYPER_DRIFT:
        buildHyperDrift(this)
        break
      case AdventureTrackType.PACHINKO_SPIRE:
        buildPachinkoSpire(this)
        break
      case AdventureTrackType.ORBITAL_JUNKYARD:
        buildOrbitalJunkyard(this)
        break
      case AdventureTrackType.FIREWALL_BREACH:
        buildFirewallBreach(this)
        break
      case AdventureTrackType.CPU_CORE:
        buildCpuCore(this)
        break
      case AdventureTrackType.CRYO_CHAMBER:
        buildCryoChamber(this)
        break
      case AdventureTrackType.BIO_HAZARD_LAB:
        buildBioHazardLab(this)
        break
      case AdventureTrackType.GRAVITY_FORGE:
        buildGravityForge(this)
        break
      case AdventureTrackType.TIDAL_NEXUS:
        buildTidalNexus(this)
        break
      case AdventureTrackType.DIGITAL_ZEN_GARDEN:
        buildDigitalZenGarden(this)
        break
      case AdventureTrackType.SYNTHWAVE_SURF:
        buildSynthwaveSurf(this)
        break
      case AdventureTrackType.SOLAR_FLARE:
        buildSolarFlare(this)
        break
      case AdventureTrackType.PRISM_PATHWAY:
        buildPrismPathway(this)
        break
      case AdventureTrackType.MAGNETIC_STORAGE:
        buildMagneticStorage(this)
        break
      case AdventureTrackType.NEURAL_NETWORK:
        buildNeuralNetwork(this)
        break
      case AdventureTrackType.NEON_STRONGHOLD:
        buildNeonStronghold(this)
        break
      case AdventureTrackType.CASINO_HEIST:
        buildCasinoHeist(this)
        break
      case AdventureTrackType.TESLA_TOWER:
        buildTeslaTower(this)
        break
      case AdventureTrackType.NEON_SKYLINE:
        buildNeonSkyline(this)
        break
      case AdventureTrackType.POLYCHROME_VOID:
        buildPolychromeVoid(this)
        break
      default:
        buildNeonHelix(this)
        break
    }

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

    this.deactivateExitPortal()

    const zoneChanged = this.currentZone !== newZone
    if (zoneChanged) {
      this.previousZone = this.currentZone
      this.currentZone = newZone
    }

    // Reset camera transition timer for cinematic entry
    this.cameraTransitionTime = 0

    this.currentCameraPreset = CAMERA_PRESETS[newZone as string] || CAMERA_PRESETS.DEFAULT

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
