import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  Quaternion,
  ArcRotateCamera,
  Mesh,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Event callback signature for communicating with Game.ts
export type AdventureCallback = (event: string, data?: any) => void

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
}

interface KinematicBinding {
  body: RAPIER.RigidBody
  mesh: Mesh
}

export class AdventureMode {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER

  // State Management
  private adventureTrack: Mesh[] = []
  private adventureBodies: RAPIER.RigidBody[] = []
  private kinematicBindings: KinematicBinding[] = []
  private adventureSensor: RAPIER.RigidBody | null = null
  private resetSensors: RAPIER.RigidBody[] = []
  private adventureActive = false
  private currentStartPos: Vector3 = Vector3.Zero()

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

  update(): void {
    if (!this.adventureActive) return

    // Sync kinematic bodies to visuals
    for (const binding of this.kinematicBindings) {
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
    
    // Cleanup Visuals
    this.adventureTrack.forEach(m => m.dispose())
    this.adventureTrack = []
    this.kinematicBindings = []
    
    // Cleanup Physics
    this.adventureBodies.forEach(body => {
      this.world.removeRigidBody(body)
    })
    this.adventureBodies = []
    
    if (this.adventureSensor) {
      this.world.removeRigidBody(this.adventureSensor)
      this.adventureSensor = null
    }

    this.resetSensors.forEach(s => {
        if (this.world) this.world.removeRigidBody(s)
    })
    this.resetSensors = []
  }

  // --- Shared Helper for Materials ---
  private getTrackMaterial(colorHex: string): StandardMaterial {
      const mat = new StandardMaterial("trackMat", this.scene)
      mat.emissiveColor = Color3.FromHexString(colorHex)
      mat.diffuseColor = Color3.Black()
      mat.alpha = 0.6
      mat.wireframe = true
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
      material: StandardMaterial
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
          this.rapier.ColliderDesc.cuboid(width / 2, 0.25, length / 2),
          body
      )
      this.adventureBodies.push(body)

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
      bankingAngle: number = 0
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
              this.rapier.ColliderDesc.cuboid(width / 2, 0.25, chordLen / 2),
              body
          )
          this.adventureBodies.push(body)

          if (wallHeight > 0) {
              this.createWall(center, currentHeading, chordLen, width, wallHeight, inclineRad, material)
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
      mat: StandardMaterial
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
              this.rapier.ColliderDesc.cuboid(0.25, height / 2, length / 2),
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
}
