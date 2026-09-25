import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../../core/physics-api'
import { getMaterialLibrary } from '../../materials'

import type { PathMechanicConfig } from './types'

export abstract class PathMechanic {
  protected scene: Scene
  protected world: PhysicsWorldSink
  protected rapier: PhysicsApi
  protected rootNode: TransformNode
  protected isSpawned = false
  protected mapBaseColor: string
  protected mapAccentColor: string
  protected neonMaterial: PBRMaterial

  constructor(scene: Scene, world: PhysicsWorldSink, rapier: PhysicsApi) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.rootNode = new TransformNode('mechanicRoot', scene)
    this.mapBaseColor = '#00d9ff'
    this.mapAccentColor = '#ff00ff'
    const matLib = getMaterialLibrary(scene)
    this.neonMaterial = matLib.getCabinetNeonMaterial(this.mapBaseColor)
  }

  abstract spawn(config: PathMechanicConfig): void
  abstract despawn(): void
  abstract update(dt: number, ballBodies: PhysicsBody[]): void

  setMapColors(baseColor: string, accentColor: string): void {
    this.mapBaseColor = baseColor
    this.mapAccentColor = accentColor
    const matLib = getMaterialLibrary(this.scene)
    this.neonMaterial = matLib.getCabinetNeonMaterial(baseColor)
    this.updateVisualColors()
  }

  protected abstract updateVisualColors(): void

  get isActive(): boolean {
    return this.isSpawned
  }
}
