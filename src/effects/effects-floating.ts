import { MeshBuilder, Vector3, StandardMaterial, Mesh, Animation, Scene, DynamicTexture, Color3 } from '@babylonjs/core'

export class FloatingNumberEffects {
  private scene: Scene
  private floatingNumbers: Mesh[] = []
  private readonly maxFloatingNumbers = 8
  constructor(scene: Scene) {
    this.scene = scene
  }

  spawnFloatingNumber(value: number, worldPosition: Vector3): void {
    const text = value.toString()

    if (this.floatingNumbers.length >= this.maxFloatingNumbers) {
      const oldest = this.floatingNumbers.shift()
      if (oldest) {
        oldest.dispose()
      }
    }

    // Create a dynamic texture with the number rendered
    const dt = new DynamicTexture(`floatingNumberTex_${text}`, { width: 256, height: 64 }, this.scene, false)
    const ctx = dt.getContext() as CanvasRenderingContext2D
    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = 'white'
    ctx.font = 'bold 48px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 32)
    dt.update()

    const plane = MeshBuilder.CreatePlane(`floatingNumber_${text}`, { width: 0.8, height: 0.2 }, this.scene)
    const mat = new StandardMaterial(`floatingNumberMat_${text}`, this.scene)
    mat.diffuseTexture = dt
    mat.emissiveColor = Color3.White()
    mat.disableLighting = true
    plane.material = mat

    plane.position = worldPosition.clone()
    plane.position.y += 0.5

    // Simple float-up animation
    const positionAnim = new Animation('floatingNumberPosition', 'position.y', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
    const alphaAnim = new Animation('floatingNumberAlpha', 'material.alpha', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)

    const totalFrames = 60
    positionAnim.setKeys([
      { frame: 0, value: plane.position.y },
      { frame: totalFrames, value: plane.position.y + 0.8 },
    ])
    alphaAnim.setKeys([
      { frame: 0, value: 1.0 },
      { frame: totalFrames, value: 0.0 },
    ])

    plane.animations = [positionAnim, alphaAnim]

    this.scene.beginAnimation(
      plane,
      0,
      totalFrames,
      false,
      1.0,
      () => {
        const idx = this.floatingNumbers.indexOf(plane)
        if (idx !== -1) this.floatingNumbers.splice(idx, 1)
        plane.dispose()
        mat.dispose()
        dt.dispose()
      }
    )

    this.floatingNumbers.push(plane)
  }
}
