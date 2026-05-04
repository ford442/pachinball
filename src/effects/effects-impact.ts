import { ParticleSystem, DynamicTexture, Vector3, Scene } from '@babylonjs/core'

export class ImpactEffects {
  private scene: Scene
  private impactFlashPool: ParticleSystem | null = null
  private impactFlashPoolInited = false

  constructor(scene: Scene) {
    this.scene = scene
  }

  triggerImpactFlash(worldPosition: Vector3, intensity: number, colorHex = '#44aaff'): void {
    // Keep colorHex as used to satisfy linter (no-op)
    void colorHex

    if (!this.impactFlashPoolInited) {
      this.initImpactFlashPool()
    }
    if (!this.impactFlashPool) return

    const ps = this.impactFlashPool
    ps.emitter = worldPosition

    let count: number

    if (intensity >= 1.0) {
      count = 60
    } else {
      count = 25
    }

    ps.manualEmitCount = count
    ps.start()

    setTimeout(() => {
      ps.stop()
    }, 100)
  }

  private initImpactFlashPool(): void {
    if (this.impactFlashPoolInited) return
    this.impactFlashPoolInited = true

    const ps = new ParticleSystem('impactFlashPool', 100, this.scene)

    const size = 64
    const tex = new DynamicTexture('impactFlashTex', size, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)')
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    tex.update()
    ps.particleTexture = tex

    ps.minSize = 0.05
    ps.maxSize = 0.15
    ps.minLifeTime = 0.1
    ps.maxLifeTime = 0.1
    ps.emitRate = 0
    ps.blendMode = ParticleSystem.BLENDMODE_ADD
    ps.gravity = Vector3.Zero()
    ps.direction1 = new Vector3(-1, -1, -1)
    ps.direction2 = new Vector3(1, 1, 1)
    ps.minEmitPower = 2
    ps.maxEmitPower = 4
    ps.updateSpeed = 0.016

    this.impactFlashPool = ps
  }

  dispose(): void {
    if (this.impactFlashPool) {
      this.impactFlashPool.stop()
      try {
        this.impactFlashPool.dispose()
      } catch {}
      this.impactFlashPool = null
    }
  }
}
