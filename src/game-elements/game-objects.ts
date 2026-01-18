import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  Color4,
  Quaternion,
  Texture,
  DynamicTexture,
  MirrorTexture,
  Scalar,
  Animation,
  ParticleSystem,
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'
import type { PhysicsBinding, BumperVisual } from './types'
import { GameConfig } from '../config'

export class GameObjects {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType
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

  private bumperParticles: ParticleSystem[] = []
  private particleTexture: Texture
  private mirrorTexture: MirrorTexture | null = null // Store reference

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType,
    particleTexture: Texture
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config
    this.particleTexture = particleTexture
  }

  createCabinetDecoration(): void {
    const chromeMat = new StandardMaterial("chromeMat", this.scene)
    chromeMat.diffuseColor = new Color3(0.1, 0.1, 0.1)
    chromeMat.specularColor = new Color3(1, 1, 1)
    chromeMat.roughness = 0.2

    const plasticMat = new StandardMaterial("plasticMat", this.scene)
    plasticMat.diffuseColor = Color3.FromHexString("#FF0055")
    plasticMat.emissiveColor = Color3.FromHexString("#440011")
    plasticMat.alpha = 0.9

    const trayWidth = 16
    const tray = MeshBuilder.CreateBox("ashtray", { width: trayWidth, height: 1.5, depth: 4 }, this.scene)
    tray.position.set(0, -2, -14)
    tray.material = chromeMat

    for(let i=0; i<30; i++) {
      const dummyBall = MeshBuilder.CreateSphere(`dummyBall_${i}`, { diameter: 0.8 }, this.scene)
      const x = Scalar.RandomRange(-trayWidth/2 + 1, trayWidth/2 - 1)
      const z = Scalar.RandomRange(-1.5, 1.5)
      dummyBall.position.set(x, 0.5, z).addInPlace(tray.position)
      dummyBall.material = chromeMat
    }

    const panel = MeshBuilder.CreateBox("controlPanel", { width: 8, height: 2, depth: 3 }, this.scene)
    panel.position.set(10, -1, -12)
    panel.rotation.x = 0.2
    const panelMat = new StandardMaterial("blackPlastic", this.scene)
    panelMat.diffuseColor = Color3.Black()
    panel.material = panelMat

    const btn = MeshBuilder.CreateCylinder("blastBtn", { diameter: 1.5, height: 0.5 }, this.scene)
    btn.position.set(0, 1, 0)
    btn.parent = panel
    const btnMat = new StandardMaterial("btnMat", this.scene)
    btnMat.diffuseColor = Color3.Red()
    btnMat.emissiveColor = Color3.Red().scale(0.4)
    btn.material = btnMat

    const path = [
      new Vector3(0, 0, 0),
      new Vector3(1, 2, 0),
      new Vector3(0, 4, 1),
      new Vector3(-1, 6, 0)
    ]

    const leftWing = MeshBuilder.CreateTube("wingL", { path, radius: 0.5, sideOrientation: 2 }, this.scene)
    leftWing.position.set(-14, 2, 0)
    leftWing.material = plasticMat

    const rightWing = MeshBuilder.CreateTube("wingR", { path, radius: 0.5, sideOrientation: 2 }, this.scene)
    rightWing.position.set(14, 2, 0)
    rightWing.scaling.x = -1
    rightWing.material = plasticMat

    const tubeMat = new StandardMaterial("glass", this.scene)
    tubeMat.alpha = 0.3
    tubeMat.diffuseColor = Color3.White()
    tubeMat.backFaceCulling = false

    const feedTube = MeshBuilder.CreateCylinder("feedTube", { height: 15, diameter: 1.2 }, this.scene)
    feedTube.position.set(-12, 5, 5)
    feedTube.material = tubeMat

    const ballCount = 5
    for(let i=0; i<ballCount; i++) {
      const dropBall = MeshBuilder.CreateSphere(`dropBall_${i}`, { diameter: 0.7 }, this.scene)
      dropBall.position.set(0, 6 - (i*3), 0)
      dropBall.parent = feedTube
      dropBall.material = chromeMat

      const frameRate = 30
      const anim = new Animation(`fall_${i}`, "position.y", frameRate, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE)
      const keyFrames = []
      keyFrames.push({ frame: 0, value: 7 })
      keyFrames.push({ frame: 60, value: -7 })
      anim.setKeys(keyFrames)
      dropBall.animations.push(anim)
      this.scene.beginAnimation(dropBall, 0, 60, true, 1.0 + (i * 0.1))
    }
  }

  createGround(mirrorTexture: MirrorTexture): void {
    this.mirrorTexture = mirrorTexture // Store for later use
    const groundMat = new StandardMaterial('groundMat', this.scene)
    groundMat.diffuseTexture = this.createGridTexture()
    ;(groundMat.diffuseTexture as Texture).uScale = 4
    ;(groundMat.diffuseTexture as Texture).vScale = 8

    // LCD Screen Effect: Make the texture emissive so it glows like a screen
    groundMat.emissiveTexture = groundMat.diffuseTexture
    // FIX: Set to Black to prevent "milky/washed out" look
    groundMat.emissiveColor = Color3.Black()

    // Remove external light influence (Diffuse) to prevent washout
    groundMat.diffuseColor = Color3.Black()

    // FIX: Reduce alpha to prevent "solid plastic" look, simulating dark glass
    groundMat.alpha = 0.85

    // Remove specular highlights to avoid "plastic" glare
    groundMat.specularColor = Color3.Black()
    // groundMat.reflectionTexture = mirrorTexture // REMOVED: LCD screens are not mirrors

    const ground = MeshBuilder.CreateGround('ground', { width: GameConfig.table.width, height: GameConfig.table.height }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = groundMat

    const groundBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(GameConfig.table.width/2, 0.1, GameConfig.table.height/2), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })
  }

  createWalls(): void {
    const wallMat = new StandardMaterial('wallMat', this.scene)
    wallMat.diffuseColor = Color3.Black()
    wallMat.emissiveColor = Color3.FromHexString("#00eeff")
    wallMat.alpha = 0.3

    const wallH = GameConfig.table.wallHeight

    // 1. Outer Walls
    this.createWall(new Vector3(-10, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    this.createWall(new Vector3(11.5, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    this.createWall(new Vector3(0.75, wallH, 20.5), new Vector3(22.5, 5, 1.0), wallMat) // Top

    // 2. Drain / Plunger Base Walls
    // this.createWall(new Vector3(9.5, wallH, 2), new Vector3(0.2, 5, 26), wallMat) // REMOVED: Replaced by Shortened Lane Guide below
    this.createWall(new Vector3(10.5, wallH, -10.5), new Vector3(1.9, 5, 1.0), wallMat) // Plunger Base

    // 3. THE FIX: Shortened Plunger Lane Guide
    // We use the new Config values to ensure the ball is released early
    this.createWall(
        new Vector3(9.5, wallH, GameConfig.table.laneGuideZ),
        new Vector3(0.2, 5, GameConfig.table.laneGuideLength),
        wallMat
    )

    // 4. Create Corner Wedges
    this.createCornerWedges(wallH)
  }

  /**
   * Creates angled deflectors in the top corners to prevent balls from sticking.
   * Calculated based on actual wall positions:
   * Left Wall X: -10
   * Right Wall X: 11.5
   * Top Wall Z: 20.5
   */
  private createCornerWedges(height: number): void {
    const wedgeSize = GameConfig.table.wedgeSize
    const thickness = GameConfig.table.wedgeThickness

    const wedgeMat = new StandardMaterial("wedgeMat", this.scene)
    wedgeMat.diffuseColor = new Color3(0.2, 0.2, 0.2)

    // Calculate diagonal width
    const diagWidth = Math.sqrt(2 * (wedgeSize * wedgeSize))

    const createWedge = (name: string, x: number, z: number, rotationY: number) => {
      const wedge = MeshBuilder.CreateBox(name, {
        width: diagWidth,
        height: height,
        depth: thickness
      }, this.scene)

      wedge.position.set(x, 1, z)
      wedge.rotation.y = rotationY
      wedge.material = wedgeMat

      const q = Quaternion.FromEulerAngles(0, rotationY, 0)
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(x, 1, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )

      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(diagWidth / 2, height / 2, thickness / 2)
          .setRestitution(0.5),
        body
      )

      this.bindings.push({ mesh: wedge, rigidBody: body })
      this.pinballMeshes.push(wedge)
    }

    // Top Left Corner Calculation
    // Corner is at (-10, 20.5). We move In (Right) by half wedgeSize and Down (Back) by half wedgeSize
    const tlX = -10 + (wedgeSize / 2)
    const tlZ = 20.5 - (wedgeSize / 2)
    createWedge("wedgeTL", tlX, tlZ, -Math.PI / 4) // 45 degrees

    // Top Right Corner Calculation
    // Corner is at (11.5, 20.5). We move In (Left) by half wedgeSize and Down (Back) by half wedgeSize
    const trX = 11.5 - (wedgeSize / 2)
    const trZ = 20.5 - (wedgeSize / 2)
    createWedge("wedgeTR", trX, trZ, Math.PI / 4) // -45 degrees
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

    const deathZoneVis = MeshBuilder.CreateBox("deathZoneVis", { width: 40, height: 0.1, depth: 4 }, this.scene)
    deathZoneVis.position.set(0, -2, -14)
    const deathMat = new StandardMaterial("deathMat", this.scene)
    deathMat.emissiveColor = Color3.Red()
    deathMat.alpha = 0.2
    deathZoneVis.material = deathMat
  }

  createFlippers(): { left: RAPIER.ImpulseJoint; right: RAPIER.ImpulseJoint } {
    const flipperMat = new StandardMaterial('flipperMat', this.scene)
    flipperMat.diffuseColor = Color3.Yellow()
    flipperMat.emissiveColor = Color3.FromHexString("#aa6600")
    flipperMat.specularColor = Color3.White()
    flipperMat.specularPower = 64

    const make = (pos: Vector3, right: boolean): RAPIER.RevoluteImpulseJoint => {
      const mesh = MeshBuilder.CreateBox("flipper", { width: 3.5, depth: 0.5, height: 0.5 }, this.scene) as Mesh
      mesh.material = flipperMat
      
      const flipperEnd = MeshBuilder.CreateSphere("flipperEnd", { diameter: 0.6 }, this.scene)
      flipperEnd.position.x = right ? 1.5 : -1.5
      flipperEnd.parent = mesh
      flipperEnd.material = flipperMat

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(0.5)
          .setAngularDamping(2)
          .setCcdEnabled(true)
      )
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(1.75, 0.25, 0.25), body)
      this.bindings.push({ mesh, rigidBody: body })
      this.pinballMeshes.push(mesh)
      this.pinballMeshes.push(flipperEnd)
      
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

      joint.configureMotorPosition(
        right ? -Math.PI / 4 : Math.PI / 4,
        GameConfig.table.flipperStrength, // Use config
        GameConfig.flipper.damping // Use config if available, but keeping original literal for now as it wasn't specified in new config for damping inside createFlippers logic fully
      )
      
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
      mat.diffuseColor = Color3.FromHexString(colorHex).scale(0.5)
      bumper.material = mat

      // --- REFINED HOLOGRAM PILLAR (Section 4) ---
      // Inner core (Dense)
      const holoInner = MeshBuilder.CreateCylinder("holoInner", { diameter: 0.6, height: 2.5, tessellation: 12 }, this.scene)
      holoInner.position.set(x, 1.8, z)
      
      const innerMat = new StandardMaterial("holoInnerMat", this.scene)
      innerMat.wireframe = true
      innerMat.emissiveColor = Color3.FromHexString(colorHex).scale(1.2)
      innerMat.alpha = 0.5
      holoInner.material = innerMat

      // Outer shell (Faint, wider)
      const holoOuter = MeshBuilder.CreateCylinder("holoOuter", { diameter: 1.0, height: 3.5, tessellation: 8 }, this.scene)
      holoOuter.position.set(x, 2.0, z)

      const outerMat = new StandardMaterial("holoOuterMat", this.scene)
      outerMat.wireframe = true
      outerMat.emissiveColor = Color3.White() // Techy contrast
      outerMat.alpha = 0.2
      holoOuter.material = outerMat

      // Parent outer to inner so we can reference one "hologram" group if needed,
      // but BumperVisual expects a single 'hologram' mesh.
      // We'll set 'holoInner' as the main ref, and parent outer to it for joint animation.
      holoOuter.parent = holoInner

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(0.4)
          .setRestitution(this.config.physics.bumperRestitution)
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
      this.bumperVisuals.push({ mesh: bumper, body: body, hologram: holoInner, hitTime: 0, sweep: Math.random() })
      this.pinballMeshes.push(bumper)
      this.pinballMeshes.push(holoInner)
      this.pinballMeshes.push(holoOuter)

      // Particle System
      if (this.config.visuals.enableParticles) {
        const ps = new ParticleSystem(`bumperParticles_${x}_${z}`, 50, this.scene)
        ps.particleTexture = this.particleTexture
        ps.emitter = bumper
        ps.minEmitBox = new Vector3(-0.5, 0, -0.5)
        ps.maxEmitBox = new Vector3(0.5, 0, 0.5)
        ps.color1 = new Color4(1, 0.5, 0, 1)
        ps.color2 = new Color4(1, 0, 1, 1)
        ps.minSize = 0.1
        ps.maxSize = 0.3
        ps.minLifeTime = 0.1
        ps.maxLifeTime = 0.3
        ps.emitRate = 100
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE
        ps.gravity = new Vector3(0, -9.81, 0)
        ps.direction1 = new Vector3(-1, 1, -1)
        ps.direction2 = new Vector3(1, 1, 1)
        ps.minAngularSpeed = 0
        ps.maxAngularSpeed = Math.PI
        ps.minEmitPower = 2
        ps.maxEmitPower = 5
        ps.updateSpeed = 0.01
        ps.stop()
        this.bumperParticles.push(ps)
      }
    }

    make(0, 8, "#ff00aa")
    make(-4, 4, "#00aaff")
    make(4, 4, "#00aaff")
  }

  createPachinkoField(center: Vector3, width: number, height: number): void {
    // --- REFINED METALLIC NAILS (Section 4) ---
    const pinMat = new StandardMaterial("pinMat", this.scene)
    pinMat.diffuseColor = Color3.FromHexString("#888888") // Darker base
    pinMat.specularColor = Color3.White()
    pinMat.specularPower = 64 // Sharp highlight
    pinMat.emissiveColor = Color3.Black() // No emission for physical look
    pinMat.alpha = 1.0

    // Add reflection if mirror texture is available
    if (this.mirrorTexture) {
        pinMat.reflectionTexture = this.mirrorTexture
        pinMat.roughness = 0.4 // Chrome-like
    }

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

        // Use slightly smaller diameter for more precision look
        const pin = MeshBuilder.CreateCylinder(`pin_${r}_${c}`, { diameter: 0.2, height: 1.5, tessellation: 12 }, this.scene)
        pin.position.set(x, 0.5, z)
        pin.material = pinMat

        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
        )
        this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(0.75, 0.1) // Match visual radius closely (0.1 = dia 0.2)
            .setRestitution(0.5)
            .setFriction(0.1),
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
    slingMat.alpha = 0.7

    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingMat)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingMat)
  }

  updateBumpers(dt: number): void {
    const time = performance.now() * 0.001

    this.bumperVisuals.forEach((vis, index) => {
      // Rotate the inner hologram
      if (vis.hologram) {
        vis.hologram.rotation.y += dt * 1.5
        vis.hologram.position.y = 1.8 + Math.sin(time * 2 + vis.sweep * 10) * 0.1

        // Rotate child (Outer) in opposite direction if it exists
        const child = vis.hologram.getChildren()[0] as Mesh
        if (child) {
            child.rotation.y -= dt * 3.0
        }
      }

      if (vis.hitTime > 0) {
        vis.hitTime -= dt
        const s = 1 + (vis.hitTime * 2)
        vis.mesh.scaling.set(s, s, s)

        if (vis.hologram) {
          vis.hologram.scaling.set(1, 1 + vis.hitTime, 1)
          vis.hologram.material!.alpha = 0.8
        }

        if (this.config.visuals.enableParticles && this.bumperParticles[index]) {
          this.bumperParticles[index].start()
        }
      } else {
        vis.mesh.scaling.set(1, 1, 1)
        if (vis.hologram) {
          vis.hologram.scaling.set(1, 1, 1)
          vis.hologram.material!.alpha = 0.5
        }

        if (this.bumperParticles[index] && this.bumperParticles[index].isStarted()) {
          this.bumperParticles[index].stop()
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
      } else {
        const pulse = Math.sin(performance.now() * 0.005) * 0.1 + 1
        this.targetMeshes[i].scaling.set(pulse, pulse, pulse)
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
      this.targetRespawnTimer[idx] = this.config.gameplay.targetRespawnTime
      return true
    }
    return false
  }

  resetTargets(): void {
    this.targetActive.fill(true)
    this.targetRespawnTimer.fill(0)
    this.targetMeshes.forEach(m => {
      m.isVisible = true
      m.scaling.set(1, 1, 1)
    })
  }

  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial): void {
    const w = MeshBuilder.CreateBox("w", { width: size.x, height: size.y * 2, depth: size.z }, this.scene)
    w.position.copyFrom(pos)
    w.material = mat
    
    const b = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size.x / 2, size.y, size.z / 2)
        .setFriction(0.3),
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

  dispose(): void {
    this.bumperParticles.forEach(ps => ps.dispose())
    this.pinballMeshes.forEach(m => m.dispose())
    this.bindings = []
    this.bumperVisuals = []
    this.bumperBodies = []
    this.targetBodies = []
    this.targetMeshes = []
    this.pinballMeshes = []
  }
}
