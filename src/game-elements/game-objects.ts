import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  Quaternion,
  Texture,
  DynamicTexture,
  MirrorTexture,
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsBinding, BumperVisual } from './types'

export class GameObjects {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private bindings: PhysicsBinding[] = []
  private bumperVisuals: BumperVisual[] = []
  private bumperBodies: RAPIER.RigidBody[] = []
  private targetBodies: RAPIER.RigidBody[] = []
  private targetMeshes: Mesh[] = []
  private targetActive: boolean[] = []
  private targetRespawnTimer: number[] = []
  private flipperLeftJoint: RAPIER.ImpulseJoint | null = null
  private flipperRightJoint: RAPIER.ImpulseJoint | null = null
  private deathZoneBody: RAPIER.RigidBody | null = null
  private pinballMeshes: Mesh[] = []

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
  }

  createGround(mirrorTexture: MirrorTexture): void {
    const groundMat = new StandardMaterial('groundMat', this.scene)
    groundMat.diffuseTexture = this.createGridTexture()
    ;(groundMat.diffuseTexture as Texture).uScale = 4
    ;(groundMat.diffuseTexture as Texture).vScale = 8
    groundMat.specularColor = new Color3(0.5, 0.5, 0.5)
    groundMat.reflectionTexture = mirrorTexture

    const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 32 }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = groundMat
    
    const groundBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(12, 0.1, 16), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })
  }

  createWalls(): void {
    const wallMat = new StandardMaterial('wallMat', this.scene)
    wallMat.diffuseColor = Color3.Black()
    wallMat.emissiveColor = Color3.FromHexString("#00eeff")
    wallMat.alpha = 0.3

    const wallH = 4
    this.createWall(new Vector3(-10, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    this.createWall(new Vector3(11.5, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    this.createWall(new Vector3(0.75, wallH, 20.5), new Vector3(22.5, 5, 1.0), wallMat)
    this.createWall(new Vector3(9.5, wallH, 2), new Vector3(0.2, 5, 26), wallMat)
    this.createWall(new Vector3(10.5, wallH, -10.5), new Vector3(1.9, 5, 1.0), wallMat)
  }

  createDeathZone(): void {
    this.deathZoneBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -2, -14)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(20, 2, 2)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      this.deathZoneBody
    )
  }

  createFlippers(): { left: RAPIER.ImpulseJoint; right: RAPIER.ImpulseJoint } {
    const flipperMat = new StandardMaterial('flipperMat', this.scene)
    flipperMat.diffuseColor = Color3.Yellow()
    flipperMat.emissiveColor = Color3.FromHexString("#aa6600")

    const make = (pos: Vector3, right: boolean): RAPIER.RevoluteImpulseJoint => {
      const mesh = MeshBuilder.CreateBox("flipper", { width: 3.5, depth: 0.5, height: 0.5 }, this.scene) as Mesh
      mesh.material = flipperMat
      
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      )
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(1.75, 0.25, 0.25), body)
      this.bindings.push({ mesh, rigidBody: body })
      this.pinballMeshes.push(mesh)
      
      const anchor = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      
      const pX = right ? 1.5 : -1.5
      const jParams = this.rapier.JointData.revolute(
        new this.rapier.Vector3(pX, 0, 0),
        new this.rapier.Vector3(pX, 0, 0),
        new this.rapier.Vector3(0, 1, 0)
      )
      jParams.limitsEnabled = true
      jParams.limits = right ? [-Math.PI / 4, Math.PI / 6] : [-Math.PI / 6, Math.PI / 4]
      
      const joint = this.world.createImpulseJoint(jParams, anchor, body, true) as RAPIER.RevoluteImpulseJoint
      joint.configureMotorPosition(right ? -Math.PI / 4 : Math.PI / 4, 100000, 1000)
      
      return joint
    }

    this.flipperLeftJoint = make(new Vector3(-4, -0.5, -7), false)
    this.flipperRightJoint = make(new Vector3(4, -0.5, -7), true)

    return {
      left: this.flipperLeftJoint,
      right: this.flipperRightJoint
    }
  }

  createBumpers(): void {
    const make = (x: number, z: number, colorHex: string) => {
      const bumper = MeshBuilder.CreateSphere("bump", { diameter: 0.8 }, this.scene) as Mesh
      bumper.position.set(x, 0.5, z)
      
      const mat = new StandardMaterial("bMat", this.scene)
      mat.emissiveColor = Color3.FromHexString(colorHex)
      bumper.material = mat

      const holo = MeshBuilder.CreateCylinder("holo", { diameter: 0.8, height: 3, tessellation: 16 }, this.scene)
      holo.position.set(x, 2.0, z)
      
      const holoMat = new StandardMaterial("holoMat", this.scene)
      holoMat.wireframe = true
      holoMat.emissiveColor = Color3.FromHexString(colorHex)
      holoMat.alpha = 0.3
      holo.material = holoMat

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(0.4)
          .setRestitution(1.5)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.cylinder(1.5, 0.5)
          .setSensor(true)
          .setTranslation(0, 2.0, 0)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      this.bindings.push({ mesh: bumper, rigidBody: body })
      this.bumperBodies.push(body)
      this.bumperVisuals.push({ mesh: bumper, body: body, hologram: holo, hitTime: 0, sweep: Math.random() })
      this.pinballMeshes.push(bumper)
      this.pinballMeshes.push(holo)
    }

    make(0, 8, "#ff00aa")
    make(-4, 4, "#00aaff")
    make(4, 4, "#00aaff")
  }

  createPachinkoField(center: Vector3, width: number, height: number): void {
    const pinMat = new StandardMaterial("pinMat", this.scene)
    pinMat.diffuseColor = Color3.FromHexString("#cccccc")
    pinMat.specularColor = Color3.White()
    pinMat.specularPower = 128
    pinMat.emissiveColor = Color3.FromHexString("#003333").scale(0.1)
    pinMat.alpha = 1.0

    const rows = 6
    const cols = 9
    const spacingX = width / cols
    const spacingZ = height / rows
    
    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2 === 0) ? 0 : spacingX / 2
      for (let c = 0; c < cols; c++) {
        const x = center.x - (width / 2) + c * spacingX + offsetX
        const z = center.z - (height / 2) + r * spacingZ
        if (Math.abs(x) < 2 && Math.abs(z - center.z) < 2) continue
        
        const pin = MeshBuilder.CreateCylinder(`pin_${r}_${c}`, { diameter: 0.3, height: 1.5 }, this.scene)
        pin.position.set(x, 0.5, z)
        pin.material = pinMat
        
        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
        )
        this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(0.75, 0.15).setRestitution(0.5),
          body
        )
        
        this.bindings.push({ mesh: pin, rigidBody: body })
        this.pinballMeshes.push(pin)
      }
    }

    const catcher = MeshBuilder.CreateTorus("catcher", { diameter: 2.5, thickness: 0.2 }, this.scene)
    catcher.position.set(center.x, 0.2, center.z)
    
    const catcherMat = new StandardMaterial("catcherMat", this.scene)
    catcherMat.emissiveColor = Color3.FromHexString("#ff00aa")
    catcherMat.alpha = 0.8
    catcher.material = catcherMat

    const catchBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, 0.2, center.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.5, 1.0)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      catchBody
    )

    this.targetBodies.push(catchBody)
    this.targetMeshes.push(catcher)
    this.targetActive.push(true)
    this.targetRespawnTimer.push(0)
    this.pinballMeshes.push(catcher)
  }

  createSlingshots(): void {
    const slingMat = new StandardMaterial('slingMat', this.scene)
    slingMat.emissiveColor = Color3.White()
    
    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingMat)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingMat)
  }

  updateBumpers(dt: number): void {
    const time = performance.now() * 0.001
    
    this.bumperVisuals.forEach(vis => {
      if (vis.hologram) {
        vis.hologram.rotation.y += dt * 1.5
        vis.hologram.position.y = 2.0 + Math.sin(time * 2 + vis.sweep * 10) * 0.2
      }
      
      if (vis.hitTime > 0) {
        vis.hitTime -= dt
        const s = 1 + (vis.hitTime * 2)
        vis.mesh.scaling.set(s, s, s)
        
        if (vis.hologram) {
          vis.hologram.scaling.set(1, 1 + vis.hitTime, 1)
          vis.hologram.material!.alpha = 0.8
        }
      } else {
        vis.mesh.scaling.set(1, 1, 1)
        if (vis.hologram) {
          vis.hologram.scaling.set(1, 1, 1)
          vis.hologram.material!.alpha = 0.3
        }
      }
    })
  }

  updateTargets(dt: number): void {
    for (let i = 0; i < this.targetActive.length; i++) {
      if (!this.targetActive[i]) {
        this.targetRespawnTimer[i] -= dt
        if (this.targetRespawnTimer[i] <= 0) {
          this.targetActive[i] = true
          this.targetMeshes[i].isVisible = true
        }
      }
    }
  }

  activateBumperHit(body: RAPIER.RigidBody): void {
    const vis = this.bumperVisuals.find(v => v.body === body)
    if (vis) {
      vis.hitTime = 0.2
    }
  }

  deactivateTarget(body: RAPIER.RigidBody): boolean {
    const idx = this.targetBodies.indexOf(body)
    if (idx !== -1 && this.targetActive[idx]) {
      this.targetActive[idx] = false
      this.targetMeshes[idx].isVisible = false
      this.targetRespawnTimer[idx] = 5.0
      return true
    }
    return false
  }

  resetTargets(): void {
    this.targetActive.fill(true)
    this.targetRespawnTimer.fill(0)
    this.targetMeshes.forEach(m => m.isVisible = true)
  }

  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial): void {
    const w = MeshBuilder.CreateBox("w", { width: size.x, height: size.y * 2, depth: size.z }, this.scene)
    w.position.copyFrom(pos)
    w.material = mat
    
    const b = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size.x / 2, size.y, size.z / 2),
      b
    )
    
    this.bindings.push({ mesh: w, rigidBody: b })
    this.pinballMeshes.push(w)
  }

  private createSlingshot(pos: Vector3, rot: number, mat: StandardMaterial): void {
    const mesh = MeshBuilder.CreateBox("sling", { width: 0.5, height: 2, depth: 4 }, this.scene)
    mesh.rotation.y = rot
    mesh.position.copyFrom(pos)
    mesh.material = mat
    
    const q = Quaternion.FromEulerAngles(0, rot, 0)
    const b = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.25, 1, 2)
        .setRestitution(1.5)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      b
    )
    
    this.bindings.push({ mesh, rigidBody: b })
    this.bumperBodies.push(b)
    this.bumperVisuals.push({ mesh, body: b, hitTime: 0, sweep: 0 })
    this.pinballMeshes.push(mesh)
  }

  private createGridTexture(): Texture {
    const dynamicTexture = new DynamicTexture('gridTexture', 512, this.scene, true)
    dynamicTexture.hasAlpha = true
    const ctx = dynamicTexture.getContext()
    const size = 512
    
    ctx.fillStyle = '#050510'
    ctx.fillRect(0, 0, size, size)
    ctx.lineWidth = 3
    ctx.strokeStyle = '#aa00ff'
    ctx.shadowBlur = 10
    ctx.shadowColor = '#d000ff'
    
    const step = size / 8
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }
    
    ctx.strokeRect(0, 0, size, size)
    dynamicTexture.update()
    return dynamicTexture
  }

  getBindings(): PhysicsBinding[] {
    return this.bindings
  }

  getBumperBodies(): RAPIER.RigidBody[] {
    return this.bumperBodies
  }

  getBumperVisuals(): BumperVisual[] {
    return this.bumperVisuals
  }

  getTargetBodies(): RAPIER.RigidBody[] {
    return this.targetBodies
  }

  getDeathZoneBody(): RAPIER.RigidBody | null {
    return this.deathZoneBody
  }

  getFlipperJoints(): { left: RAPIER.ImpulseJoint | null; right: RAPIER.ImpulseJoint | null } {
    return {
      left: this.flipperLeftJoint,
      right: this.flipperRightJoint
    }
  }

  getPinballMeshes(): Mesh[] {
    return this.pinballMeshes
  }

  addBinding(binding: PhysicsBinding): void {
    this.bindings.push(binding)
  }

  removeBinding(rigidBody: RAPIER.RigidBody): void {
    const idx = this.bindings.findIndex(b => b.rigidBody === rigidBody)
    if (idx !== -1) {
      this.bindings[idx].mesh.dispose()
      this.bindings.splice(idx, 1)
    }
  }
}
