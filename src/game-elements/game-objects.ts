import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Color4,
  Quaternion,
  Texture,
  Scalar,
  Animation,
  ParticleSystem,
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'
import type { PhysicsBinding, BumperVisual } from './types'
import { GameConfig } from '../config'
import { getMaterialLibrary } from './material-library'
import {
  PALETTE,
  INTENSITY,
  STATE_PROFILES,
  color,
  emissive,
  stateEmissive,
} from './visual-language'

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
  private matLib: ReturnType<typeof getMaterialLibrary>

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
    this.matLib = getMaterialLibrary(scene)
  }

  createCabinetDecoration(): void {
    // Use MaterialLibrary for consistent materials
    const chromeMat = this.matLib.getChromeMaterial()
    const plasticMat = this.matLib.getNeonBumperMaterial('#FF0055') // Use as accent plastic
    const brushedMetalMat = this.matLib.getBrushedMetalMaterial()
    const glassTubeMat = this.matLib.getGlassTubeMaterial()
    const blackPlasticMat = this.matLib.getBlackPlasticMaterial()

    // Enhanced ball tray with metallic finish
    const trayWidth = 16
    const tray = MeshBuilder.CreateBox("ashtray", { width: trayWidth, height: 1.2, depth: 4 }, this.scene)
    tray.position.set(0, -2.2, -14)
    tray.material = brushedMetalMat

    // Random chrome balls with better distribution
    for(let i=0; i<25; i++) {
      const dummyBall = MeshBuilder.CreateSphere(`dummyBall_${i}`, { diameter: 0.7 + Math.random() * 0.2 }, this.scene)
      const x = Scalar.RandomRange(-trayWidth/2 + 1.5, trayWidth/2 - 1.5)
      const z = Scalar.RandomRange(-1.2, 1.2)
      const y = Scalar.RandomRange(0.3, 0.6)
      dummyBall.position.set(x, y, z).addInPlace(tray.position)
      dummyBall.material = chromeMat
    }

    // Enhanced control panel
    const panel = MeshBuilder.CreateBox("controlPanel", { width: 8, height: 1.8, depth: 3 }, this.scene)
    panel.position.set(10, -1.2, -12)
    panel.rotation.x = 0.2
    panel.material = blackPlasticMat

    // LED button with glow
    const btn = MeshBuilder.CreateCylinder("blastBtn", { diameter: 1.2, height: 0.3 }, this.scene)
    btn.position.set(0, 1, 0)
    btn.parent = panel
    const btnMat = new StandardMaterial("btnMat", this.scene)
    btnMat.diffuseColor = Color3.FromHexString("#ff0044")
    btnMat.emissiveColor = Color3.FromHexString("#ff0044").scale(0.8)
    btn.material = btnMat

    // ================================================================
    // PLUNGER/SHOOTER ROD ASSEMBLY
    // ================================================================
    
    // Shooter housing (the metal tube)
    const shooterHousing = MeshBuilder.CreateCylinder("shooterHousing", { 
      diameter: 1.2, 
      height: 6,
      tessellation: 16 
    }, this.scene)
    shooterHousing.rotation.x = Math.PI / 2
    shooterHousing.position.set(10.5, -0.2, -10)
    shooterHousing.material = chromeMat

    // Shooter rod (the plunger)
    const shooterRod = MeshBuilder.CreateCylinder("shooterRod", { 
      diameter: 0.4, 
      height: 5,
      tessellation: 12 
    }, this.scene)
    shooterRod.rotation.x = Math.PI / 2
    shooterRod.position.set(10.5, -0.2, -10)
    const rodMat = new StandardMaterial("rodMat", this.scene)
    rodMat.diffuseColor = new Color3(0.7, 0.7, 0.8)
    rodMat.specularColor = new Color3(1, 1, 1)
    shooterRod.material = rodMat

    // Plunger handle (knob at the end)
    const plungerKnob = MeshBuilder.CreateCylinder("plungerKnob", { 
      diameter: 1.5, 
      height: 0.8,
      tessellation: 16 
    }, this.scene)
    plungerKnob.rotation.x = Math.PI / 2
    plungerKnob.position.set(10.5, -0.2, -13)
    plungerKnob.material = blackPlasticMat

    // Shooter spring (coiled detail)
    const spring = MeshBuilder.CreateTorus("shooterSpring", { 
      diameter: 0.8, 
      thickness: 0.15,
      tessellation: 16 
    }, this.scene)
    spring.position.set(10.5, -0.2, -11.5)
    spring.rotation.x = Math.PI / 2
    const springMat = new StandardMaterial("springMat", this.scene)
    springMat.diffuseColor = new Color3(0.5, 0.5, 0.6)
    spring.material = springMat

    // Plunger lane guide rail (the wall the ball rides against)
    const laneGuide = MeshBuilder.CreateBox("laneGuide", { width: 0.3, height: 1.5, depth: 12 }, this.scene)
    laneGuide.position.set(8.2, -0.3, -8)
    laneGuide.material = chromeMat

    // Decorative wing rails with better geometry
    const path = [
      new Vector3(0, 0, 0),
      new Vector3(0.8, 2, 0),
      new Vector3(0.2, 4, 0.5),
      new Vector3(-0.5, 6, 0)
    ]

    const leftWing = MeshBuilder.CreateTube("wingL", { path, radius: 0.4, sideOrientation: 2 }, this.scene)
    leftWing.position.set(-13.5, 1.5, 0)
    leftWing.material = plasticMat

    const rightWing = MeshBuilder.CreateTube("wingR", { path, radius: 0.4, sideOrientation: 2 }, this.scene)
    rightWing.position.set(14.5, 1.5, 0)
    rightWing.scaling.x = -1
    rightWing.material = plasticMat

    const feedTube = MeshBuilder.CreateCylinder("feedTube", { height: 15, diameter: 1.0, tessellation: 16 }, this.scene)
    feedTube.position.set(-12, 5, 5)
    feedTube.material = glassTubeMat

    // Animated balls in tube
    const ballCount = 5
    for(let i=0; i<ballCount; i++) {
      const dropBall = MeshBuilder.CreateSphere(`dropBall_${i}`, { diameter: 0.6 }, this.scene)
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

    // Add side rails for depth perception
    this.createSideRails(brushedMetalMat, plasticMat)
  }

  private createSideRails(metalMat: PBRMaterial, accentMat: PBRMaterial): void {
    // ================================================================
    // RAISED PLAYFIELD RAILS - Multi-layer profile for depth
    // ================================================================
    
    // Main rail bodies - taller for better silhouette
    const leftRail = MeshBuilder.CreateBox("leftRail", { width: 1.2, height: 1.5, depth: 32 }, this.scene)
    leftRail.position.set(-12.3, -0.2, 5)
    leftRail.material = metalMat
    this.pinballMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox("rightRail", { width: 1.2, height: 1.5, depth: 32 }, this.scene)
    rightRail.position.set(13.3, -0.2, 5)
    rightRail.material = metalMat
    this.pinballMeshes.push(rightRail)

    // Top rail surface - where ball contacts
    const leftRailTop = MeshBuilder.CreateBox("leftRailTop", { width: 0.8, height: 0.2, depth: 31 }, this.scene)
    leftRailTop.position.set(-12.1, 0.55, 5)
    leftRailTop.material = metalMat
    this.pinballMeshes.push(leftRailTop)

    const rightRailTop = MeshBuilder.CreateBox("rightRailTop", { width: 0.8, height: 0.2, depth: 31 }, this.scene)
    rightRailTop.position.set(13.1, 0.55, 5)
    rightRailTop.material = metalMat
    this.pinballMeshes.push(rightRailTop)

    // LED accent strips on inner rail face
    const leftLED = MeshBuilder.CreateBox("leftRailLED", { width: 0.1, height: 0.15, depth: 30 }, this.scene)
    leftLED.position.set(-11.7, 0.3, 5)
    leftLED.material = accentMat

    const rightLED = MeshBuilder.CreateBox("rightRailLED", { width: 0.1, height: 0.15, depth: 30 }, this.scene)
    rightLED.position.set(12.7, 0.3, 5)
    rightLED.material = accentMat

    // ================================================================
    // PLUNGER LANE RAILS - Raised walls for the shooter lane
    // ================================================================
    
    // Inner plunger lane wall
    const plungerInner = MeshBuilder.CreateBox("plungerInner", { width: 0.4, height: 2, depth: 20 }, this.scene)
    plungerInner.position.set(8.5, 0, -5)
    plungerInner.material = metalMat
    this.pinballMeshes.push(plungerInner)

    // Plunger lane LED strip
    const plungerLED = MeshBuilder.CreateBox("plungerLED", { width: 0.1, height: 0.1, depth: 18 }, this.scene)
    plungerLED.position.set(8.3, 0.8, -5)
    plungerLED.material = accentMat

    // ================================================================
    // FLIPPER AREA RAILS - Curved guides near flippers
    // ================================================================
    
    // Left flipper rail (angled)
    const leftFlipperRail = MeshBuilder.CreateBox("leftFlipperRail", { width: 0.6, height: 1.2, depth: 8 }, this.scene)
    leftFlipperRail.position.set(-7, -0.3, -8)
    leftFlipperRail.rotation.y = -0.3
    leftFlipperRail.material = metalMat
    this.pinballMeshes.push(leftFlipperRail)

    // Right flipper rail (angled)
    const rightFlipperRail = MeshBuilder.CreateBox("rightFlipperRail", { width: 0.6, height: 1.2, depth: 8 }, this.scene)
    rightFlipperRail.position.set(8.5, -0.3, -8)
    rightFlipperRail.rotation.y = 0.3
    rightFlipperRail.material = metalMat
    this.pinballMeshes.push(rightFlipperRail)
  }

  createGround(): void {
    // Use MaterialLibrary for playfield material
    const groundMat = this.matLib.getPlayfieldMaterial()

    const ground = MeshBuilder.CreateGround('ground', { width: GameConfig.table.width, height: GameConfig.table.height }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = groundMat

    const groundBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(GameConfig.table.width/2, 0.1, GameConfig.table.height/2), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    // Flipper zone visibility enhancement (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      const flipperGlow = MeshBuilder.CreateGround("flipperGlow", { width: 10, height: 6 }, this.scene)
      flipperGlow.position.set(0, -0.95, -7)
      const glowMat = new StandardMaterial("flipperGlowMat", this.scene)
      glowMat.diffuseColor = Color3.Black()
      glowMat.emissiveColor = Color3.FromHexString("#001133")
      glowMat.alpha = 0.3
      flipperGlow.material = glowMat
    }
  }

  createWalls(): void {
    // Use MaterialLibrary for smoked glass walls
    const wallMat = this.matLib.getSmokedGlassMaterial()
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

    const wedgeMat = this.matLib.getBrushedMetalMaterial()

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
    const flipperMat = this.matLib.getNeonFlipperMaterial()

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
      // Create high detail master mesh (LOD level 0)
      const bumperHigh = MeshBuilder.CreateSphere("bump_high", { diameter: 0.9, segments: 32 }, this.scene) as Mesh
      bumperHigh.position.set(x, 0.5, z)
      
      // Create medium detail LOD mesh
      const bumperMedium = MeshBuilder.CreateSphere("bump_med", { diameter: 0.9, segments: 16 }, this.scene) as Mesh
      
      // Create low detail LOD mesh
      const bumperLow = MeshBuilder.CreateSphere("bump_low", { diameter: 0.9, segments: 8 }, this.scene) as Mesh
      
      // Set up LOD levels - use bumperHigh as the master mesh
      bumperHigh.addLODLevel(15, bumperMedium)  // Switch to medium at 15 units
      bumperHigh.addLODLevel(30, bumperLow)     // Switch to low at 30 units
      bumperHigh.addLODLevel(50, null)          // Cull beyond 50 units
      
      // Use high detail mesh for physics/visuals (it's the LOD master)
      const bumper = bumperHigh
      
      // Use MaterialLibrary for neon bumper
      const mat = this.matLib.getNeonBumperMaterial(colorHex)
      bumper.material = mat

      // --- REFINED HOLOGRAM PILLAR (Section 4) ---
      // Inner core (Dense)
      const holoInner = MeshBuilder.CreateCylinder("holoInner", { diameter: 0.6, height: 2.5, tessellation: 12 }, this.scene)
      holoInner.position.set(x, 1.8, z)
      
      // Hologram materials from MaterialLibrary
      const innerMat = this.matLib.getHologramMaterial(colorHex, true)
      holoInner.material = innerMat

      // Outer shell (Faint, wider)
      const holoOuter = MeshBuilder.CreateCylinder("holoOuter", { diameter: 1.2, height: 4.0, tessellation: 12 }, this.scene)
      holoOuter.position.set(x, 2.0, z)

      const outerMat = this.matLib.getHologramMaterial('#FFFFFF', true)
      outerMat.alpha = 0.25
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
      const initialEmissive = emissive(colorHex, INTENSITY.ACTIVE)
      this.bumperVisuals.push({
        mesh: bumper,
        body: body,
        hologram: holoInner,
        hitTime: 0,
        sweep: Math.random(),
        targetEmissive: initialEmissive.clone(),
        currentEmissive: initialEmissive.clone(),
        flashTimer: 0,
      })
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
    // Use MaterialLibrary for metallic pins
    const pinMat = this.matLib.getPinMaterial()

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

    // Barrier walls at the left and right edges of the pachinko pin grid
    // to block the open gutter areas and prevent lateral ball drift.
    const barrierMat = new StandardMaterial("pachinkoBarrierMat", this.scene)
    barrierMat.diffuseColor = Color3.Black()
    barrierMat.emissiveColor = Color3.FromHexString("#00eeff")
    barrierMat.alpha = 0.3

    const barrierH = GameConfig.table.wallHeight
    this.createWall(new Vector3(center.x - width / 2, barrierH, center.z), new Vector3(0.2, 5, height), barrierMat)
    this.createWall(new Vector3(center.x + width / 2, barrierH, center.z), new Vector3(0.2, 5, height), barrierMat)

    const catcher = MeshBuilder.CreateTorus("catcher", { diameter: 2.5, thickness: 0.2 }, this.scene)
    catcher.position.set(center.x, 0.2, center.z)

    catcher.material = this.matLib.getCatcherMaterial()

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
    const slingMat = this.matLib.getNeonSlingshotMaterial()

    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingMat)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingMat)
  }

  updateBumpers(dt: number): void {
    const time = performance.now() * 0.001

    this.bumperVisuals.forEach((vis, index) => {
      const mat = vis.mesh.material as PBRMaterial

      // ---- Smooth emissive interpolation (lerp toward target) ----
      if (vis.currentEmissive && vis.targetEmissive) {
        Color3.LerpToRef(vis.currentEmissive, vis.targetEmissive, dt * 5, vis.currentEmissive)

        // State entry flash - brief white flash on state transition
        if (vis.flashTimer && vis.flashTimer > 0) {
          vis.flashTimer -= dt
          const flashIntensity = vis.flashTimer / 0.1
          const flashColor = vis.currentEmissive.add(color(PALETTE.WHITE).scale(flashIntensity * INTENSITY.BURST))
          mat.emissiveColor = flashColor
        } else {
          mat.emissiveColor = vis.currentEmissive
        }
      }

      // Rotate the inner hologram
      if (vis.hologram) {
        vis.hologram.rotation.y += dt * 1.5
        vis.hologram.position.y = 1.8 + Math.sin(time * 2 + vis.sweep * 10) * 0.1

        // Rotate child (Outer) in opposite direction if it exists
        const child = vis.hologram.getChildren()[0] as Mesh
        if (child) {
            child.rotation.y -= dt * 3.0
        }

        // Hologram state sync - sync hologram emissive with bumper target
        if (vis.targetEmissive && vis.hologram.material) {
          const holoMat = vis.hologram.material as StandardMaterial
          Color3.LerpToRef(
            holoMat.emissiveColor,
            vis.targetEmissive.scale(1.2),
            dt * 8,
            holoMat.emissiveColor
          )
        }
      }

      if (vis.hitTime > 0) {
        vis.hitTime -= dt
        // Elastic bounce instead of linear
        const bouncePhase = Math.sin((1 - vis.hitTime / 0.2) * Math.PI)
        const s = 1 + bouncePhase * 0.4 // Peak at 1.4x scale
        vis.mesh.scaling.set(s, s, s)

        // Add slight squash in Y during peak stretch
        if (vis.hitTime > 0.1) {
          vis.mesh.scaling.y = 1 - bouncePhase * 0.2
        }

        // Hit energy pulse - brief white flash on impact
        if (vis.currentEmissive) {
          const flashIntensity = INTENSITY.BURST * (vis.hitTime / 0.2)
          mat.emissiveColor = vis.currentEmissive.add(color(PALETTE.WHITE).scale(flashIntensity))
        }

        if (vis.hologram) {
          // Hologram counter-pulse
          const holoS = 1 + (0.2 - vis.hitTime) * 2 // Inverse timing
          vis.hologram.scaling.set(1, 1 + holoS * 0.3, 1)
          vis.hologram.material!.alpha = 0.8 + bouncePhase * 0.2
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

  /**
   * Set bumper state with smooth emissive transition and entry flash.
   * Also applies state-specific roughness/metallic profiles.
   */
  setBumperState(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT' | 'ADVENTURE'): void {
    const targetColor = stateEmissive(state, INTENSITY.ACTIVE)
    const profile = STATE_PROFILES[state]

    this.bumperVisuals.forEach(vis => {
      vis.targetEmissive = targetColor.clone()
      vis.flashTimer = 0.1 // Trigger state entry flash

      // Apply state-specific surface properties
      const mat = vis.mesh.material as PBRMaterial
      if (profile) {
        mat.roughness = profile.roughness
        mat.metallic = profile.metallic
      }
    })
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

  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial | PBRMaterial): void {
    const w = MeshBuilder.CreateBox("w", { width: size.x, height: size.y * 2, depth: size.z }, this.scene)
    w.position.copyFrom(pos)
    w.material = mat
    
    const b = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size.x / 2, size.y, size.z / 2)
        .setFriction(0.1),  // OP-4: Unified wall friction (matches ball)
      b
    )
    
    this.bindings.push({ mesh: w, rigidBody: b })
    this.pinballMeshes.push(w)
  }

  private createSlingshot(pos: Vector3, rot: number, mat: StandardMaterial | PBRMaterial): void {
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
