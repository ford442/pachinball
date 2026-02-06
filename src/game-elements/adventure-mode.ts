import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  Quaternion,
  ArcRotateCamera,
  Mesh,
  VertexBuffer,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Event callback signature for communicating with Game.ts
export type AdventureCallback = (event: string, data?: unknown) => void

export enum AdventureTrackType {
  NEON_HELIX = 'NEON_HELIX',
  CYBER_CORE = 'CYBER_CORE',
  QUANTUM_GRID = 'QUANTUM_GRID',
  SINGULARITY_WELL = 'SINGULARITY_WELL',
  GLITCH_SPIRE = 'GLITCH_SPIRE',
  RETRO_WAVE_HILLS = 'RETRO_WAVE_HILLS',
  CHRONO_CORE = 'CHRONO_CORE',
  HYPER_DRIFT = 'HYPER_DRIFT',
  PACHINKO_SPIRE = 'PACHINKO_SPIRE',
  ORBITAL_JUNKYARD = 'ORBITAL_JUNKYARD',
  FIREWALL_BREACH = 'FIREWALL_BREACH',
  CPU_CORE = 'CPU_CORE',
  CRYO_CHAMBER = 'CRYO_CHAMBER',
  BIO_HAZARD_LAB = 'BIO_HAZARD_LAB',
  GRAVITY_FORGE = 'GRAVITY_FORGE',
  TIDAL_NEXUS = 'TIDAL_NEXUS',
  DIGITAL_ZEN_GARDEN = 'DIGITAL_ZEN_GARDEN',
  SYNTHWAVE_SURF = 'SYNTHWAVE_SURF',
  SOLAR_FLARE = 'SOLAR_FLARE',
  PRISM_PATHWAY = 'PRISM_PATHWAY',
  MAGNETIC_STORAGE = 'MAGNETIC_STORAGE',
  NEURAL_NETWORK = 'NEURAL_NETWORK',
  NEON_STRONGHOLD = 'NEON_STRONGHOLD',
  CASINO_HEIST = 'CASINO_HEIST',
  TESLA_TOWER = 'TESLA_TOWER',
  NEON_SKYLINE = 'NEON_SKYLINE',
  POLYCHROME_VOID = 'POLYCHROME_VOID',
}

const GROUP_UNIVERSAL = 0x0001
const GROUP_RED = 0x0002
const GROUP_GREEN = 0x0004
const GROUP_BLUE = 0x0008

const MASK_ALL = 0xFFFF
const MASK_RED = GROUP_UNIVERSAL | GROUP_RED
const MASK_GREEN = GROUP_UNIVERSAL | GROUP_GREEN
const MASK_BLUE = GROUP_UNIVERSAL | GROUP_BLUE

interface GravityWell {
  sensor: RAPIER.RigidBody
  center: Vector3
  strength: number
}

interface DampingZone {
  sensor: RAPIER.RigidBody
  damping: number
}

interface KinematicBinding {
  body: RAPIER.RigidBody
  mesh: Mesh
}

interface AnimatedObstacle extends KinematicBinding {
  type: 'PISTON' | 'OSCILLATOR' | 'ROTATING_OSCILLATOR'
  basePos: Vector3
  baseRot?: Quaternion
  frequency: number
  amplitude: number
  phase: number
  axis?: Vector3
}

interface ConveyorZone {
  sensor: RAPIER.RigidBody
  force: Vector3
}

interface ChromaGate {
  sensor: RAPIER.RigidBody
  colorType: 'RED' | 'GREEN' | 'BLUE'
}

export class AdventureMode {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER

  // State Management
  private adventureTrack: Mesh[] = []
  private materials: StandardMaterial[] = []
  private adventureBodies: RAPIER.RigidBody[] = []
  private kinematicBindings: KinematicBinding[] = []
  private animatedObstacles: AnimatedObstacle[] = []
  private conveyorZones: ConveyorZone[] = []
  private gravityWells: GravityWell[] = []
  private dampingZones: DampingZone[] = []
  private chromaGates: ChromaGate[] = []
  private adventureSensor: RAPIER.RigidBody | null = null
  private resetSensors: RAPIER.RigidBody[] = []
  private adventureActive = false
  private currentStartPos: Vector3 = Vector3.Zero()
  private timeAccumulator = 0
  private currentBallMesh: Mesh | null = null

  // Camera Management
  private tableCamera: ArcRotateCamera | null = null
  private followCamera: ArcRotateCamera | null = null

  // Communication
  private onEvent: AdventureCallback | null = null

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
  }

  /**
   * Registers a callback listener to handle story events in the main Game class.
   */
  setEventListener(callback: AdventureCallback): void {
    this.onEvent = callback
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

    // Notify the Game class to update the Display
    if (this.onEvent) this.onEvent('START', trackType)

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

    // Create new RPG-style Isometric Camera
    // For Pachinko Spire, maybe a different angle?
    // Plan says "Camera looks down (or sideways?)".
    // Default ISO is fine, but maybe steeper pitch?

    this.followCamera = new ArcRotateCamera("isoCam", -Math.PI / 2, Math.PI / 3, 14, Vector3.Zero(), this.scene)

    if (trackType === AdventureTrackType.PACHINKO_SPIRE) {
        // Look more directly at the board
        this.followCamera.beta = Math.PI / 2.5
        this.followCamera.radius = 20
    }

    this.followCamera.lowerRadiusLimit = 8
    this.followCamera.upperRadiusLimit = 35
    this.followCamera.attachControl(this.scene.getEngine().getRenderingCanvas(), true)
    
    if (ballMesh) {
      this.followCamera.lockedTarget = ballMesh
    }
    
    this.scene.activeCamera = this.followCamera
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

  // --- Shared Helper for Materials ---
  private getTrackMaterial(colorHex: string): StandardMaterial {
      const mat = new StandardMaterial("trackMat", this.scene)
      mat.emissiveColor = Color3.FromHexString(colorHex)
      mat.diffuseColor = Color3.Black()
      mat.alpha = 0.6
      mat.wireframe = true
      this.materials.push(mat)
      return mat
  }

  // --- Track: The Neon Helix (Original) ---
  private createHelixTrack(): void {
    const holoMat = this.getTrackMaterial("#00ffff")
    let currentPos = this.currentStartPos.clone()
    let heading = Math.PI

    const addRamp = (width: number, length: number, drop: number, rotY: number) => {
       const incline = Math.atan2(drop, length)
       const meshLen = Math.sqrt(length * length + drop * drop)
       this.addStraightRamp(currentPos, rotY, width, meshLen, incline, holoMat)
       const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
       currentPos = currentPos.add(forward.scale(length))
       currentPos.y -= drop
    }

    addRamp(6, 10, 4, heading)
    heading += Math.PI / 2
    addRamp(4, 8, 1, heading)
    heading -= Math.PI / 1.5
    addRamp(4, 12, 3, heading)

    this.createBasin(currentPos, holoMat)
  }

  // --- Track: The Cyber-Core Descent (New) ---
  private createDescentTrack(): void {
      const coreMat = this.getTrackMaterial("#ff0033")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const dropLen = 15
      const dropIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, coreMat)

      const curve1Radius = 15
      const curve1Angle = Math.PI
      const curve1Incline = (5 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, curve1Radius, curve1Angle, curve1Incline, 6, 3.0, coreMat)
      heading += curve1Angle

      const gapLength = 8
      const gapDrop = 2
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 6, 5, 0, coreMat)

      const corkRadius = 8
      const corkAngle = (270 * Math.PI) / 180
      const corkIncline = (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 6, 1.0, coreMat)
      heading += corkAngle

      this.createBasin(currentPos, coreMat)
  }

  // --- Track: The Quantum Grid ---
  private createQuantumGridTrack(): void {
      const gridMat = this.getTrackMaterial("#00FF00")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      currentPos = this.addStraightRamp(currentPos, heading, 4, 10, 0, gridMat)

      const zigzagWidth = 3
      const zigzagLen = 5
      const zigzagIncline = 0

      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)
      heading -= Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)
      heading += Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)

      const orbitRadius = 6
      const orbitAngle = (270 * Math.PI) / 180
      const orbitIncline = - (5 * Math.PI) / 180
      const orbitWallHeight = 0.5

      currentPos = this.addCurvedRamp(currentPos, heading, orbitRadius, orbitAngle, orbitIncline, zigzagWidth, orbitWallHeight, gridMat)
      heading += orbitAngle

      const gapLength = 4
      const gapDrop = 1
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, gridMat)

      this.createBasin(currentPos, gridMat)
  }

  // --- Track: The Singularity Well ---
  private createSingularityWell(): void {
      const wellMat = this.getTrackMaterial("#9900FF")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const injectLen = 12
      const injectIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, injectLen, injectIncline, wellMat)

      const rimRadius = 14
      const rimAngle = Math.PI
      const rimIncline = (5 * Math.PI) / 180
      const rimBank = - (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, rimRadius, rimAngle, rimIncline, 6, 4.0, wellMat, 20, rimBank)
      heading += rimAngle

      const gapLength = 4
      const gapDrop = 2
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 6, 4, 0, wellMat)

      const diskRadius = 8
      const diskAngle = (270 * Math.PI) / 180
      const diskIncline = (10 * Math.PI) / 180
      const diskBank = - (25 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, diskRadius, diskAngle, diskIncline, 6, 1.0, wellMat, 20, diskBank)
      heading += diskAngle

      this.createBasin(currentPos, wellMat)
  }

  // --- Track: The Glitch Spire ---
  private createGlitchSpireTrack(): void {
      const glitchMat = this.getTrackMaterial("#FF00FF")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const uplinkLen = 15
      const uplinkIncline = - (20 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 4, uplinkLen, uplinkIncline, glitchMat)

      const gapLength = 6
      const gapDrop = 4
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, glitchMat)

      heading += Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)
      heading -= Math.PI / 2
      currentPos = this.addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)

      const spiralRadius = 8
      const spiralAngle = 2 * Math.PI
      const spiralIncline = (10 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 3, 0.5, glitchMat, 30)
      heading += spiralAngle

      this.createBasin(currentPos, glitchMat)
  }

  // --- Track: The Retro-Wave Hills ---
  private createRetroWaveHills(): void {
      const retroMat = this.getTrackMaterial("#FF8800")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      currentPos = this.addStraightRamp(currentPos, heading, 6, 10, 0, retroMat)

      const hillLen = 8
      const rise1Incline = - (15 * Math.PI) / 180
      const fall1Incline = (15 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, rise1Incline, retroMat)
      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, fall1Incline, retroMat)

      const rise2Incline = - (20 * Math.PI) / 180
      const fall2Incline = (20 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, rise2Incline, retroMat)
      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, fall2Incline, retroMat)

      const turnRadius = 12
      const turnAngle = Math.PI
      const turnIncline = 0
      const banking = - (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 6, 2.0, retroMat, 20, banking)
      heading += turnAngle

      const jumpLen = 12
      const jumpIncline = - (25 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 4, jumpLen, jumpIncline, retroMat)

      const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalDist = 15
      const goalHeight = 5

      const goalPos = currentPos.add(jumpForward.scale(goalDist))
      goalPos.y += goalHeight

      this.createBasin(goalPos, retroMat)
  }

  // --- Track: The Chrono-Core ---
  private createChronoCore(): void {
      const chronoMat = this.getTrackMaterial("#FFD700")
      let currentPos = this.currentStartPos.clone()
      const heading = 0

      const entryLen = 10
      const entryIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 5, entryLen, entryIncline, chronoMat)

      const gear1Radius = 8
      const gear1Speed = (30 * Math.PI) / 180
      const gear1AngVel = -gear1Speed

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      currentPos.y -= 1.0
      const gear1Center = currentPos.add(forward.scale(gear1Radius + 1))

      this.createRotatingPlatform(gear1Center, gear1Radius, gear1AngVel, chronoMat)

      currentPos = gear1Center.add(forward.scale(gear1Radius))
      currentPos = this.addStraightRamp(currentPos, heading, 3, 12, 0, chronoMat)

      const gear2Radius = 10
      const gear2Speed = (20 * Math.PI) / 180
      const gear2AngVel = gear2Speed

      const gear2Center = currentPos.add(forward.scale(gear2Radius + 0.5))
      this.createRotatingPlatform(gear2Center, gear2Radius, gear2AngVel, chronoMat, true)

      const goalPos = gear2Center.clone()
      goalPos.y += 4.0

      const jumpRampPos = gear2Center.add(forward.scale(gear2Radius - 2))
      const jumpHeading = heading + Math.PI

      this.addStraightRamp(jumpRampPos, jumpHeading, 4, 4, -(30 * Math.PI)/180, chronoMat)
      this.createBasin(goalPos, chronoMat)
  }

  // --- Track: The Hyper-Drift ---
  private createHyperDriftTrack(): void {
      const driftMat = this.getTrackMaterial("#00FFFF")
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      const launchLen = 15
      const launchIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 8, launchLen, launchIncline, driftMat)

      const alphaRadius = 15
      const alphaAngle = -Math.PI / 2
      const alphaIncline = (5 * Math.PI) / 180
      const alphaBank = (30 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, alphaRadius, alphaAngle, alphaIncline, 8, 2.0, driftMat, 20, alphaBank)
      heading += alphaAngle

      const betaRadius = 15
      const betaAngle = Math.PI / 2
      const betaIncline = (5 * Math.PI) / 180
      const betaBank = -(30 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, betaRadius, betaAngle, betaIncline, 8, 2.0, driftMat, 20, betaBank)
      heading += betaAngle

      const corkRadius = 10
      const corkAngle = 2 * Math.PI
      const corkIncline = (10 * Math.PI) / 180
      const corkBank = -(45 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 8, 2.0, driftMat, 30, corkBank)
      heading += corkAngle

      const jumpLen = 10
      const jumpIncline = -(30 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, jumpLen, jumpIncline, driftMat)

      const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalDist = 15
      const goalHeight = 8

      const goalPos = currentPos.add(jumpForward.scale(goalDist))
      goalPos.y += goalHeight

      this.createBasin(goalPos, driftMat)
  }

  // --- Track: The Pachinko Spire ---
  private createPachinkoSpireTrack(): void {
    const spireMat = this.getTrackMaterial("#FFFFFF") // Silver/Chrome
    let currentPos = this.currentStartPos.clone()
    const heading = 0 // North

    // 1. The Drop Gate
    // 5 units, -45 degrees (Steep Down)
    const dropLen = 5
    const dropIncline = (45 * Math.PI) / 180
    currentPos = this.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, spireMat)

    // 2. The Pin Field (Main Body)
    // 30 units, -75 degrees (Very Steep)
    // Width 12
    const mainLen = 30
    const mainIncline = (75 * Math.PI) / 180
    const mainWidth = 12

    // Capture start of main segment for pin placement
    const mainStartPos = currentPos.clone()

    currentPos = this.addStraightRamp(currentPos, heading, mainWidth, mainLen, mainIncline, spireMat)

    // Helper to calculate position on the ramp surface
    // Forward Vector along the ramp
    const forwardVec = new Vector3(0, -Math.sin(mainIncline), Math.cos(mainIncline))
    // Right Vector
    const rightVec = new Vector3(1, 0, 0)

    // Normal Vector (for pin rotation axis)
    // Ramp Surface Normal = (0, cos(75), sin(75))
    const normalVec = new Vector3(0, Math.cos(mainIncline), Math.sin(mainIncline))

    // Pin Grid Generation
    const pinSpacing = 2.0
    const rows = Math.floor(mainLen / pinSpacing) - 1

    // Need to handle physics manually for pins
    if (this.world) {
        for (let r = 1; r <= rows; r++) {
            const dist = r * pinSpacing
            // Staggered offsets
            const isEven = r % 2 === 0
            const xOffsets = isEven ? [-4, -2, 0, 2, 4] : [-3, -1, 1, 3]

            for (const xOff of xOffsets) {
                // Position on ramp
                const pinPos = mainStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(xOff))
                // Raise slightly so it sits on surface (surface is at pinPos roughly, but box has height 0.5)
                // Box center is at -0.25 (half height) relative to surface? No, addStraightRamp centers box.
                // We should push out by Normal * 0.25 (ramp half height) + Pin Half Height.
                // Pin Height = 0.5?

                const pinHeight = 0.5
                const surfaceOffset = normalVec.scale(0.25 + pinHeight/2)
                const finalPos = pinPos.add(surfaceOffset)

                const pin = MeshBuilder.CreateCylinder("pin", { diameter: 0.3, height: pinHeight }, this.scene)
                pin.position.copyFrom(finalPos)
                // Align rotation with Ramp Normal (Y-up cylinder needs to point along Normal)
                // Default Cylinder is Y-up. We want Y to be Normal.
                // Normal is (0, cos, sin).
                // Rotation Axis: Cross(Y, Normal). Angle: acos(Dot(Y, Normal)).
                // Normal is roughly Z-ish/Y-ish.
                // Or simpler: Rotate X by Incline?
                // Flat Ramp (0 deg): Normal (0,1,0). Cylinder Y (0,1,0). Rot X = 0.
                // Ramp 90 deg: Normal (0,0,1). Cylinder Y needs to be (0,0,1). Rot X = 90.
                // Ramp 75 deg: Rot X = 75.
                pin.rotation.x = mainIncline
                pin.material = spireMat
                this.adventureTrack.push(pin)

                // Physics
                const q = Quaternion.FromEulerAngles(pin.rotation.x, pin.rotation.y, pin.rotation.z)
                const body = this.world.createRigidBody(
                    this.rapier.RigidBodyDesc.fixed()
                        .setTranslation(finalPos.x, finalPos.y, finalPos.z)
                        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                )
                this.world.createCollider(
                    this.rapier.ColliderDesc.cylinder(pinHeight/2, 0.15).setRestitution(0.6),
                    body
                )
                this.adventureBodies.push(body)
            }
        }
    }

    // 3. The Mills (Rotating Platforms)
    // Distance ~15 units down (Halfway)
    const millDist = 15
    const millRadius = 3
    const millOffset = 3.5 // X offset

    const createMill = (xDir: number, speedDir: number) => {
         const posOnRamp = mainStartPos.add(forwardVec.scale(millDist)).add(rightVec.scale(xDir * millOffset))
         // Flush with surface
         const millPos = posOnRamp.add(normalVec.scale(0.1)) // Slightly embedded/flush

         // Visual
         const mill = MeshBuilder.CreateCylinder("mill", { diameter: millRadius*2, height: 0.2 }, this.scene)
         mill.position.copyFrom(millPos)
         mill.rotation.x = mainIncline
         mill.material = spireMat
         this.adventureTrack.push(mill)

         // Physics
         if (this.world) {
             const bodyDesc = this.rapier.RigidBodyDesc.kinematicVelocityBased()
                 .setTranslation(millPos.x, millPos.y, millPos.z)

             // Initial Rotation
             const q = Quaternion.FromEulerAngles(mainIncline, 0, 0)
             bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })

             const body = this.world.createRigidBody(bodyDesc)

             // Angular Velocity: Must be along the local Y axis (Normal)
             // Global AngVel vector
             const angSpeed = 2.0 * speedDir
             const angVel = normalVec.scale(angSpeed)
             body.setAngvel({ x: angVel.x, y: angVel.y, z: angVel.z }, true)

             this.world.createCollider(
                 this.rapier.ColliderDesc.cylinder(0.1, millRadius).setFriction(1.0),
                 body
             )
             this.adventureBodies.push(body)
             this.kinematicBindings.push({ body, mesh: mill })
         }
    }

    createMill(-1, 1) // Left, CW (relative to normal?)
    createMill(1, -1) // Right, CCW

    // 4. Catch Basins
    // At the bottom of the 30 unit ramp.
    const bottomPos = mainStartPos.add(forwardVec.scale(mainLen))
    // Drop down to create a landing zone? Or just place them there.

    const basinY = bottomPos.y - 2
    const basinZ = bottomPos.z

    // Center Goal
    this.createBasin(new Vector3(0, basinY, basinZ), spireMat)

    // Side Resets (Left and Right)
    // Make them look like basins but function as teleporters
    const createResetBasin = (x: number) => {
        const pos = new Vector3(x, basinY, basinZ)

        // 1. Visual & Physical Floor (So ball doesn't ghost through)
        // Use logic similar to createBasin: Solid floor + Walls
        const basin = MeshBuilder.CreateBox("resetBasin", { width: 4, height: 1, depth: 4 }, this.scene)
        basin.position.copyFrom(pos)
        basin.material = spireMat
        this.adventureTrack.push(basin)

        if (this.world) {
            // Solid Floor Body
            const body = this.world.createRigidBody(
                this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
            )
            // Collider must match visual box (Width 4, Height 1, Depth 4)
            this.world.createCollider(
                this.rapier.ColliderDesc.cuboid(2, 0.5, 2),
                body
            )
            this.adventureBodies.push(body)

            // 2. Sensor (Trigger) - Placed just above the floor
            // So when ball lands ON the solid floor, it triggers the sensor.
            const sensorPos = pos.clone()
            sensorPos.y += 0.75 // Just above surface

            const sensorBody = this.world.createRigidBody(
                this.rapier.RigidBodyDesc.fixed().setTranslation(sensorPos.x, sensorPos.y, sensorPos.z)
            )
            this.world.createCollider(
                this.rapier.ColliderDesc.cuboid(1.8, 0.25, 1.8).setSensor(true),
                sensorBody
            )
            this.resetSensors.push(sensorBody)
        }
    }

    createResetBasin(-6)
    createResetBasin(6)
  }

  // --- Track: The Orbital Junkyard ---
  private createOrbitalJunkyardTrack(): void {
      const junkMat = this.getTrackMaterial("#888888") // Grey/Rusty
      let currentPos = this.currentStartPos.clone()
      const heading = 0

      // 1. Launch Tube
      // Length 8, Incline -10 deg, Width 4
      const launchLen = 8
      const launchIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 4, launchLen, launchIncline, junkMat)

      // 2. The Debris Field
      // Length 25, Incline -5 deg, Width 10
      const debrisLen = 25
      const debrisIncline = (5 * Math.PI) / 180
      const debrisWidth = 10

      // Capture start of debris field for object placement
      const debrisStartPos = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, debrisWidth, debrisLen, debrisIncline, junkMat)

      // 3. Debris Objects (Space Junk)
      if (this.world) {
          const debrisCount = 25
          const forwardVec = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
          const rightVec = new Vector3(1, 0, 0)
          const normalVec = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

          for (let i = 0; i < debrisCount; i++) {
              // Random position along the ramp
              // Keep it somewhat centered but messy.
              // Avoid the very start and very end to prevent blocking entry/exit totally.
              const dist = 2 + Math.random() * (debrisLen - 6)
              const offset = (Math.random() - 0.5) * (debrisWidth - 2) // Keep inside walls

              const debrisPosOnSurface = debrisStartPos.add(forwardVec.scale(dist)).add(rightVec.scale(offset))

              // Random Type: Box or Tetrahedron (Polyhedron)
              const type = Math.random() > 0.5 ? 'box' : 'tetra'
              const scale = 0.5 + Math.random() * 1.0 // 0.5 to 1.5

              let mesh: Mesh
              let colliderDesc: RAPIER.ColliderDesc

              // Raise slightly above surface based on scale
              const finalPos = debrisPosOnSurface.add(normalVec.scale(scale * 0.5))

              if (type === 'box') {
                  mesh = MeshBuilder.CreateBox("junkBox", { size: scale }, this.scene)
                  colliderDesc = this.rapier.ColliderDesc.cuboid(scale / 2, scale / 2, scale / 2)
              } else {
                  mesh = MeshBuilder.CreatePolyhedron("junkTetra", { type: 0, size: scale * 0.6 }, this.scene)
                  // Approx collider for tetra - use a ball or small cuboid for simplicity or convex hull if expensive
                  // Using Cuboid for performance stability
                  colliderDesc = this.rapier.ColliderDesc.cuboid(scale / 3, scale / 3, scale / 3)
              }

              mesh.position.copyFrom(finalPos)
              // Random Rotation
              mesh.rotation.x = Math.random() * Math.PI
              mesh.rotation.y = Math.random() * Math.PI
              mesh.rotation.z = Math.random() * Math.PI
              mesh.material = junkMat
              this.adventureTrack.push(mesh)

              const q = Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed()
                      .setTranslation(finalPos.x, finalPos.y, finalPos.z)
                      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
              )
              this.world.createCollider(colliderDesc, body)
              this.adventureBodies.push(body)
          }
      }

      // 4. The Crusher (Choke Point)
      // Two large blocks creating a narrow gap
      // Located near the end of the debris field or just after?
      // "The Crusher (Hazard): ... Two large static blocks creating a narrow 2-unit wide gap"
      // Let's place it at the end of the debris ramp segment, effectively acting as the gate to the goal.

      // We need to add these blocks MANUALLY because addStraightRamp doesn't support custom obstacles inside it easily.
      // We can place them relative to 'currentPos' (which is the end of the debris ramp).
      // Or place them ON the debris ramp near the end.

      // Let's place them just before currentPos.
      const crusherDistFromEnd = 2
      const forwardVec = new Vector3(0, -Math.sin(debrisIncline), Math.cos(debrisIncline))
      const rightVec = new Vector3(1, 0, 0)
      const normalVec = new Vector3(0, Math.cos(debrisIncline), Math.sin(debrisIncline))

      const crusherCenterPos = debrisStartPos.add(forwardVec.scale(debrisLen - crusherDistFromEnd))
      const gapWidth = 2
      const blockWidth = (debrisWidth - gapWidth) / 2 // (10 - 2) / 2 = 4
      const blockHeight = 2
      const blockDepth = 2

      const createCrusherBlock = (direction: number) => { // -1 Left, 1 Right
          const offset = direction * (gapWidth/2 + blockWidth/2) // 1 + 2 = 3
          const pos = crusherCenterPos.add(rightVec.scale(offset)).add(normalVec.scale(blockHeight/2))

          const box = MeshBuilder.CreateBox("crusherBlock", { width: blockWidth, height: blockHeight, depth: blockDepth }, this.scene)
          box.position.copyFrom(pos)
          box.rotation.x = debrisIncline
          box.material = junkMat
          this.adventureTrack.push(box)

          if (this.world) {
               const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, box.rotation.z)
               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed()
                       .setTranslation(pos.x, pos.y, pos.z)
                       .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(blockWidth/2, blockHeight/2, blockDepth/2),
                   body
               )
               this.adventureBodies.push(body)
          }
      }

      createCrusherBlock(-1)
      createCrusherBlock(1)

      // 5. Escape Pod (Goal)
      // Just after the debris ramp ends.
      // currentPos is the end of the debris ramp.
      // Drop slightly into a basin.

      const goalPos = currentPos.clone()
      goalPos.y -= 2 // Drop down
      goalPos.z += 2 // Move forward slightly

      this.createBasin(goalPos, junkMat)
  }

  // --- Track: The Firewall Breach ---
  private createFirewallBreachTrack(): void {
      const wallMat = this.getTrackMaterial("#FF4400") // Orange/Red
      const debrisMat = this.getTrackMaterial("#0088FF") // Cyan/Blue
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. Packet Stream (Launch)
      // Length 20, Incline -25 deg (Steep Drop)
      const launchLen = 20
      const launchIncline = (25 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, wallMat)

      // 2. Security Layer 1 (Debris Field)
      // Flat, Length 15, Width 8
      const debrisLen = 15
      const debrisWidth = 8

      const debrisStartPos = currentPos.clone()
      currentPos = this.addStraightRamp(currentPos, heading, debrisWidth, debrisLen, 0, wallMat)

      // Add Data Blocks (Dynamic Debris)
      // 4x5 grid of small dynamic boxes
      if (this.world) {
          const rows = 5
          const cols = 4
          const spacing = 1.5
          const startX = -(cols - 1) * spacing / 2
          const startZ = 2.0 // Offset from start of ramp

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                  const xOffset = startX + c * spacing
                  const zOffset = startZ + r * spacing

                  const blockPos = debrisStartPos
                      .add(forward.scale(zOffset))
                      .add(right.scale(xOffset))

                  // Raise slightly
                  blockPos.y += 0.5

                  this.createDynamicBlock(blockPos, 1.0, 0.5, debrisMat) // Mass 0.5
              }
          }
      }

      // 3. The Chicane (Filter)
      // S-Bend: 90 Left, 90 Right
      const turnRadius = 10
      const turnAngle = Math.PI / 2

      // Turn Left
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
      heading -= turnAngle

      // Turn Right
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 8, 1.0, wallMat, 15, 0)
      heading += turnAngle

      // 4. Security Layer 2 (The Heavy Wall)
      // Flat, Length 10
      const wallLen = 10
      const wallStartPos = currentPos.clone()
      currentPos = this.addStraightRamp(currentPos, heading, 8, wallLen, 0, wallMat)

      // Add Firewall Panels (Heavy Blocks)
      // 3 large blocks side-by-side
      if (this.world) {
          const blockCount = 3
          const blockSize = 2.5
          const spacing = 2.6
          const startX = -(blockCount - 1) * spacing / 2
          const zOffset = 5.0 // Middle of the ramp

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < blockCount; i++) {
              const xOffset = startX + i * spacing
              const blockPos = wallStartPos
                  .add(forward.scale(zOffset))
                  .add(right.scale(xOffset))

              blockPos.y += blockSize / 2

              this.createDynamicBlock(blockPos, blockSize, 5.0, wallMat) // Mass 5.0
          }
      }

      // 5. Root Access (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, wallMat)
  }

  private createDynamicBlock(pos: Vector3, size: number, mass: number, material: StandardMaterial): void {
      if (!this.world) return

      const box = MeshBuilder.CreateBox("dynBlock", { size }, this.scene)
      box.position.copyFrom(pos)
      box.material = material
      this.adventureTrack.push(box)

      const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)

      const body = this.world.createRigidBody(bodyDesc)

      // Calculate density based on mass and volume to achieve desired mass
      // Volume = size^3
      // Density = Mass / Volume
      const volume = size * size * size
      const density = mass / volume

      this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
            .setDensity(density)
            .setFriction(0.5)
            .setRestitution(0.2),
          body
      )
      this.adventureBodies.push(body)

      // Need to sync this dynamic body to mesh
      // We can reuse the kinematicBindings array since it just maps body->mesh in update()
      // although the name implies kinematic, the update loop logic is generic:
      // "Sync kinematic bodies to visuals... pos = body.translation()..."
      // So checking update():
      /*
        for (const binding of this.kinematicBindings) {
            if (!binding.body || !binding.mesh) continue
            const pos = binding.body.translation()
            ...
        }
      */
      // Yes, this works for dynamic bodies too.
      this.kinematicBindings.push({ body, mesh: box })
  }

  // --- Track: The Prism Pathway ---
  private createPrismPathwayTrack(): void {
      const glassMat = this.getTrackMaterial("#E0FFFF") // Cyan
      const laserMat = this.getTrackMaterial("#FF00FF") // Magenta

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Fiber Injection (Entry)
      // Length 15, Incline -20 deg, Width 4
      const entryLen = 15
      const entryIncline = (20 * Math.PI) / 180 // Down
      currentPos = this.addStraightRamp(currentPos, heading, 4, entryLen, entryIncline, glassMat)

      // 2. The Refractor Field (Obstacles)
      // Flat, Length 20, Width 10. Static Prisms.
      const fieldLen = 20
      const fieldWidth = 10
      const fieldStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, glassMat)

      if (this.world) {
          const prismCount = 5
          const prismHeight = 1.5
          const prismRadius = 0.5 // Diameter 1.0

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < prismCount; i++) {
               // Scatter logic
               const dist = 3 + Math.random() * (fieldLen - 6)
               const offset = (Math.random() - 0.5) * (fieldWidth - 2)

               const pos = fieldStart.add(forward.scale(dist)).add(right.scale(offset))
               pos.y += prismHeight / 2 // Sit on floor (floor y is roughly constant if flat)

               // Prism Mesh
               const prism = MeshBuilder.CreateCylinder("prism", { diameter: prismRadius * 2, height: prismHeight, tessellation: 3 }, this.scene)
               prism.position.copyFrom(pos)
               // Random Rotation
               prism.rotation.y = Math.random() * Math.PI * 2
               prism.material = glassMat // Or maybe separate prism material
               this.adventureTrack.push(prism)

               // Physics
               // Use Convex Hull for accurate triangular collision
               const positions = prism.getVerticesData(VertexBuffer.PositionKind)
               if (positions) {
                   const q = Quaternion.FromEulerAngles(0, prism.rotation.y, 0)
                   const body = this.world.createRigidBody(
                       this.rapier.RigidBodyDesc.fixed()
                           .setTranslation(pos.x, pos.y, pos.z)
                           .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                   )

                   // Convex Hull expects a Float32Array of vertices
                   const vertices = new Float32Array(positions)
                   const hull = this.rapier.ColliderDesc.convexHull(vertices)

                   if (hull) {
                       hull.setRestitution(0.8) // High bounce
                       this.world.createCollider(hull, body)
                       this.adventureBodies.push(body)
                   }
               }
          }
      }

      // 3. The Laser Gauntlet (Hazard)
      // Flat, Length 25, Width 8. Sweeping Lasers.
      const gauntletLen = 25
      const gauntletWidth = 8
      const gauntletStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, gauntletWidth, gauntletLen, 0, glassMat)

      if (this.world) {
          const laserCount = 3
          const laserHeight = 2.0
          const laserRadius = 0.2 // Thin
          const spacing = gauntletLen / (laserCount + 1)

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < laserCount; i++) {
              const dist = spacing * (i + 1)
              const basePos = gauntletStart.add(forward.scale(dist))
              // Center Y
              basePos.y += laserHeight / 2

              // Visual
              const laser = MeshBuilder.CreateCylinder("laser", { diameter: laserRadius * 2, height: laserHeight }, this.scene)
              laser.position.copyFrom(basePos)
              laser.material = laserMat
              // Emissive glow? laserMat is already emissive magenta.
              this.adventureTrack.push(laser)

              // Physics
              // Kinematic Position Based
              const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicPositionBased()
                       .setTranslation(basePos.x, basePos.y, basePos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cylinder(laserHeight/2, laserRadius),
                  body
              )
              this.adventureBodies.push(body)

              // Animation: Side-to-Side
              // Axis is 'right' vector.
              // Amplitude: Width is 8. Half width 4. Keep inside -> Amp 3.0?
              // Frequency: Vary slightly?
              const freq = 1.5 + i * 0.5
              const phase = i * 1.0

              this.animatedObstacles.push({
                  body,
                  mesh: laser,
                  type: 'OSCILLATOR',
                  basePos: basePos,
                  frequency: freq,
                  amplitude: 3.0,
                  phase: phase,
                  axis: right
              })
          }
      }

      // 4. The Spectrum Loop (Vertical)
      // Spiral Up. Radius 8, Angle 360, Incline 10 (Up), Banking 20.
      const loopRadius = 8
      const loopAngle = 2 * Math.PI
      const loopIncline = -(10 * Math.PI) / 180 // Negative for Up in my helper logic (vDrop negative)
      const loopBank = (20 * Math.PI) / 180 // Inward banking? Positive?
                                            // Helper: bankingAngle is rotation.z
                                            // Left turn (heading increases).
                                            // To bank inward (left), we need Z rotation...
                                            // Standard Babylon: +Z rotation rolls CCW around Z.
                                            // If heading is 0 (North), +Z roll tilts Left side Up? No.
                                            // Right Hand Rule on Z axis (pointing South?).
                                            // Let's assume helper handles local banking relative to heading.
                                            // Helper: box.rotation.z = bankingAngle.
                                            // If box is rotated Y by heading.
                                            // Local Z axis is... Forward? No, Box dimensions: Width=X, Height=Y, Depth=Z.
                                            // Wait, addCurvedRamp creates box width=width, height=0.5, depth=chordLen.
                                            // box.rotation.y = heading.
                                            // box.rotation.x = incline.
                                            // box.rotation.z = banking.
                                            // In Babylon, rotation order is usually YXZ or ZXY? Default is YXZ?
                                            // If YXZ: Rotate Y (Heading), then X (Pitch), then Z (Roll).
                                            // Pitch is local X. Roll is local Z.
                                            // Since Depth is Z, Roll around Z axis is "Barrel Roll".
                                            // That's what we want for banking.
                                            // Positive Z roll -> Left side Down, Right side Up? Or CCW.
                                            // Let's stick to positive 20.

      currentPos = this.addCurvedRamp(currentPos, heading, loopRadius, loopAngle, loopIncline, 8, 2.0, glassMat, 30, loopBank)
      heading += loopAngle

      // 5. The White Light (Goal)
      // Bucket at top.
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(forward.scale(4))

      this.createBasin(goalPos, glassMat) // Cyan/White
      // Add a glowing sphere?
      const goalLight = MeshBuilder.CreateSphere("goalLight", { diameter: 2 }, this.scene)
      goalLight.position.copyFrom(goalPos)
      goalLight.position.y += 2
      const whiteMat = this.getTrackMaterial("#FFFFFF")
      goalLight.material = whiteMat
      this.adventureTrack.push(goalLight)
  }

  // --- Track: The Magnetic Storage ---
  private createMagneticStorageTrack(): void {
      const storageMat = this.getTrackMaterial("#222222") // Dark Chrome
      const laserMat = this.getTrackMaterial("#FF0000") // Red

      let currentPos = this.currentStartPos.clone()
      const heading = 0

      // 1. The Write Head (Injection)
      // Length 12, Incline -25 deg, Width 6
      const entryLen = 12
      const entryIncline = (25 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, storageMat)

      // 2. The Platter (Main Stage)
      // Radius 12, CCW 2.5 rad/s, Friction 0.1
      const platterRadius = 12
      const platterSpeed = 2.5 // CCW = Positive Y? usually.

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const platterCenter = currentPos.add(forward.scale(platterRadius + 1))
      // Drop slightly onto it?
      platterCenter.y -= 1.0

      this.createRotatingPlatform(platterCenter, platterRadius, platterSpeed, storageMat)

      // 3. Bad Sectors (Obstacles)
      // 3 Cubes attached to platter.
      if (this.world && this.adventureBodies.length > 0) {
          const platterBody = this.adventureBodies[this.adventureBodies.length - 1]
          const binding = this.kinematicBindings.find(b => b.body === platterBody)

          const positions = [
              { r: 6, angle: 0 },
              { r: 9, angle: (120 * Math.PI) / 180 },
              { r: 4, angle: (240 * Math.PI) / 180 }
          ]

          positions.forEach(p => {
               // Visual
               const size = 2.0
               const box = MeshBuilder.CreateBox("badSector", { size }, this.scene)
               if (binding) {
                   box.parent = binding.mesh
                   const lx = Math.sin(p.angle) * p.r
                   const lz = Math.cos(p.angle) * p.r
                   box.position.set(lx, size/2 + 0.25, lz) // 0.25 is half platform thickness
                   box.rotation.y = p.angle
                   box.material = laserMat
               }

               // Collider
               const lx = Math.sin(p.angle) * p.r
               const lz = Math.cos(p.angle) * p.r
               const colRot = Quaternion.FromEulerAngles(0, p.angle, 0)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(size/2, size/2, size/2)
                       .setTranslation(lx, size/2 + 0.25, lz)
                       .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w }),
                   platterBody
               )
          })
      }

      // 4. The Actuator Arm (Hazard)
      // Pivot Outside. Length 10. Sweep 45 deg.
      const pivotDist = 16
      const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
      // Place to the Left
      const pivotPos = platterCenter.add(right.scale(-pivotDist))
      pivotPos.y += 2.0 // Hover above

      const armLength = 10
      const armWidth = 1.0
      const armHeight = 1.0

      if (this.world) {
          const pivotMesh = MeshBuilder.CreateSphere("actuatorPivot", { diameter: 2 }, this.scene)
          pivotMesh.position.copyFrom(pivotPos)
          pivotMesh.material = storageMat
          this.adventureTrack.push(pivotMesh)

          const armBox = MeshBuilder.CreateBox("actuatorArm", { width: armLength, height: armHeight, depth: armWidth }, this.scene)
          armBox.parent = pivotMesh
          // Arm extends towards center (Right).
          armBox.position.set(armLength/2, 0, 0)
          armBox.material = storageMat

          // Physics Body at Pivot
          const bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
               .setTranslation(pivotPos.x, pivotPos.y, pivotPos.z)
          const body = this.world.createRigidBody(bodyDesc)

          // Collider relative to Body (Pivot)
          // Center at (Length/2, 0, 0)
          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(armLength/2, armHeight/2, armWidth/2)
                  .setTranslation(armLength/2, 0, 0),
              body
          )
          this.adventureBodies.push(body)

          this.animatedObstacles.push({
              body,
              mesh: pivotMesh,
              type: 'ROTATING_OSCILLATOR',
              basePos: pivotPos,
              baseRot: new Quaternion(), // Identity
              frequency: Math.PI, // 0.5 Hz * 2PI
              amplitude: Math.PI / 4,
              phase: 0,
              axis: new Vector3(0, 1, 0)
          })
      }

      // 5. The Data Cache (Goal)
      // 5 units off "West" edge.
      const goalPos = platterCenter.add(right.scale(-platterRadius - 6))
      goalPos.y -= 2.0

      this.createBasin(goalPos, storageMat)
  }

  // --- Track: The Neural Network ---
  private createNeuralNetworkTrack(): void {
      const netMat = this.getTrackMaterial("#FFFFFF") // White
      const veinMat = this.getTrackMaterial("#FF0000") // Red

      let currentPos = this.currentStartPos.clone()
      const heading = 0

      // 1. The Stimulus (Injection)
      // Length 12, Incline -25 deg, Width 6
      const stimLen = 12
      const stimIncline = (25 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, stimLen, stimIncline, netMat)

      // 2. The Axon Terminal (Branching Path)
      const forkStart = currentPos.clone()
      const forkHeading = heading

      // Left Path
      let leftPos = forkStart.clone()
      let leftHeading = forkHeading
      // Curve Left 45
      leftPos = this.addCurvedRamp(leftPos, leftHeading, 10, Math.PI/4, 0, 2, 0, veinMat, 10)
      leftHeading -= Math.PI/4
      // Straight
      leftPos = this.addStraightRamp(leftPos, leftHeading, 2, 5, 0, veinMat)
      // Curve Right 45 (Reconnect direction)
      leftPos = this.addCurvedRamp(leftPos, leftHeading, 10, -Math.PI/4, 0, 2, 0, veinMat, 10)
      leftHeading += Math.PI/4

      // Right Path
      let rightPos = forkStart.clone()
      let rightHeading = forkHeading
      // Curve Right 45
      rightPos = this.addCurvedRamp(rightPos, rightHeading, 10, -Math.PI/4, 0, 6, 1.0, netMat, 10)
      rightHeading += Math.PI/4
      // Straight with Obstacles
      const rightStraightStart = rightPos.clone()
      rightPos = this.addStraightRamp(rightPos, rightHeading, 6, 5, 0, netMat)
      // Add Obstacles (Cell Bodies)
      if (this.world) {
           const rockRadius = 0.5
           const rockPos = rightStraightStart.add(new Vector3(Math.sin(rightHeading), 0, Math.cos(rightHeading)).scale(2.5))
           rockPos.y += 0.5
           const rock = MeshBuilder.CreateSphere("cellBody", { diameter: rockRadius * 2 }, this.scene)
           rock.position.copyFrom(rockPos)
           rock.material = veinMat
           this.adventureTrack.push(rock)
           const body = this.world.createRigidBody(
               this.rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z)
           )
           this.world.createCollider(
               this.rapier.ColliderDesc.ball(rockRadius),
               body
           )
           this.adventureBodies.push(body)
      }
      // Curve Left 45 (Reconnect)
      rightPos = this.addCurvedRamp(rightPos, rightHeading, 10, Math.PI/4, 0, 6, 1.0, netMat, 10)
      rightHeading -= Math.PI/4

      // Converge
      const convergePos = leftPos.add(rightPos).scale(0.5)
      currentPos = convergePos

      // 3. The Synaptic Gap (Hazard)
      const gapLen = 6
      const gapStart = currentPos.clone()
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Move currentPos to other side of gap
      currentPos = currentPos.add(forward.scale(gapLen))

      // Bridge in middle
      if (this.world) {
          const bridgeWidth = 4
          const bridgeLen = 4 // Slightly shorter than gap
          const bridgeHeight = 1.0

          const bridgeCenter = gapStart.add(forward.scale(gapLen / 2))
          // Base Y: Submerged (-2) -> Surface (0)
          const surfaceY = gapStart.y
          const submergedY = surfaceY - 2.0
          const midY = (surfaceY + submergedY) / 2
          const amp = (surfaceY - submergedY) / 2 // 1.0

          const basePos = new Vector3(bridgeCenter.x, midY, bridgeCenter.z) // Center of oscillation

          const box = MeshBuilder.CreateBox("synapseBridge", { width: bridgeWidth, height: bridgeHeight, depth: bridgeLen }, this.scene)
          box.position.copyFrom(basePos)
          box.rotation.y = heading
          box.material = veinMat
          this.adventureTrack.push(box)

          const q = Quaternion.FromEulerAngles(0, heading, 0)
          const body = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.kinematicPositionBased()
                  .setTranslation(basePos.x, basePos.y, basePos.z)
                  .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          )
          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(bridgeWidth/2, bridgeHeight/2, bridgeLen/2),
              body
          )
          this.adventureBodies.push(body)

          this.animatedObstacles.push({
              body,
              mesh: box,
              type: 'PISTON',
              basePos,
              frequency: 2.0, // 1 Hz approx
              amplitude: amp,
              phase: 0
          })
      }

      // 4. The Dendrite Forest (Chicane)
      const forestLen = 20
      const forestWidth = 10
      const forestStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, forestWidth, forestLen, 0, netMat)

      if (this.world) {
          // Damping Zone
          const hLen = forestLen
          const center = forestStart.add(forward.scale(hLen / 2))
          center.y += 0.5

          const sensor = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
          )
          const q = Quaternion.FromEulerAngles(0, heading, 0)
          sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(forestWidth/2, 1, forestLen/2).setSensor(true),
              sensor
          )

          this.dampingZones.push({
              sensor,
              damping: 2.0
          })

          // Cilia Field
          const ciliaCount = 50
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i=0; i<ciliaCount; i++) {
               const dist = Math.random() * (forestLen - 2) + 1
               const offset = (Math.random() - 0.5) * (forestWidth - 1)
               const pos = forestStart.add(forward.scale(dist)).add(right.scale(offset))
               pos.y += 1.0 // Height 2.0, center at 1.0

               const cilia = MeshBuilder.CreateCylinder("cilia", { diameter: 0.2, height: 2.0 }, this.scene)
               cilia.position.copyFrom(pos)
               cilia.material = veinMat
               this.adventureTrack.push(cilia)

               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cylinder(1.0, 0.1),
                   body
               )
               this.adventureBodies.push(body)
          }
      }

      // 5. The Soma (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, netMat)
  }

  // --- Track: The Neon Stronghold ---
  private createNeonStrongholdTrack(): void {
      const stoneMat = this.getTrackMaterial("#2F2F2F") // Dark Stone
      const neonMat = this.getTrackMaterial("#0088FF") // Electric Blue

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Approach
      // Length 15, Incline -10 deg, Width 6
      const approachLen = 15
      const approachIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, approachLen, approachIncline, stoneMat)

      // 2. The Drawbridge (The Moat)
      // Gap Length 6. Target Elevation +2 relative to launch.
      const moatLen = 6
      const jumpHeight = 2.0

      // Visual Water below
      const waterPos = currentPos.clone()
      waterPos.y -= 3.0
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      // Center of water box
      const waterCenter = waterPos.add(forward.scale(moatLen / 2))

      if (this.world) {
           const water = MeshBuilder.CreateBox("moatWater", { width: 10, height: 1, depth: moatLen }, this.scene)
           water.position.copyFrom(waterCenter)
           water.material = neonMat // Holographic water
           this.adventureTrack.push(water)
      }

      // Move currentPos across gap and up
      currentPos = currentPos.add(forward.scale(moatLen))
      currentPos.y += jumpHeight

      // 3. The Gatehouse (Hazards)
      // Flat, Length 18, Width 4.
      const gatehouseLen = 18
      const gatehouseWidth = 4
      const gatehouseStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, gatehouseWidth, gatehouseLen, 0, stoneMat, 2.0)

      // Portcullis Gates
      if (this.world) {
          const gateCount = 3
          const gateSpacing = 4.0 // Spread them out
          const startDist = 3.0

          const gateWidth = gatehouseWidth
          const gateHeight = 3.0
          const gateDepth = 0.5

          for (let i = 0; i < gateCount; i++) {
               const dist = startDist + i * gateSpacing
               const pos = gatehouseStart.add(forward.scale(dist))

               // Center Y Oscillation
               const floorY = pos.y
               const midY = floorY + gateHeight/2 + 1.25
               const amp = 1.25

               const basePos = new Vector3(pos.x, midY, pos.z)

               const gate = MeshBuilder.CreateBox("portcullis", { width: gateWidth, height: gateHeight, depth: gateDepth }, this.scene)
               gate.position.copyFrom(basePos)
               gate.rotation.y = heading
               gate.material = neonMat // Neon Bars
               this.adventureTrack.push(gate)

               const q = Quaternion.FromEulerAngles(0, heading, 0)
               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicPositionBased()
                       .setTranslation(basePos.x, basePos.y, basePos.z)
                       .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(gateWidth/2, gateHeight/2, gateDepth/2),
                   body
               )
               this.adventureBodies.push(body)

               this.animatedObstacles.push({
                   body,
                   mesh: gate,
                   type: 'PISTON',
                   basePos,
                   frequency: 2.0, // 1 Hz
                   amplitude: amp,
                   phase: i * 1.5 // Staggered
               })
          }
      }

      // 4. The Courtyard (Battle)
      // Rotating Platform, Radius 10, 0.5 rad/s.
      const courtRadius = 10
      const courtSpeed = 0.5 // Slow

      const courtCenter = currentPos.add(forward.scale(courtRadius + 1))

      this.createRotatingPlatform(courtCenter, courtRadius, courtSpeed, stoneMat)

      // Turrets (Static on Platform -> Kinematic Children)
      if (this.world && this.adventureBodies.length > 0) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const turretCount = 2
          const turretDist = 6.0

          for (let i = 0; i < turretCount; i++) {
              const angle = i * Math.PI // Opposite sides

              const turretHeight = 2.0
              const turretRadius = 1.0

              // Visual
              const turret = MeshBuilder.CreateCylinder("turret", { diameter: turretRadius*2, height: turretHeight }, this.scene)

              const binding = this.kinematicBindings.find(b => b.body === platformBody)
              if (binding) {
                  turret.parent = binding.mesh
                  const cx = Math.sin(angle) * turretDist
                  const cz = Math.cos(angle) * turretDist

                  turret.position.set(cx, turretHeight/2 + 0.25, cz)
                  turret.material = neonMat

                  // Collider
                  const colliderDesc = this.rapier.ColliderDesc.cylinder(turretHeight/2, turretRadius)
                      .setTranslation(cx, turretHeight/2 + 0.25, cz)

                  this.world.createCollider(colliderDesc, platformBody)
              }
          }
      }

      // 5. The Keep (Ascent)
      // Curved Ramp, Radius 8, Angle 270, Incline 20 (Up).
      const keepRadius = 8
      const keepAngle = (270 * Math.PI) / 180
      const keepIncline = -(20 * Math.PI) / 180 // Up

      // Start Keep ramp from edge of courtyard
      const keepStart = courtCenter.add(forward.scale(courtRadius + 1))
      currentPos = keepStart
      // Heading is still 0 (North)

      currentPos = this.addCurvedRamp(currentPos, heading, keepRadius, keepAngle, keepIncline, 6, 2.0, stoneMat, 20)
      heading += keepAngle

      // 6. The Throne (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 1 // Basin floor
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const finalGoalPos = goalPos.add(goalForward.scale(4))

      this.createBasin(finalGoalPos, neonMat)
  }

  // --- Track: The Casino Heist ---
  private createCasinoHeistTrack(): void {
      const feltMat = this.getTrackMaterial("#880000") // Dark Red
      const goldMat = this.getTrackMaterial("#FFD700") // Gold
      const chipMatRed = this.getTrackMaterial("#FF0000")
      const chipMatBlue = this.getTrackMaterial("#0000FF")
      const chipMatBlack = this.getTrackMaterial("#111111")
      const chipMatWhite = this.getTrackMaterial("#FFFFFF")
      const chipMats = [chipMatRed, chipMatBlue, chipMatBlack, chipMatWhite]

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The High Roller (Entry)
      // Length 15, Incline -15 deg, Width 8
      const entryLen = 15
      const entryIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, feltMat)

      // 2. The Chip Stack Maze (Obstacles)
      // Flat, Length 20, Width 12
      const mazeLen = 20
      const mazeWidth = 12
      const mazeStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, mazeWidth, mazeLen, 0, feltMat)

      if (this.world) {
          const chipCount = 15
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < chipCount; i++) {
              const dist = 2 + Math.random() * (mazeLen - 4)
              const offset = (Math.random() - 0.5) * (mazeWidth - 2)

              const pos = mazeStart.add(forward.scale(dist)).add(right.scale(offset))
              // Stack height? "Stacks". Let's vary height.
              const stackHeight = 0.5 + Math.random() * 1.5
              const chipRadius = 1.0

              pos.y += stackHeight / 2 // Sit on floor

              const chip = MeshBuilder.CreateCylinder("pokerChip", { diameter: chipRadius * 2, height: stackHeight }, this.scene)
              chip.position.copyFrom(pos)
              chip.material = chipMats[Math.floor(Math.random() * chipMats.length)]
              this.adventureTrack.push(chip)

              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cylinder(stackHeight / 2, chipRadius).setRestitution(0.8),
                  body
              )
              this.adventureBodies.push(body)
          }
      }

      // 3. The Roulette Wheel (Hazard)
      // Rotating Platform, Radius 12, Speed Variable (1.5 rad/s)
      const wheelRadius = 12
      const wheelSpeed = 1.5 // CCW

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const wheelCenter = currentPos.add(forward.scale(wheelRadius + 1))

      this.createRotatingPlatform(wheelCenter, wheelRadius, wheelSpeed, feltMat)

      // Zero Pockets (Sensors)
      // 2 Gaps. Attached to platform via separate kinematic body with same velocity
      if (this.world) {
          const pocketCount = 2
          const pocketAngleStep = Math.PI // 180 degrees apart

          // Create a kinematic body for sensors that mimics the platform rotation
          const sensorBodyDesc = this.rapier.RigidBodyDesc.kinematicVelocityBased()
              .setTranslation(wheelCenter.x, wheelCenter.y, wheelCenter.z)
          const sensorBody = this.world.createRigidBody(sensorBodyDesc)
          sensorBody.setAngvel({ x: 0, y: wheelSpeed, z: 0 }, true)

          this.resetSensors.push(sensorBody)
          this.adventureBodies.push(sensorBody)

          // Add sensor shapes
          for (let i = 0; i < pocketCount; i++) {
              const angle = i * pocketAngleStep
              const r = wheelRadius * 0.7 // Mid-radius

              const lx = Math.sin(angle) * r
              const lz = Math.cos(angle) * r

              const sensorShape = this.rapier.ColliderDesc.cylinder(0.5, 1.0)
                  .setTranslation(lx, 0.5, lz)
                  .setSensor(true)

              this.world.createCollider(sensorShape, sensorBody)

              // Visual Marker
              const marker = MeshBuilder.CreateCylinder("zeroPocket", { diameter: 2, height: 0.1 }, this.scene)
              // We need to parent this to the platform mesh to rotate visually
              // The platform mesh is the last one in kinematicBindings
              if (this.kinematicBindings.length > 0) {
                  const platformBinding = this.kinematicBindings[this.kinematicBindings.length - 1]
                  marker.parent = platformBinding.mesh
                  marker.position.set(lx, 0.55, lz)
                  marker.material = chipMatBlack
              }
          }
      }

      // 4. The Slots (Chicane)
      // Length 12, Width 8
      // 3 Kinematic Walls (Reel Gates).
      const slotLen = 12
      const slotWidth = 8

      const wheelExit = wheelCenter.add(forward.scale(wheelRadius + 1))
      currentPos = wheelExit
      const slotStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, slotWidth, slotLen, 0, feltMat)

      if (this.world) {
          const gateCount = 3
          const gateWidth = slotWidth
          const gateHeight = 4.0
          const gateDepth = 0.5
          const spacing = 3.0

          for (let i = 0; i < gateCount; i++) {
               const dist = 2.0 + i * spacing
               const pos = slotStart.add(forward.scale(dist))

               // Random motion
               const amp = 2.5
               const phase = Math.random() * Math.PI * 2
               const freq = 1.0 + Math.random() // Random speed

               const floorY = pos.y
               const basePos = new Vector3(pos.x, floorY, pos.z)

               const gate = MeshBuilder.CreateBox("slotGate", { width: gateWidth, height: gateHeight, depth: gateDepth }, this.scene)
               gate.position.copyFrom(basePos)
               gate.rotation.y = heading
               gate.material = goldMat
               this.adventureTrack.push(gate)

               const q = Quaternion.FromEulerAngles(0, heading, 0)
               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicPositionBased()
                       .setTranslation(basePos.x, basePos.y, basePos.z)
                       .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(gateWidth/2, gateHeight/2, gateDepth/2),
                   body
               )
               this.adventureBodies.push(body)

               this.animatedObstacles.push({
                   body,
                   mesh: gate,
                   type: 'PISTON',
                   basePos,
                   frequency: freq * 3.0,
                   amplitude: amp,
                   phase
               })
          }
      }

      // 5. The Vault (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, goldMat)
  }

  // --- Primitive Builders ---

  /**
   * Creates a straight ramp segment.
   * @param startPos Start position (top center of the start edge)
   * @param heading Y Rotation (direction)
   * @param width Width of the ramp
   * @param length Length of the mesh (Hypotenuse)
   * @param inclineRad Angle of slope in radians (Positive = Downward slope)
   * @param material Material
   * @returns End position of the segment
   */
  private addStraightRamp(
      startPos: Vector3,
      heading: number,
      width: number,
      length: number,
      inclineRad: number,
      material: StandardMaterial,
      wallHeight: number = 0,
      friction: number = 0.5
  ): Vector3 {
      if (!this.world) return startPos

      const box = MeshBuilder.CreateBox("straightRamp", { width, height: 0.5, depth: length }, this.scene)

      // Calculate Horizontal and Vertical components
      const hLen = length * Math.cos(inclineRad)
      const vDrop = length * Math.sin(inclineRad)

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Center of the box
      // Move half the horizontal distance forward, and half the vertical drop down
      const center = startPos.add(forward.scale(hLen / 2))
      center.y -= vDrop / 2
      
      box.position.copyFrom(center)
      box.rotation.y = heading
      box.rotation.x = inclineRad // Babylon +X rotation tilts the nose down/up depending on orientation.
      
      box.material = material
      this.adventureTrack.push(box)
      
      // Physics
      const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, 0)
      const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed()
              .setTranslation(center.x, center.y, center.z)
              .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )
      this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(width / 2, 0.25, length / 2).setFriction(friction),
          body
      )
      this.adventureBodies.push(body)

      if (wallHeight > 0) {
          this.createWall(center, heading, length, width, wallHeight, inclineRad, material, friction)
      }

      // Return End Position
      const endPos = startPos.add(forward.scale(hLen))
      endPos.y -= vDrop
      return endPos
  }

  private addCurvedRamp(
      startPos: Vector3,
      startHeading: number,
      radius: number,
      totalAngle: number,
      inclineRad: number,
      width: number,
      wallHeight: number,
      material: StandardMaterial,
      segments: number = 20,
      bankingAngle: number = 0,
      friction: number = 0.5
  ): Vector3 {
      if (!this.world) return startPos

      const segmentAngle = totalAngle / segments
      const arcLength = radius * Math.abs(segmentAngle)
      const chordLen = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2)
      const segmentDrop = arcLength * Math.sin(inclineRad)

      let currentHeading = startHeading
      let currentP = startPos.clone()

      for (let i = 0; i < Math.abs(segments); i++) {
          currentHeading += (segmentAngle / 2)

          const forward = new Vector3(Math.sin(currentHeading), 0, Math.cos(currentHeading))
          const center = currentP.add(forward.scale(chordLen / 2))
          center.y -= segmentDrop / 2

          const box = MeshBuilder.CreateBox("curveSeg", { width, height: 0.5, depth: chordLen }, this.scene)
          box.position.copyFrom(center)

          box.rotation.x = inclineRad
          box.rotation.y = currentHeading
          box.rotation.z = bankingAngle

          box.material = material
          this.adventureTrack.push(box)

          const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, box.rotation.z)
          const body = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed()
                  .setTranslation(center.x, center.y, center.z)
                  .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          )
          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(width / 2, 0.25, chordLen / 2).setFriction(friction),
              body
          )
          this.adventureBodies.push(body)

          if (wallHeight > 0) {
              this.createWall(center, currentHeading, chordLen, width, wallHeight, inclineRad, material, friction)
          }

          currentP = currentP.add(forward.scale(chordLen))
          currentP.y -= segmentDrop

          currentHeading += (segmentAngle / 2)
      }

      return currentP
  }

  private createWall(
      center: Vector3,
      heading: number,
      length: number,
      trackWidth: number,
      height: number,
      inclineRad: number,
      mat: StandardMaterial,
      friction: number = 0.5
  ) {
      if (!this.world) return

      const offsets = [trackWidth / 2 + 0.25, -trackWidth / 2 - 0.25]

      offsets.forEach(offset => {
          const wall = MeshBuilder.CreateBox("wall", { width: 0.5, height: height, depth: length }, this.scene)

          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
          const wallPos = center.add(right.scale(offset))
          wallPos.y += height / 2

          wall.position.copyFrom(wallPos)
          wall.rotation.y = heading
          wall.rotation.x = inclineRad
          wall.material = mat
          this.adventureTrack.push(wall)

          const q = Quaternion.FromEulerAngles(wall.rotation.x, wall.rotation.y, 0)
          const body = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed()
                  .setTranslation(wallPos.x, wallPos.y, wallPos.z)
                  .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          )
          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(0.25, height / 2, length / 2).setFriction(friction),
              body
          )
          this.adventureBodies.push(body)
      })
  }

  private createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: StandardMaterial,
    hasTeeth: boolean = false
  ): void {
      if (!this.world) return

      const thickness = 0.5
      const cylinder = MeshBuilder.CreateCylinder("gear", { diameter: radius * 2, height: thickness, tessellation: 32 }, this.scene)
      cylinder.position.copyFrom(center)
      cylinder.material = material
      this.adventureTrack.push(cylinder)

      const bodyDesc = this.rapier.RigidBodyDesc.kinematicVelocityBased()
          .setTranslation(center.x, center.y, center.z)

      const body = this.world.createRigidBody(bodyDesc)
      body.setAngvel({ x: 0, y: angVelY, z: 0 }, true)

      const colliderDesc = this.rapier.ColliderDesc.cylinder(thickness / 2, radius)
          .setFriction(1.0)

      this.world.createCollider(colliderDesc, body)
      this.adventureBodies.push(body)

      this.kinematicBindings.push({ body, mesh: cylinder })

      if (hasTeeth) {
        const toothCount = 12
        const angleStep = (2 * Math.PI) / toothCount

        for (let i = 0; i < toothCount; i++) {
             if (i % 2 !== 0) continue

             const angle = i * angleStep
             const tx = Math.sin(angle) * (radius - 0.25)
             const tz = Math.cos(angle) * (radius - 0.25)

             const toothCollider = this.rapier.ColliderDesc.cuboid(0.5, 0.5, 1.0)
                 .setTranslation(tx, 0.5 + 0.25, tz)
                 .setRotation( { w: Math.cos(angle/2), x: 0, y: Math.sin(angle/2), z: 0 } )

             this.world.createCollider(toothCollider, body)

             const tooth = MeshBuilder.CreateBox("tooth", { width: 1, height: 1, depth: 2 }, this.scene)
             tooth.parent = cylinder
             tooth.position.set(tx, 0.5 + 0.25, tz)
             tooth.rotation.y = angle
             tooth.material = material
        }
      }
  }

  private createBasin(pos: Vector3, material: StandardMaterial): void {
    if (!this.world) return

    const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 8 }, this.scene)
    basin.position.set(pos.x, pos.y - 1, pos.z)
    basin.material = material
    this.adventureTrack.push(basin)

    const bBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y - 1, pos.z)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(4, 0.5, 4), bBody)
    this.adventureBodies.push(bBody)

    // Exit Sensor
    const sensorY = pos.y - 0.5
    const sensor = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, sensorY, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(2, 1, 1)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      sensor
    )
    this.adventureSensor = sensor
  }

  // --- Track: The CPU Core ---
  private createCpuCoreTrack(): void {
      // Colors: PCB Green and Gold Traces
      const pcbMat = this.getTrackMaterial("#004400") // Dark Green
      const traceMat = this.getTrackMaterial("#FFD700") // Gold
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Front Side Bus (Entry)
      // Flat, Wide (6), Length 15
      const entryLen = 15
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, 0, pcbMat)

      // 2. The Logic Gate (Chicane)
      // Narrow (3), Zig-Zag
      const gateWidth = 3
      const gateLen = 5

      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

      // Left 90
      heading -= Math.PI / 2
      // Because we turned 90 degrees abruptly, we need to adjust start pos for the next ramp
      // addStraightRamp starts from 'currentPos'. If we turn, we continue from that point.
      // But visually, a sharp turn might look weird without a corner piece.
      // addStraightRamp returns the END of the segment.
      // If we simply rotate heading, the next segment starts from the end of previous one, but rotated.
      // That works for sharp turns.

      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

      // Right 90 (Back to original heading)
      heading += Math.PI / 2
      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, gateWidth, gateLen, 0, traceMat)

      // 3. The Heatsink (Hazard)
      // Rotating Platform, Radius 8, Fast (90 deg/sec)
      // Needs Fan Blades
      const fanRadius = 8
      const fanSpeed = 1.5 // Radians/sec (~86 deg/sec)

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Drop slightly or stay flat? Plan says flat.
      // Move center forward so we land on the edge
      const fanCenter = currentPos.add(forward.scale(fanRadius + 1))

      // We need to implement a custom rotating platform with blades
      // Reuse createRotatingPlatform but add blade logic?
      // Or just write it here custom.

      this.createRotatingPlatform(fanCenter, fanRadius, -fanSpeed, pcbMat, false) // Base

      // Add Fan Blades separately attached to the same kinematic body?
      // createRotatingPlatform creates a body. We can't easily attach more colliders to it from outside without modifying it.
      // Let's modify createRotatingPlatform to support "Fan Blades" or do it manually here.

      // Manual implementation for Heatsink Fan
      if (this.world) {
          // We already created the base platform above.
          // Let's find the last body added (which is the platform)
          const fanBody = this.adventureBodies[this.adventureBodies.length - 1]

          // Add 4 Blades
          const bladeCount = 4
          const bladeLength = fanRadius - 1
          const bladeHeight = 1.5
          const bladeThickness = 0.5

          for (let i = 0; i < bladeCount; i++) {
              const angle = (i * Math.PI * 2) / bladeCount

              // Visual Blade
              const blade = MeshBuilder.CreateBox("fanBlade", { width: bladeThickness, height: bladeHeight, depth: bladeLength }, this.scene)
              // Position relative to center?
              // We need to parent it to the visual mesh of the platform?
              // The platform mesh is in this.kinematicBindings
              const binding = this.kinematicBindings.find(b => b.body === fanBody)
              if (binding) {
                  blade.parent = binding.mesh
                  // Local position: Offset from center
                  blade.position.set(0, bladeHeight/2, bladeLength/2)
                  // Rotate around Y center?
                  // We want them radiating out.
                  // If we set position to (0,0, L/2) and then rotate the PARENT (Pivot), that works.
                  // But here we are attaching to the spinning platform.

                  // Easier: Create the blade at the correct local position/rotation
                  // TransformNode as pivot?
                  // Babylon parenting handles visual rotation.

                  // Local position:
                  const r = bladeLength / 2
                  const lx = Math.sin(angle) * r
                  const lz = Math.cos(angle) * r

                  blade.position.set(lx, bladeHeight/2, lz)
                  blade.rotation.y = angle
                  blade.material = traceMat

                  // Physics Collider
                  // Must be attached to the kinematic body
                  // Collider Position is Relative to Body Center (which is fanCenter)
                  // So we use the same offsets as visual

                  const colRot = Quaternion.FromEulerAngles(0, angle, 0)

                  const colliderDesc = this.rapier.ColliderDesc.cuboid(bladeThickness/2, bladeHeight/2, bladeLength/2)
                      .setTranslation(lx, bladeHeight/2 + 0.25, lz) // +0.25 for half platform thickness
                      .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

                  this.world.createCollider(colliderDesc, fanBody)
              }
          }
      }

      // 4. The Thermal Bridge
      // Narrow (2), Length 10
      // Connects from fan edge to goal

      // Current logical position is fanCenter.
      // We need to start the bridge at the far edge of the fan.
      const bridgeStart = fanCenter.add(forward.scale(fanRadius))
      const bridgeLen = 10
      const bridgeWidth = 2.0

      // Update currentPos to bridgeStart
      // addStraightRamp calculates center based on startPos.
      const bridgeEnd = this.addStraightRamp(bridgeStart, heading, bridgeWidth, bridgeLen, 0, traceMat)

      // 5. The Processor Die (Goal)
      const goalPos = bridgeEnd.clone()
      goalPos.z += 4 // Move into basin
      // goalPos.y -= 1 // Drop slightly?

      this.createBasin(goalPos, pcbMat)

      // Visual: CPU Socket?
      const socket = MeshBuilder.CreateBox("cpuSocket", { width: 4, height: 0.2, depth: 4 }, this.scene)
      socket.position.copyFrom(goalPos)
      socket.position.y += 0.5 // Sit on floor
      socket.material = traceMat
      this.adventureTrack.push(socket)
  }

  // --- Track: The Cryo-Chamber ---
  private createCryoChamberTrack(): void {
      const iceMat = this.getTrackMaterial("#A5F2F3") // Ice Blue
      const pillarMat = this.getTrackMaterial("#FFFFFF") // White/Ice
      let currentPos = this.currentStartPos.clone()
      let heading = 0
      const iceFriction = 0.001 // Frictionless

      // 1. Flash Freeze (Entry)
      // Length 15, Incline -20 deg, Width 6, Friction 0.0
      const entryLen = 15
      const entryIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, iceMat, 1.0, iceFriction)

      // 2. The Slalom (Chicane)
      // Curved Ramp x 3. Left 45 -> Right 90 -> Left 45. Radius 10.
      const slalomRadius = 10
      const turn45 = Math.PI / 4
      const turn90 = Math.PI / 2

      // Part 1: Left 45
      currentPos = this.addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
      heading -= turn45
      // Pillar at Apex (Start of next?)
      this.createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)

      // Part 2: Right 90
      currentPos = this.addCurvedRamp(currentPos, heading, slalomRadius, turn90, 0, 8, 1.0, iceMat, 15, 0, iceFriction)
      heading += turn90
      // Pillar at Apex
      this.createStaticCylinder(currentPos, 1.0, 3.0, pillarMat)

      // Part 3: Left 45
      currentPos = this.addCurvedRamp(currentPos, heading, slalomRadius, -turn45, 0, 8, 1.0, iceMat, 10, 0, iceFriction)
      heading -= turn45

      // 3. The Ice Bridge (Hazard)
      // Straight, Length 12, Width 2.5, WallHeight 0.0
      const bridgeLen = 12
      const bridgeWidth = 2.5
      currentPos = this.addStraightRamp(currentPos, heading, bridgeWidth, bridgeLen, 0, iceMat, 0.0, iceFriction)

      // 4. The Avalanche (Descent)
      // Curved Ramp, Radius 10, Angle 180, Incline -15 deg, Banking -20 deg (Inward)
      const avRadius = 10
      const avAngle = Math.PI
      const avIncline = (15 * Math.PI) / 180
      const avBank = -(20 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, avRadius, avAngle, avIncline, 8, 2.0, iceMat, 20, avBank, iceFriction)
      heading += avAngle

      // 5. Absolute Zero (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2
      this.createBasin(goalPos, iceMat)
  }

  private createStaticCylinder(pos: Vector3, diameter: number, height: number, material: StandardMaterial): void {
      if (!this.world) return

      const mesh = MeshBuilder.CreateCylinder("staticPillar", { diameter, height }, this.scene)
      mesh.position.copyFrom(pos)
      mesh.position.y += height / 2 // Sit on floor (approx)
      mesh.material = material
      this.adventureTrack.push(mesh)

      const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      )
      this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(height / 2, diameter / 2),
          body
      )
      this.adventureBodies.push(body)
  }

  // --- Track: The Bio-Hazard Lab ---
  private createBioHazardLabTrack(): void {
      const hazardMat = this.getTrackMaterial("#39FF14") // Lime Green
      const warningMat = this.getTrackMaterial("#FFFF00") // Yellow
      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Sludge Chute (Entry)
      // Length 15, Incline -20 deg, Width 6, Friction 0.1
      const chuteLen = 15
      const chuteIncline = (20 * Math.PI) / 180
      const sludgeFriction = 0.1

      // WallHeight 0.5 to keep ball in initially
      currentPos = this.addStraightRamp(currentPos, heading, 6, chuteLen, chuteIncline, hazardMat, 1.0, sludgeFriction)

      // 2. The Centrifuge (Hazard)
      // Radius 10, Rotation CCW 3.0 rad/s
      const centrifugeRadius = 10
      const centrifugeSpeed = 3.0 // Rad/s

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

      // Move center so we enter tangentially or radially?
      // Usually ramp leads to edge.
      // Let's drop the ball onto the edge.
      const centrifugeCenter = currentPos.add(forward.scale(centrifugeRadius + 1))
      centrifugeCenter.y -= 2.0 // Drop into it

      // Create Platform
      this.createRotatingPlatform(centrifugeCenter, centrifugeRadius, centrifugeSpeed, hazardMat)

      // Add Containment Wall (Rotating with platform)
      // We need to access the body created by createRotatingPlatform to attach the wall collider
      // It's the last added body.
      if (this.world && this.adventureBodies.length > 0) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const wallHeight = 0.5
          const wallThickness = 0.5

          // Visual Wall (Tube)
          // Actually, let's use a Tube describing the ring, or just a cylinder with hollow logic?
          // Simplest is a Cylinder with 'arc' but we need 360.
          // Let's use CreateTorus
          const torus = MeshBuilder.CreateTorus("centrifugeWall", {
              diameter: centrifugeRadius * 2,
              thickness: wallThickness,
              tessellation: 32
          }, this.scene)

          // Torus is created lying flat? No, usually standing.
          // We need it flat.

          // But wait, parenting to the kinematic mesh (cylinder)
          const binding = this.kinematicBindings.find(b => b.body === platformBody)
          if (binding) {
             torus.parent = binding.mesh
             torus.position.set(0, wallHeight/2, 0)
             torus.material = warningMat

             // The collider needs to be a hollow cylinder or multiple cuboids approximating a ring.
             // Rapier doesn't have a hollow cylinder collider.
             // We must use compound cuboids.
             const segments = 16
             const angleStep = (Math.PI * 2) / segments

             for (let i=0; i<segments; i++) {
                 const angle = i * angleStep
                 const cx = Math.sin(angle) * centrifugeRadius
                 const cz = Math.cos(angle) * centrifugeRadius

                 const colRot = Quaternion.FromEulerAngles(0, angle, 0)

                 // Arc length approx = radius * step
                 const arcLen = centrifugeRadius * angleStep

                 const colliderDesc = this.rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, arcLen/2 + 0.2) // +0.2 overlap
                    .setTranslation(cx, wallHeight/2 + 0.25, cz) // +0.25 relative to platform center (floor is 0.5 thick)
                    .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

                 this.world.createCollider(colliderDesc, platformBody)
             }
          }
      }

      // Update currentPos to exit the centrifuge
      // We entered at 'entry' (approx). We exit at 'exit'.
      // Let's say we exit 180 degrees from entry? Or 90?
      // Since it's spinning fast CCW, ball will be flung out.
      // We need a gap in the wall? "Outer rim wall is only 0.5 units high. High speed risks flying over."
      // The intention is the ball FLIES OVER the wall due to centripetal force.
      // So we place the next track section slightly lower and outward.

      const exitDir = heading // Continue straight?
      // Or maybe to the right?
      // Let's continue forward.
      const exitForward = new Vector3(Math.sin(exitDir), 0, Math.cos(exitDir))
      const exitPos = centrifugeCenter.add(exitForward.scale(centrifugeRadius + 2))
      exitPos.y -= 1.0 // Drop

      currentPos = exitPos

      // 3. The Pipeline (Tunnel)
      // Length 12, Width 2.5, WallHeight 4.0, Incline 0
      const pipeLen = 12
      const pipeWidth = 2.5
      const pipeHeight = 4.0

      // Add a catch basin/funnel to ensure ball enters pipe?
      // Or just a wider entry ramp.
      // Let's add a small funnel ramp first.
      currentPos = this.addStraightRamp(currentPos, heading, 6, 4, 0, warningMat, 2.0)

      currentPos = this.addStraightRamp(currentPos, heading, pipeWidth, pipeLen, 0, hazardMat, pipeHeight)

      // 4. The Mixing Vats (Chicane)
      // S-Bend: 90 Left, 90 Right. Radius 8. Gaps.
      const turnRadius = 8
      const turnAngle = Math.PI / 2

      // Turn Left 90
      // Split into 2 segments with gap
      // 45 deg -> Gap -> 45 deg
      const halfAngle = turnAngle / 2

      // Part 1
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading -= halfAngle

      // GAP
      const gapLen = 2.0
      // Visual Gap: Just move currentPos
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      // Tangent is perpendicular to radius... addCurvedRamp returns end pos.
      // Heading is updated to tangent at end.
      currentPos = currentPos.add(gapForward.scale(gapLen))

      // Part 2
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, -halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading -= halfAngle

      // Straight buffer
      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, warningMat)

      // Turn Right 90
      // Part 1
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading += halfAngle

      // GAP
      const gapForward2 = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      currentPos = currentPos.add(gapForward2.scale(gapLen))

      // Part 2
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, halfAngle, 0, 4, 1.0, hazardMat, 10, 0, 0.1)
      heading += halfAngle

      // 5. Containment Unit (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, hazardMat)
  }

  // --- Track: The Gravity Forge ---
  private createGravityForgeTrack(): void {
      const rustMat = this.getTrackMaterial("#8B4513") // Rust
      const steelMat = this.getTrackMaterial("#333333") // Dark Steel
      const moltenMat = this.getTrackMaterial("#FF4500") // Molten Orange

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Feed Chute (Entry)
      // Length 12, Incline -30 deg, Width 6
      const feedLen = 12
      const feedIncline = (30 * Math.PI) / 180

      // Save start pos of conveyor for sensor
      const conveyorStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, 6, feedLen, feedIncline, rustMat)

      // Add Conveyor Sensor logic
      // It covers the ramp area.
      // We can use a sensor box rotated to match the ramp.
      if (this.world) {
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          // Calculate center of ramp (same logic as addStraightRamp)
          const hLen = feedLen * Math.cos(feedIncline)
          const vDrop = feedLen * Math.sin(feedIncline)
          const center = conveyorStart.add(forward.scale(hLen / 2))
          center.y -= vDrop / 2

          // Raise slightly so ball is inside
          center.y += 0.5

          const sensorBody = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed()
                  .setTranslation(center.x, center.y, center.z)
          )
          // Rotation matches ramp
          const q = Quaternion.FromEulerAngles(feedIncline, heading, 0)
          sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(3, 1, feedLen / 2).setSensor(true),
              sensorBody
          )

          // Force Vector: +5.0 Z (Relative to ramp forward)
          // Ramp Forward is (0, -sin, cos) in local space if inclining down?
          // Wait, addStraightRamp rotates X by incline.
          // In Local space, forward is Z+.
          // We want to push the ball DOWN the ramp.
          // Force should be applied in World Space or Local? applyImpulse takes World Space.
          // We need World Vector matching Ramp Forward.
          // Ramp Rotation Quaternion q.
          // Local Forward (0,0,1) rotated by q.

          // Force should be applied in World Space.
          // The ramp heads in `heading` (Y rotation) and pitches down by `feedIncline` (X rotation).
          // World Forward:
          // x = sin(heading) * cos(incline)
          // y = -sin(incline)
          // z = cos(heading) * cos(incline)

          const forceDir = new Vector3(
              Math.sin(heading) * Math.cos(feedIncline),
              -Math.sin(feedIncline),
              Math.cos(heading) * Math.cos(feedIncline)
          )

          this.conveyorZones.push({
              sensor: sensorBody,
              force: forceDir.scale(50.0) // Force 5.0 * 10? Plan says "Force +5.0". But impulse needs to be noticeable.
                                          // 5.0 N force on 1kg ball is 5 m/s^2 accel.
                                          // At 60fps (dt 0.016), dv = 5 * 0.016 = 0.08 m/s per frame.
                                          // Over 1 second, adds 5 m/s. Seems correct for a conveyor.
                                          // If I use 50, it's 50 m/s^2. VERY fast.
                                          // Let's stick to 25.0 to be safe/strong.
          })
      }

      // 2. The Crusher Line (Hazard)
      // Flat, Length 20, Width 8
      const crushLen = 20
      const crushWidth = 8

      // Save start pos for pistons
      const crushStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, crushWidth, crushLen, 0, steelMat)

      // Add 3 Hydraulic Pistons
      // Box: Width 6, Depth 3, Height 4
      // Sinusoidal Y.
      if (this.world) {
          const pistonWidth = 6
          const pistonDepth = 3
          const pistonHeight = 4

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

          // Staggered: 0.0, 1.5, 3.0 sec offsets. Freq 1.0 Hz.
          // Locations: distributed along the 20 length.
          // Let's place them at 5, 10, 15 units from start.

          const positions = [5, 10, 15]
          const phases = [0, 1.5, 3.0] // Phase in Radians? Or Seconds? Plan says "offsets". Sin(t * freq). offset is phase shift.
                                       // If freq is 1.0 (2PI rad/s?), then 1.5s is ~1.5 cycles?
                                       // Let's treat them as phase addends.

          for (let i = 0; i < 3; i++) {
              const dist = positions[i]
              const pistonPos = crushStart.add(forward.scale(dist))
              // Center X (0 offset)

              // Base Y calculation
              // Floor is at pistonPos.y
              // We want min Y to be floor + 0.2 gap.
              // Piston Height is 4. Center at min Y is (floor + 0.2 + 2).
              // Oscillation: y = mid + sin * amp.
              // We want (mid - amp) = min Y.
              // We want (mid + amp) = max Y (lifted).
              // Let's lift it by 4 units. Max Y = min Y + 4.
              // So Amp = 2.0.
              // Mid = Min + 2.0 = floor + 0.2 + 2 + 2 = floor + 4.2.

              const floorY = pistonPos.y
              const gap = 0.2
              const amp = 2.0
              const minY = floorY + gap + pistonHeight / 2
              const midY = minY + amp

              const basePos = new Vector3(pistonPos.x, midY, pistonPos.z)

              // Visual
              const piston = MeshBuilder.CreateBox("piston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, this.scene)
              piston.position.copyFrom(basePos)
              piston.material = steelMat // Or maybe Rust?
              this.adventureTrack.push(piston)

              // Physics
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.kinematicPositionBased()
                      .setTranslation(basePos.x, basePos.y, basePos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cuboid(pistonWidth/2, pistonHeight/2, pistonDepth/2),
                  body
              )
              this.adventureBodies.push(body)

              this.animatedObstacles.push({
                  body,
                  mesh: piston,
                  type: 'PISTON',
                  basePos,
                  frequency: 2.0, // Slowish? 1.0 Hz = 2PI rad/s? Logic uses sin(t * freq). If freq is rad/s, use 2PI. If Hz, mul by 2PI.
                                  // Plan says "pistonFreq = 1.0 (Hz)". So use Math.PI * 2.
                  amplitude: amp,
                  phase: phases[i]
              })
          }
      }

      // 3. The Slag Bridge (Chicane)
      // S-Bend: 90 Left, 90 Right. Width 2. No Walls.
      const turnRadius = 10
      const turnAngle = Math.PI / 2

      // Turn Left
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, -turnAngle, 0, 2, 0, moltenMat, 15)
      heading -= turnAngle

      // Turn Right
      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, 0, 2, 0, moltenMat, 15)
      heading += turnAngle

      // 4. The Centrifugal Caster (Turn)
      // Rotating Platform, Radius 10, Speed 2.0 rad/s. Wall Height 3.0.
      // Exit Gap.

      const castRadius = 10
      const castSpeed = 2.0

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const castCenter = currentPos.add(forward.scale(castRadius + 1))

      // Create Platform
      this.createRotatingPlatform(castCenter, castRadius, castSpeed, steelMat)

      // Add Custom Wall with Gap
      // Wall Height 3.0.
      // Gap at exit.
      // We need to know where "Exit" is.
      // We entered at 'heading' (tangent? or radial?).
      // The bridge ends at 'currentPos'.
      // If we simply drop onto the platform...
      // Let's assume exit is 180 degrees from entry or 90?
      // "Exit: A 30-degree gap in the wall that aligns with the goal ramp once per rotation."
      // Wait, "aligns with the goal ramp once per rotation" implies the GAP rotates with the platform?
      // OR the platform rotates, and the wall is STATIC?
      // "Centrifugal Caster... Rotating Platform... WallHeight 3.0 (To keep ball in)... Exit: A 30-degree gap... aligns..."
      // If the WALL is part of the rotating platform, then the gap rotates.
      // If the gap rotates, it only opens to the static exit ramp momentarily. This fits "Caster".
      // So Wall rotates.

      if (this.world && this.adventureBodies.length > 0) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const wallHeight = 3.0
          const wallThickness = 0.5

          // Visual: Torus with gap? Or Cylinder segments.
          // Gap is 30 degrees.
          // Wall covers 330 degrees.

          const gapAngle = (30 * Math.PI) / 180
          const wallAngle = (2 * Math.PI) - gapAngle

          // We can use a Ribbon or multiple boxes.
          // Multiple boxes approximating the arc.
          const segments = 20
          const step = wallAngle / segments

          // Binding
          const binding = this.kinematicBindings.find(b => b.body === platformBody)
          const parentMesh = binding ? binding.mesh : null

          // Start angle. Gap should align with exit eventually.
          // Let's put gap at angle 0 relative to platform.
          // We need to place walls from gapAngle/2 to 2PI - gapAngle/2?

          const startAngle = gapAngle / 2

          for (let i = 0; i <= segments; i++) {
              const theta = startAngle + i * step

              const cx = Math.sin(theta) * castRadius
              const cz = Math.cos(theta) * castRadius

              // Box dimensions
              // Width ~ Arc Length
              const arcLen = castRadius * step

              const wall = MeshBuilder.CreateBox("casterWall", { width: wallThickness, height: wallHeight, depth: arcLen + 0.2 }, this.scene)
              if (parentMesh) {
                  wall.parent = parentMesh
                  wall.position.set(cx, wallHeight/2, cz)
                  wall.rotation.y = theta
                  wall.material = steelMat
              }

              // Collider
              const colRot = Quaternion.FromEulerAngles(0, theta, 0)
              const colliderDesc = this.rapier.ColliderDesc.cuboid(wallThickness/2, wallHeight/2, arcLen/2 + 0.1)
                  .setTranslation(cx, wallHeight/2 + 0.25, cz)
                  .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

              this.world.createCollider(colliderDesc, platformBody)
          }
      }

      // 5. The Quenching Tank (Goal)
      // 5 units below the Caster exit.
      // Where is the exit? The gap rotates, so exit is anywhere on the perimeter.
      // But we need a STATIC ramp to catch it? Or just a bucket below.
      // "Goal... 5 units below the Caster exit."
      // Let's place the goal ramp/bucket at the "Exit Direction".
      // Let's say exit is Straight Ahead (heading).

      const exitForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = castCenter.add(exitForward.scale(castRadius + 4))
      goalPos.y -= 5.0

      this.createBasin(goalPos, moltenMat) // Blue liquid? PLAN says "Blue liquid".
                                            // moltenMat is Orange. Let's make a blue one.
      const waterMat = this.getTrackMaterial("#0088FF")
      // Overwrite material of last added basin?
      // createBasin pushes to adventureTrack.
      const basinMesh = this.adventureTrack[this.adventureTrack.length - 1]
      if (basinMesh) basinMesh.material = waterMat
  }

  // --- Track: The Tidal Nexus ---
  private createTidalNexusTrack(): void {
      const waterMat = this.getTrackMaterial("#0066FF") // Deep Sky Blue
      const foamMat = this.getTrackMaterial("#E0FFFF") // Light Cyan

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Spillway (Injection)
      // Length 15, Incline -20 deg, Width 6, Conveyor Force +8.0 Z
      const spillLen = 15
      const spillIncline = (20 * Math.PI) / 180

      // Save start for conveyor
      const spillStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, 6, spillLen, spillIncline, waterMat)

      if (this.world) {
          // Conveyor Logic
          const hLen = spillLen * Math.cos(spillIncline)
          const vDrop = spillLen * Math.sin(spillIncline)
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const center = spillStart.add(forward.scale(hLen / 2))
          center.y -= vDrop / 2
          center.y += 0.5 // Just above floor

          const sensorBody = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
          )
          const q = Quaternion.FromEulerAngles(spillIncline, heading, 0)
          sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(3, 1, spillLen / 2).setSensor(true),
              sensorBody
          )

          // Force: +8.0 Z relative to ramp.
          // World Force Vector
          // Gravity Forge used 50.0 for "+5.0". So 8.0 -> 80.0?
          // Let's try 60.0.
          const forceDir = new Vector3(
              Math.sin(heading) * Math.cos(spillIncline),
              -Math.sin(spillIncline),
              Math.cos(heading) * Math.cos(spillIncline)
          )
          this.conveyorZones.push({
              sensor: sensorBody,
              force: forceDir.scale(60.0)
          })
      }

      // 2. The Turbine (Hazard)
      // Rotating Platform, Radius 8, CW 1.5 rad/s.
      // 4 Paddle Wheels.
      const turbineRadius = 8
      const turbineSpeed = 1.5 // CW => Negative Y rotation? Usually +Y is CCW. So -1.5.

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const turbineCenter = currentPos.add(forward.scale(turbineRadius + 1))
      // turbineCenter.y -= 1.0 // Drop slightly?

      // Reuse CreateRotatingPlatform for base
      this.createRotatingPlatform(turbineCenter, turbineRadius, -turbineSpeed, waterMat)

      // Add Paddles
      if (this.world) {
          const platformBody = this.adventureBodies[this.adventureBodies.length - 1]
          const paddleCount = 4
          const paddleLen = turbineRadius - 1
          const paddleHeight = 1.5
          const paddleThick = 0.5

          for (let i = 0; i < paddleCount; i++) {
              const angle = (i * Math.PI * 2) / paddleCount

              // Visual
              const paddle = MeshBuilder.CreateBox("paddle", { width: paddleThick, height: paddleHeight, depth: paddleLen }, this.scene)
              // Attach to platform mesh
              const binding = this.kinematicBindings.find(b => b.body === platformBody)
              if (binding) {
                  paddle.parent = binding.mesh

                  // Local pos
                  const r = paddleLen / 2
                  const lx = Math.sin(angle) * r
                  const lz = Math.cos(angle) * r

                  paddle.position.set(lx, paddleHeight/2, lz)
                  paddle.rotation.y = angle
                  paddle.material = foamMat
              }

              // Collider
              const colRot = Quaternion.FromEulerAngles(0, angle, 0)
              const colliderDesc = this.rapier.ColliderDesc.cuboid(paddleThick/2, paddleHeight/2, paddleLen/2)
                  .setTranslation(
                       Math.sin(angle) * paddleLen/2,
                       paddleHeight/2 + 0.25,
                       Math.cos(angle) * paddleLen/2
                  )
                  .setRotation({ x: colRot.x, y: colRot.y, z: colRot.z, w: colRot.w })

              this.world.createCollider(colliderDesc, platformBody)
          }
      }

      // Exit Turbine
      // Assuming straight exit
      const turbineExit = turbineCenter.add(forward.scale(turbineRadius))
      currentPos = turbineExit

      // 3. The Riptide (Turn)
      // Radius 12, Angle 180, Incline -5 deg, Banking -10 deg (Inward).
      // "Cross-Current" pushes Outward.
      const ripRadius = 12
      const ripAngle = Math.PI // 180
      const ripIncline = (5 * Math.PI) / 180
      const ripBank = -(10 * Math.PI) / 180

      const ripStart = currentPos.clone()

      // Create Visuals/Physics
      currentPos = this.addCurvedRamp(currentPos, heading, ripRadius, ripAngle, ripIncline, 8, 2.0, waterMat, 20, ripBank)

      // Create Cross-Current Sensors
      // Iterate segments again manually
      if (this.world) {
          const segments = 20
          const segmentAngle = ripAngle / segments
          const arcLength = ripRadius * segmentAngle
          const chordLen = 2 * ripRadius * Math.sin(segmentAngle / 2)
          const segmentDrop = arcLength * Math.sin(ripIncline)

          let curH = heading
          let curP = ripStart.clone()

          for (let i = 0; i < segments; i++) {
              curH += (segmentAngle / 2)

              const segForward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
              const center = curP.add(segForward.scale(chordLen / 2))
              center.y -= segmentDrop / 2
              center.y += 0.5 // Above floor

              // Sensor
              const sensorBody = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
              )
              const q = Quaternion.FromEulerAngles(ripIncline, curH, ripBank)
              sensorBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

              this.world.createCollider(
                  this.rapier.ColliderDesc.cuboid(4, 1, chordLen / 2).setSensor(true),
                  sensorBody
              )

              // Force: Outward (Right relative to forward)
              // Forward is (sin(H), 0, cos(H)). Right is (cos(H), 0, -sin(H)).
              // Ignoring vertical tilt for simple outward push.
              const outwardDir = new Vector3(Math.cos(curH), 0, -Math.sin(curH))

              this.conveyorZones.push({
                  sensor: sensorBody,
                  force: outwardDir.scale(40.0) // Strong push
              })

              curP = curP.add(segForward.scale(chordLen))
              curP.y -= segmentDrop
              curH += (segmentAngle / 2)
          }
      }
      heading += ripAngle

      // 4. The Wave Pool (Chicane)
      // Straight Ramp, Length 20, Width 8.
      // 5 rows of kinematic boxes moving in sine wave.
      const poolLen = 20
      const poolWidth = 8

      const poolStart = currentPos.clone()
      currentPos = this.addStraightRamp(currentPos, heading, poolWidth, poolLen, 0, waterMat)

      if (this.world) {
          const rows = 5
          const rowSpacing = 3.0
          const startDist = 3.0
          const boxWidth = poolWidth - 1
          const boxDepth = 2.0
          const boxHeight = 1.0

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

          for (let i = 0; i < rows; i++) {
              const dist = startDist + i * rowSpacing
              const pos = poolStart.add(forward.scale(dist))

              // Sine Wave: sin(t + z).
              // z here is distance along track or world z?
              // "sin(t + z)". Let's use 'dist' as phase offset.
              // Amplitude 1.5.
              // Base Y: Floor level.
              // We want it to rise out of floor?
              // Floor is at pos.y.
              // Let's set Base Y such that it peaks at Floor + Amp/2?
              // Or just moves up and down through floor.

              const basePos = pos.clone()
              basePos.y -= 0.5 // Start partially submerged

              const box = MeshBuilder.CreateBox("waveBox", { width: boxWidth, height: boxHeight, depth: boxDepth }, this.scene)
              box.position.copyFrom(basePos)
              box.rotation.y = heading
              box.material = foamMat
              this.adventureTrack.push(box)

              const q = Quaternion.FromEulerAngles(0, heading, 0)
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.kinematicPositionBased()
                      .setTranslation(basePos.x, basePos.y, basePos.z)
                      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cuboid(boxWidth/2, boxHeight/2, boxDepth/2),
                  body
              )
              this.adventureBodies.push(body)

              this.animatedObstacles.push({
                  body,
                  mesh: box,
                  type: 'PISTON', // Reuse piston logic
                  basePos,
                  frequency: 3.0, // Speed of wave
                  amplitude: 1.5,
                  phase: dist * 0.5 // Phase shift based on distance
              })
          }
      }

      // 5. The Abyssal Drop (Goal)
      // Steep waterfall drop?
      // Just a bucket at bottom.
      const goalPos = currentPos.clone()
      goalPos.y -= 4
      goalPos.z += 4

      this.createBasin(goalPos, waterMat)
  }

  // --- Track: The Digital Zen Garden ---
  private createDigitalZenGardenTrack(): void {
      const gardenMat = this.getTrackMaterial("#FFFFFF") // White
      const accentMat = this.getTrackMaterial("#FF69B4") // Hot Pink
      const sandFriction = 0.8
      const waterFriction = 0.1

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Raked Path (Entry)
      // Length 15, Incline -15 deg, Width 8, Friction 0.8
      const entryLen = 15
      const entryIncline = (15 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 8, entryLen, entryIncline, gardenMat, 1.0, sandFriction)

      // 2. The Rock Garden (Obstacles)
      // Flat, Length 20, Width 12
      const rockLen = 20
      const rockWidth = 12
      const rockStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, rockWidth, rockLen, 0, gardenMat, 0.5, sandFriction)

      // Add 3 Large Static Geospheres
      if (this.world) {
          const rockRadius = 2.0
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          // Triangular Formation: One Central, Two Flankers
          const positions = [
              { z: 12, x: 0 },
              { z: 6, x: -3.5 },
              { z: 6, x: 3.5 }
          ]

          positions.forEach(pos => {
              const rockPos = rockStart
                  .add(forward.scale(pos.z))
                  .add(right.scale(pos.x))

              // Embed slightly
              rockPos.y += rockRadius * 0.6

              const rock = MeshBuilder.CreateSphere("zenRock", { diameter: rockRadius * 2, segments: 4 }, this.scene)
              rock.position.copyFrom(rockPos)
              rock.material = accentMat
              this.adventureTrack.push(rock)

              // Physics
              const body = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(rockPos.x, rockPos.y, rockPos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.ball(rockRadius).setRestitution(0.2),
                  body
              )
              this.adventureBodies.push(body)
          })
      }

      // 3. The Stream Crossing (Hazard)
      // Curve Radius 15, Angle 90, Incline 0, Friction 0.1
      // Conveyor Force +3.0 X (Towards outer edge)
      const streamRadius = 15
      const streamAngle = Math.PI / 2

      const streamStart = currentPos.clone()
      const streamStartHeading = heading

      currentPos = this.addCurvedRamp(currentPos, heading, streamRadius, streamAngle, 0, 8, 1.0, gardenMat, 20, 0, waterFriction)

      // Add Cross Current
      if (this.world) {
          const segments = 10
          const segAngle = streamAngle / segments
          const chordLen = 2 * streamRadius * Math.sin(segAngle/2)

          let curH = streamStartHeading
          let curP = streamStart.clone()

          for (let i=0; i<segments; i++) {
               curH += segAngle / 2
               const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
               const center = curP.add(forward.scale(chordLen / 2))
               center.y += 0.5

               const sensor = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
               )
               const q = Quaternion.FromEulerAngles(0, curH, 0)
               sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(4, 1, chordLen/2).setSensor(true),
                   sensor
               )

               // Force: Towards Outer Edge (Left relative to forward in a Right turn)
               const leftDir = new Vector3(-Math.cos(curH), 0, Math.sin(curH))

               this.conveyorZones.push({
                   sensor,
                   force: leftDir.scale(30.0)
               })

               curP = curP.add(forward.scale(chordLen))
               curH += segAngle / 2
          }
      }
      heading += streamAngle

      // 4. The Moon Bridge (Vertical Arch)
      // Length 10, Width 3, WallHeight 1.0. Parabolic.
      const bridgeLen = 10
      const segments = 10
      const segLen = bridgeLen / segments
      const bridgeWidth = 3

      for (let i=0; i<segments; i++) {
          const x0 = i * segLen
          const x1 = (i + 1) * segLen
          const xm = (x0 + x1) / 2

          // Parabola: y = -0.12 * (x - 5)^2 + 3
          // Slope at xm: dy/dx = -0.24 * (xm - 5)
          const slope = -0.24 * (xm - 5)
          const incline = -Math.atan(slope)

          const meshLen = Math.sqrt(1 + slope * slope) * segLen

          currentPos = this.addStraightRamp(currentPos, heading, bridgeWidth, meshLen, incline, accentMat, 1.0, sandFriction)
      }

      // 5. The Lotus Shrine (Goal)
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(forward.scale(4))

      this.createBasin(goalPos, accentMat)
  }

  // --- Track: The Synthwave Surf ---
  private createSynthwaveSurfTrack(): void {
      const floorMat = this.getTrackMaterial("#110022") // Dark Purple
      const gridMat = this.getTrackMaterial("#00FFFF") // Cyan
      const barMat1 = this.getTrackMaterial("#00FF00") // Green
      const barMat2 = this.getTrackMaterial("#FF0000") // Red

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Bass Drop (Entry)
      // Length 15, Incline -25 deg, Width 8
      const dropLen = 15
      const dropIncline = (25 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 8, dropLen, dropIncline, floorMat)

      // Visual: Pulsing Chevrons?
      // Can simulate with some static meshes for now or just rely on floorMat.

      // 2. The Equalizer (Hazard)
      // Flat, Length 20, Width 10.
      const eqLen = 20
      const eqWidth = 10
      const eqStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, eqWidth, eqLen, 0, floorMat)

      // EQ Bars (Pistons)
      // 5 Rows of 4 Pistons.
      if (this.world) {
          const rows = 5
          const cols = 4
          const rowSpacing = 3.0
          const colSpacing = 2.0
          const pistonWidth = 1.5
          const pistonHeight = 3.0
          const pistonDepth = 1.5

          const startZ = 2.0 // From start of segment
          const startX = -((cols - 1) * colSpacing) / 2

          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                   const zOffset = startZ + r * rowSpacing
                   const xOffset = startX + c * colSpacing

                   const pistonPos = eqStart.add(forward.scale(zOffset)).add(right.scale(xOffset))

                   // Base Pos: Floor level?
                   // "They rise and fall... y = abs(sin(t + x))"
                   // We want them to block path when up.
                   // Start with top flush with floor?
                   // Or fully below?
                   // Let's have base Y such that min Y is flush with floor, max Y is 3.0 above.
                   // Amplitude 1.5. Midpoint = Floor + 1.5.
                   // y = mid + amp * sin.
                   // Min = floor. Max = floor + 3.

                   const basePos = pistonPos.clone()
                   basePos.y += pistonHeight / 2 // Center of box when flush
                   // But we want to animate it.
                   // The animate loop uses: y = basePos.y + offset.
                   // Offset is +/- amp.
                   // So basePos.y needs to be the MIDPOINT of the oscillation.
                   // Midpoint = Floor + 1.5 (half max height).
                   // Center of box at midpoint = (Floor + 1.5).

                   const oscBaseY = pistonPos.y + pistonHeight / 2 // Floor + 1.5

                   // Reset basePos for animation center
                   const animBasePos = new Vector3(pistonPos.x, oscBaseY - pistonHeight/2, pistonPos.z)
                   // Wait, my logic in update():
                   // const newY = obst.basePos.y + yOffset
                   // If amplitude is 1.5, range is [base-1.5, base+1.5].
                   // If base is Floor + 1.5. Range is [Floor, Floor + 3.0]. Correct.
                   // Center of box is at Y. Box bottom is Y - 1.5.
                   // At Floor: Center = Floor. Bottom = Floor - 1.5. Top = Floor + 1.5.
                   // At Floor+3: Center = Floor+3. Bottom = Floor+1.5. Top = Floor+4.5.
                   // So it rises OUT of floor?
                   // "Navigate the troughs".
                   // If it's 0 to 3, it blocks.
                   // If it's -3 to 0, it's clear.
                   // abs(sin) is 0 to 1.
                   // We want 0 to Max Height.
                   // Update logic uses simple sin.
                   // Let's adjust Phase/Freq.
                   // Use abs(sin) logic? update() currently supports sin.
                   // Let's stick to sin. Range [-1, 1].
                   // We want it to go from Flush (0 height above floor) to Full (3 height).
                   // Center oscillates.

                   const box = MeshBuilder.CreateBox("eqPiston", { width: pistonWidth, height: pistonHeight, depth: pistonDepth }, this.scene)
                   box.position.copyFrom(animBasePos)
                   box.rotation.y = heading
                   // Gradient color: Green to Red. Use row index.
                   box.material = (r % 2 === 0) ? barMat1 : barMat2
                   this.adventureTrack.push(box)

                   const q = Quaternion.FromEulerAngles(0, heading, 0)
                   const body = this.world.createRigidBody(
                       this.rapier.RigidBodyDesc.kinematicPositionBased()
                           .setTranslation(animBasePos.x, animBasePos.y, animBasePos.z)
                           .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                   )
                   this.world.createCollider(
                       this.rapier.ColliderDesc.cuboid(pistonWidth/2, pistonHeight/2, pistonDepth/2),
                       body
                   )
                   this.adventureBodies.push(body)

                   this.animatedObstacles.push({
                       body,
                       mesh: box,
                       type: 'PISTON',
                       basePos: animBasePos,
                       frequency: 4.0, // bpm 120 -> 2 Hz? let's make it fast.
                       amplitude: 1.5,
                       // Phase based on X + T?
                       // We can pass phase as xOffset.
                       phase: xOffset * 0.5 + r * 1.0
                   })
              }
          }
      }

      // 3. The High-Pass Filter (Turn)
      // Radius 12, Angle 180, Incline +5 deg (Uphill), Banking -15 deg
      const turnRadius = 12
      const turnAngle = Math.PI
      const turnIncline = -(5 * Math.PI) / 180 // Negative is Uphill?
      // Wait, in addStraightRamp: vDrop = length * sin(incline).
      // positive incline -> vDrop positive -> y goes down.
      // So negative incline -> vDrop negative -> y goes up. Correct.
      const turnBank = -(15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 8, 2.0, gridMat, 20, turnBank)
      heading += turnAngle

      // 4. The Sub-Woofer (Goal Approach)
      // Spiral 360, Incline -15 deg (Down), Banking -30 deg
      const spiralRadius = 6
      const spiralAngle = 2 * Math.PI
      const spiralIncline = (15 * Math.PI) / 180 // Down
      const spiralBank = -(30 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 8, 2.0, floorMat, 30, spiralBank)
      heading += spiralAngle

      // 5. The Mic Drop (Goal)
      const goalPos = currentPos.clone()
      goalPos.y -= 2
      goalPos.z += 2

      this.createBasin(goalPos, gridMat)
  }

  // --- Track: The Solar Flare ---
  private createSolarFlareTrack(): void {
      const plasmaMat = this.getTrackMaterial("#FF4500") // Orange Red
      const coreMat = this.getTrackMaterial("#FFFF00") // Yellow

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. Coronal Mass Ejection (Launch)
      // Length 15, Incline -20 deg, Width 6
      const launchLen = 15
      const launchIncline = (20 * Math.PI) / 180
      const launchStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, 6, launchLen, launchIncline, plasmaMat)

      // Plasma Boost: Conveyor Force +10.0 Z (relative to ramp)
      if (this.world) {
          const hLen = launchLen * Math.cos(launchIncline)
          const vDrop = launchLen * Math.sin(launchIncline)
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const center = launchStart.add(forward.scale(hLen / 2))
          center.y -= vDrop / 2
          center.y += 0.5

          const sensor = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
          )
          const q = Quaternion.FromEulerAngles(launchIncline, heading, 0)
          sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

          this.world.createCollider(
              this.rapier.ColliderDesc.cuboid(3, 1, launchLen / 2).setSensor(true),
              sensor
          )

          // Force Vector: 10.0 * 10 = 100.0? Based on previous 60.0 for 8.0.
          // Let's try 80.0
          const forceDir = new Vector3(
              Math.sin(heading) * Math.cos(launchIncline),
              -Math.sin(launchIncline),
              Math.cos(heading) * Math.cos(launchIncline)
          )
          this.conveyorZones.push({
              sensor,
              force: forceDir.scale(80.0)
          })
      }

      // 2. The Prominence (Vertical Arch)
      // Parabolic Arch: Rise 8 units, Fall 8 units. Length 20.
      const archLen = 20
      const segments = 10
      const segLen = archLen / segments
      const archWidth = 4

      // Parabola y = -a * x^2 + h
      // Starts at x=0, y=0. Ends at x=20, y=0??
      // "Rise 8 units, Fall 8 units".
      // Let's model as y = -0.08 * (x - 10)^2 + 8.
      // x=0 -> y = -0.08 * 100 + 8 = 0.
      // x=10 -> y=8.
      // x=20 -> y=0.
      // Slope dy/dx = -0.16 * (x - 10).

      for (let i = 0; i < segments; i++) {
          const x0 = i * segLen
          const x1 = (i + 1) * segLen
          const xm = (x0 + x1) / 2

          const slope = -0.16 * (xm - 10)
          const incline = -Math.atan(slope)
          const meshLen = Math.sqrt(1 + slope * slope) * segLen

          currentPos = this.addStraightRamp(currentPos, heading, archWidth, meshLen, incline, plasmaMat, 0.5)
      }

      // 3. The Sunspot Field (Hazard)
      // Flat, Length 25, Width 12
      const fieldLen = 25
      const fieldWidth = 12
      const fieldStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, fieldWidth, fieldLen, 0, plasmaMat)

      // Gravity Wells
      if (this.world) {
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
          const wellStrength = 40.0 // Plan says 10.0. Boost for effect?

          // Positions
          const positions = [
             { z: 5, x: -3 },
             { z: 12, x: 3 },
             { z: 20, x: 0 }
          ]

          positions.forEach(p => {
              const wellPos = fieldStart.add(forward.scale(p.z)).add(right.scale(p.x))
              wellPos.y += 0.5

              // Visual: Swirling Vortex? Use cylinder for now.
              const vortex = MeshBuilder.CreateCylinder("vortex", { diameter: 4, height: 0.1 }, this.scene)
              vortex.position.copyFrom(wellPos)
              vortex.material = coreMat // Yellow center
              this.adventureTrack.push(vortex)

              // Sensor
              const sensor = this.world.createRigidBody(
                  this.rapier.RigidBodyDesc.fixed().setTranslation(wellPos.x, wellPos.y, wellPos.z)
              )
              this.world.createCollider(
                  this.rapier.ColliderDesc.cylinder(1.0, 3.0).setSensor(true),
                  sensor
              )

              this.gravityWells.push({
                  sensor,
                  center: wellPos,
                  strength: wellStrength
              })
          })
      }

      // 4. The Solar Wind (Cross-Force)
      // Curve Radius 15, Angle 180, Incline 0.
      // Continuous Lateral Force (+5.0 X)
      const windRadius = 15
      const windAngle = Math.PI
      const windStart = currentPos.clone()
      const windStartHeading = heading

      currentPos = this.addCurvedRamp(currentPos, heading, windRadius, windAngle, 0, 8, 1.0, plasmaMat, 20, 0)

      // Add Solar Wind Sensors
      if (this.world) {
          const segments = 10
          const segAngle = windAngle / segments
          const chordLen = 2 * windRadius * Math.sin(segAngle/2)

          let curH = windStartHeading
          let curP = windStart.clone()

          for (let i = 0; i < segments; i++) {
               curH += segAngle / 2
               const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
               const center = curP.add(forward.scale(chordLen / 2))
               center.y += 0.5

               const sensor = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
               )
               const q = Quaternion.FromEulerAngles(0, curH, 0)
               sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(4, 1, chordLen/2).setSensor(true),
                   sensor
               )

               // Force: Lateral (+5.0 X Global?).
               // Plan: "Continuous Lateral Force (+5.0 X) pushing the ball towards the outer edge."
               // If we are turning Right (implied by addCurvedRamp default direction?), outer edge is Left?
               // addCurvedRamp logic:
               // forward = (sin(H), 0, cos(H))
               // If H starts at 0 (North), turns to PI (South).
               // It turns RIGHT if currentHeading += positive.
               // So outer edge is LEFT (-X local).
               // +5.0 X Global is Right.
               // Let's use Global +5.0 X.

               const windForce = new Vector3(50.0, 0, 0) // Scaled

               this.conveyorZones.push({
                   sensor,
                   force: windForce
               })

               curP = curP.add(forward.scale(chordLen))
               curH += segAngle / 2
          }
      }
      heading += windAngle

      // 5. Fusion Core (Goal)
      // Bucket in Dyson Ring structure
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(forward.scale(4))

      this.createBasin(goalPos, coreMat)

      // Visual: Dyson Ring
      const ring = MeshBuilder.CreateTorus("dysonRing", { diameter: 8, thickness: 1.0, tessellation: 32 }, this.scene)
      ring.position.copyFrom(goalPos)
      ring.position.y += 2
      ring.rotation.x = Math.PI / 2
      ring.material = coreMat
      this.adventureTrack.push(ring)
  }

  // --- Track: The Tesla Tower ---
  private createTeslaTowerTrack(): void {
      const coilMat = this.getTrackMaterial("#CD7F32") // Copper
      const lightningMat = this.getTrackMaterial("#00DDFF") // Electric Blue

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Induction Coil (Entry)
      // Curved Ramp (Spiral Down). Radius 10, Angle 360, Incline 15.
      // Mag-Rail: Tangential Force +20.0.
      const coilRadius = 10
      const coilAngle = 2 * Math.PI
      const coilIncline = (15 * Math.PI) / 180

      const coilStart = currentPos.clone()
      const coilStartHeading = heading

      currentPos = this.addCurvedRamp(currentPos, heading, coilRadius, coilAngle, coilIncline, 8, 2.0, coilMat, 30)

      // Mag-Rail Sensors
      if (this.world) {
          const segments = 20
          const segAngle = coilAngle / segments
          const chordLen = 2 * coilRadius * Math.sin(segAngle/2)
          const drop = chordLen * Math.sin(coilIncline) // Approx segment drop

          let curH = coilStartHeading
          let curP = coilStart.clone()

          for (let i = 0; i < segments; i++) {
               curH += segAngle / 2
               const forward = new Vector3(Math.sin(curH), 0, Math.cos(curH))
               const center = curP.add(forward.scale(chordLen / 2))
               center.y -= drop / 2
               center.y += 0.5 // Above floor

               const sensor = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z)
               )
               const q = Quaternion.FromEulerAngles(coilIncline, curH, 0)
               sensor.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)

               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(4, 1, chordLen/2).setSensor(true),
                   sensor
               )

               // Tangential Force: Forward vector
               // Force +20.0 Tangential.
               // Since ramp is forward, tangential is forward.
               const forceVec = new Vector3(Math.sin(curH), -Math.sin(coilIncline), Math.cos(curH)).normalize().scale(200.0) // 20.0 * 10

               this.conveyorZones.push({
                   sensor,
                   force: forceVec
               })

               curP = curP.add(forward.scale(chordLen))
               curP.y -= drop
               curH += segAngle / 2
          }
      }
      heading += coilAngle

      // 2. The Spark Gap (Jump)
      // Gap Length 8. Drop 2.
      const gapLen = 8
      const gapDrop = 2

      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const gapStart = currentPos.clone()

      // Visual Arc
      const arcPoints = [
          gapStart,
          gapStart.add(gapForward.scale(gapLen)).subtract(new Vector3(0, gapDrop, 0))
      ]
      // Just draw a tube or something?
      const arc = MeshBuilder.CreateTube("sparkArc", { path: arcPoints, radius: 0.2 }, this.scene)
      arc.material = lightningMat
      this.adventureTrack.push(arc)

      // Move Pos
      currentPos = currentPos.add(gapForward.scale(gapLen))
      currentPos.y -= gapDrop

      // 3. The Step-Down Transformer (Chicane)
      // Zig-Zag x 3. Width 4. No Walls.
      // Arc Pylons at corners.
      const zigLen = 6
      const zigWidth = 4

      currentPos = this.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

      // Pylon 1 (Turn Left)
      this.createArcPylon(currentPos, lightningMat)
      heading -= Math.PI / 2

      currentPos = this.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

      // Pylon 2 (Turn Right)
      this.createArcPylon(currentPos, lightningMat)
      heading += Math.PI / 2

      currentPos = this.addStraightRamp(currentPos, heading, zigWidth, zigLen, 0, coilMat)

      // 4. The Faraday Cage (Arena)
      // Flat 12x12.
      const cageSize = 12
      const cageStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, cageSize, cageSize, 0, coilMat)

      // Ball Lightning
      // 3 Kinematic Spheres moving randomly?
      // "Kinematic Spheres moving randomly".
      // Let's create bouncy spheres that move.
      if (this.world) {
          const sphereRadius = 1.0
          const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < 3; i++) {
               const offsetZ = 2 + Math.random() * (cageSize - 4)
               const offsetX = (Math.random() - 0.5) * (cageSize - 4)

               const pos = cageStart.add(forward.scale(offsetZ)).add(right.scale(offsetX))
               pos.y += 2.0

               const sphere = MeshBuilder.CreateSphere("ballLightning", { diameter: sphereRadius * 2 }, this.scene)
               sphere.position.copyFrom(pos)
               sphere.material = lightningMat
               this.adventureTrack.push(sphere)

               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.kinematicVelocityBased()
                       .setTranslation(pos.x, pos.y, pos.z)
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.ball(sphereRadius).setRestitution(1.2),
                   body
               )
               this.adventureBodies.push(body)
               this.kinematicBindings.push({ body, mesh: sphere })

               this.animatedObstacles.push({
                   body,
                   mesh: sphere,
                   type: 'OSCILLATOR',
                   basePos: pos,
                   frequency: 0.5 + Math.random(),
                   amplitude: 3.0,
                   axis: right, // Move left-right
                   phase: Math.random() * Math.PI
               })
          }
      }

      // 5. Grounding Rod (Goal)
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(goalForward.scale(4))

      this.createBasin(goalPos, coilMat)
  }

  // --- Track: The Neon Skyline ---
  private createNeonSkylineTrack(): void {
      const skylineMat = this.getTrackMaterial("#111122") // Dark Blue
      const windMat = this.getTrackMaterial("#AAFFFF") // White/Cyan

      let currentPos = this.currentStartPos.clone()
      let heading = 0

      // 1. The Rooftop Run (Entry)
      // Length 15, Incline -10 deg, Width 6
      const entryLen = 15
      const entryIncline = (10 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, entryLen, entryIncline, skylineMat)

      // 2. The Vent Jump (Mechanic)
      // Gap Length 5. Target Elev +5.
      const gapLen = 5
      const jumpHeight = 5.0

      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const gapStart = currentPos.clone()

      // Updraft Fan Sensor
      if (this.world) {
          const center = gapStart.add(forward.scale(gapLen / 2))
          // Center Y is below gap usually? Or in the gap.
          // Let's place it slightly below where the ball launches.
          center.y -= 2.0

          // Visual Fan
          const fan = MeshBuilder.CreateCylinder("ventFan", { diameter: 4, height: 0.5 }, this.scene)
          fan.position.copyFrom(center)
          fan.material = windMat
          this.adventureTrack.push(fan)

          const sensor = this.world.createRigidBody(
              this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, center.y + 1.0, center.z)
          )
          this.world.createCollider(
              this.rapier.ColliderDesc.cylinder(3.0, 2.5).setSensor(true),
              sensor
          )

          // Force: +25.0 Y. Scaled by 10 like others?
          // Gravity Forge: +5.0 -> 25.0 impulse? No, I used 50.0 there.
          // Tidal Nexus: +8.0 -> 60.0.
          // Neon Skyline: +25.0.
          // Let's try 250.0. This is a HUGE jump (+5 elevation).
          this.conveyorZones.push({
              sensor,
              force: new Vector3(0, 250.0, 0)
          })
      }

      // Move Pos
      currentPos = currentPos.add(forward.scale(gapLen))
      currentPos.y += jumpHeight

      // 3. The Skyscraper (Platform)
      // Flat, Length 15, Width 10.
      const skyLen = 15
      const skyWidth = 10
      const skyStart = currentPos.clone()

      currentPos = this.addStraightRamp(currentPos, heading, skyWidth, skyLen, 0, skylineMat)

      // AC Units (Maze)
      if (this.world) {
          const unitCount = 6
          const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))

          for (let i = 0; i < unitCount; i++) {
               const dist = 2 + Math.random() * (skyLen - 4)
               const offset = (Math.random() - 0.5) * (skyWidth - 2)

               const pos = skyStart.add(forward.scale(dist)).add(right.scale(offset))
               pos.y += 1.0

               const ac = MeshBuilder.CreateBox("acUnit", { size: 2 }, this.scene)
               ac.position.copyFrom(pos)
               ac.material = skylineMat
               this.adventureTrack.push(ac)

               const body = this.world.createRigidBody(
                   this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
               )
               this.world.createCollider(
                   this.rapier.ColliderDesc.cuboid(1, 1, 1),
                   body
               )
               this.adventureBodies.push(body)
          }
      }

      // 4. The Billboard (Wall Ride)
      // Curved Ramp. Radius 12, Angle 90, Incline 0, Banking -45.
      const boardRadius = 12
      const boardAngle = Math.PI / 2
      const boardBank = -(45 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, boardRadius, boardAngle, 0, 8, 2.0, windMat, 20, boardBank)
      heading += boardAngle

      // 5. The Penthouse Landing (Goal)
      const goalForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalPos = currentPos.add(goalForward.scale(4))

      this.createBasin(goalPos, skylineMat)
  }

  private createArcPylon(pos: Vector3, mat: StandardMaterial): void {
      if (!this.world) return

      // Visual
      const pylon = MeshBuilder.CreateCylinder("pylon", { diameter: 1.0, height: 3.0 }, this.scene)
      pylon.position.copyFrom(pos)
      pylon.position.y += 1.5
      pylon.material = mat
      this.adventureTrack.push(pylon)

      // Physics (Static)
      const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 1.5, pos.z)
      )
      this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(1.5, 0.5),
          body
      )
      this.adventureBodies.push(body)

      // Repulsive Gravity Well
      const sensor = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 1.5, pos.z)
      )
      this.world.createCollider(
          this.rapier.ColliderDesc.ball(3.0).setSensor(true),
          sensor
      )

      this.gravityWells.push({
          sensor,
          center: pos,
          strength: -50.0 // Repel
      })
  }

  // --- Track: The Polychrome Void ---
  private createPolychromeVoidTrack(): void {
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

  private createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void {
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

  private setBallColorState(ball: RAPIER.RigidBody, color: 'RED' | 'GREEN' | 'BLUE'): void {
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
