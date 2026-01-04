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
  start(ballBody: RAPIER.RigidBody, currentCamera: ArcRotateCamera, ballMesh: Mesh | undefined): void {
    if (this.adventureActive) return
    this.adventureActive = true

    // Notify the Game class to update the Display
    if (this.onEvent) this.onEvent('START')

    this.createTrack()
    
    // Reset ball velocity and teleport to start of track
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    ballBody.setTranslation({ x: 0, y: 3, z: 8 }, true)
    
    // Store original camera to restore later
    this.tableCamera = currentCamera

    // Create new RPG-style Isometric Camera
    this.followCamera = new ArcRotateCamera("isoCam", -Math.PI / 2, Math.PI / 3, 14, Vector3.Zero(), this.scene)
    this.followCamera.lowerRadiusLimit = 8
    this.followCamera.upperRadiusLimit = 25
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

  private createTrack(): void {
    // "Tron" style wireframe material
    const holoMat = new StandardMaterial("holoTrackMat", this.scene)
    holoMat.emissiveColor = Color3.FromHexString("#00ffff")
    holoMat.diffuseColor = Color3.Black()
    holoMat.alpha = 0.5
    holoMat.wireframe = true

    let currentPos = new Vector3(0, 2, 8)
    
    // Helper to generate track segments procedurally
    const addRamp = (width: number, length: number, drop: number, rotY: number) => {
      const box = MeshBuilder.CreateBox("holoRamp", { width, height: 0.5, depth: length }, this.scene)

      // Calculate position based on rotation
      const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
      const center = currentPos.add(forward.scale(length / 2))
      center.y -= drop / 2
      
      box.position.copyFrom(center)
      box.rotation.y = rotY
      // Tilt downward based on drop
      box.rotation.x = Math.atan2(drop, length)
      box.material = holoMat
      
      this.adventureTrack.push(box)
      
      // Physics Body
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

      // Update cursor for next segment
      currentPos = currentPos.add(forward.scale(length))
      currentPos.y -= drop
      return currentPos
    }

    // --- Level Design Sequence ---
    let heading = Math.PI // Facing "North" (into the screen)

    // 1. The Drop
    addRamp(6, 10, 4, heading)

    // 2. The Turn
    heading += Math.PI / 2
    addRamp(4, 8, 1, heading)

    // 3. The Spiral
    heading -= Math.PI / 1.5
    addRamp(4, 12, 3, heading)

    // 4. The Basin (Catch area)
    const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 8 }, this.scene)
    basin.position.set(0, currentPos.y - 1, -8)
    basin.material = holoMat
    this.adventureTrack.push(basin)

    const bBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, currentPos.y - 1, -8)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(4, 0.5, 4), bBody)
    this.adventureBodies.push(bBody)

    // 5. Exit Sensor (Returns to Table)
    const sensorY = currentPos.y - 0.5
    const sensor = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, sensorY, -8)
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
