/**
 * PLAN.md §1 Layer 1 — Physical / mechanical backbox depth.
 * Rotating drum cylinders and a static backdrop simulate the "real" props
 * behind the glass LCD screen.
 */

import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
} from '@babylonjs/core'
import type { Mesh, Scene } from '@babylonjs/core'
import { DisplayState, type DisplayConfig } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'
import { color, emissive, INTENSITY, PALETTE, QualityTier, STATE_COLORS } from '../game-elements/visual-language'

interface DrumVisual {
  mesh: Mesh
  speed: number
  phase: number
}

export class DisplayPhysicalLayer {
  private scene: Scene
  private root: TransformNode | null = null
  private backdrop: Mesh | null = null
  private drums: DrumVisual[] = []
  private time = 0
  private visible = true
  private qualityTier: QualityTier
  private drumSpeedMultiplier = 1

  constructor(scene: Scene, _config: DisplayConfig, qualityTier: QualityTier) {
    this.scene = scene
    this.qualityTier = qualityTier
  }

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    this.root = new TransformNode('displayPhysicalRoot', this.scene)
    this.root.parent = parent
    this.root.position.z = DISPLAY_LAYER_Z.PHYSICAL

    const w = config.width
    const h = config.height

    // Static backdrop — deep cabinet interior art
    this.backdrop = MeshBuilder.CreatePlane('physicalBackdrop', { width: w * 0.96, height: h * 0.96 }, this.scene)
    this.backdrop.parent = this.root
    this.backdrop.rotation.y = Math.PI
    this.backdrop.position.z = -0.05

    const backdropMat = new StandardMaterial('physicalBackdropMat', this.scene)
    backdropMat.diffuseColor = Color3.Black()
    backdropMat.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
    backdropMat.disableLighting = true
    this.backdrop.material = backdropMat

    if (this.qualityTier === QualityTier.LOW) {
      this.backdrop.isVisible = true
      return
    }

    // Three rotating drums (pachinko-style mechanical reels)
    const drumConfigs = [
      { x: -4.5, radius: 1.4, speed: 0.6, color: PALETTE.CYAN },
      { x: 0, radius: 1.8, speed: -0.45, color: PALETTE.PURPLE },
      { x: 4.5, radius: 1.3, speed: 0.75, color: PALETTE.GOLD },
    ]

    for (let i = 0; i < drumConfigs.length; i++) {
      const cfg = drumConfigs[i]
      const drum = MeshBuilder.CreateCylinder(
        `physicalDrum${i}`,
        { diameter: cfg.radius * 2, height: 0.35, tessellation: 24 },
        this.scene
      )
      drum.parent = this.root
      drum.rotation.z = Math.PI / 2
      drum.position.set(cfg.x, 0, 0.08)

      const mat = new StandardMaterial(`physicalDrumMat${i}`, this.scene)
      mat.diffuseColor = Color3.Black()
      mat.emissiveColor = emissive(cfg.color, INTENSITY.MEDIUM)
      mat.specularColor = color(cfg.color).scale(0.3)
      drum.material = mat

      this.drums.push({ mesh: drum, speed: cfg.speed, phase: i * 1.2 })
    }
  }

  onStateChange(state: DisplayState): void {
    switch (state) {
      case DisplayState.FEVER:
      case DisplayState.JACKPOT:
        this.drumSpeedMultiplier = 3.5
        break
      case DisplayState.REACH:
        this.drumSpeedMultiplier = 2.0
        break
      default:
        this.drumSpeedMultiplier = 1.0
    }

    if (this.backdrop?.material) {
      const mat = this.backdrop.material as StandardMaterial
      if (state === DisplayState.REACH) {
        mat.emissiveColor = emissive(STATE_COLORS.REACH, INTENSITY.LOW)
      } else if (state === DisplayState.FEVER || state === DisplayState.JACKPOT) {
        mat.emissiveColor = emissive(PALETTE.GOLD, INTENSITY.MEDIUM)
      } else {
        mat.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
      }
    }
  }

  update(dt: number, _state: DisplayState): void {
    if (!this.visible) return
    this.time += dt

    for (const drum of this.drums) {
      drum.mesh.rotation.x += dt * drum.speed * this.drumSpeedMultiplier
      // Subtle bob for mechanical feel
      drum.mesh.position.y = Math.sin(this.time * 2 + drum.phase) * 0.04
    }
  }

  updateParallax(time: number): void {
    if (this.root) {
      this.root.position.z = DISPLAY_LAYER_Z.PHYSICAL + Math.sin(time * 0.7) * 0.015
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (this.root) this.root.setEnabled(visible)
  }

  dispose(): void {
    for (const drum of this.drums) {
      drum.mesh.material?.dispose()
      drum.mesh.dispose()
    }
    this.backdrop?.material?.dispose()
    this.backdrop?.dispose()
    this.root?.dispose()
    this.drums = []
    this.backdrop = null
    this.root = null
  }
}
