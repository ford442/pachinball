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
}

export class AdventureMode {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER

  // State Management
  private adventureTrack: Mesh[] = []
  private adventureBodies: RAPIER.RigidBody[] = []
  private adventureSensor: RAPIER.RigidBody | null = null
  private adventureActive = false

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

    if (trackType === AdventureTrackType.CYBER_CORE) {
        this.createDescentTrack()
    } else if (trackType === AdventureTrackType.QUANTUM_GRID) {
        this.createQuantumGridTrack()
    } else if (trackType === AdventureTrackType.SINGULARITY_WELL) {
        this.createSingularityWell()
    } else if (trackType === AdventureTrackType.GLITCH_SPIRE) {
        this.createGlitchSpireTrack()
    } else if (trackType === AdventureTrackType.RETRO_WAVE_HILLS) {
        this.createRetroWaveHills()
    } else {
        this.createHelixTrack()
    }
    
    // Reset ball velocity and teleport to start of track
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)

    // Teleport to the start position (should be synchronized with track creation)
    // For Cyber-Core, we start high up.
    let startPos = new Vector3(0, 3, 8)
    if (trackType === AdventureTrackType.CYBER_CORE) {
        startPos = new Vector3(0, 20, 0)
    } else if (trackType === AdventureTrackType.QUANTUM_GRID) {
        startPos = new Vector3(0, 10, 0)
    } else if (trackType === AdventureTrackType.SINGULARITY_WELL) {
        startPos = new Vector3(0, 25, 0)
    } else if (trackType === AdventureTrackType.GLITCH_SPIRE) {
        startPos = new Vector3(0, 10, 0)
    } else if (trackType === AdventureTrackType.RETRO_WAVE_HILLS) {
        startPos = new Vector3(0, 5, 0)
    }

    ballBody.setTranslation({ x: startPos.x, y: startPos.y, z: startPos.z }, true)
    
    // Store original camera to restore later
    this.tableCamera = currentCamera

    // Create new RPG-style Isometric Camera
    this.followCamera = new ArcRotateCamera("isoCam", -Math.PI / 2, Math.PI / 3, 14, Vector3.Zero(), this.scene)
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
    
    // Cleanup Physics
    this.adventureBodies.forEach(body => {
      this.world.removeRigidBody(body)
    })
    this.adventureBodies = []
    
    if (this.adventureSensor) {
      this.world.removeRigidBody(this.adventureSensor)
      this.adventureSensor = null
    }
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
    let currentPos = new Vector3(0, 2, 8)
    let heading = Math.PI

    // Re-using the logic, but adapting to use the new robust helpers if possible,
    // or keeping it simple. Let's convert it to use addStraightRamp for consistency if feasible,
    // but the original logic was slightly different.
    // To minimize regression risk on the Helix, I will keep a legacy helper or inline it here
    // using the new helper with correct math.

    // Original: addRamp(width, length, drop, rotY)
    // drop was Y change. length was Z (depth) of box.
    // pitch was atan2(drop, length).
    // This implies 'length' was the Adjacent side.
    
    const addRamp = (width: number, length: number, drop: number, rotY: number) => {
       // length here is Horizontal Distance approx.
       const incline = Math.atan2(drop, length)
       // Hypotenuse
       const meshLen = Math.sqrt(length * length + drop * drop)
       this.addStraightRamp(currentPos, rotY, width, meshLen, incline, holoMat)

       // Update pos manually as addStraightRamp returns endPos
       // But addStraightRamp moves 'meshLen' along incline.
       // Horizontal distance covered: meshLen * cos(incline) = length.
       // Vertical drop: meshLen * sin(incline) = drop.
       // So it matches.
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
      const coreMat = this.getTrackMaterial("#ff0033") // Red for "Corrupted" theme
      let currentPos = new Vector3(0, 20, 0) // Start high
      let heading = 0 // Facing North (+Z)

      // Track Parameters from PLAN.md

      // 1. The Injection Drop
      // Length 15 (Hypotenuse), Incline -20deg.
      const dropLen = 15
      const dropIncline = (20 * Math.PI) / 180
      currentPos = this.addStraightRamp(currentPos, heading, 6, dropLen, dropIncline, coreMat)

      // 2. Velocity Curve
      // Radius 15, Angle 180 (PI), Incline -5deg.
      // Left Turn (Standard positive angle).
      const curve1Radius = 15
      const curve1Angle = Math.PI
      const curve1Incline = (5 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, curve1Radius, curve1Angle, curve1Incline, 6, 3.0, coreMat)
      heading += curve1Angle

      // 3. The Firewall Gap
      // Length 8, Target Elevation -2.
      // Gap logic:
      const gapLength = 8
      const gapDrop = 2
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      // Landing Platform
      currentPos = this.addStraightRamp(currentPos, heading, 6, 5, 0, coreMat)

      // 4. The Corkscrew
      // Radius 8, Angle 270 (1.5 PI), Incline -15 deg.
      const corkRadius = 8
      const corkAngle = (270 * Math.PI) / 180
      const corkIncline = (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, corkRadius, corkAngle, corkIncline, 6, 1.0, coreMat)
      heading += corkAngle

      // 5. Root Access (Goal)
      this.createBasin(currentPos, coreMat)
  }

  // --- Track: The Quantum Grid ---
  private createQuantumGridTrack(): void {
      const gridMat = this.getTrackMaterial("#00FF00") // Matrix Green
      let currentPos = new Vector3(0, 10, 0)
      let heading = 0 // North (+Z)

      // 1. The Initialization Vector
      // Straight, Length 10, Flat (0 deg), Width 4, WallHeight 0
      // Note: addStraightRamp creates a box (floor), no walls built-in.
      currentPos = this.addStraightRamp(currentPos, heading, 4, 10, 0, gridMat)

      // 2. The Logic Gate (Zig-Zag)
      // Width 3. Pattern: Fwd 5, Left 90, Fwd 5, Right 90, Fwd 5.
      const zigzagWidth = 3
      const zigzagLen = 5
      const zigzagIncline = 0

      // Fwd 5
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)

      // Left 90 (Decrease heading by 90 deg = -PI/2)
      // Wait, standard math: Z is 0 deg. X is 90 deg?
      // Babylon system:
      // +Z is forward. +X is right.
      // 0 heading -> +Z.
      // +PI/2 heading -> +X (Right).
      // -PI/2 heading -> -X (Left).

      // "Left 90" usually implies -90 degrees in standard nav, but let's check Babylon rotation.
      // Mesh rotation.y: +Y rot turns Counter-Clockwise?
      // If I want to turn Left (from Z to -X), I should rotate Y by -90?
      // Let's assume standard "Left" turn.
      heading -= Math.PI / 2

      // Fwd 5
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)

      // Right 90
      heading += Math.PI / 2

      // Fwd 5
      currentPos = this.addStraightRamp(currentPos, heading, zigzagWidth, zigzagLen, zigzagIncline, gridMat)

      // 3. The Processor Core (Orbit)
      // Curved Ramp, Radius 6, Angle 270 (1.5 PI), Incline 5 deg (Upward = Negative Incline in my logic?)
      // addCurvedRamp `inclineRad`: Positive = Downward slope.
      // So Upward = Negative.
      const orbitRadius = 6
      const orbitAngle = (270 * Math.PI) / 180
      const orbitIncline = - (5 * Math.PI) / 180
      // const orbitWidth = 4 // Plan says GridWidth 3, but maybe widen for curve? Let's use 3.
      const orbitWallHeight = 0.5 // Low Curb

      currentPos = this.addCurvedRamp(currentPos, heading, orbitRadius, orbitAngle, orbitIncline, zigzagWidth, orbitWallHeight, gridMat)
      heading += orbitAngle

      // 4. The Upload Gap
      // Length 4, Target Elevation -1.
      const gapLength = 4
      const gapDrop = 1
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      // Landing pad before basin
      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, gridMat)

      // 5. Target (Goal)
      this.createBasin(currentPos, gridMat)
  }

  // --- Track: The Singularity Well ---
  private createSingularityWell(): void {
      const wellMat = this.getTrackMaterial("#9900FF") // Deep Purple
      let currentPos = new Vector3(0, 25, 0) // Start high
      let heading = 0 // North (+Z)

      // 1. Event Injection
      // Straight, Length 12, Incline -15 deg (Down), Width 6
      const injectLen = 12
      const injectIncline = (15 * Math.PI) / 180 // Positive for Down
      currentPos = this.addStraightRamp(currentPos, heading, 6, injectLen, injectIncline, wellMat)

      // 2. The Outer Rim (Horizon)
      // Radius 14, Angle 180, Incline -5 deg, Wall 4.0
      // Banking? "Tilt inward". Left turn -> Bank Left (-Z?).
      // Let's assume standard banking of 15 degrees (0.26 rad) for effect.
      const rimRadius = 14
      const rimAngle = Math.PI // 180 deg
      const rimIncline = (5 * Math.PI) / 180
      const rimBank = - (15 * Math.PI) / 180 // Bank Left

      currentPos = this.addCurvedRamp(currentPos, heading, rimRadius, rimAngle, rimIncline, 6, 4.0, wellMat, 20, rimBank)
      heading += rimAngle

      // 3. Transfer Orbit (Gap)
      // Length 4, Drop 2
      const gapLength = 4
      const gapDrop = 2
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      // Landing Platform for Gap
      // Small straight section to land on before next curve
      currentPos = this.addStraightRamp(currentPos, heading, 6, 4, 0, wellMat)

      // 4. The Accretion Disk
      // Radius 8, Angle 270, Incline -10 deg, Wall 1.0
      // Bank steeper: 25 degrees.
      const diskRadius = 8
      const diskAngle = (270 * Math.PI) / 180
      const diskIncline = (10 * Math.PI) / 180
      const diskBank = - (25 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, diskRadius, diskAngle, diskIncline, 6, 1.0, wellMat, 20, diskBank)
      heading += diskAngle

      // 5. The Singularity (Goal)
      this.createBasin(currentPos, wellMat)
  }

  // --- Track: The Glitch Spire ---
  private createGlitchSpireTrack(): void {
      const glitchMat = this.getTrackMaterial("#FF00FF") // Magenta
      let currentPos = new Vector3(0, 10, 0) // Mid-level start
      let heading = 0 // North (+Z)

      // 1. The Uplink (Ascent)
      // Straight, Length 15, Incline 20 degrees (Upward = Negative Incline in addStraightRamp?), Width 4, Wall 1.0
      // Note: addStraightRamp 'inclineRad' is positive for Downward slope (pitch down).
      // So Upward = Negative angle.
      const uplinkLen = 15
      const uplinkIncline = - (20 * Math.PI) / 180

      // Since addStraightRamp currently does not support walls, we might need to rely on the default box.
      // But PLAN.md says WallHeight 1.0.
      // The other tracks use addCurvedRamp for walls, or just flat ramps.
      // I'll stick to addStraightRamp for now and maybe add walls manually if needed,
      // or just assume "Low safety" means the 0.5 height of the ramp itself is the curb?
      // Actually, createDescentTrack uses addStraightRamp and then assumes 6 width is safe.
      // I will create the ramp. The player needs to be careful.
      currentPos = this.addStraightRamp(currentPos, heading, 4, uplinkLen, uplinkIncline, glitchMat)

      // 2. The Packet Loss (Gap)
      // Gap Length 6, Target Elevation -4 (Drop)
      const gapLength = 6
      const gapDrop = 4
      const gapForward = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(gapLength)
      currentPos = currentPos.add(gapForward)
      currentPos.y -= gapDrop

      // Landing Platform
      currentPos = this.addStraightRamp(currentPos, heading, 4, 3, 0, glitchMat)

      // 3. The Jitter Turn (Chicane)
      // Land -> Turn Right 90 -> Forward 5 -> Turn Left 90 -> Forward 5.
      // Width 3. WallHeight 0.0.

      // Turn Right 90.
      heading += Math.PI / 2

      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)

      // Turn Left 90
      heading -= Math.PI / 2

      // Forward 5
      currentPos = this.addStraightRamp(currentPos, heading, 3, 5, 0, glitchMat)

      // 4. The Stack Overflow (Vertical Crossover)
      // Curved Ramp (Spiral Down), Radius 8, Angle 360, Incline -10 deg (Down = Positive).
      // Note: "Down" usually means positive incline in my logic here (pitch down).
      // PLAN says "Incline -10 deg". In Descent track, Incline -20 was Down.
      // Wait. In Descent Track: `dropIncline = (20 * PI) / 180` (Positive number passed)
      // And the comment said "Incline: -20 degrees (Down)".
      // So in `addStraightRamp` logic, Positive `inclineRad` makes `vDrop` positive, so `y` decreases.
      // So Positive Angle = Down.
      // So if PLAN says -10 deg but implies "Spiral Down", I should use +10 deg in my function.
      const spiralRadius = 8
      const spiralAngle = 2 * Math.PI // 360 deg
      const spiralIncline = (10 * Math.PI) / 180 // Downward

      // WallHeight 0.0? PLAN doesn't specify wall height for spiral, but says "Visual knot".
      // Let's give it a small wall since it's a long spiral.
      // Actually, PLAN for Glitch Spire says: "The Jitter Turn... WallHeight 0.0".
      // Doesn't explicitly say for Stack Overflow. I'll add 0.5 for safety.

      currentPos = this.addCurvedRamp(currentPos, heading, spiralRadius, spiralAngle, spiralIncline, 3, 0.5, glitchMat, 30)
      heading += spiralAngle

      // 5. System Restore (Goal)
      this.createBasin(currentPos, glitchMat)
  }

  // --- Track: The Retro-Wave Hills ---
  private createRetroWaveHills(): void {
      const retroMat = this.getTrackMaterial("#FF8800") // Orange
      let currentPos = new Vector3(0, 5, 0)
      let heading = 0 // North (+Z)

      // 1. The Fade In
      // Straight, Length 10, Incline 0, Width 6
      currentPos = this.addStraightRamp(currentPos, heading, 6, 10, 0, retroMat)

      // 2. The Modulation (The Hills)
      // Hill 1: Rise (8u, -15°) -> Fall (8u, +15°)
      const hillLen = 8
      const rise1Incline = - (15 * Math.PI) / 180
      const fall1Incline = (15 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, rise1Incline, retroMat)
      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, fall1Incline, retroMat)

      // Hill 2: Rise (8u, -20°) -> Fall (8u, +20°)
      const rise2Incline = - (20 * Math.PI) / 180
      const fall2Incline = (20 * Math.PI) / 180

      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, rise2Incline, retroMat)
      currentPos = this.addStraightRamp(currentPos, heading, 6, hillLen, fall2Incline, retroMat)

      // 3. The Carrier Wave (Banked Turn)
      // Radius 12, Angle 180, Incline 0, Banking -15 deg (Inward Tilt)
      // Turn is 180 degrees. Let's assume standard "Right" or "Left"?
      // PLAN doesn't specify direction, but usually turns are continuations.
      // Let's do a Left Turn (Standard positive angle in my addCurvedRamp seems to be left? No wait.)
      // My addCurvedRamp:
      // currentHeading += (segmentAngle / 2)
      // forward = sin(heading), cos(heading).
      // If segmentAngle is Positive, heading Increases.
      // North (0) -> +PI/2 (Right/East).
      // So Positive Angle = Right Turn.
      // To "Bank Inward" on a Right Turn, we need to tilt Right.
      // Rotation Z: +Z roll tilts Left (CCW around Z). -Z roll tilts Right (CW around Z).
      // So for Right Turn, Banking should be Negative.
      // PLAN says Banking: -15 degrees.
      // Matches Right Turn.

      const turnRadius = 12
      const turnAngle = Math.PI // 180
      const turnIncline = 0
      const banking = - (15 * Math.PI) / 180

      currentPos = this.addCurvedRamp(currentPos, heading, turnRadius, turnAngle, turnIncline, 6, 2.0, retroMat, 20, banking)
      heading += turnAngle

      // 4. The High Pass Filter (The Jump)
      // Straight, Length 12, Incline -25 deg (Steep Ramp Up), Width 4
      const jumpLen = 12
      const jumpIncline = - (25 * Math.PI) / 180

      // Add a small flat lead-in to settle the ball before the jump? Not specified, stick to plan.
      // We need to calculate the release point carefully.
      // addStraightRamp returns the end position of the ramp mesh (top surface center).

      // Store start of jump to calculate trajectory if needed, but we just place the bucket.
      currentPos = this.addStraightRamp(currentPos, heading, 4, jumpLen, jumpIncline, retroMat)

      // 5. The Sunset (Goal)
      // Location: 15 units forward, 5 units up from jump release.
      const jumpForward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
      const goalDist = 15
      const goalHeight = 5

      const goalPos = currentPos.add(jumpForward.scale(goalDist))
      goalPos.y += goalHeight

      // Create goal basin at calculated position
      this.createBasin(goalPos, retroMat)
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
      // Checked: +X rotation tilts top-towards-camera (if looking at Z).
      // If we are heading 0 (+Z), +X rotation tilts the "far" end down?
      // Actually usually +X is "Looking Down" (pitch down).
      // If flat is (0,0,1). Rot X (90) -> (0,-1,0).
      // So yes, +X rotation = Downward slope.
      
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
      // Arc length for this segment on the circle
      const arcLength = radius * Math.abs(segmentAngle)

      // Straight-line length (Chord) for the segment mesh
      const chordLen = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2)

      // Vertical drop for this segment
      // The path travels 'arcLength' distance along the slope.
      // So vertical drop is based on arcLength? Or do we treat the chord as the slope path?
      // Usually "incline" is relative to the path traveled.
      // Let's use arcLength for slope calculation to be consistent with "travel distance".
      const segmentDrop = arcLength * Math.sin(inclineRad)

      // The box length should roughly match the chord.
      // If we tilt it, the horizontal projection of the chord shrinks slightly, but for small angles negligible.
      // Let's use chordLen as the mesh depth.

      let currentHeading = startHeading
      let currentP = startPos.clone()

      for (let i = 0; i < Math.abs(segments); i++) {
          // Move heading to the middle of the chord direction
          currentHeading += (segmentAngle / 2)

          // Calculate center position
          const forward = new Vector3(Math.sin(currentHeading), 0, Math.cos(currentHeading))
          const center = currentP.add(forward.scale(chordLen / 2))
          center.y -= segmentDrop / 2

          const box = MeshBuilder.CreateBox("curveSeg", { width, height: 0.5, depth: chordLen }, this.scene)
          box.position.copyFrom(center)
          // Rotation Order:
          // 1. Bank (Z) - Roll
          // 2. Incline (X) - Pitch
          // 3. Heading (Y) - Yaw
          // However, Babylon Euler order is YXZ (Yaw, Pitch, Roll) or similar.
          // We can use Quaternion to be precise.
          // Roll (Banking): Z axis. Pitch (Incline): X axis. Yaw (Heading): Y axis.
          // We want Banking to be "local" to the ramp surface?
          // Usually Banking is rotation around the Z axis (Forward).
          // Incline is rotation around X axis (Right).
          // Heading is rotation around Y axis (Up).

          box.rotation.x = inclineRad
          box.rotation.y = currentHeading
          box.rotation.z = bankingAngle

          // Re-calculate visual rotation using quaternion to ensure order is applied correctly if needed,
          // but Babylon .rotation property applies YXZ order by default.
          // Let's explicitly check if we need Quaternion for correct banking.
          // If we bank, we want the "Right" vector to dip.
          // If we Pitch (incline), we want the "Forward" vector to dip.

          box.material = material
          this.adventureTrack.push(box)

          // Physics
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

          // Walls
          if (wallHeight > 0) {
              this.createWall(center, currentHeading, chordLen, width, wallHeight, inclineRad, material)
          }

          // Advance Position
          currentP = currentP.add(forward.scale(chordLen))
          currentP.y -= segmentDrop

          // Complete the turn for this segment
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

          // Right vector relative to heading
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
