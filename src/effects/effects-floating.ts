import { Animation } from '@babylonjs/core/Animations/animation'
import type { Animatable } from '@babylonjs/core/Animations/animatable'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Scene } from '@babylonjs/core/scene'
import { createUnlitMaterial } from '../materials/material-basic'

const TOTAL_FRAMES = 60
const RISE = 0.8
const TEX_WIDTH = 256
const TEX_HEIGHT = 64

/** One reusable popup: a plane with its own text texture and material, built once and re-drawn. */
interface FloatingSlot {
  plane: Mesh
  material: StandardMaterial
  texture: DynamicTexture
  positionAnim: Animation
  alphaAnim: Animation
  animatable: Animatable | null
  /** Bumped on every (re)use so a stale animation-end callback cannot release a reused slot. */
  generation: number
}

/**
 * Score popups. The old code built a plane, a `DynamicTexture` and a `StandardMaterial` per popup
 * and disposed all three a second later. Now at most `maxFloatingNumbers` slots exist, created the
 * first time they are needed and recycled afterwards; once the table has shown that many popups at
 * once, a popup allocates no texture and no material (#524).
 */
export class FloatingNumberEffects {
  private scene: Scene
  private readonly slots: FloatingSlot[] = []
  /** Slots currently showing a number, oldest first. */
  private readonly active: FloatingSlot[] = []
  private readonly maxFloatingNumbers = 8

  constructor(scene: Scene) {
    this.scene = scene
  }

  spawnFloatingNumber(value: number, worldPosition: Vector3): void {
    const slot = this.takeSlot()
    const text = value.toString()
    slot.generation++
    slot.animatable?.stop()

    // Render the number into the slot's texture
    const ctx = slot.texture.getContext() as CanvasRenderingContext2D
    ctx.clearRect(0, 0, TEX_WIDTH, TEX_HEIGHT)
    ctx.fillStyle = 'white'
    ctx.font = 'bold 48px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, TEX_WIDTH / 2, TEX_HEIGHT / 2)
    slot.texture.update()

    const plane = slot.plane
    plane.position.copyFrom(worldPosition)
    plane.position.y += 0.5
    slot.material.alpha = 1
    plane.setEnabled(true)

    // Simple float-up animation
    slot.positionAnim.setKeys([
      { frame: 0, value: plane.position.y },
      { frame: TOTAL_FRAMES, value: plane.position.y + RISE },
    ])
    slot.alphaAnim.setKeys([
      { frame: 0, value: 1.0 },
      { frame: TOTAL_FRAMES, value: 0.0 },
    ])

    const generation = slot.generation
    slot.animatable = this.scene.beginAnimation(plane, 0, TOTAL_FRAMES, false, 1.0, () => {
      if (slot.generation !== generation) return
      this.release(slot)
    })
    this.active.push(slot)
  }

  /** A free slot, a new one while under the cap, or the oldest popup's slot (it is cut short). */
  private takeSlot(): FloatingSlot {
    for (const slot of this.slots) {
      if (!this.active.includes(slot)) return slot
    }
    if (this.slots.length < this.maxFloatingNumbers) {
      const slot = this.createSlot(this.slots.length)
      this.slots.push(slot)
      return slot
    }
    const oldest = this.active.shift()
    if (!oldest) return this.slots[0]!
    return oldest
  }

  private createSlot(index: number): FloatingSlot {
    const texture = new DynamicTexture(`floatingNumberTex_${index}`, { width: TEX_WIDTH, height: TEX_HEIGHT }, this.scene, false)
    const plane = MeshBuilder.CreatePlane(`floatingNumber_${index}`, { width: 0.8, height: 0.2 }, this.scene)
    const material = createUnlitMaterial(this.scene, `floatingNumberMat_${index}`, Color3.White(), { diffuseTexture: texture })
    plane.material = material
    plane.isPickable = false
    plane.setEnabled(false)

    const positionAnim = new Animation('floatingNumberPosition', 'position.y', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
    const alphaAnim = new Animation('floatingNumberAlpha', 'material.alpha', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
    plane.animations = [positionAnim, alphaAnim]

    return { plane, material, texture, positionAnim, alphaAnim, animatable: null, generation: 0 }
  }

  private release(slot: FloatingSlot): void {
    const idx = this.active.indexOf(slot)
    if (idx !== -1) this.active.splice(idx, 1)
    slot.animatable = null
    slot.plane.setEnabled(false)
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.generation++
      slot.animatable?.stop()
      slot.plane.dispose()
      slot.material.dispose()
      slot.texture.dispose()
    }
    this.slots.length = 0
    this.active.length = 0
  }
}
