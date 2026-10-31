/**
 * Backbox screen border — an emissive strip around the backbox glass, driven by
 * DisplayState, the jackpot phase and bumper contacts (`ScreenBorderModel`).
 *
 * `CabinetLighting` builds it when its `enableScreenBorder` is on and feeds it
 * from the event bus. Its neighbour `BackboxBorderGlow` animates the cabinet's
 * own backbox mesh; this is a separate frame of six lit segments in front of the
 * glass, so the meltdown's top-to-bottom wave has rows to run down.
 *
 * Quality tier: LOW builds nothing. The backbox root does not exist when the
 * lighting is constructed (the display builds it later), so the strip is
 * created on the first frame the root is there. Its materials are not in the
 * frozen-material allowlist (frozen-material-set.ts): they change every frame.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import { DisplayState } from './display-types'
import { BORDER_SEGMENT_COUNT, ScreenBorderModel, type ScreenBorderAccessibility } from './screen-border-model'
import { QualityTier } from '../game-elements/visual-language'

export interface BackboxScreenBorderOptions {
  /** The glass the strip frames (`DisplayConfig.width` × `height`). */
  width: number
  height: number
  qualityTier: QualityTier
  /** Read every frame, so toggling photosensitive mode or reduced motion applies at once. */
  getAccessibility: () => ScreenBorderAccessibility
}

/** Strip thickness and depth, in backbox-local units. */
const THICKNESS = 0.22
const DEPTH = 0.12
/** In front of the composite glass (`DISPLAY_LAYER_Z.COMPOSITE`, -0.75); the scene camera is on -Z. */
const FRONT_Z = -0.82

export class BackboxScreenBorder {
  private readonly model: ScreenBorderModel
  private readonly enabled: boolean
  private meshes: Mesh[] = []
  private materials: StandardMaterial[] = []
  private disposed = false
  private visible = true

  constructor(
    private readonly scene: Scene,
    private readonly options: BackboxScreenBorderOptions,
  ) {
    this.enabled = options.qualityTier !== QualityTier.LOW
    this.model = new ScreenBorderModel(options.getAccessibility)
  }

  /** Whether the strip is built and lit (false on LOW, before the backbox exists, after dispose). */
  get built(): boolean {
    return this.meshes.length > 0
  }

  onDisplaySet(state: DisplayState): void {
    this.model.setDisplayState(state)
  }

  /** `jackpot:phase` from the sim-step phase clock; 0 when the sequence ends. */
  onJackpotPhase(phase: number): void {
    this.model.setJackpotPhase(phase)
  }

  /** A bumper contact, 0–1. */
  onContact(strength: number): void {
    this.model.contact(strength)
  }

  /** Once per render frame. */
  update(dt: number): void {
    if (!this.enabled || this.disposed) return
    if (!this.built && !this.build()) return
    if (!this.visible) return
    this.model.update(dt)
    for (let i = 0; i < BORDER_SEGMENT_COUNT; i++) {
      const [r, g, b] = this.model.colors[i]
      this.materials[i].emissiveColor.set(r, g, b)
    }
  }

  /** `CabinetLighting.setEnabled`: lights out hides the strip too. */
  setEnabled(enabled: boolean): void {
    for (const mesh of this.meshes) mesh.setEnabled(enabled)
    this.visible = enabled
  }

  dispose(): void {
    this.disposed = true
    for (const mesh of this.meshes) mesh.dispose()
    for (const material of this.materials) material.dispose()
    this.meshes = []
    this.materials = []
  }

  private build(): boolean {
    const root = this.scene.getTransformNodeByName('backboxRoot')
    if (!root) return false
    const { width, height } = this.options
    const halfW = width / 2
    const halfH = height / 2
    const side = THICKNESS / 2

    // Same order as BORDER_SEGMENT_ROW: top, upper-left, upper-right, lower-left, lower-right, bottom.
    const segments: Array<{ name: string; w: number; h: number; x: number; y: number }> = [
      { name: 'top', w: width + THICKNESS * 2, h: THICKNESS, x: 0, y: halfH + side },
      { name: 'upperLeft', w: THICKNESS, h: halfH, x: -halfW - side, y: halfH / 2 },
      { name: 'upperRight', w: THICKNESS, h: halfH, x: halfW + side, y: halfH / 2 },
      { name: 'lowerLeft', w: THICKNESS, h: halfH, x: -halfW - side, y: -halfH / 2 },
      { name: 'lowerRight', w: THICKNESS, h: halfH, x: halfW + side, y: -halfH / 2 },
      { name: 'bottom', w: width + THICKNESS * 2, h: THICKNESS, x: 0, y: -halfH - side },
    ]

    for (const seg of segments) {
      const mesh = MeshBuilder.CreateBox(
        `backboxScreenBorder_${seg.name}`,
        { width: seg.w, height: seg.h, depth: DEPTH },
        this.scene,
      )
      const material = new StandardMaterial(`backboxScreenBorderMat_${seg.name}`, this.scene)
      material.disableLighting = true
      material.diffuseColor.set(0, 0, 0)
      material.specularColor.set(0, 0, 0)
      mesh.material = material
      mesh.parent = root
      mesh.position.set(seg.x, seg.y, FRONT_Z)
      mesh.isPickable = false
      this.meshes.push(mesh)
      this.materials.push(material)
    }
    return true
  }
}
