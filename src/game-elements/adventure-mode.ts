import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  Quaternion,
  ArcRotateCamera,
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export class AdventureMode {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private adventureTrack: Mesh[] = []
  private adventureBodies: RAPIER.RigidBody[] = []
  private adventureSensor: RAPIER.RigidBody | null = null
  private adventureActive = false
  private tableCamera: ArcRotateCamera | null = null
  private followCamera: ArcRotateCamera | null = null

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
  }

  isActive(): boolean {
    return this.adventureActive
  }

  getSensor(): RAPIER.RigidBody | null {
    return this.adventureSensor
  }

  start(ballBody: RAPIER.RigidBody, currentCamera: ArcRotateCamera, ballMesh: Mesh | undefined): void {
    if (this.adventureActive) return
    
    this.adventureActive = true
    this.createTrack()
    
    ballBody.setTranslation({ x: 0, y: 3, z: 8 }, true)
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    
    this.tableCamera = currentCamera
    this.followCamera = new ArcRotateCamera("isoCam", -Math.PI / 2, 0.8, 15, Vector3.Zero(), this.scene)
    
    if (ballMesh) {
      this.followCamera.lockedTarget = ballMesh
    }
    
    this.scene.activeCamera = this.followCamera
  }

  end(): void {
    if (!this.adventureActive) return
    
    this.adventureActive = false
    
    if (this.tableCamera) {
      this.scene.activeCamera = this.tableCamera
      this.followCamera?.dispose()
      this.followCamera = null
    }
    
    this.adventureTrack.forEach(m => m.dispose())
    this.adventureTrack = []
    
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
    const holoMat = new StandardMaterial("holoTrackMat", this.scene)
    holoMat.emissiveColor = Color3.FromHexString("#00ffff")
    holoMat.diffuseColor = Color3.Black()
    holoMat.alpha = 0.6
    holoMat.wireframe = true

    let currentPos = new Vector3(0, 2, 8)
    
    const addRamp = (width: number, length: number, drop: number, rotY: number) => {
      const box = MeshBuilder.CreateBox("holoRamp", { width, height: 0.5, depth: length }, this.scene)
      const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
      const center = currentPos.add(forward.scale(length / 2))
      center.y -= drop / 2
      
      box.position.copyFrom(center)
      box.rotation.y = rotY
      box.rotation.x = Math.atan2(drop, length)
      box.material = holoMat
      
      this.adventureTrack.push(box)
      
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
      currentPos = currentPos.add(forward.scale(length))
      currentPos.y -= drop
      return currentPos
    }

    let heading = Math.PI
    addRamp(6, 10, 4, heading)
    heading += Math.PI / 2
    addRamp(4, 6, 1, heading)
    heading -= Math.PI / 1.5
    addRamp(4, 12, 3, heading)

    const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 4 }, this.scene)
    basin.position.set(0, currentPos.y - 1, -8)
    basin.material = holoMat
    this.adventureTrack.push(basin)

    const bBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, currentPos.y - 1, -8)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(4, 0.5, 2), bBody)
    this.adventureBodies.push(bBody)

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
