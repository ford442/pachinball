/**
 * Adventure Mode Orchestrator
 * 
 * Main controller for adventure mode that handles track selection, camera management,
 * physics updates, and event dispatching.
 */

import {
  ArcRotateCamera,
  Vector3,
  Mesh,
  Quaternion,
  Scalar,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { TrackBuilder } from './track-builder'
import { CAMERA_PRESETS } from './camera-presets'
import { AdventureTrackType, type AdventureCallback, type CameraPreset } from './adventure-types'
import { CameraEasing } from './camera-easing'
import { getNextAdventureTrack, getTrackStartAnchor } from './portal-routing'

// Import all track builders
import { buildNeonHelix } from './tracks/neon-helix'
import { buildCyberCore } from './tracks/cyber-core'
import { buildQuantumGrid } from './tracks/quantum-grid'
import { buildSingularityWell } from './tracks/singularity-well'
import { buildGlitchSpire } from './tracks/glitch-spire'
import { buildRetroWaveHills } from './tracks/retro-wave-hills'
import { buildChronoCore } from './tracks/chrono-core'
import { buildHyperDrift } from './tracks/hyper-drift'
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
  private tableCamera: ArcRotateCamera | null = null
  private followCamera: ArcRotateCamera | null = null

  /** Camera transition state for cinematic polish */
  private cameraTransitionTime = 0
  private cameraTransitionDuration = 0.8 // seconds for smooth entry
  private exitPortal: ActiveExitPortal | null = null

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
    this.updateExitPortal(dt, ballBodies)

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
    const ringHex = isSuccess ? '#00d9ff' : '#ff4400'
    const coreHex = isSuccess ? '#ffd700' : '#aa2244'
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

    portal.root.dispose()

    if (this.world.getRigidBody(portal.sensor.handle)) {
      this.world.removeRigidBody(portal.sensor)
    }
  }

  private getExitPortalPosition(trackId: AdventureTrackType, mode: ExitPortalWorldMode): Vector3 {
    const anchor = getTrackStartAnchor(trackId)
    const zOffset = mode === 'EXTENDED_MAP' ? 95 : 55
    const yOffset = mode === 'EXTENDED_MAP' ? 2.2 : 1.4
    return new Vector3(anchor.x, anchor.y + yOffset, anchor.z + zOffset)
  }

  private updateExitPortal(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    const portal = this.exitPortal
    if (!portal) return

    portal.animationTime += dt
    portal.root.rotation.z += dt * (portal.kind === 'success' ? 2.5 : 3.5)

    const pulse = 0.85 + Math.sin(portal.animationTime * (portal.kind === 'success' ? 6.0 : 8.0)) * 0.25
    portal.ringMaterial.emissiveColor = portal.ringBase.scale(1.2 * pulse)
    portal.coreMaterial.emissiveColor = portal.coreBase.scale(0.85 * pulse)

    const ball = ballBodies[0]
    if (!ball) return

    const sensorCollider = portal.sensor.collider(0)
    const ballCollider = ball.collider(0)
    if (!sensorCollider || !ballCollider) return

    if (!this.world.intersectionPair(sensorCollider, ballCollider)) return

    const nextTrack = getNextAdventureTrack(portal.trackId)
    const teleportPos = getTrackStartAnchor(nextTrack)

    ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
    ball.setTranslation({ x: teleportPos.x, y: teleportPos.y, z: teleportPos.z }, true)

    this.onEvent?.('PORTAL_ENTERED', {
      id: portal.id,
      trackId: portal.trackId,
      nextTrack,
      kind: portal.kind,
      position: new Vector3(portal.root.position.x, portal.root.position.y, portal.root.position.z),
      teleportPosition: teleportPos.clone(),
    })

    this.deactivateExitPortal()
    this.switchZone(nextTrack, teleportPos)
  }

  /**
   * Activates Adventure Mode
   */
  start(
    ballBody: RAPIER.RigidBody,
    currentCamera: ArcRotateCamera,
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
    switch (trackType) {
      case AdventureTrackType.CYBER_CORE:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildCyberCore(this)
        break
      case AdventureTrackType.QUANTUM_GRID:
        this.currentStartPos = new Vector3(0, 10, 0)
        buildQuantumGrid(this)
        break
      case AdventureTrackType.SINGULARITY_WELL:
        this.currentStartPos = new Vector3(0, 25, 0)
        buildSingularityWell(this)
        break
      case AdventureTrackType.GLITCH_SPIRE:
        this.currentStartPos = new Vector3(0, 10, 0)
        buildGlitchSpire(this)
        break
      case AdventureTrackType.RETRO_WAVE_HILLS:
        this.currentStartPos = new Vector3(0, 5, 0)
        buildRetroWaveHills(this)
        break
      case AdventureTrackType.CHRONO_CORE:
        this.currentStartPos = new Vector3(0, 15, 0)
        buildChronoCore(this)
        break
      case AdventureTrackType.HYPER_DRIFT:
        this.currentStartPos = new Vector3(0, 15, 0)
        buildHyperDrift(this)
        break
      case AdventureTrackType.PACHINKO_SPIRE:
        this.currentStartPos = new Vector3(0, 30, 0)
        buildPachinkoSpire(this)
        break
      case AdventureTrackType.ORBITAL_JUNKYARD:
        this.currentStartPos = new Vector3(0, 15, 0)
        buildOrbitalJunkyard(this)
        break
      case AdventureTrackType.FIREWALL_BREACH:
        this.currentStartPos = new Vector3(0, 25, 0)
        buildFirewallBreach(this)
        break
      case AdventureTrackType.CPU_CORE:
        this.currentStartPos = new Vector3(0, 15, 0)
        buildCpuCore(this)
        break
      case AdventureTrackType.CRYO_CHAMBER:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildCryoChamber(this)
        break
      case AdventureTrackType.BIO_HAZARD_LAB:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildBioHazardLab(this)
        break
      case AdventureTrackType.GRAVITY_FORGE:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildGravityForge(this)
        break
      case AdventureTrackType.TIDAL_NEXUS:
        this.currentStartPos = new Vector3(0, 25, 0)
        buildTidalNexus(this)
        break
      case AdventureTrackType.DIGITAL_ZEN_GARDEN:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildDigitalZenGarden(this)
        break
      case AdventureTrackType.SYNTHWAVE_SURF:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildSynthwaveSurf(this)
        break
      case AdventureTrackType.SOLAR_FLARE:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildSolarFlare(this)
        break
      case AdventureTrackType.PRISM_PATHWAY:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildPrismPathway(this)
        break
      case AdventureTrackType.MAGNETIC_STORAGE:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildMagneticStorage(this)
        break
      case AdventureTrackType.NEURAL_NETWORK:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildNeuralNetwork(this)
        break
      case AdventureTrackType.NEON_STRONGHOLD:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildNeonStronghold(this)
        break
      case AdventureTrackType.CASINO_HEIST:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildCasinoHeist(this)
        break
      case AdventureTrackType.TESLA_TOWER:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildTeslaTower(this)
        break
      case AdventureTrackType.NEON_SKYLINE:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildNeonSkyline(this)
        break
      case AdventureTrackType.POLYCHROME_VOID:
        this.currentStartPos = new Vector3(0, 20, 0)
        buildPolychromeVoid(this)
        break
      default:
        this.currentStartPos = new Vector3(0, 2, 8)
        buildNeonHelix(this)
        break
    }
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
   * End adventure mode and cleanup
   */
  end(): void {
    if (!this.adventureActive) return
    this.adventureActive = false
    this.deactivateExitPortal()

    if (this.onEvent) this.onEvent('END')

    // Restore Table Camera
    if (this.tableCamera) {
      this.scene.activeCamera = this.tableCamera
      this.scene.activeCameras = [this.tableCamera]
      this.followCamera?.dispose()
      this.followCamera = null
    }

    this.currentBallMesh = null
    this.currentCameraPreset = null

    // Cleanup Visuals
    this.adventureTrack.forEach(m => m.dispose())
    this.adventureTrack = []
    this.materials.forEach(m => m.dispose())
    this.materials = []
    this.kinematicBindings = []
    this.animatedObstacles = []

    // Cleanup Physics
    this.adventureBodies.forEach(body => {
      if (this.world.getRigidBody(body.handle)) {
        this.world.removeRigidBody(body)
      }
    })
    this.adventureBodies = []

    this.conveyorZones.forEach(z => {
      if (this.world.getRigidBody(z.sensor.handle)) {
        this.world.removeRigidBody(z.sensor)
      }
    })
    this.conveyorZones = []

    this.gravityWells.forEach(w => {
      if (this.world.getRigidBody(w.sensor.handle)) {
        this.world.removeRigidBody(w.sensor)
      }
    })
    this.gravityWells = []

    this.dampingZones.forEach(z => {
      if (this.world.getRigidBody(z.sensor.handle)) {
        this.world.removeRigidBody(z.sensor)
      }
    })
    this.dampingZones = []

    if (this.adventureSensor) {
      if (this.world.getRigidBody(this.adventureSensor.handle)) {
        this.world.removeRigidBody(this.adventureSensor)
      }
      this.adventureSensor = null
    }

    this.resetSensors.forEach(s => {
      if (this.world.getRigidBody(s.handle)) {
        this.world.removeRigidBody(s)
      }
    })
    this.resetSensors = []

    this.chromaGates.forEach(g => {
      if (this.world.getRigidBody(g.sensor.handle)) {
        this.world.removeRigidBody(g.sensor)
      }
    })
    this.chromaGates = []
  }
}
