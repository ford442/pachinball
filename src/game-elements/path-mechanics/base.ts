import { TransformNode, Scene, PBRMaterial } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../../materials'

import type { PathMechanicConfig } from './types'

export abstract class PathMechanic {
  protected scene: Scene
  protected world: RAPIER.World
  protected rapier: typeof RAPIER
  protected rootNode: TransformNode
  protected isSpawned = false
  protected mapBaseColor: string
  protected mapAccentColor: string
  protected neonMaterial: PBRMaterial

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
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
  abstract update(dt: number, ballBodies: RAPIER.RigidBody[]): void

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
