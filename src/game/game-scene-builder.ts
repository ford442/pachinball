/**
 * Game Scene Builder — Staged scene construction helpers.
 */

import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Tools } from '@babylonjs/core/Misc/tools'
import { Scene } from '@babylonjs/core/scene'
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera'
import type { TimerScope } from '../core/timers'
import type { PhysicsSystem } from '../game-elements/physics'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { GameObjects } from '../objects'
import { applyTableDecorations } from '../objects'
import type { BallManager } from '../game-elements/ball-manager'
import type { AdventureMode } from '../adventure'
import { CameraController } from '../game-elements'

import type { GameUIManager } from './game-ui'
import { getMaterialLibrary } from '../materials'
import { getCabinetBuilder } from '../cabinet'
import { GameConfig } from '../config'
import type { AccessibilityConfig, QualityTier } from '../game-elements'

/** Longest `yieldFrame` waits for a frame that a hidden tab will never deliver. */
export const FRAME_YIELD_TIMEOUT_MS = 50

export interface SceneBuilderHost {
  readonly timers: TimerScope
  readonly scene: Scene | null
  readonly physics: PhysicsSystem
  readonly accessibility: AccessibilityConfig
  readonly qualityTier: QualityTier
  effects: EffectsSystem | null
  display: DisplaySystem | null
  gameObjects: GameObjects | null
  ballManager: BallManager | null
  tableCam: TargetCamera | null
  cameraController: CameraController | null
  adventureMode: AdventureMode | null
  mirrorTexture: import('@babylonjs/core/Materials/Textures/mirrorTexture').MirrorTexture | null
  shadowGenerator: ShadowGenerator | null
  playfieldGroup: TransformNode | null
  uiManager: GameUIManager | null
}

export class GameSceneBuilder {
  private readonly host: SceneBuilderHost

  constructor(host: SceneBuilderHost) {
    this.host = host
  }

  async buildCriticalScene(
    options: {
      onCabinetProgress?: (progress: number) => void
    } = {},
  ): Promise<void> {
    const { scene, gameObjects, ballManager, tableCam, effects, display } = this.host
    if (!scene || !gameObjects || !ballManager || !display) return

    // Root container for all playfield visuals — pitched so the far end rises toward
    // the backbox. Rapier physics stay flat; gravity provides the slope simulation.
    const playfieldGroup = new TransformNode('playfieldGroup', scene)
    playfieldGroup.rotation.x = Tools.ToRadians(18.0)
    this.host.playfieldGroup = playfieldGroup

    // Classic glTF (or procedural fallback). Started now, awaited at the end: walls, flippers
    // and the ball do not need it, so a slow glTF (15 s loader timeout) can no longer leave the
    // table without them, and Start still waits for the cabinet below (#453).
    const cabinetBuilder = getCabinetBuilder(scene)
    cabinetBuilder.setQualityTier(this.host.qualityTier)
    const cabinetReady = cabinetBuilder.loadCabinetPreset('classic', {
      qualityTier: this.host.qualityTier,
      onProgress: options.onCabinetProgress,
    })
    // If a step below throws first, the rejection must not surface as unhandled.
    cabinetReady.catch(() => undefined)

    this.createLCDPlayfield()   // ground + flipperGlow are parented to playfieldGroup inside

    // ========================================================================
    // NEXUS CASCADE — PREMIUM CYBER-NEON PLAYFIELD DECORATION
    // ========================================================================
    // One-shot visual upgrade that turns the table from prototype to high-end
    // arcade cabinet. Uses Decal API + pure emissive geometry. Everything is
    // parented under playfieldGroup so it perfectly follows the +18° tilt.
    // ZERO physics bodies. Called right after the LCD ground is created.
    if (this.host.playfieldGroup) {
      const ground = scene.getMeshByName('lcdGround') as Mesh | null
      if (ground) {
        applyTableDecorations(scene, ground, this.host.playfieldGroup)
      }
    }

    // The cabinet and backbox hierarchies do not exist yet (the loader's first step is an
    // async chunk import). The reparent below runs before either appears, and the snapshot
    // also covers anything the loader created synchronously, so neither is ever re-parented
    // into playfieldGroup.
    const beforeStructure = new Set(scene.meshes.map(m => m.uniqueId))

    gameObjects.createWalls()
    gameObjects.createFlippers()
    if (this.host.mirrorTexture) {
      ballManager.setMirrorTexture(this.host.mirrorTexture)
    }
    ballManager.createMainBall()

    // Parent flipper assemblies into the tilted playfield group (world pose preserved).
    for (const { mesh } of gameObjects.getAllFlippers().values()) {
      mesh.setParent(playfieldGroup, true)
    }

    // Reparent walls + flippers into the tilted visual group.
    // Ball is excluded — its position is overwritten each frame from Rapier world coords.
    scene.meshes
      .filter(m => !beforeStructure.has(m.uniqueId) && !m.parent && !/^ball$/i.test(m.name))
      .forEach(m => { m.parent = playfieldGroup })

    // Defensive build-phase logging
    const flipperMeshes = scene.meshes.filter(m => /flipper/i.test(m.name))
    const ballMeshes = scene.meshes.filter(m => /^ball$/i.test(m.name))
    console.log(`[GameSceneBuilder] Critical scene built: ${flipperMeshes.length} flipper meshes, ${ballMeshes.length} main ball meshes`)
    if (ballMeshes.length === 0) {
      console.warn('[GameSceneBuilder] WARNING: No main ball mesh found in scene after createMainBall()')
    }

    // A table without flippers is unplayable: fail the stage (the boot banner names it)
    // rather than enabling Start on it.
    const joints = [...gameObjects.getAllFlippers().values()].filter(f => f.joint).length
    if (joints < 2 || flipperMeshes.length < 2) {
      throw new Error(`Critical scene incomplete: ${joints}/2 flipper joints, ${flipperMeshes.length} flipper meshes`)
    }

    const shadowGenerator = this.host.shadowGenerator
    if (shadowGenerator) {
      for (const mesh of flipperMeshes) shadowGenerator.addShadowCaster(mesh, true)
      for (const mesh of ballMeshes) shadowGenerator.addShadowCaster(mesh, true)
    }

    // Start stays gated on the cabinet (or its procedural fallback) resolving.
    await cabinetReady

    // After the cabinet: the border glow binds to the preset's 'cabinetBackbox' mesh.
    display.createBackbox(new Vector3(0, 13.5, 26.5))

    if (tableCam && effects) {
      effects.registerCamera(tableCam)
      effects.registerTableCamera(tableCam)
    }

    if (tableCam) {
      this.host.cameraController = new CameraController(tableCam)
    }
  }

  createLCDPlayfield(): void {
    const { scene, physics } = this.host
    if (!scene) return

    const matLib = getMaterialLibrary(scene)
    const lcdMat = matLib.getLCDTableMaterial()

    const ground = MeshBuilder.CreateGround('lcdGround', { width: GameConfig.table.width, height: GameConfig.table.height }, scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = lcdMat

    if (physics.isReady()) {
      const physicsWorld = physics.getWorld()
      const rapier = physics.getPhysicsApi()
      const groundBody = physicsWorld.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
      )
      if (groundBody) {
        physicsWorld.createCollider(
          rapier.ColliderDesc.cuboid(GameConfig.table.width / 2, 0.1, GameConfig.table.height / 2),
          groundBody
        )
      }
    }

    ground.receiveShadows = true
    this.host.shadowGenerator?.addShadowCaster(ground, false)
    if (this.host.playfieldGroup) ground.parent = this.host.playfieldGroup

    if (!GameConfig.camera.reducedMotion) {
      const flipperGlow = MeshBuilder.CreateGround('flipperGlow', { width: 10, height: 6 }, scene)
      flipperGlow.position.set(0, -0.95, -7)
      flipperGlow.receiveShadows = true
      if (this.host.playfieldGroup) flipperGlow.parent = this.host.playfieldGroup
      const glowMat = new StandardMaterial('flipperGlowMat', scene)
      glowMat.diffuseColor = new Color3(0, 0, 0)
      glowMat.emissiveColor = new Color3(0, 0.07, 0.2)
      glowMat.alpha = 0.3
      flipperGlow.material = glowMat
    }

    console.log('[GameSceneBuilder] LCD playfield created')
  }

  buildGameplayScene(): void {
    const { scene, gameObjects, ballManager, display, effects } = this.host
    if (!scene || !gameObjects || !ballManager || !display || !effects) return

    // Snapshot before gameplay obstacles are built so we can reparent them to playfieldGroup
    const beforeGameplay = new Set(scene.meshes.map(m => m.uniqueId))

    gameObjects.createDeathZone()
    gameObjects.createPlungerBody()
    gameObjects.createPlungerVisuals()
    gameObjects.createLaneSensors()
    gameObjects.createBumpers()
    effects.initBumperSparkPool(12)
    gameObjects.createSlingshots()
    gameObjects.createPachinkoField()
    gameObjects.createFlipperRamps()
    gameObjects.createDrainRails()

    const shadowGenerator = this.host.shadowGenerator
    if (shadowGenerator) {
      const gameplayMeshes = scene.meshes.filter(m => /bumper|slingshot/i.test(m.name))
      for (const mesh of gameplayMeshes) shadowGenerator.addShadowCaster(mesh, true)
    }

    // Reparent all new obstacle meshes into the tilted visual group
    if (this.host.playfieldGroup) {
      const pg = this.host.playfieldGroup
      scene.meshes
        .filter(m => !beforeGameplay.has(m.uniqueId) && !m.parent)
        .forEach(m => { m.parent = pg })
    }
  }

  buildCosmeticScene(): void {
    const { gameObjects, effects, scene } = this.host
    if (!gameObjects || !effects || !scene) return

    gameObjects.createCabinetDecoration()

    effects.createCabinetLighting()

    const matLib = getMaterialLibrary(scene)
    const plasticMat = matLib.getNeonBumperMaterial('#FF0055')
    effects.registerDecorativeMaterial(plasticMat)
  }

  /**
   * Resolves on the next animation frame, or after FRAME_YIELD_TIMEOUT_MS if none arrives:
   * a hidden or occluded tab never fires rAF, and awaiting it would stall init (#452).
   * Whichever loses the race fires into an already-resolved promise.
   */
  yieldFrame(): Promise<void> {
    const { timers } = this.host
    return new Promise(resolve => {
      timers.requestAnimationFrame(() => resolve())
      timers.setTimeout(resolve, FRAME_YIELD_TIMEOUT_MS)
    })
  }
}
