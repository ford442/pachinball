/**
 * Game Scene Builder — Staged scene construction helpers.
 */

import { MeshBuilder, Mesh, Vector3, Scene, StandardMaterial, Color3 } from '@babylonjs/core'
import type { ArcRotateCamera } from '@babylonjs/core'

import type { PhysicsSystem } from '../game-elements/physics'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { GameObjects } from '../objects'
import type { BallManager } from '../game-elements/ball-manager'
import type { CameraController } from '../game-elements/camera-controller'
import type { GameStateManager } from './game-state'
import type { AdventureMode } from '../adventure'
import type { AdventureManager } from './game-adventure'
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
  tableCam: ArcRotateCamera | null
  cameraController: CameraController | null
  adventureMode: AdventureMode | null
  mirrorTexture: import('@babylonjs/core').MirrorTexture | null
  uiManager: GameUIManager | null
}

export class GameSceneBuilder {
  private readonly host: SceneBuilderHost

  constructor(host: SceneBuilderHost) {
    this.host = host
  }

  buildCriticalScene(): void {
    const { scene, gameObjects, ballManager, tableCam, effects, adventureMode, cameraController, adventureManager } = this.host
    if (!gameObjects || !ballManager) return

    if (scene) {
      const cabinetBuilder = getCabinetBuilder(scene)
      // Cabinet preset is loaded by the cabinet manager; this is a fallback
      cabinetBuilder.loadCabinetPreset('classic')
    }

    this.createLCDPlayfield()

    gameObjects.createWalls()
    gameObjects.createFlippers()
    if (this.host.mirrorTexture) {
      ballManager.setMirrorTexture(this.host.mirrorTexture)
    }
    ballManager.createMainBall()

    if (tableCam && effects) {
      effects.registerCamera(tableCam)
      effects.registerTableCamera(tableCam)
    }

    if (tableCam) {
      const { CameraController: CC } = require('../game-elements') as typeof import('../game-elements')
      this.host.cameraController = new CC(tableCam)
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

    if (!GameConfig.camera.reducedMotion) {
      const flipperGlow = MeshBuilder.CreateGround('flipperGlow', { width: 10, height: 6 }, scene)
      flipperGlow.position.set(0, -0.95, -7)
      const glowMat = new StandardMaterial('flipperGlowMat', scene)
      glowMat.diffuseColor = new Color3(0, 0, 0)
      glowMat.emissiveColor = new Color3(0, 0.07, 0.2)
      glowMat.alpha = 0.3
      flipperGlow.material = glowMat
    }

    console.log('[GameSceneBuilder] LCD playfield created')
  }

  buildGameplayScene(): void {
    const { gameObjects, ballManager, display, effects } = this.host
    if (!gameObjects || !ballManager || !display || !effects) return

    gameObjects.createDeathZone()
    gameObjects.createBumpers()
    effects.initBumperSparkPool(12)
    gameObjects.createSlingshots()
    gameObjects.createPachinkoField()
    gameObjects.createFlipperRamps()
    gameObjects.createDrainRails()
  }

  buildCosmeticScene(): void {
    const { gameObjects, display, effects, scene } = this.host
    if (!gameObjects || !display || !effects || !scene) return

    gameObjects.createCabinetDecoration()

    display.createBackbox(new Vector3(0.75, 15, 30))
    effects.createCabinetLighting()

    const matLib = getMaterialLibrary(scene)
    const plasticMat = matLib.getNeonBumperMaterial('#FF0055')
    effects.registerDecorativeMaterial(plasticMat)
  }

  yieldFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
  }
}
