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
    } else {
        this.createHelixTrack()
    }
    
    // Reset ball velocity and teleport to start of track
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)

    // Teleport to the start position (should be synchronized with track creation)
    // For Cyber-Core, we start high up.
    const startPos = trackType === AdventureTrackType.CYBER_CORE
        ? new Vector3(0, 20, 0) // Adjusted for descent
        : new Vector3(0, 3, 8)

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
      segments: number = 20
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
          box.rotation.y = currentHeading
          box.rotation.x = inclineRad

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
