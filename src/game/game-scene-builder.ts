/**
 * Game Scene Builder — Staged scene construction helpers.
 */

import { MeshBuilder, Mesh, Vector3, Scene, StandardMaterial, Color3, ShadowGenerator, TransformNode, Tools } from '@babylonjs/core'
import type { TargetCamera } from '@babylonjs/core'

import type { PhysicsSystem } from '../game-elements/physics'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { GameObjects } from '../objects'
import type { BallManager } from '../game-elements/ball-manager'
import type { AdventureMode } from '../adventure'
import { CameraController } from '../game-elements'

import type { GameUIManager } from './game-ui'
import { getMaterialLibrary } from '../materials'
import { getCabinetBuilder } from '../cabinet'
import { GameConfig } from '../config'

export interface SceneBuilderHost {
  readonly scene: Scene
  readonly physics: PhysicsSystem
  effects: EffectsSystem | null
  display: DisplaySystem | null
  gameObjects: GameObjects | null
  ballManager: BallManager | null
  tableCam: TargetCamera | null
  cameraController: CameraController | null
  adventureMode: AdventureMode | null
  mirrorTexture: import('@babylonjs/core').MirrorTexture | null
  shadowGenerator: ShadowGenerator | null
  playfieldGroup: TransformNode | null
  uiManager: GameUIManager | null
}

export class GameSceneBuilder {
  private readonly host: SceneBuilderHost

  constructor(host: SceneBuilderHost) {
    this.host = host
  }

  buildCriticalScene(): void {
    const { scene, gameObjects, ballManager, tableCam, effects, display } = this.host
    if (!gameObjects || !ballManager || !display) return

    // Root container for all playfield visuals — pitched so the far end rises toward
    // the backbox. Rapier physics stay flat; gravity provides the slope simulation.
    const playfieldGroup = new TransformNode('playfieldGroup', scene)
    playfieldGroup.rotation.x = Tools.ToRadians(18.0)
    this.host.playfieldGroup = playfieldGroup

    if (scene) {
      const cabinetBuilder = getCabinetBuilder(scene)
      // Cabinet preset is loaded by the cabinet manager; this is a fallback
      cabinetBuilder.loadCabinetPreset('classic')
    }

    this.createLCDPlayfield()   // ground + flipperGlow are parented to playfieldGroup inside

    display.createBackbox(new Vector3(0, 13.5, 26.5))

    // Snapshot mesh IDs after cabinet + backbox so those hierarchies are not reparented
    const beforeStructure = new Set(scene.meshes.map(m => m.uniqueId))

    gameObjects.createWalls()
    gameObjects.createFlippers()
    if (this.host.mirrorTexture) {
      ballManager.setMirrorTexture(this.host.mirrorTexture)
    }
    ballManager.createMainBall()

    // Reparent walls + flippers into the tilted visual group.
    // Ball is excluded — its position is overwritten each frame from Rapier world coords.
    scene.meshes
      .filter(m => !beforeStructure.has(m.uniqueId) && !m.parent && !/^ball$/i.test(m.name))
      .forEach(m => { m.parent = playfieldGroup })

    // Defensive build-phase logging
    if (scene) {
      const flipperMeshes = scene.meshes.filter(m => /flipper/i.test(m.name))
      const ballMeshes = scene.meshes.filter(m => /^ball$/i.test(m.name))
      console.log(`[GameSceneBuilder] Critical scene built: ${flipperMeshes.length} flipper meshes, ${ballMeshes.length} main ball meshes`)
      if (flipperMeshes.length === 0) {
        console.warn('[GameSceneBuilder] WARNING: No flipper meshes found in scene after createFlippers()')
      }
      if (ballMeshes.length === 0) {
        console.warn('[GameSceneBuilder] WARNING: No main ball mesh found in scene after createMainBall()')
      }

      const shadowGenerator = this.host.shadowGenerator
      if (shadowGenerator) {
        for (const mesh of flipperMeshes) shadowGenerator.addShadowCaster(mesh, true)
        for (const mesh of ballMeshes) shadowGenerator.addShadowCaster(mesh, true)
      }
    }

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

    const physicsWorld = physics.getWorld()
    const rapier = physics.getRapier()
    if (physicsWorld && rapier) {
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
    if (!gameObjects || !ballManager || !display || !effects) return

    // Snapshot before gameplay obstacles are built so we can reparent them to playfieldGroup
    const beforeGameplay = new Set(scene.meshes.map(m => m.uniqueId))

    gameObjects.createDeathZone()
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

  yieldFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
  }
}
