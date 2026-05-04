import {
  ArcRotateCamera,
  Vector3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Quaternion,
  Color3,
  Scalar,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { AdventureModeTracksB } from './adventure-mode-tracks-b'
export { AdventureTrackType } from './adventure-mode-builder'
export type { AdventureCallback } from './adventure-mode-builder'
import {
  AdventureTrackType,
  GROUP_UNIVERSAL,
  GROUP_RED,
  GROUP_GREEN,
  GROUP_BLUE,
  MASK_ALL,
  MASK_RED,
  MASK_GREEN,
  MASK_BLUE,
} from './adventure-mode-builder'
import type { AdventureCallback } from './adventure-mode-builder'

/**
 * Camera preset configuration for adventure mode tracks.
 * Defines all camera parameters for track-specific visibility and cinematic feel.
 */
export interface CameraPreset {
  alpha: number
  beta: number
  radius: number
  fov: number
  lookAheadTime: number
  trackingSmoothing: number
  speedRadiusFactor: number
  speedFOVFactor: number
  maxRadiusExtension: number
  minBeta: number
  maxBeta: number
  minRadius: number
  maxRadius: number
}

/**
 * Track-specific camera presets for optimal visibility and cinematic feel.
 * Each preset is tuned for the specific track geometry and gameplay style.
 */
export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  /** NEON_HELIX: Balanced isometric view for the classic helix descent */
  NEON_HELIX: {
    alpha: -Math.PI / 2,
    beta: 0.96, // 55°
    radius: 16,
    fov: 0.75,
    lookAheadTime: 0.35,
    trackingSmoothing: 7.0,
    speedRadiusFactor: 0.25,
    speedFOVFactor: 0.008,
    maxRadiusExtension: 8,
    minBeta: 0.7,
    maxBeta: 1.22,
    minRadius: 10,
    maxRadius: 35,
  },
  /** CYBER_CORE: Steeper angle for vertical descent sections */
  CYBER_CORE: {
    alpha: -Math.PI / 2,
    beta: 1.13, // 65°
    radius: 14,
    fov: 0.8,
    lookAheadTime: 0.25,
    trackingSmoothing: 9.0,
    speedRadiusFactor: 0.35,
    speedFOVFactor: 0.012,
    maxRadiusExtension: 10,
    minBeta: 0.87,
    maxBeta: 1.31,
    minRadius: 10,
    maxRadius: 35,
  },
  /** QUANTUM_GRID: Wider FOV for maze navigation */
  QUANTUM_GRID: {
    alpha: -Math.PI / 2,
    beta: 1.22, // 70°
    radius: 18,
    fov: 0.85,
    lookAheadTime: 0.4,
    trackingSmoothing: 6.0,
    speedRadiusFactor: 0.15,
    speedFOVFactor: 0.005,
    maxRadiusExtension: 4,
    minBeta: 1.05,
    maxBeta: 1.4,
    minRadius: 14,
    maxRadius: 35,
  },
  /** SINGULARITY_WELL: Tighter view for gravitational challenge */
  SINGULARITY_WELL: {
    alpha: -Math.PI / 2,
    beta: 1.05, // 60°
    radius: 15,
    fov: 0.78,
    lookAheadTime: 0.3,
    trackingSmoothing: 8.0,
    speedRadiusFactor: 0.3,
    speedFOVFactor: 0.01,
    maxRadiusExtension: 6,
    minBeta: 0.79,
    maxBeta: 1.31,
    minRadius: 10,
    maxRadius: 35,
  },
  /** GLITCH_SPIRE: Dynamic view for chaotic environment */
  GLITCH_SPIRE: {
    alpha: -Math.PI / 2,
    beta: 1.0, // 57°
    radius: 17,
    fov: 0.82,
    lookAheadTime: 0.32,
    trackingSmoothing: 7.5,
    speedRadiusFactor: 0.28,
    speedFOVFactor: 0.009,
    maxRadiusExtension: 7,
    minBeta: 0.75,
    maxBeta: 1.26,
    minRadius: 11,
    maxRadius: 35,
  },
  /** PACHINKO_SPIRE: Top-down view for vertical pachinko board */
  PACHINKO_SPIRE: {
    alpha: -Math.PI / 2,
    beta: 1.26, // 72°
    radius: 20,
    fov: 0.9,
    lookAheadTime: 0.2,
    trackingSmoothing: 10.0,
    speedRadiusFactor: 0.1,
    speedFOVFactor: 0.003,
    maxRadiusExtension: 5,
    minBeta: 1.13,
    maxBeta: 1.45,
    minRadius: 15,
    maxRadius: 40,
  },
  /** DEFAULT: Fallback preset for tracks without specific tuning */
  DEFAULT: {
    alpha: -Math.PI / 2,
    beta: Math.PI / 3,
    radius: 14,
    fov: 0.8,
    lookAheadTime: 0.3,
    trackingSmoothing: 7.0,
    speedRadiusFactor: 0.2,
    speedFOVFactor: 0.01,
    maxRadiusExtension: 8,
    minBeta: 0.5,
    maxBeta: 1.3,
    minRadius: 8,
    maxRadius: 35,
  },
}

export class AdventureMode extends AdventureModeTracksB {
  /** Current camera preset for active track */
  protected currentCameraPreset: CameraPreset | null = CAMERA_PRESETS.DEFAULT
  /** Current zone/track type for zone transition detection */
  private currentZone: AdventureTrackType | null = null
  /** Previous zone for transition intensity calculation */
  private previousZone: AdventureTrackType | null = null
  
  /**
   * Registers a callback listener to handle story events in the main Game class.
   */
  setEventListener(callback: AdventureCallback): void {
    this.onEvent = callback
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

  isActive(): boolean {
    return this.adventureActive
  }

  getSensor(): RAPIER.RigidBody | null {
    return this.adventureSensor
  }

  getResetSensors(): RAPIER.RigidBody[] {
    return this.resetSensors
  }

  getStartPos(): Vector3 {
    return this.currentStartPos
  }

  update(dt: number = 0.016, ballBodies: RAPIER.RigidBody[] = []): void {
    if (!this.adventureActive) return

    this.timeAccumulator += dt

    // Camera update
    if (this.followCamera && ballBodies.length > 0 && this.currentCameraPreset) {
      this.updateCinematicCamera(ballBodies[0], dt)
    }

    // 1. Animate Obstacles
    for (const obst of this.animatedObstacles) {
        if (obst.type === 'PISTON') {
            const yOffset = Math.sin(this.timeAccumulator * obst.frequency + obst.phase) * obst.amplitude
            // Pistons move up from base.
            // Formula: y = base + offset
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

    // 2. Apply Conveyor Forces
    // Check if any ball is inside a conveyor sensor
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

    // 3. Apply Gravity Wells
    for (const well of this.gravityWells) {
        const sensorHandle = well.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                // Direction towards center
                const ballPos = ball.translation()
                const dir = well.center.subtract(new Vector3(ballPos.x, ballPos.y, ballPos.z)).normalize()
                const imp = dir.scale(well.strength * dt)
                ball.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true)
            }
        }
    }

    // 4. Apply Damping Zones
    for (const zone of this.dampingZones) {
        const sensorHandle = zone.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                // F = -v * k
                const vel = ball.linvel()
                const force = {
                    x: -vel.x * zone.damping,
                    y: -vel.y * zone.damping,
                    z: -vel.z * zone.damping
                }
                // Apply as Impulse: F * dt
                ball.applyImpulse({ x: force.x * dt, y: force.y * dt, z: force.z * dt }, true)
            }
        }
    }

    // 5. Apply Chroma Gates
    for (const gate of this.chromaGates) {
        const sensorHandle = gate.sensor.collider(0)
        for (const ball of ballBodies) {
            const ballHandle = ball.collider(0)
            if (this.world.intersectionPair(sensorHandle, ballHandle)) {
                this.setBallColorState(ball, gate.colorType)
            }
        }
    }

    // 6. Sync kinematic bodies to visuals
    // This includes standard kinematics (rotating platforms) and our animated ones
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

    // 1. Speed-based radius
    const speedFactor = Math.min(speed / 30, 1)
    const targetRadius = preset.radius + (speedFactor * preset.speedRadiusFactor * 30)

    // 2. Look-ahead targeting
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

    // 3. Apply with smoothing
    const smoothing = preset.trackingSmoothing * dt

    // Position smoothing
    this.followCamera.target = new Vector3(
      this.followCamera.target.x + (targetPosition.x - this.followCamera.target.x) * smoothing,
      this.followCamera.target.y + (targetPosition.y - this.followCamera.target.y) * smoothing,
      this.followCamera.target.z + (targetPosition.z - this.followCamera.target.z) * smoothing
    )

    // Radius smoothing with clamping
    const radiusDelta = (targetRadius - this.followCamera.radius) * (preset.trackingSmoothing * 0.4 * dt)
    this.followCamera.radius = Scalar.Clamp(
      this.followCamera.radius + radiusDelta,
      preset.minRadius,
      Math.min(preset.maxRadius, preset.radius + preset.maxRadiusExtension)
    )

    // FOV smoothing
    const targetFOV = preset.fov + (speedFactor * preset.speedFOVFactor * 30)
    const fovDelta = (targetFOV - this.followCamera.fov) * (preset.trackingSmoothing * 0.3 * dt)
    this.followCamera.fov = Scalar.Clamp(
      this.followCamera.fov + fovDelta,
      preset.fov - 0.3,  // Max change from base
      preset.fov + 0.3
    )

    // Safety: clamp beta
    this.followCamera.beta = Scalar.Clamp(this.followCamera.beta, preset.minBeta, preset.maxBeta)
  }

  /**
   * Activates Adventure Mode:
   * 1. Emits 'START' event
   * 2. Builds the holographic track
   * 3. Teleports the ball
   * 4. Swaps camera to Isometric Follow view
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

    // Notify the Game class to update the Display
    if (this.onEvent) this.onEvent('START', trackType)
    
    // Emit zone enter event for initial zone
    if (this.onEvent) this.onEvent('ZONE_ENTER', { 
      zone: trackType, 
      previousZone: this.previousZone,
      isMajor: true // First entry is always major
    })

    // Set Start Position based on Track
    if (trackType === AdventureTrackType.CYBER_CORE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createDescentTrack()
    } else if (trackType === AdventureTrackType.QUANTUM_GRID) {
        this.currentStartPos = new Vector3(0, 10, 0)
        this.createQuantumGridTrack()
    } else if (trackType === AdventureTrackType.SINGULARITY_WELL) {
        this.currentStartPos = new Vector3(0, 25, 0)
        this.createSingularityWell()
    } else if (trackType === AdventureTrackType.GLITCH_SPIRE) {
        this.currentStartPos = new Vector3(0, 10, 0)
        this.createGlitchSpireTrack()
    } else if (trackType === AdventureTrackType.RETRO_WAVE_HILLS) {
        this.currentStartPos = new Vector3(0, 5, 0)
        this.createRetroWaveHills()
    } else if (trackType === AdventureTrackType.CHRONO_CORE) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createChronoCore()
    } else if (trackType === AdventureTrackType.HYPER_DRIFT) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createHyperDriftTrack()
    } else if (trackType === AdventureTrackType.PACHINKO_SPIRE) {
        this.currentStartPos = new Vector3(0, 30, 0)
        this.createPachinkoSpireTrack()
    } else if (trackType === AdventureTrackType.ORBITAL_JUNKYARD) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createOrbitalJunkyardTrack()
    } else if (trackType === AdventureTrackType.FIREWALL_BREACH) {
        this.currentStartPos = new Vector3(0, 25, 0)
        this.createFirewallBreachTrack()
    } else if (trackType === AdventureTrackType.CPU_CORE) {
        this.currentStartPos = new Vector3(0, 15, 0)
        this.createCpuCoreTrack()
    } else if (trackType === AdventureTrackType.CRYO_CHAMBER) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createCryoChamberTrack()
    } else if (trackType === AdventureTrackType.BIO_HAZARD_LAB) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createBioHazardLabTrack()
    } else if (trackType === AdventureTrackType.GRAVITY_FORGE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createGravityForgeTrack()
    } else if (trackType === AdventureTrackType.TIDAL_NEXUS) {
        this.currentStartPos = new Vector3(0, 25, 0)
        this.createTidalNexusTrack()
    } else if (trackType === AdventureTrackType.DIGITAL_ZEN_GARDEN) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createDigitalZenGardenTrack()
    } else if (trackType === AdventureTrackType.SYNTHWAVE_SURF) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createSynthwaveSurfTrack()
    } else if (trackType === AdventureTrackType.SOLAR_FLARE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createSolarFlareTrack()
    } else if (trackType === AdventureTrackType.PRISM_PATHWAY) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createPrismPathwayTrack()
    } else if (trackType === AdventureTrackType.MAGNETIC_STORAGE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createMagneticStorageTrack()
    } else if (trackType === AdventureTrackType.NEURAL_NETWORK) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createNeuralNetworkTrack()
    } else if (trackType === AdventureTrackType.NEON_STRONGHOLD) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createNeonStrongholdTrack()
    } else if (trackType === AdventureTrackType.CASINO_HEIST) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createCasinoHeistTrack()
    } else if (trackType === AdventureTrackType.TESLA_TOWER) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createTeslaTowerTrack()
    } else if (trackType === AdventureTrackType.NEON_SKYLINE) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createNeonSkylineTrack()
    } else if (trackType === AdventureTrackType.POLYCHROME_VOID) {
        this.currentStartPos = new Vector3(0, 20, 0)
        this.createPolychromeVoidTrack()
    } else {
        this.currentStartPos = new Vector3(0, 2, 8) // Helix default
        this.createHelixTrack()
    }
    
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
  }

  /**
   * Switch to a new zone in Dynamic Adventure Mode (scrolling world).
   * This triggers zone transition effects: backbox video, lighting, music, screen shake.
   * 
   * @param newZone - The zone type to switch to
   * @param ballPosition - Optional ball position for zone entry point
   * @returns true if zone was switched, false if already in that zone
   */
  switchZone(newZone: AdventureTrackType, ballPosition?: Vector3): boolean {
    if (!this.adventureActive) {
      console.warn('[AdventureMode] Cannot switch zone: adventure not active')
      return false
    }
    
    if (this.currentZone === newZone) {
      return false // Already in this zone
    }
    
    // Track zone transition
    this.previousZone = this.currentZone
    this.currentZone = newZone
    
    // Update camera preset for new zone
    const presetKey = newZone as string
    this.currentCameraPreset = CAMERA_PRESETS[presetKey] || CAMERA_PRESETS.DEFAULT
    
    // Notify Game class of zone transition
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
   * Major transitions are between thematically different zones
   */
  private isMajorZoneTransition(from: AdventureTrackType | null, to: AdventureTrackType): boolean {
    if (!from) return true // First entry is always major
    
    // Define major transition groups
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
    
    // Transition between different categories is major
    const fromDanger = dangerZones.includes(from)
    const toDanger = dangerZones.includes(to)
    const fromCalm = calmZones.includes(from)
    const toCalm = calmZones.includes(to)
    const fromTech = techZones.includes(from)
    const toTech = techZones.includes(to)
    
    // Major if switching between categories
    if (fromDanger !== toDanger) return true
    if (fromCalm !== toCalm) return true
    if (fromTech !== toTech) return true
    
    return false
  }

  end(): void {
    if (!this.adventureActive) return
    this.adventureActive = false
    
    if (this.onEvent) this.onEvent('END')

    // Restore Table Camera
    if (this.tableCamera) {
      this.scene.activeCamera = this.tableCamera
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


  // Moved to adventure-mode-tracks-b.ts

  // Moved to adventure-mode-tracks-b.ts

  // Moved to adventure-mode-tracks-b.ts

  // Moved to adventure-mode-tracks-b.ts

  // --- Track: The Polychrome Void ---
  protected createPolychromeVoidTrack(): void {
      const whiteMat = this.getTrackMaterial("#FFFFFF")
      const redMat = this.getTrackMaterial("#FF0000")
      const greenMat = this.getTrackMaterial("#00FF00")
      const blueMat = this.getTrackMaterial("#0000FF")

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. Monochrome Injection (Entry)
      // White. Group Universal.
      const entryLen = 10
      const entryIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, whiteMat, 0, 0.5)

      // 2. The Red Shift (Gate)
      const gatePos = currentPos.clone()
      gatePos.y += 1.0
      this.createChromaGate(gatePos, 'RED')

      // 3. Crimson Walkway (Filter)
      const crimLen = 15
      const crimWidth = 4
      const crimStart = currentPos.clone()

      // Create Red Floor manually to set Group
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const crimCenter = crimStart.add(forward.scale(crimLen / 2))
      // Flat (Incline 0)
      const floor = MeshBuilder.CreateBox("crimsonFloor", { width: crimWidth, height: 0.5, depth: crimLen }, this.scene)
      floor.position.copyFrom(crimCenter)
      floor.rotation.y = heading
      floor.material = redMat
      this.adventureTrack.push(floor)

      if (this.world) {
          const body = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(crimCenter.x, crimCenter.y, crimCenter.z)
          )
          const q = Quaternion.FromEulerAngles(0, heading, 0)
          body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          const collider = this.rapier.ColliderDesc.cuboid(crimWidth/2, 0.25, crimLen/2)
          // Set Group: Red
          // Interaction Groups: (Member << 16) | Filter
          const groups = (GROUP_RED << 16) | MASK_ALL
          collider.setCollisionGroups(groups)

          this.world.createCollider(collider, body)
          this.adventureBodies.push(body)
      }

      // Add Blue Ghosts (Obstacles)
      if (this.world) {
          const ghostCount = 5
          for (let i=0; i<ghostCount; i++) {
              const dist = 3 + i * 2.5
              const offset = (Math.random() - 0.5) * (crimWidth - 1)
              const pos = crimStart.add(forward.scale(dist))
              const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
              const ghostPos = pos.add(right.scale(offset))
              ghostPos.y += 0.5

              const ghost = MeshBuilder.CreateBox("blueGhost", { size: 1.0 }, this.scene)
              ghost.position.copyFrom(ghostPos)
              ghost.material = blueMat
              this.adventureTrack.push(ghost)

              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(ghostPos.x, ghostPos.y, ghostPos.z)
              )
              const collider = this.rapier.ColliderDesc.cuboid(0.5, 0.5, 0.5)
              // Group: Blue
              const groups = (GROUP_BLUE << 16) | MASK_ALL
              collider.setCollisionGroups(groups)

              this.world.createCollider(collider, body)
              this.adventureBodies.push(body)
          }
      }

      currentPos = crimStart.add(forward.scale(crimLen))

      // 4. The Green Filter (Gate)
      const jumpGap = 4
      currentPos = currentPos.add(forward.scale(jumpGap))
      // Gate in air
      const greenGatePos = currentPos.clone()
      greenGatePos.y += 2.0 // High
      this.createChromaGate(greenGatePos, 'GREEN')

      // 5. Emerald Isles (Platforming)
      const isleCount = 5
      const isleSpacing = 3
      const isleSize = 2

      for (let i=0; i<isleCount; i++) {
          currentPos = currentPos.add(forward.scale(isleSpacing))

          const offset = 1.5
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          // Randomize left/right
          const greenLeft = Math.random() > 0.5

          const p1Pos = currentPos.add(right.scale(-offset))
          const p2Pos = currentPos.add(right.scale(offset))

          const createIsle = (pos: Vector3, color: 'GREEN' | 'RED') => {
              const mat = color === 'GREEN' ? greenMat : redMat
              const grp = color === 'GREEN' ? GROUP_GREEN : GROUP_RED

              const box = MeshBuilder.CreateBox("isle", { width: isleSize, height: 0.5, depth: isleSize }, this.scene)
              box.position.copyFrom(pos)
              box.material = mat
              this.adventureTrack.push(box)

              if (this.world) {
                  const body = this.world.createRigidBody(
                      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
                  )
                  const col = this.rapier.ColliderDesc.cuboid(isleSize/2, 0.25, isleSize/2)
                  col.setCollisionGroups((grp << 16) | MASK_ALL)
                  this.world.createCollider(col, body)
                  this.adventureBodies.push(body)
              }
          }

          createIsle(p1Pos, greenLeft ? 'GREEN' : 'RED')
          createIsle(p2Pos, greenLeft ? 'RED' : 'GREEN')
      }

      // 6. The Blue Shift (Gate)
      currentPos = currentPos.add(forward.scale(isleSpacing))
      this.createChromaGate(currentPos, 'BLUE')

      // 7. Sapphire Spiral (Ascent)
      const spiralRadius = 10
      const spiralAngle = 2 * Math.PI
      const spiralIncline = -(10 * Math.PI) / 180 // Up

      // const spiralStart = currentPos.clone()
      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 6, 1.0, blueMat, 20)

      // if (this.world) {
      //     // Add Red Ghosts along the spiral (Approximate)
      // }
      heading += spiralAngle

      // 8. Whiteout (Goal)
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(goalForward.scale(4))

      this.createBasin(goalPos, whiteMat)
  }

  protected createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void {
      if (!this.world) return

      // Visual
      const gateMat = this.getTrackMaterial(color === 'RED' ? "#FF0000" : color === 'GREEN' ? "#00FF00" : "#0000FF")
      const gate = MeshBuilder.CreateTorus("gate", { diameter: 4, thickness: 0.2 }, this.scene)
      gate.position.copyFrom(pos)
      gate.rotation.x = Math.PI / 2
      gate.material = gateMat
      this.adventureTrack.push(gate)

      // Sensor
      const sensor = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(0.5, 2.0).setSensor(true),
          sensor
      )

      this.chromaGates.push({ sensor, colorType: color })
  }

  protected setBallColorState(ball: RAPIER.RigidBody, color: 'RED' | 'GREEN' | 'BLUE'): void {
      const collider = ball.collider(0)
      if (!collider) return

      let groups = 0
      let matColor = Color3.White()

      switch (color) {
          case 'RED':
              groups = (GROUP_UNIVERSAL << 16) | MASK_RED // Member: Universal (so others see me), Filter: MASK_RED
              // Wait, earlier I said Ball Filter decides what IT sees.
              // "MASK_RED" = "UNIVERSAL | RED".
              // So if Ball Filter = MASK_RED, it sees Universal and Red objects.
              // Ball Membership: If I set it to Universal, then Red Objects (Filter: ALL) will see Ball.
              // Blue Objects (Filter: ALL) will see Ball.
              // But Ball Filter (MASK_RED) will NOT see Blue Objects (Group Blue).
              // So collision logic: Pair exists if (FilterA & MemberB) && (FilterB & MemberA).
              // Ball Filter (Red|Univ) & Blue Object Member (Blue) = 0.
              // So they don't collide. Correct.
              matColor = Color3.Red()
              break
          case 'GREEN':
              groups = (GROUP_UNIVERSAL << 16) | MASK_GREEN
              matColor = Color3.Green()
              break
          case 'BLUE':
              groups = (GROUP_UNIVERSAL << 16) | MASK_BLUE
              matColor = Color3.Blue()
              break
      }

      collider.setCollisionGroups(groups)

      if (this.currentBallMesh) {
          const mat = this.currentBallMesh.material as StandardMaterial
          if (mat) {
              mat.emissiveColor = matColor
              mat.diffuseColor = matColor
          }
      }
  }
}

