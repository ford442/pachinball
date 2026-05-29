import {
  Scene,
  Vector3,
  MeshBuilder,
  Mesh,
  StandardMaterial,
  Color3,
  Scalar,
  Animation,
  Texture,
  TransformNode
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { color, emissive, PALETTE, INTENSITY } from '../game-elements/visual-language'

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

    // DISABLED: leftOutlaneBlocker physics collider overlaps the left outer wall
    // and is positioned in the plunger lane area instead of near the flippers.
    // Visual mesh kept; physics body removed pending redesign.
    // const leftOutlaneBody = this.world.createRigidBody(
    //   this.rapier.RigidBodyDesc.fixed()
    //     .setTranslation(-9.5, 0.3, -10)
    //     .setRotation(new this.rapier.Quaternion(0, Math.sin(0.2), 0, Math.cos(0.2)))
    // )
    // this.world.createCollider(
    //   this.rapier.ColliderDesc.cuboid(0.2, 0.75, 3)
    //     .setRestitution(0.6)
    //     .setFriction(0.1),
    //   leftOutlaneBody
    // )
    // this.bindings.push({ mesh: leftOutlaneBlocker, rigidBody: leftOutlaneBody })

    // Right outlane blocker
    const rightOutlaneBlocker = MeshBuilder.CreateBox('rightOutlaneBlocker', { width: 0.4, height: 1.5, depth: 6 }, this.scene)
    rightOutlaneBlocker.position.set(11, 0.3, -10)
    rightOutlaneBlocker.rotation.y = -0.4
    rightOutlaneBlocker.material = metalMat
    this.pinballMeshes.push(rightOutlaneBlocker)

    // DISABLED: rightOutlaneBlocker physics collider was overlapping plunger lane,
    // causing ball to get stuck / experience massive friction on launch.
    // Visual mesh is kept; physics body removed pending redesign.
    // const rightOutlaneBody = this.world.createRigidBody(
    //   this.rapier.RigidBodyDesc.fixed()
    //     .setTranslation(11, 0.3, -10)
    //     .setRotation(new this.rapier.Quaternion(0, Math.sin(-0.2), 0, Math.cos(-0.2)))
    // )
    // this.world.createCollider(
    //   this.rapier.ColliderDesc.cuboid(0.2, 0.75, 3)
    //     .setRestitution(0.6)
    //     .setFriction(0.1),
    //   rightOutlaneBody
    // )
    // this.bindings.push({ mesh: rightOutlaneBlocker, rigidBody: rightOutlaneBody })

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

// ============================================================================
// PURE-VISUAL CYBER-NEON DECALS & DECORATION FACTORY
// Zero physics impact — all elements are emissive + bloom-friendly only.
// Decals automatically follow playfieldGroup tilt via target.parent wiring.
// ============================================================================

export interface DecalOptions {
  size?: Vector3
  normal?: Vector3
  emissiveIntensity?: number
  zOffset?: number
}

/**
 * Creates a projected neon decal on a target mesh (typically the LCD playfield ground).
 * Uses Babylon Decal API so the graphic conforms perfectly to the +18° tilted surface.
 * The decal is re-parented to follow the playfieldGroup.
 *
 * NOTE: texturePath may be a placeholder until real decal PNGs (circuit traces, arrows, etc.)
 * are added under public/assets/textures/decals/. Missing textures result in no-op visuals
 * for that decal; the geometry-based traces in applyTableDecorations provide immediate richness.
 */
export function createNeonDecal(
  scene: Scene,
  targetMesh: Mesh,
  position: Vector3,
  texturePath: string,
  options: DecalOptions = {}
): Mesh {
  const {
    size = new Vector3(4, 4, 0.1),
    normal = new Vector3(0, 1, 0),
    emissiveIntensity = 1.2,
    zOffset = -0.8
  } = options

  const decalMat = new StandardMaterial(`neonDecal-${Date.now()}`, scene)
  decalMat.diffuseTexture = new Texture(texturePath, scene)
  decalMat.diffuseTexture.hasAlpha = true
  decalMat.emissiveColor = color(PALETTE.CYAN).scale(emissiveIntensity)
  decalMat.emissiveTexture = decalMat.diffuseTexture
  decalMat.disableLighting = true
  decalMat.zOffset = zOffset

  const decal = MeshBuilder.CreateDecal('neonDecal', targetMesh, {
    position,
    normal,
    size
  })

  decal.material = decalMat
  decal.parent = targetMesh.parent
  return decal
}

// ============================================================================
// NEXUS CASCADE — PREMIUM CYBER-NEON ARCADE AESTHETIC
// ============================================================================
// This section transforms the playfield into a high-end 2025 cyber-arcade
// cabinet. Everything here is 100% visual (no Rapier bodies, no colliders).
// All decoration respects the +18° playfieldGroup tilt via parenting.
//
// Design Language ("Nexus Cascade"):
//   • Primary power: Electric CYAN
//   • Data / secondary: Hot MAGENTA
//   • Premium / energy: Liquid GOLD
//   • Depth / mystery: Deep ULTRAVIOLET (PURPLE)
//   • Danger / warning: ALERT (orange-red)
//   • Bio / rare accents: MATRIX green
//
// Techniques: Decal API + low-poly emissive tubes/boxes/tori/pyramids,
// material sharing, INTENSITY constants, layered bloom-ready glows.
// ============================================================================

// -----------------------------------------------------------------------------
// Extended DecorationFactory — reusable visual building blocks
// -----------------------------------------------------------------------------

export class DecorationFactory {
  /**
   * Creates a glowing neon strut (thin vertical tech pillar).
   * Purely visual — no collider.
   */
  static createNeonStrut(name: string, scene: Scene, parent: TransformNode, pos: Vector3) {
    const strut = MeshBuilder.CreateCylinder(name, { height: 1.8, diameter: 0.08 }, scene)
    strut.parent = parent
    strut.position = pos

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
    mat.diffuseColor = Color3.Black()
    strut.material = mat
    return strut
  }

  /**
   * Creates a small glowing tech node (indicator / junction box).
   * Purely visual — no collider.
   */
  static createTechNode(name: string, scene: Scene, parent: TransformNode, pos: Vector3) {
    const node = MeshBuilder.CreateBox(name, { size: 0.35 }, scene)
    node.parent = parent
    node.position = pos

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.HIGH)
    node.material = mat
    return node
  }

  /**
   * Creates a faceted glowing crystal (holo-diamond / data shard).
   * Slightly rotated for interesting bloom highlights. Purely visual.
   */
  static createHoloCrystal(name: string, scene: Scene, parent: TransformNode, pos: Vector3, scale = 1.0, tint: string = PALETTE.GOLD) {
    const crystal = MeshBuilder.CreatePolyhedron(name, { type: 0, size: 0.22 * scale }, scene) // tetrahedron-ish
    crystal.parent = parent
    crystal.position = pos
    crystal.rotation.set(
      Math.random() * 0.8 + 0.3,
      Math.random() * Math.PI * 2,
      Math.random() * 0.6 + 0.4
    )

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(tint, INTENSITY.HIGH)
    mat.diffuseColor = Color3.Black()
    mat.disableLighting = true
    crystal.material = mat
    return crystal
  }

  /**
   * Creates a glowing neon ring (energy halo / data port).
   */
  static createNeonRing(name: string, scene: Scene, parent: TransformNode, pos: Vector3, diameter = 1.4, colorHex: string = PALETTE.CYAN) {
    const ring = MeshBuilder.CreateTorus(name, {
      diameter,
      thickness: 0.045,
      tessellation: 28
    }, scene)
    ring.parent = parent
    ring.position = pos
    ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.15

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(colorHex, INTENSITY.ACTIVE)
    mat.diffuseColor = Color3.Black()
    mat.disableLighting = true
    ring.material = mat
    return ring
  }

  /**
   * Creates a stylized "fiber optic" wire bundle (multiple parallel curved tubes).
   * Excellent for connecting clusters and adding organic cyber flow.
   */
  static createWireBundle(
    name: string,
    scene: Scene,
    parent: TransformNode,
    start: Vector3,
    end: Vector3,
    strands = 4,
    baseColor: string = PALETTE.CYAN
  ) {
    const bundle: Mesh[] = []
    const colors = [baseColor, PALETTE.MAGENTA, PALETTE.GOLD, PALETTE.PURPLE]

    for (let i = 0; i < strands; i++) {
      const offset = (i - (strands - 1) / 2) * 0.09
      const mid = new Vector3(
        (start.x + end.x) / 2 + offset * 0.6,
        start.y + 0.25 + Math.sin(i) * 0.08,
        (start.z + end.z) / 2 + offset * 0.3
      )

      const path = [start, mid, end]
      const wire = MeshBuilder.CreateTube(`${name}_s${i}`, {
        path,
        radius: 0.028 + (i % 2) * 0.008,
        tessellation: 5,
        cap: 2
      }, scene)

      wire.parent = parent
      const mat = new StandardMaterial(`${name}_mat_s${i}`, scene)
      mat.emissiveColor = emissive(colors[i % colors.length], 0.95 + i * 0.08)
      mat.diffuseColor = Color3.Black()
      mat.disableLighting = true
      wire.material = mat
      bundle.push(wire)
    }
    return bundle
  }

  /**
   * Creates a rectangular tech panel with subtle glowing seams.
   */
  static createTechPanel(name: string, scene: Scene, parent: TransformNode, pos: Vector3, size: Vector3, emissiveHex = PALETTE.PURPLE) {
    const panel = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene)
    panel.parent = parent
    panel.position = pos

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(emissiveHex, INTENSITY.NORMAL * 0.7)
    mat.diffuseColor = new Color3(0.02, 0.02, 0.04)
    panel.material = mat
    return panel
  }
}

// -----------------------------------------------------------------------------
// Artistic helper functions — the real creative heart of Nexus Cascade
// Each function is a self-contained visual motif. All low-poly + emissive.
// -----------------------------------------------------------------------------

/** Shared materials for performance (created once per decoration pass) */
let _sharedMats: Record<string, StandardMaterial> | null = null

function getSharedMat(scene: Scene, key: string, emissiveHex: string, intensity: number): StandardMaterial {
  if (!_sharedMats) _sharedMats = {}
  if (!_sharedMats[key]) {
    const m = new StandardMaterial(`sharedDecor_${key}`, scene)
    m.emissiveColor = emissive(emissiveHex, intensity)
    m.diffuseColor = Color3.Black()
    m.disableLighting = true
    _sharedMats[key] = m
  }
  return _sharedMats[key]
}

function createEmissiveTrace(
  scene: Scene,
  parent: TransformNode,
  from: Vector3,
  to: Vector3,
  hexColor: string,
  radius = 0.05,
  intensity = 1.15
): Mesh {
  const trace = MeshBuilder.CreateTube(
    `trace_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    { path: [from, to], radius, tessellation: 4, cap: 2 },
    scene
  )
  trace.parent = parent
  trace.material = getSharedMat(scene, `trace_${hexColor}`, hexColor, intensity)
  return trace
}

function createPerimeterBezel(scene: Scene, parent: TransformNode): void {
  // Outer glowing "picture frame" — gives the whole table a premium machined bezel
  const matCyan = getSharedMat(scene, 'bezelCyan', PALETTE.CYAN, 0.85)
  const matGold = getSharedMat(scene, 'bezelGold', PALETTE.GOLD, 0.7)

  // Long left & right rails
  const leftRail = MeshBuilder.CreateBox('bezelLeft', { width: 0.18, height: 0.07, depth: 34 }, scene)
  leftRail.parent = parent
  leftRail.position.set(-12.8, 0.04, 4.8)
  leftRail.material = matCyan

  const rightRail = MeshBuilder.CreateBox('bezelRight', { width: 0.18, height: 0.07, depth: 34 }, scene)
  rightRail.parent = parent
  rightRail.position.set(12.8, 0.04, 4.8)
  rightRail.material = matCyan

  // Front (flipper) and back accent rails
  const frontRail = MeshBuilder.CreateBox('bezelFront', { width: 25.2, height: 0.07, depth: 0.16 }, scene)
  frontRail.parent = parent
  frontRail.position.set(0, 0.04, -11.6)
  frontRail.material = matGold

  const backRail = MeshBuilder.CreateBox('bezelBack', { width: 25.2, height: 0.07, depth: 0.16 }, scene)
  backRail.parent = parent
  backRail.position.set(0, 0.04, 21.6)
  backRail.material = matGold

  // Corner "rivet" nodes
  const corners = [
    new Vector3(-12.4, 0.12, -11.2), new Vector3(12.4, 0.12, -11.2),
    new Vector3(-12.4, 0.12, 21.2), new Vector3(12.4, 0.12, 21.2)
  ]
  corners.forEach((p, i) => {
    const rivet = MeshBuilder.CreateCylinder(`bezelRivet${i}`, { height: 0.09, diameter: 0.22 }, scene)
    rivet.parent = parent
    rivet.position = p
    rivet.material = getSharedMat(scene, 'rivet', PALETTE.MAGENTA, 1.4)
  })
}

function createCentralReactorMotif(scene: Scene, parent: TransformNode): void {
  // Large elegant central "power core" — the visual heart of the table
  // Concentric rings + radial spokes + floating central orb
  const ringMat = getSharedMat(scene, 'reactorRing', PALETTE.CYAN, 1.05)
  const spokeMat = getSharedMat(scene, 'reactorSpoke', PALETTE.GOLD, 0.9)
  const coreMat = getSharedMat(scene, 'reactorCore', PALETTE.MAGENTA, 1.6)

  // Three concentric rings at slightly different heights
  for (let i = 0; i < 3; i++) {
    const r = 3.8 - i * 0.9
    const ring = MeshBuilder.CreateTorus(`reactorRing${i}`, {
      diameter: r * 2, thickness: 0.05 + i * 0.01, tessellation: 32
    }, scene)
    ring.parent = parent
    ring.position.set(0, 0.06 + i * 0.03, 5.5)
    ring.rotation.x = Math.PI / 2
    ring.material = ringMat
  }

  // Radial energy spokes (8 elegant lines)
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2
    const len = 3.6
    const spoke = MeshBuilder.CreateTube(`reactorSpoke${i}`, {
      path: [
        new Vector3(0, 0.05, 5.5),
        new Vector3(Math.cos(ang) * len, 0.05, 5.5 + Math.sin(ang) * len)
      ],
      radius: 0.035,
      tessellation: 3
    }, scene)
    spoke.parent = parent
    spoke.material = spokeMat
  }

  // Floating central holo-core (slightly above surface)
  const core = MeshBuilder.CreateSphere('reactorCore', { diameter: 0.85 }, scene)
  core.parent = parent
  core.position.set(0, 0.55, 5.5)
  core.material = coreMat

  // Tiny orbiting data nodes around the core
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2
    const orb = DecorationFactory.createTechNode(`coreOrb${i}`, scene, parent, new Vector3(
      Math.cos(angle) * 1.35, 0.35, 5.5 + Math.sin(angle) * 1.35
    ))
    orb.scaling.setAll(0.6)
  }
}

function createLanePowerRails(scene: Scene, parent: TransformNode): void {
  // Premium double-line power rails that run the full length of the table
  // These frame the main play area beautifully without interfering with physics lanes
  const flowMat = getSharedMat(scene, 'flowArrow', PALETTE.CYAN, 1.35)

  // Left power rail (double line for depth)
  createEmissiveTrace(scene, parent, new Vector3(-8.2, 0.03, -10), new Vector3(-8.2, 0.03, 19.5), PALETTE.GOLD, 0.07, 1.2)
  createEmissiveTrace(scene, parent, new Vector3(-7.85, 0.025, -10), new Vector3(-7.85, 0.025, 19.5), PALETTE.CYAN, 0.04, 0.95)

  // Right power rail (mirrored)
  createEmissiveTrace(scene, parent, new Vector3(8.2, 0.03, -10), new Vector3(8.2, 0.03, 19.5), PALETTE.GOLD, 0.07, 1.2)
  createEmissiveTrace(scene, parent, new Vector3(7.85, 0.025, -10), new Vector3(7.85, 0.025, 19.5), PALETTE.CYAN, 0.04, 0.95)

  // Repeating "energy flow" chevrons pointing up the table (directional dynamism)
  for (let z = -7; z < 17; z += 2.6) {
    // Left side
    const cL = MeshBuilder.CreateBox(`flowL${z}`, { width: 0.9, height: 0.06, depth: 0.14 }, scene)
    cL.parent = parent
    cL.position.set(-8.0, 0.04, z)
    cL.rotation.y = 0.6
    cL.material = flowMat

    // Right side
    const cR = MeshBuilder.CreateBox(`flowR${z}`, { width: 0.9, height: 0.06, depth: 0.14 }, scene)
    cR.parent = parent
    cR.position.set(8.0, 0.04, z)
    cR.rotation.y = -0.6
    cR.material = flowMat
  }

  // Plunger lane special treatment (right side only)
  createEmissiveTrace(scene, parent, new Vector3(9.6, 0.04, -9), new Vector3(9.6, 0.04, 8), PALETTE.MAGENTA, 0.055, 1.0)
  createEmissiveTrace(scene, parent, new Vector3(10.1, 0.035, -9), new Vector3(10.1, 0.035, 8), PALETTE.CYAN, 0.04, 0.8)
}

function createSideServerRacks(scene: Scene, parent: TransformNode): void {
  // Dense but elegant "server rack" clusters on the extreme left and right margins.
  // These sell the "high-end arcade cabinet" fantasy beautifully.
  const rackColors = [PALETTE.CYAN, PALETTE.MAGENTA, PALETTE.PURPLE]

  // LEFT SIDE — 3 distinct vertical clusters
  const leftClusters = [
    { x: -11.8, zBase: 15.5, count: 5 },
    { x: -11.4, zBase: 9.0, count: 4 },
    { x: -11.9, zBase: 2.5, count: 3 }
  ]

  leftClusters.forEach((cluster, ci) => {
    for (let i = 0; i < cluster.count; i++) {
      const z = cluster.zBase + i * 1.35
      const h = 1.4 + (i % 2) * 0.6
      const strut = DecorationFactory.createNeonStrut(`rackL${ci}_${i}`, scene, parent, new Vector3(cluster.x, h * 0.45, z))
      strut.scaling.y = h / 1.8

      // Cross bracing + nodes
      if (i % 2 === 0) {
        const brace = MeshBuilder.CreateBox(`rackBraceL${ci}_${i}`, { width: 0.7, height: 0.05, depth: 0.08 }, scene)
        brace.parent = parent
        brace.position.set(cluster.x + 0.4, h * 0.6, z)
        brace.material = getSharedMat(scene, 'brace', rackColors[(ci + i) % 3], 0.75)
      }
      DecorationFactory.createTechNode(`rackNodeL${ci}_${i}`, scene, parent, new Vector3(cluster.x + 0.25, h + 0.15, z))
    }
    // Hanging wire bundle from each cluster
    DecorationFactory.createWireBundle(`rackWiresL${ci}`, scene, parent,
      new Vector3(cluster.x + 0.3, 1.8, cluster.zBase + 1.5),
      new Vector3(cluster.x - 0.8, 0.4, cluster.zBase - 3.5),
      3, rackColors[ci % 3] as string
    )
  })

  // RIGHT SIDE — slightly different rhythm for visual interest
  const rightClusters = [
    { x: 11.6, zBase: 16.2, count: 4 },
    { x: 11.9, zBase: 8.5, count: 5 },
    { x: 11.5, zBase: 1.8, count: 3 }
  ]

  rightClusters.forEach((cluster, ci) => {
    for (let i = 0; i < cluster.count; i++) {
      const z = cluster.zBase + i * 1.45
      const h = 1.55 + ((i + 1) % 2) * 0.5
      const strut = DecorationFactory.createNeonStrut(`rackR${ci}_${i}`, scene, parent, new Vector3(cluster.x, h * 0.45, z))
      strut.scaling.y = h / 1.8

      if (i % 2 === 1) {
        const brace = MeshBuilder.CreateBox(`rackBraceR${ci}_${i}`, { width: 0.65, height: 0.05, depth: 0.08 }, scene)
        brace.parent = parent
        brace.position.set(cluster.x - 0.35, h * 0.55, z)
        brace.material = getSharedMat(scene, 'braceR', PALETTE.GOLD, 0.8)
      }
      DecorationFactory.createTechNode(`rackNodeR${ci}_${i}`, scene, parent, new Vector3(cluster.x - 0.2, h + 0.18, z))
    }
    DecorationFactory.createWireBundle(`rackWiresR${ci}`, scene, parent,
      new Vector3(cluster.x - 0.25, 1.9, cluster.zBase + 0.8),
      new Vector3(cluster.x + 0.9, 0.35, cluster.zBase - 4.2),
      4, PALETTE.MAGENTA as string
    )
  })
}

function createFloatingHoloShards(scene: Scene, parent: TransformNode): void {
  // Delicate floating holographic elements in visually "quiet" pockets.
  // These catch light beautifully and sell the premium sci-fi fantasy.
  const shardPositions = [
    // Left quiet zones
    { p: new Vector3(-6.2, 0.45, 13.5), s: 1.15, t: PALETTE.MATRIX },
    { p: new Vector3(-5.8, 0.32, 7.8), s: 0.85, t: PALETTE.CYAN },
    // Right quiet zones
    { p: new Vector3(6.4, 0.48, 12.8), s: 1.25, t: PALETTE.GOLD },
    { p: new Vector3(5.9, 0.29, 4.2), s: 0.9, t: PALETTE.PURPLE },
    // Back corners (near bumpers but not blocking)
    { p: new Vector3(-4.1, 0.55, 17.2), s: 1.4, t: PALETTE.ALERT },
    { p: new Vector3(3.8, 0.51, 17.6), s: 1.1, t: PALETTE.MAGENTA },
    // Front side pockets (near slings but elevated)
    { p: new Vector3(-4.8, 0.38, -5.5), s: 0.75, t: PALETTE.CYAN },
    { p: new Vector3(4.6, 0.41, -5.2), s: 0.8, t: PALETTE.GOLD }
  ]

  shardPositions.forEach((cfg, idx) => {
    DecorationFactory.createHoloCrystal(`holoShard${idx}`, scene, parent, cfg.p, cfg.s, cfg.t)
    // Add a second tiny companion crystal for richness
    if (idx % 2 === 0) {
      DecorationFactory.createHoloCrystal(`holoShard${idx}_b`, scene, parent,
        new Vector3(cfg.p.x + 0.6, cfg.p.y - 0.18, cfg.p.z + 0.9), cfg.s * 0.55, PALETTE.PURPLE)
    }
  })

  // A few elegant floating rings above the shards
  DecorationFactory.createNeonRing('holoRingL', scene, parent, new Vector3(-5.5, 0.85, 11.0), 1.1, PALETTE.CYAN)
  DecorationFactory.createNeonRing('holoRingR', scene, parent, new Vector3(5.3, 0.9, 10.4), 1.25, PALETTE.MAGENTA as string)
}

function createFiberOpticWiring(scene: Scene, parent: TransformNode): void {
  // Artistic snaking data cables that connect major clusters.
  // These add wonderful organic flow and "busy but premium" energy.
  const routes = [
    // Left-to-center data runs
    { s: new Vector3(-9.8, 0.3, 14), e: new Vector3(-2.5, 0.1, 9) },
    { s: new Vector3(-10.2, 0.25, 6), e: new Vector3(-1.8, 0.08, 3) },
    // Right-to-center
    { s: new Vector3(10.1, 0.28, 13.5), e: new Vector3(2.2, 0.12, 8) },
    { s: new Vector3(9.7, 0.22, 5), e: new Vector3(1.6, 0.07, 1.5) },
    // Cross-field long runs (very cyber)
    { s: new Vector3(-10.5, 0.35, 18), e: new Vector3(9.8, 0.15, -3) },
    { s: new Vector3(10.8, 0.32, 17), e: new Vector3(-9.2, 0.18, -2) }
  ]

  routes.forEach((r, i) => {
    DecorationFactory.createWireBundle(`fiber${i}`, scene, parent, r.s, r.e, 3 + (i % 2), (i % 2 ? PALETTE.CYAN : PALETTE.MAGENTA) as string)
  })
}

function createWarningBarricadesAndHazards(scene: Scene, parent: TransformNode): void {
  // Industrial danger markings near outlanes, drain, and upper corners.
  // These add narrative "this machine is serious" energy.
  const alertMat = getSharedMat(scene, 'alertStripe', PALETTE.ALERT, 1.0)
  const stripeMat = getSharedMat(scene, 'hazardStripe', PALETTE.GOLD, 0.85)

  // Outlane danger chevrons (left)
  for (let i = 0; i < 3; i++) {
    const c = MeshBuilder.CreateBox(`outlaneAlertL${i}`, { width: 1.1, height: 0.05, depth: 0.22 }, scene)
    c.parent = parent
    c.position.set(-7.2, 0.03, -8.5 - i * 1.4)
    c.rotation.y = 0.8
    c.material = alertMat
  }

  // Outlane danger chevrons (right)
  for (let i = 0; i < 3; i++) {
    const c = MeshBuilder.CreateBox(`outlaneAlertR${i}`, { width: 1.1, height: 0.05, depth: 0.22 }, scene)
    c.parent = parent
    c.position.set(7.4, 0.03, -8.5 - i * 1.4)
    c.rotation.y = -0.8
    c.material = alertMat
  }

  // Upper back hazard striping (near bumpers)
  for (let x = -5; x <= 5; x += 2.2) {
    const stripe = MeshBuilder.CreateBox(`upperHazard${x}`, { width: 1.4, height: 0.04, depth: 0.55 }, scene)
    stripe.parent = parent
    stripe.position.set(x, 0.03, 15.8)
    stripe.rotation.y = (x % 3) * 0.15
    stripe.material = stripeMat
  }

  // Drain area "do not enter" style diagonal bars
  for (let i = 0; i < 4; i++) {
    const bar = MeshBuilder.CreateBox(`drainBar${i}`, { width: 2.8, height: 0.05, depth: 0.12 }, scene)
    bar.parent = parent
    bar.position.set(-1.5 + i * 1.1, 0.035, -9.8)
    bar.rotation.y = 0.35 + i * 0.08
    bar.material = alertMat
  }
}

function createMicroLEDField(scene: Scene, parent: TransformNode): void {
  // Thousands of tiny "status LEDs" scattered across the surface like a living circuit board.
  // Extremely cheap (tiny boxes) but sells incredible density and quality.
  const ledColors = [PALETTE.CYAN, PALETTE.MAGENTA, PALETTE.GOLD, PALETTE.MATRIX]
  let idx = 0

  // Main field grid (avoiding the very center play lanes)
  for (let x = -11; x <= 11; x += 1.35) {
    for (let z = -8; z <= 18; z += 1.6) {
      // Skip the most critical ball paths
      if (Math.abs(x) < 5.5 && z > -4 && z < 12) continue
      if (Math.abs(x) > 9.5) continue // already covered by server racks

      const led = MeshBuilder.CreateBox(`microLED_${idx++}`, { size: 0.08 }, scene)
      led.parent = parent
      led.position.set(x + (Math.random() - 0.5) * 0.3, 0.015, z + (Math.random() - 0.5) * 0.25)
      led.material = getSharedMat(scene, `led${idx % 4}`, ledColors[idx % 4], 0.6 + Math.random() * 0.5)
    }
  }
}

function createUpperMaintenanceCluster(scene: Scene, parent: TransformNode): void {
  // The "brain" of the machine — a dense cluster of panels, ports, and readouts
  // right under the backbox. Feels like real high-end pinball backglass support hardware.
  const panelMat = getSharedMat(scene, 'maintPanel', PALETTE.PURPLE, 0.65)
  const portMat = getSharedMat(scene, 'maintPort', PALETTE.CYAN, 1.3)

  // Large base maintenance plate
  const plate = MeshBuilder.CreateBox('maintPlate', { width: 11, height: 0.06, depth: 5.5 }, scene)
  plate.parent = parent
  plate.position.set(0, 0.03, 18.8)
  plate.material = panelMat

  // Grid of glowing "access ports"
  for (let x = -4; x <= 4; x += 1.6) {
    for (let z = 16.5; z <= 20.5; z += 1.3) {
      const port = MeshBuilder.CreateCylinder(`maintPort_${x}_${z}`, { height: 0.04, diameter: 0.38 }, scene)
      port.parent = parent
      port.position.set(x, 0.06, z)
      port.material = portMat

      // Tiny status LED on each port
      const led = MeshBuilder.CreateBox(`portLED_${x}_${z}`, { size: 0.07 }, scene)
      led.parent = parent
      led.position.set(x + 0.18, 0.09, z)
      led.material = getSharedMat(scene, 'portLED', PALETTE.MATRIX, 1.8)
    }
  }

  // A few elegant vertical "diagnostic" struts rising from the plate
  for (let i = 0; i < 3; i++) {
    const s = DecorationFactory.createNeonStrut(`diagStrut${i}`, scene, parent, new Vector3(-3 + i * 3, 0.9, 19.2))
    s.scaling.y = 0.9
  }
}

// -----------------------------------------------------------------------------
// MAIN EXPORT — applyTableDecorations
// This is the single public function called once after the playfield ground exists.
// It builds the entire "Nexus Cascade" premium cyber-neon experience.
// -----------------------------------------------------------------------------

/**
 * applyTableDecorations
 *
 * The complete visual upgrade pass for the playfield.
 * Creates a rich, dense, cohesive "Nexus Cascade" cyber-neon arcade cabinet aesthetic
 * that feels expensive, alive, and perfectly integrated with the existing geometry.
 *
 * Features:
 *  - Projected vector decals (via Babylon Decal API — tilt-correct automatically)
 *  - Multi-layer perimeter bezel + power rails with directional flow chevrons
 *  - Central "reactor core" radial motif (the visual centerpiece)
 *  - Dense but elegant side "server rack" tech clusters with hanging fiber bundles
 *  - Floating holographic crystals + rings in quiet visual pockets
 *  - Artistic snaking data wiring connecting major elements
 *  - Industrial warning barricades near outlanes and drain
 *  - Thousands of micro status LEDs (incredible perceived density)
 *  - Upper maintenance / diagnostic cluster under the backbox
 *
 * Everything lives under a single `playfieldCyberDecor` TransformNode for cleanliness.
 * ZERO physics cost. Highly bloom-friendly. Uses shared materials aggressively.
 */
export function applyTableDecorations(
  scene: Scene,
  playfieldMesh: Mesh,
  playfieldGroup: TransformNode | null
): void {
  if (!playfieldMesh || !scene) return

  const parent = (playfieldGroup ?? playfieldMesh.parent ?? undefined) as TransformNode | undefined
  if (!parent) return

  // Reset shared material cache for this decoration pass
  _sharedMats = null

  // Root container for the entire decoration layer (easy to inspect / toggle later)
  const decorRoot = new TransformNode('playfieldCyberDecor', scene)
  decorRoot.parent = parent

  // ========================================================================
  // LAYER 1 — PROJECTED DECALS (high-level graphic language)
  // ========================================================================
  createNeonDecal(scene, playfieldMesh, new Vector3(0, -0.99, 5), '/assets/textures/decals/circuit-center.png', {
    size: new Vector3(7.5, 11, 0.08),
    emissiveIntensity: 1.35,
    zOffset: -0.6
  })
  createNeonDecal(scene, playfieldMesh, new Vector3(-5.5, -0.99, -6), '/assets/textures/decals/lane-arrow-l.png', {
    size: new Vector3(2.2, 3.5, 0.06),
    emissiveIntensity: 1.6,
    zOffset: -0.7
  })
  createNeonDecal(scene, playfieldMesh, new Vector3(5.5, -0.99, -6), '/assets/textures/decals/lane-arrow-r.png', {
    size: new Vector3(2.2, 3.5, 0.06),
    emissiveIntensity: 1.6,
    zOffset: -0.7
  })
  createNeonDecal(scene, playfieldMesh, new Vector3(0, -0.99, 14), '/assets/textures/decals/hazard-chevron.png', {
    size: new Vector3(9, 4, 0.05),
    emissiveIntensity: 1.1,
    zOffset: -0.9
  })

  // ========================================================================
  // LAYER 2 — ARCHITECTURAL BEZEL & POWER RAILS (premium framing)
  // ========================================================================
  createPerimeterBezel(scene, decorRoot)
  createLanePowerRails(scene, decorRoot)

  // ========================================================================
  // LAYER 3 — HERO MOTIF (the thing players remember)
  // ========================================================================
  createCentralReactorMotif(scene, decorRoot)

  // ========================================================================
  // LAYER 4 — SIDE TECH ECOSYSTEM (dense but respectful of play space)
  // ========================================================================
  createSideServerRacks(scene, decorRoot)
  createFiberOpticWiring(scene, decorRoot)

  // ========================================================================
  // LAYER 5 — FLOATING HOLO ACCENTS + MICRO DETAIL
  // ========================================================================
  createFloatingHoloShards(scene, decorRoot)
  createMicroLEDField(scene, decorRoot)

  // ========================================================================
  // LAYER 6 — NARRATIVE DANGER + BACK-OF-CABINET DETAIL
  // ========================================================================
  createWarningBarricadesAndHazards(scene, decorRoot)
  createUpperMaintenanceCluster(scene, decorRoot)

  console.log('[Decoration] Nexus Cascade premium cyber-neon decorations applied — table now feels like a high-end arcade cabinet')
}
