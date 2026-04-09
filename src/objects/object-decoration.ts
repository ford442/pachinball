import { Scene, Vector3, MeshBuilder, Mesh, StandardMaterial, Color3, Scalar, Animation } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'

export class DecorationBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER

  private matLib: ReturnType<typeof getMaterialLibrary>
  private bindings: PhysicsBinding[] = []
  private pinballMeshes: Mesh[] = []

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: typeof GameConfig
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier

    this.matLib = getMaterialLibrary(scene)
  }

  createCabinetDecoration(): void {
    // Use MaterialLibrary for consistent materials
    const chromeMat = this.matLib.getChromeMaterial()
    const plasticMat = this.matLib.getNeonBumperMaterial('#FF0055')
    const brushedMetalMat = this.matLib.getBrushedMetalMaterial()
    const glassTubeMat = this.matLib.getGlassTubeMaterial()
    const blackPlasticMat = this.matLib.getBlackPlasticMaterial()

    // Enhanced ball tray with metallic finish
    const trayWidth = 16
    const tray = MeshBuilder.CreateBox('ashtray', { width: trayWidth, height: 1.2, depth: 4 }, this.scene)
    tray.position.set(0, -2.2, -14)
    tray.material = brushedMetalMat

    // Random chrome balls with better distribution
    for (let i = 0; i < 25; i++) {
      const dummyBall = MeshBuilder.CreateSphere(`dummyBall_${i}`, { diameter: 0.7 + Math.random() * 0.2 }, this.scene)
      const x = Scalar.RandomRange(-trayWidth / 2 + 1.5, trayWidth / 2 - 1.5)
      const z = Scalar.RandomRange(-1.2, 1.2)
      const y = Scalar.RandomRange(0.3, 0.6)
      dummyBall.position.set(x, y, z).addInPlace(tray.position)
      dummyBall.material = chromeMat
    }

    // Enhanced control panel
    const panel = MeshBuilder.CreateBox('controlPanel', { width: 8, height: 1.8, depth: 3 }, this.scene)
    panel.position.set(10, -1.2, -12)
    panel.rotation.x = 0.2
    panel.material = blackPlasticMat

    // LED button with glow
    const btn = MeshBuilder.CreateCylinder('blastBtn', { diameter: 1.2, height: 0.3 }, this.scene)
    btn.position.set(0, 1, 0)
    btn.parent = panel
    const btnMat = new StandardMaterial('btnMat', this.scene)
    btnMat.diffuseColor = Color3.FromHexString('#ff0044')
    btnMat.emissiveColor = Color3.FromHexString('#ff0044').scale(0.8)
    btn.material = btnMat

    // ================================================================
    // PLUNGER/SHOOTER ROD ASSEMBLY
    // ================================================================

    // Shooter housing (the metal tube)
    const shooterHousing = MeshBuilder.CreateCylinder('shooterHousing', {
      diameter: 1.2,
      height: 6,
      tessellation: 16
    }, this.scene)
    shooterHousing.rotation.x = Math.PI / 2
    shooterHousing.position.set(10.5, -0.2, -10)
    shooterHousing.material = chromeMat

    // Shooter rod (the plunger)
    const shooterRod = MeshBuilder.CreateCylinder('shooterRod', {
      diameter: 0.4,
      height: 5,
      tessellation: 12
    }, this.scene)
    shooterRod.rotation.x = Math.PI / 2
    shooterRod.position.set(10.5, -0.2, -10)
    const rodMat = new StandardMaterial('rodMat', this.scene)
    rodMat.diffuseColor = new Color3(0.7, 0.7, 0.8)
    rodMat.specularColor = new Color3(1, 1, 1)
    shooterRod.material = rodMat

    // Plunger handle (knob at the end)
    const plungerKnob = MeshBuilder.CreateCylinder('plungerKnob', {
      diameter: 1.5,
      height: 0.8,
      tessellation: 16
    }, this.scene)
    plungerKnob.rotation.x = Math.PI / 2
    plungerKnob.position.set(10.5, -0.2, -13)
    plungerKnob.material = blackPlasticMat

    // Shooter spring (coiled detail)
    const spring = MeshBuilder.CreateTorus('shooterSpring', {
      diameter: 0.8,
      thickness: 0.15,
      tessellation: 16
    }, this.scene)
    spring.position.set(10.5, -0.2, -11.5)
    spring.rotation.x = Math.PI / 2
    const springMat = new StandardMaterial('springMat', this.scene)
    springMat.diffuseColor = new Color3(0.5, 0.5, 0.6)
    spring.material = springMat

    // Plunger lane guide rail
    const laneGuide = MeshBuilder.CreateBox('laneGuide', { width: 0.3, height: 1.5, depth: 12 }, this.scene)
    laneGuide.position.set(8.2, -0.3, -8)
    laneGuide.material = chromeMat

    // Decorative wing rails
    const path = [
      new Vector3(0, 0, 0),
      new Vector3(0.8, 2, 0),
      new Vector3(0.2, 4, 0.5),
      new Vector3(-0.5, 6, 0)
    ]

    const leftWing = MeshBuilder.CreateTube('wingL', { path, radius: 0.4, sideOrientation: 2 }, this.scene)
    leftWing.position.set(-13.5, 1.5, 0)
    leftWing.material = plasticMat

    const rightWing = MeshBuilder.CreateTube('wingR', { path, radius: 0.4, sideOrientation: 2 }, this.scene)
    rightWing.position.set(14.5, 1.5, 0)
    rightWing.scaling.x = -1
    rightWing.material = plasticMat

    const feedTube = MeshBuilder.CreateCylinder('feedTube', { height: 15, diameter: 1.0, tessellation: 16 }, this.scene)
    feedTube.position.set(-12, 5, 5)
    feedTube.material = glassTubeMat

    // Animated balls in tube
    const ballCount = 5
    for (let i = 0; i < ballCount; i++) {
      const dropBall = MeshBuilder.CreateSphere(`dropBall_${i}`, { diameter: 0.6 }, this.scene)
      dropBall.position.set(0, 6 - (i * 3), 0)
      dropBall.parent = feedTube
      dropBall.material = chromeMat

      const frameRate = 30
      const anim = new Animation(`fall_${i}`, 'position.y', frameRate, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE)
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

  private createSideRails(metalMat: import('@babylonjs/core').PBRMaterial, accentMat: import('@babylonjs/core').PBRMaterial): void {
    // ================================================================
    // SMOOTH CURVED RAILS
    // ================================================================

    const railMat = this.matLib.getEnhancedRailMaterial()

    // Left rail path
    const leftRailPath = [
      new Vector3(-12, 0.5, -11),
      new Vector3(-12, 0.5, -5),
      new Vector3(-12, 0.5, 5),
      new Vector3(-12, 0.5, 15),
      new Vector3(-12, 0.5, 21)
    ]

    const leftRail = MeshBuilder.CreateTube('leftRail', {
      path: leftRailPath,
      radius: 0.35,
      tessellation: 32,
      cap: 2,
      sideOrientation: 2
    }, this.scene)
    leftRail.material = railMat
    this.pinballMeshes.push(leftRail)

    // Right rail path
    const rightRailPath = [
      new Vector3(13, 0.5, -11),
      new Vector3(13, 0.5, -5),
      new Vector3(13, 0.5, 5),
      new Vector3(13, 0.5, 15),
      new Vector3(13, 0.5, 21)
    ]

    const rightRail = MeshBuilder.CreateTube('rightRail', {
      path: rightRailPath,
      radius: 0.35,
      tessellation: 32,
      cap: 2,
      sideOrientation: 2
    }, this.scene)
    rightRail.material = railMat
    this.pinballMeshes.push(rightRail)

    // Rail accent lines
    const leftAccentPath = leftRailPath.map(p => new Vector3(p.x + 0.25, p.y - 0.1, p.z))
    const leftAccent = MeshBuilder.CreateTube('leftRailAccent', {
      path: leftAccentPath,
      radius: 0.08,
      tessellation: 16
    }, this.scene)
    leftAccent.material = accentMat

    const rightAccentPath = rightRailPath.map(p => new Vector3(p.x - 0.25, p.y - 0.1, p.z))
    const rightAccent = MeshBuilder.CreateTube('rightRailAccent', {
      path: rightAccentPath,
      radius: 0.08,
      tessellation: 16
    }, this.scene)
    rightAccent.material = accentMat

    // ================================================================
    // SIDE RAIL PHYSICS COLLIDERS
    // ================================================================

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
    // OUTLANE BLOCKERS
    // ================================================================

    // Left outlane blocker
    const leftOutlaneBlocker = MeshBuilder.CreateBox('leftOutlaneBlocker', { width: 0.4, height: 1.5, depth: 6 }, this.scene)
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

    // Right outlane blocker
    const rightOutlaneBlocker = MeshBuilder.CreateBox('rightOutlaneBlocker', { width: 0.4, height: 1.5, depth: 6 }, this.scene)
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
    // PLUNGER LANE RAILS
    // ================================================================

    const plungerInner = MeshBuilder.CreateBox('plungerInner', { width: 0.4, height: 2, depth: 20 }, this.scene)
    plungerInner.position.set(8.5, 0, -5)
    plungerInner.material = metalMat
    this.pinballMeshes.push(plungerInner)

    const plungerLED = MeshBuilder.CreateBox('plungerLED', { width: 0.1, height: 0.1, depth: 18 }, this.scene)
    plungerLED.position.set(8.3, 0.8, -5)
    plungerLED.material = accentMat

    // ================================================================
    // FLIPPER AREA RAILS
    // ================================================================

    // Left flipper rail
    const leftFlipperRail = MeshBuilder.CreateBox('leftFlipperRail', { width: 0.6, height: 1.2, depth: 8 }, this.scene)
    leftFlipperRail.position.set(-7, -0.3, -8)
    leftFlipperRail.rotation.y = -0.3
    leftFlipperRail.material = metalMat
    this.pinballMeshes.push(leftFlipperRail)

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

    // Right flipper rail
    const rightFlipperRail = MeshBuilder.CreateBox('rightFlipperRail', { width: 0.6, height: 1.2, depth: 8 }, this.scene)
    rightFlipperRail.position.set(8.5, -0.3, -8)
    rightFlipperRail.rotation.y = 0.3
    rightFlipperRail.material = metalMat
    this.pinballMeshes.push(rightFlipperRail)

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

  getBindings(): PhysicsBinding[] {
    return this.bindings
  }

  getPinballMeshes(): Mesh[] {
    return this.pinballMeshes
  }
}
