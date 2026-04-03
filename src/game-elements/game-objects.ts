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
  TransformNode,
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
    // SMOOTH CURVED RAILS - CreateTube for organic flowing profile
    // ================================================================
    
    // Enhanced rail material with map-reactive accent
    const railMat = this.matLib.getEnhancedRailMaterial()
    
    // Left rail path - smooth curve along playfield edge
    const leftRailPath = [
      new Vector3(-12, 0.5, -11),  // Bottom near flippers
      new Vector3(-12, 0.5, -5),   // Mid lower
      new Vector3(-12, 0.5, 5),    // Center
      new Vector3(-12, 0.5, 15),   // Mid upper
      new Vector3(-12, 0.5, 21)    // Top
    ]
    
    // Create smooth curved left rail using CreateTube
    const leftRail = MeshBuilder.CreateTube("leftRail", {
      path: leftRailPath,
      radius: 0.35,
      tessellation: 32,
      cap: 2,
      sideOrientation: 2
    }, this.scene)
    leftRail.material = railMat
    this.pinballMeshes.push(leftRail)
    
    // Right rail path - smooth curve along playfield edge
    const rightRailPath = [
      new Vector3(13, 0.5, -11),   // Bottom near flippers
      new Vector3(13, 0.5, -5),    // Mid lower
      new Vector3(13, 0.5, 5),     // Center
      new Vector3(13, 0.5, 15),    // Mid upper
      new Vector3(13, 0.5, 21)     // Top
    ]
    
    // Create smooth curved right rail using CreateTube
    const rightRail = MeshBuilder.CreateTube("rightRail", {
      path: rightRailPath,
      radius: 0.35,
      tessellation: 32,
      cap: 2,
      sideOrientation: 2
    }, this.scene)
    rightRail.material = railMat
    this.pinballMeshes.push(rightRail)
    
    // Rail accent lines - thin glowing strips along rails
    const leftAccentPath = leftRailPath.map(p => new Vector3(p.x + 0.25, p.y - 0.1, p.z))
    const leftAccent = MeshBuilder.CreateTube("leftRailAccent", {
      path: leftAccentPath,
      radius: 0.08,
      tessellation: 16
    }, this.scene)
    leftAccent.material = accentMat
    
    const rightAccentPath = rightRailPath.map(p => new Vector3(p.x - 0.25, p.y - 0.1, p.z))
    const rightAccent = MeshBuilder.CreateTube("rightRailAccent", {
      path: rightAccentPath,
      radius: 0.08,
      tessellation: 16
    }, this.scene)
    rightAccent.material = accentMat

    // ================================================================
    // SIDE RAIL PHYSICS COLLIDERS - Strong barriers to prevent ball escape
    // ================================================================
    
    // Left side rail collider - TALL and THICK to block balls
    const leftRailBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(-11.8, 0.8, 5)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.6, 1.2, 16)
        .setRestitution(0.5)
        .setFriction(0.1),
      leftRailBody
    )
    this.bindings.push({ mesh: leftRail, rigidBody: leftRailBody })

    // Right side rail collider - TALL and THICK to block balls
    const rightRailBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(12.8, 0.8, 5)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.6, 1.2, 16)
        .setRestitution(0.5)
        .setFriction(0.1),
      rightRailBody
    )
    this.bindings.push({ mesh: rightRail, rigidBody: rightRailBody })
    
    // ================================================================
    // OUTLANE BLOCKERS - Prevent balls from draining down the sides
    // ================================================================
    
    // Left outlane blocker - angled wall that bounces ball back to flipper area
    const leftOutlaneBlocker = MeshBuilder.CreateBox("leftOutlaneBlocker", { width: 0.4, height: 1.5, depth: 6 }, this.scene)
    leftOutlaneBlocker.position.set(-9.5, 0.3, -10)
    leftOutlaneBlocker.rotation.y = 0.4
    leftOutlaneBlocker.material = metalMat
    this.pinballMeshes.push(leftOutlaneBlocker)
    
    const leftOutlaneBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(-9.5, 0.3, -10)
        .setRotation(new this.rapier.Quaternion(0, Math.sin(0.2), 0, Math.cos(0.2)))
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.2, 0.75, 3)
        .setRestitution(0.6)
        .setFriction(0.1),
      leftOutlaneBody
    )
    this.bindings.push({ mesh: leftOutlaneBlocker, rigidBody: leftOutlaneBody })
    
    // Right outlane blocker - angled wall that bounces ball back to flipper area
    const rightOutlaneBlocker = MeshBuilder.CreateBox("rightOutlaneBlocker", { width: 0.4, height: 1.5, depth: 6 }, this.scene)
    rightOutlaneBlocker.position.set(11, 0.3, -10)
    rightOutlaneBlocker.rotation.y = -0.4
    rightOutlaneBlocker.material = metalMat
    this.pinballMeshes.push(rightOutlaneBlocker)
    
    const rightOutlaneBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(11, 0.3, -10)
        .setRotation(new this.rapier.Quaternion(0, Math.sin(-0.2), 0, Math.cos(-0.2)))
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.2, 0.75, 3)
        .setRestitution(0.6)
        .setFriction(0.1),
      rightOutlaneBody
    )
    this.bindings.push({ mesh: rightOutlaneBlocker, rigidBody: rightOutlaneBody })

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
    // FLIPPER AREA RAILS - Curved guides near flippers with PHYSICS
    // ================================================================
    
    // Left flipper rail (angled) - visual
    const leftFlipperRail = MeshBuilder.CreateBox("leftFlipperRail", { width: 0.6, height: 1.2, depth: 8 }, this.scene)
    leftFlipperRail.position.set(-7, -0.3, -8)
    leftFlipperRail.rotation.y = -0.3
    leftFlipperRail.material = metalMat
    this.pinballMeshes.push(leftFlipperRail)

    // Left flipper rail physics
    const leftFlipperRailBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(-7, 0.3, -8)
        .setRotation(new this.rapier.Quaternion(0, Math.sin(-0.15), 0, Math.cos(-0.15)))
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.3, 0.6, 4)
        .setRestitution(0.4)
        .setFriction(0.1),
      leftFlipperRailBody
    )
    this.bindings.push({ mesh: leftFlipperRail, rigidBody: leftFlipperRailBody })

    // Right flipper rail (angled) - visual
    const rightFlipperRail = MeshBuilder.CreateBox("rightFlipperRail", { width: 0.6, height: 1.2, depth: 8 }, this.scene)
    rightFlipperRail.position.set(8.5, -0.3, -8)
    rightFlipperRail.rotation.y = 0.3
    rightFlipperRail.material = metalMat
    this.pinballMeshes.push(rightFlipperRail)

    // Right flipper rail physics
    const rightFlipperRailBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(8.5, 0.3, -8)
        .setRotation(new this.rapier.Quaternion(0, Math.sin(0.15), 0, Math.cos(0.15)))
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.3, 0.6, 4)
        .setRestitution(0.4)
        .setFriction(0.1),
      rightFlipperRailBody
    )
    this.bindings.push({ mesh: rightFlipperRail, rigidBody: rightFlipperRailBody })
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

  /**
   * Creates gentle ramps and curves in the lower half that funnel the ball toward the flippers.
   * These guides prevent instant side drains and keep the ball in play longer.
   */
  createFlipperRamps(): void {
    const rampMat = this.matLib.getBrushedMetalMaterial()
    
    // ================================================================
    // LEFT FLIPPER FUNNEL - Curved guide from left wall to left flipper
    // ================================================================
    
    // Create a curved tube that guides balls from the left side toward the left flipper
    const leftRampPath = [
      new Vector3(-10, 0.4, 0),   // Start near left wall, upper-mid table
      new Vector3(-8.5, 0.35, -2), // Curve inward
      new Vector3(-7, 0.3, -4),   // Mid approach
      new Vector3(-5.5, 0.25, -6), // Near flipper
      new Vector3(-4, 0.2, -7.5)  // End at left flipper
    ]
    
    const leftRamp = MeshBuilder.CreateTube("leftFlipperRamp", {
      path: leftRampPath,
      radius: 0.15,
      sideOrientation: 2
    }, this.scene)
    leftRamp.material = rampMat
    this.pinballMeshes.push(leftRamp)
    
    // Physics collider for left ramp (series of small boxes along the path)
    for (let i = 0; i < leftRampPath.length - 1; i++) {
      const start = leftRampPath[i]
      const end = leftRampPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)
      
      const rampBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.15, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.2, 0.15, length / 2)
          .setRestitution(0.4)
          .setFriction(0.1),
        rampBody
      )
    }
    
    // ================================================================
    // RIGHT FLIPPER FUNNEL - Curved guide from right wall to right flipper
    // ================================================================
    
    const rightRampPath = [
      new Vector3(11, 0.4, 0),    // Start near right wall, upper-mid table
      new Vector3(9.5, 0.35, -2), // Curve inward
      new Vector3(8, 0.3, -4),    // Mid approach
      new Vector3(6.5, 0.25, -6), // Near flipper
      new Vector3(5, 0.2, -7.5)   // End at right flipper
    ]
    
    const rightRamp = MeshBuilder.CreateTube("rightFlipperRamp", {
      path: rightRampPath,
      radius: 0.15,
      sideOrientation: 2
    }, this.scene)
    rightRamp.material = rampMat
    this.pinballMeshes.push(rightRamp)
    
    // Physics collider for right ramp
    for (let i = 0; i < rightRampPath.length - 1; i++) {
      const start = rightRampPath[i]
      const end = rightRampPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)
      
      const rampBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.15, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.2, 0.15, length / 2)
          .setRestitution(0.4)
          .setFriction(0.1),
        rampBody
      )
    }
    
    // ================================================================
    // CENTER RAMP - Divides the lower playfield and creates interesting bounces
    // ================================================================
    
    const centerRampPath = [
      new Vector3(-2, 0.2, -3),   // Left side
      new Vector3(0, 0.25, -4),   // Center peak
      new Vector3(2, 0.2, -3)     // Right side
    ]
    
    const centerRamp = MeshBuilder.CreateTube("centerRamp", {
      path: centerRampPath,
      radius: 0.12,
      sideOrientation: 2
    }, this.scene)
    centerRamp.material = rampMat
    this.pinballMeshes.push(centerRamp)
    
    // Physics for center ramp
    const centerRampBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, 0.25, -4)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(2.5, 0.1, 0.5)
        .setRestitution(0.4)
        .setFriction(0.1),
      centerRampBody
    )
    
    // ================================================================
    // UPPER DEFLECTOR RAILS - Prevent straight-down drains from upper playfield
    // ================================================================
    
    // Left upper deflector - guides balls from upper left toward center
    const leftDeflectorPath = [
      new Vector3(-6, 0.3, 2),
      new Vector3(-4, 0.25, 0),
      new Vector3(-2, 0.2, -2)
    ]
    
    const leftDeflector = MeshBuilder.CreateTube("leftDeflector", {
      path: leftDeflectorPath,
      radius: 0.12,
      sideOrientation: 2
    }, this.scene)
    leftDeflector.material = rampMat
    this.pinballMeshes.push(leftDeflector)
    
    for (let i = 0; i < leftDeflectorPath.length - 1; i++) {
      const start = leftDeflectorPath[i]
      const end = leftDeflectorPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)
      
      const deflectorBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.08, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.12, 0.08, length / 2)
          .setRestitution(0.35)
          .setFriction(0.1),
        deflectorBody
      )
    }
    
    // Right upper deflector - guides balls from upper right toward center
    const rightDeflectorPath = [
      new Vector3(7, 0.3, 2),
      new Vector3(5, 0.25, 0),
      new Vector3(3, 0.2, -2)
    ]
    
    const rightDeflector = MeshBuilder.CreateTube("rightDeflector", {
      path: rightDeflectorPath,
      radius: 0.12,
      sideOrientation: 2
    }, this.scene)
    rightDeflector.material = rampMat
    this.pinballMeshes.push(rightDeflector)
    
    for (let i = 0; i < rightDeflectorPath.length - 1; i++) {
      const start = rightDeflectorPath[i]
      const end = rightDeflectorPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)
      
      const deflectorBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.08, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.12, 0.08, length / 2)
          .setRestitution(0.35)
          .setFriction(0.1),
        deflectorBody
      )
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

  /**
   * Creates strong side rails that run from the upper playfield down to the flippers.
   * These physically block the ball from draining down the left/right gutters.
   */
  createDrainRails(): void {
    const railMat = this.matLib.getBrushedMetalMaterial()
    const railHeight = 1.2
    const railThick = 0.4

    // Left rail - curves inward toward the left flipper
    const leftRailPath = [
      new Vector3(-10, railHeight / 2, 20),    // Top wall junction
      new Vector3(-10, railHeight / 2, 10),    // Upper playfield
      new Vector3(-9.5, railHeight / 2, 0),    // Mid playfield
      new Vector3(-8, railHeight / 2, -6),     // Above flipper
      new Vector3(-5.5, railHeight / 2, -9)    // Ends near left flipper
    ]

    const leftRail = MeshBuilder.CreateTube("leftSideRail", {
      path: leftRailPath,
      radius: 0.18,
      sideOrientation: 2
    }, this.scene)
    leftRail.material = railMat
    this.pinballMeshes.push(leftRail)

    // Physics colliders for left rail
    for (let i = 0; i < leftRailPath.length - 1; i++) {
      const start = leftRailPath[i]
      const end = leftRailPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const railBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(railThick / 2, railHeight / 2, length / 2)
          .setRestitution(0.5)
          .setFriction(0.1),
        railBody
      )
    }

    // Right rail - curves inward toward the right flipper
    const rightRailPath = [
      new Vector3(11.5, railHeight / 2, 20),   // Top wall junction
      new Vector3(11.5, railHeight / 2, 10),   // Upper playfield
      new Vector3(11, railHeight / 2, 0),      // Mid playfield
      new Vector3(9.5, railHeight / 2, -6),    // Above flipper
      new Vector3(7, railHeight / 2, -9)       // Ends near right flipper
    ]

    const rightRail = MeshBuilder.CreateTube("rightSideRail", {
      path: rightRailPath,
      radius: 0.18,
      sideOrientation: 2
    }, this.scene)
    rightRail.material = railMat
    this.pinballMeshes.push(rightRail)

    // Physics colliders for right rail
    for (let i = 0; i < rightRailPath.length - 1; i++) {
      const start = rightRailPath[i]
      const end = rightRailPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const railBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(railThick / 2, railHeight / 2, length / 2)
          .setRestitution(0.5)
          .setFriction(0.1),
        railBody
      )
    }

    // Lower guard rails - smooth cylindrical guards above flippers
    const guardMat = this.matLib.getChromeMaterial()
    
    // Left guard - round tube profile
    const leftGuard = MeshBuilder.CreateCylinder("leftGuard", { diameter: 0.26, height: 3, tessellation: 14 }, this.scene)
    leftGuard.position.set(-4.5, 0.4, -10)
    leftGuard.rotation.x = Math.PI / 2
    leftGuard.rotation.z = -Math.PI / 8
    leftGuard.material = guardMat
    this.pinballMeshes.push(leftGuard)

    const lgBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(-4.5, 0.4, -10)
        .setRotation(new this.rapier.Quaternion(0, Math.sin(-Math.PI / 16), 0, Math.cos(-Math.PI / 16)))
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.15, 0.4, 1.5)
        .setRestitution(0.6)
        .setFriction(0.1),
      lgBody
    )

    // Right guard - round tube profile
    const rightGuard = MeshBuilder.CreateCylinder("rightGuard", { diameter: 0.26, height: 3, tessellation: 14 }, this.scene)
    rightGuard.position.set(6, 0.4, -10)
    rightGuard.rotation.x = Math.PI / 2
    rightGuard.rotation.z = Math.PI / 8
    rightGuard.material = guardMat
    this.pinballMeshes.push(rightGuard)

    const rgBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(6, 0.4, -10)
        .setRotation(new this.rapier.Quaternion(0, Math.sin(Math.PI / 16), 0, Math.cos(Math.PI / 16)))
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.15, 0.4, 1.5)
        .setRestitution(0.6)
        .setFriction(0.1),
      rgBody
    )
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
    const flipperMat = this.matLib.getEnhancedFlipperMaterial()
    const pivotMat = this.matLib.getFlipperPivotMaterial()

    const make = (pos: Vector3, right: boolean): RAPIER.RevoluteImpulseJoint => {
      const isRight = right
      const flipperLength = 3.5
      const flipperWidth = 0.5
      const flipperHeight = 0.6
      
      // Create parent node for the flipper assembly
      const flipperRoot = new TransformNode("flipperRoot", this.scene)
      flipperRoot.position.copyFrom(pos)
      
      // ================================================================
      // FLIPPER BLADE - Main paddle with curved end
      // ================================================================
      
      // Main blade body - tapered box for angled top surface
      const bladeMesh = MeshBuilder.CreateBox("flipperBlade", { 
        width: flipperLength - 0.4,  // Slightly shorter to make room for rounded tip
        depth: flipperWidth, 
        height: flipperHeight 
      }, this.scene) as Mesh
      
      // Offset blade so pivot is at the base
      bladeMesh.position.x = isRight ? (flipperLength - 0.4) / 2 : -(flipperLength - 0.4) / 2
      bladeMesh.position.y = 0
      bladeMesh.rotation.x = 0.15 // Slight upward angle for better ball contact
      bladeMesh.parent = flipperRoot
      bladeMesh.material = flipperMat
      
      // Rounded flipper tip (curved end) - smooth sphere collision
      const tipMesh = MeshBuilder.CreateSphere("flipperTip", { 
        diameter: flipperWidth * 1.2,
        segments: 16 
      }, this.scene) as Mesh
      tipMesh.position.x = isRight ? flipperLength - 0.3 : -(flipperLength - 0.3)
      tipMesh.position.y = 0.05
      tipMesh.position.z = 0
      tipMesh.parent = flipperRoot
      tipMesh.material = flipperMat
      
      // Side bevels - angled edges for visual detail
      const bevelLeft = MeshBuilder.CreateBox("flipperBevelL", {
        width: flipperLength - 0.6,
        depth: 0.1,
        height: flipperHeight - 0.1
      }, this.scene) as Mesh
      bevelLeft.position.x = bladeMesh.position.x
      bevelLeft.position.z = flipperWidth / 2
      bevelLeft.position.y = 0.05
      bevelLeft.rotation.x = 0.15
      bevelLeft.parent = flipperRoot
      bevelLeft.material = flipperMat
      
      const bevelRight = MeshBuilder.CreateBox("flipperBevelR", {
        width: flipperLength - 0.6,
        depth: 0.1,
        height: flipperHeight - 0.1
      }, this.scene) as Mesh
      bevelRight.position.x = bladeMesh.position.x
      bevelRight.position.z = -flipperWidth / 2
      bevelRight.position.y = 0.05
      bevelRight.rotation.x = 0.15
      bevelRight.parent = flipperRoot
      bevelRight.material = flipperMat

      // ================================================================
      // PIVOT ASSEMBLY - Detailed pivot visualization
      // ================================================================
      
      // Main pivot cylinder
      const pivotCyl = MeshBuilder.CreateCylinder("flipperPivot", {
        diameter: 0.8,
        height: 0.9,
        tessellation: 16
      }, this.scene) as Mesh
      pivotCyl.rotation.x = Math.PI / 2
      pivotCyl.position.x = isRight ? 1.5 : -1.5
      pivotCyl.position.y = -0.1
      pivotCyl.parent = flipperRoot
      pivotCyl.material = pivotMat
      
      // Pivot cap (top)
      const pivotCap = MeshBuilder.CreateCylinder("flipperPivotCap", {
        diameter: 0.6,
        height: 0.15,
        tessellation: 16
      }, this.scene) as Mesh
      pivotCap.rotation.x = Math.PI / 2
      pivotCap.position.x = isRight ? 1.5 : -1.5
      pivotCap.position.y = -0.1
      pivotCap.position.z = 0.4
      pivotCap.parent = flipperRoot
      pivotCap.material = pivotMat
      
      // Pivot ring detail
      const pivotRing = MeshBuilder.CreateTorus("flipperPivotRing", {
        diameter: 0.9,
        thickness: 0.08,
        tessellation: 16
      }, this.scene) as Mesh
      pivotRing.position.x = isRight ? 1.5 : -1.5
      pivotRing.position.y = -0.1
      pivotRing.position.z = 0
      pivotRing.parent = flipperRoot
      pivotRing.material = pivotMat

      // ================================================================
      // PHYSICS BODY - Simplified collider matching visual shape
      // ================================================================
      
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(0.5)
          .setAngularDamping(2)
          .setCcdEnabled(true)
      )
      
      // Main blade collider (box)
      const colliderOffset = isRight ? (flipperLength - 0.4) / 2 : -(flipperLength - 0.4) / 2
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid((flipperLength - 0.4) / 2, 0.3, 0.25)
          .setTranslation(colliderOffset, 0, 0),
        body
      )
      
      // Rounded tip collider (ball)
      const tipOffset = isRight ? flipperLength - 0.3 : -(flipperLength - 0.3)
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(0.3)
          .setTranslation(tipOffset, 0.05, 0)
          .setRestitution(0.3),
        body
      )
      
      // Register binding with root mesh
      this.bindings.push({ mesh: flipperRoot as unknown as Mesh, rigidBody: body })
      this.pinballMeshes.push(bladeMesh, tipMesh, bevelLeft, bevelRight)
      this.pinballMeshes.push(pivotCyl, pivotCap, pivotRing)
      
      // ================================================================
      // PIVOT JOINT - Revolute joint with limits
      // ================================================================
      
      const anchor = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )
      
      const pX = isRight ? 1.5 : -1.5
      const jParams = this.rapier.JointData.revolute(
        new this.rapier.Vector3(pX, 0, 0),
        new this.rapier.Vector3(pX, 0, 0),
        new this.rapier.Vector3(0, 1, 0)
      )
      jParams.limitsEnabled = true
      jParams.limits = isRight ? [-Math.PI / 4, Math.PI / 6] : [-Math.PI / 6, Math.PI / 4]
      
      const joint = this.world.createImpulseJoint(jParams, anchor, body, true) as RAPIER.RevoluteImpulseJoint

      joint.configureMotorPosition(
        isRight ? -Math.PI / 4 : Math.PI / 4,
        GameConfig.table.flipperStrength,
        GameConfig.flipper.damping
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
    const make = (x: number, z: number, colorHex: string, scale: number = 1.0) => {
      // ================================================================
      // ORGANIC BUMPER BODY - Flattened sphere with LOD
      // ================================================================
      const bumperHigh = MeshBuilder.CreateSphere("bump_high", { diameter: 0.9 * scale, segments: 32 }, this.scene) as Mesh
      bumperHigh.position.set(x, 0.5, z)
      bumperHigh.scaling = new Vector3(1, 0.7, 1)
      
      const bumperMedium = MeshBuilder.CreateSphere("bump_med", { diameter: 0.9 * scale, segments: 16 }, this.scene) as Mesh
      bumperMedium.scaling = new Vector3(1, 0.7, 1)
      
      const bumperLow = MeshBuilder.CreateSphere("bump_low", { diameter: 0.9 * scale, segments: 8 }, this.scene) as Mesh
      bumperLow.scaling = new Vector3(1, 0.7, 1)
      
      bumperHigh.addLODLevel(15, bumperMedium)
      bumperHigh.addLODLevel(30, bumperLow)
      bumperHigh.addLODLevel(50, null)
      
      const bumper = bumperHigh
      
      // Use enhanced bumper materials with map-reactive glow
      const bodyMat = this.matLib.getEnhancedBumperBodyMaterial(colorHex)
      bumper.material = bodyMat

      // ================================================================
      // BUMPER CAP - Subtle beveled top
      // ================================================================
      const bumperCap = MeshBuilder.CreateSphere("bump_cap", { diameter: 0.55 * scale, segments: 16 }, this.scene) as Mesh
      bumperCap.position.set(x, 0.5 + 0.22 * scale, z)
      bumperCap.scaling = new Vector3(1, 0.35, 1)
      bumperCap.material = bodyMat

      // ================================================================
      // DEEP EMISSIVE RING - Torus around equator
      // ================================================================
      const bumperRing = MeshBuilder.CreateTorus("bump_ring", { 
        diameter: 0.78 * scale, 
        thickness: 0.055 * scale, 
        tessellation: 24 
      }, this.scene) as Mesh
      bumperRing.position.set(x, 0.38 * scale, z)
      bumperRing.rotation.x = Math.PI / 2
      
      // Use enhanced ring material with deeper emissive
      const ringMat = this.matLib.getEnhancedBumperRingMaterial(colorHex)
      bumperRing.material = ringMat

      // --- REFINED HOLOGRAM PILLAR (tapered for organic look) ---
      const holoInner = MeshBuilder.CreateCylinder("holoInner", { diameterTop: 0.35, diameterBottom: 0.65, height: 2.5, tessellation: 12 }, this.scene)
      holoInner.position.set(x, 1.8, z)
      
      const innerMat = this.matLib.getHologramMaterial(colorHex, true)
      holoInner.material = innerMat

      const holoOuter = MeshBuilder.CreateCylinder("holoOuter", { diameterTop: 0.9, diameterBottom: 1.4, height: 4.0, tessellation: 12 }, this.scene)
      holoOuter.position.set(x, 2.0, z)

      const outerMat = this.matLib.getHologramMaterial('#FFFFFF', true)
      outerMat.alpha = 0.25
      holoOuter.material = outerMat
      holoOuter.parent = holoInner

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(0.4 * scale)
          .setRestitution(0.85)
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
      let ps: ParticleSystem | undefined
      if (this.config.visuals.enableParticles) {
        ps = new ParticleSystem(`bumperParticles_${x}_${z}`, 50, this.scene)
        ps.particleTexture = this.particleTexture
        ps.emitter = bumper
        ps.minEmitBox = new Vector3(-0.5, 0, -0.5)
        ps.maxEmitBox = new Vector3(0.5, 0, 0.5)
        
        const baseColor = color(colorHex)
        ps.color1 = Color4.FromColor3(baseColor, 1)
        ps.color2 = Color4.FromColor3(baseColor.scale(0.7), 0.5)
        
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

      this.bumperVisuals.push({
        mesh: bumper,
        body: body,
        hologram: holoInner,
        hitTime: 0,
        sweep: Math.random(),
        targetEmissive: initialEmissive.clone(),
        currentEmissive: initialEmissive.clone(),
        flashTimer: 0,
        color: colorHex,
        particles: ps,
      })
      this.pinballMeshes.push(bumper, bumperCap, bumperRing, holoInner, holoOuter)
    }

    // Main center bumper (larger)
    make(0, 8, "#ff00aa", 1.2)
    // Upper side bumpers
    make(-4, 4, "#00aaff", 1.0)
    make(4, 4, "#00aaff", 1.0)
    // Lower bumpers - funnel toward flippers
    make(-3, 0, "#ffaa00", 0.9)
    make(3, 0, "#ffaa00", 0.9)
    // Far upper bumper
    make(0, 14, "#00ff88", 0.85)
    // Side deflector bumper - prevents direct side drains from upper playfield
    make(-6, 10, "#ff4400", 1.0)
  }

  createPachinkoField(center: Vector3 = new Vector3(0, 0.5, 6), width: number = 24, height: number = 22): void {
    // Enhanced peg material with map-reactive emissive tips
    const pinMat = this.matLib.getEnhancedPinMaterial()

    // Dense pachinko grid: 10 rows, staggered columns for chaotic ball paths
    // Covering the upper 2/3 of the playfield to keep the ball bouncing
    const rows = 10
    const cols = 13
    const spacingX = width / cols
    const spacingZ = height / rows

    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2 === 0) ? 0 : spacingX / 2
      for (let c = 0; c < cols; c++) {
        const x = center.x - (width / 2) + c * spacingX + offsetX
        const z = center.z - (height / 2) + r * spacingZ
        // Skip center area for the main catcher/target
        if (Math.abs(x) < 2.5 && Math.abs(z - center.z) < 2.5) continue

        const pegHeight = 1.5
        const baseRadius = 0.12
        const topRadius = 0.06
        
        // ================================================================
        // ENHANCED PEG - Tapered cylinder with rounded top and base bevel
        // ================================================================
        
        // Main tapered body
        const pin = MeshBuilder.CreateCylinder(`pin_${r}_${c}`, { 
          diameterTop: topRadius * 2, 
          diameterBottom: baseRadius * 2,
          height: pegHeight,
          tessellation: 12 
        }, this.scene)
        pin.position.set(x, 0.4, z)
        pin.material = pinMat
        
        // Rounded top cap (hemisphere for smooth ball contact)
        const pinCap = MeshBuilder.CreateSphere(`pinCap_${r}_${c}`, { 
          diameter: topRadius * 2.2,
          slice: 0.5,
          segments: 10
        }, this.scene)
        pinCap.position.set(x, 0.4 + pegHeight / 2 - 0.02, z)
        pinCap.material = pinMat
        
        // Base bevel ring for visual polish
        const pinBevel = MeshBuilder.CreateTorus(`pinBevel_${r}_${c}`, {
          diameter: baseRadius * 2.3,
          thickness: 0.025,
          tessellation: 10
        }, this.scene)
        pinBevel.position.set(x, 0.4 - pegHeight / 2 + 0.03, z)
        pinBevel.rotation.x = Math.PI / 2
        pinBevel.material = pinMat

        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.4, z)
        )
        
        // Thin collider matching tapered shape (average radius)
        const avgRadius = (baseRadius + topRadius) / 2
        this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(pegHeight / 2, avgRadius)
            .setRestitution(0.65)
            .setFriction(0.1),
          body
        )

        this.bindings.push({ mesh: pin, rigidBody: body })
        this.pinballMeshes.push(pin, pinCap, pinBevel)
      }
    }

    // Catcher in the center of the pachinko field
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

    this.bumperVisuals.forEach((vis) => {
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

        if (this.config.visuals.enableParticles && vis.particles) {
          vis.particles.start()
        }
      } else {
        vis.mesh.scaling.set(1, 1, 1)
        if (vis.hologram) {
          vis.hologram.scaling.set(1, 1, 1)
          vis.hologram.material!.alpha = 0.5
        }

        if (vis.particles && vis.particles.isStarted()) {
          vis.particles.stop()
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

  activateBumperHit(body: RAPIER.RigidBody, impactVelocity: number = 10): void {
    const vis = this.bumperVisuals.find(v => v.body === body)
    if (vis) {
      vis.hitTime = 0.2
      
      // Scale particle burst by impact velocity
      if (vis.particles) {
        const intensity = Math.min(impactVelocity / 20, 2.0)
        vis.particles.emitRate = 100 * intensity
        vis.particles.targetStopDuration = 0.1 * intensity
        vis.particles.start()
      }
    }
  }

  /**
   * Set bumper state with smooth emissive transition and entry flash.
   * Also applies state-specific roughness/metallic profiles.
   * Updates particle colors to match state color.
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

      // Update particle colors to match state
      if (vis.particles) {
        vis.particles.color1 = Color4.FromColor3(targetColor, 1)
        vis.particles.color2 = Color4.FromColor3(targetColor.scale(0.7), 0.5)
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
