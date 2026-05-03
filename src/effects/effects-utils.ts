import { DynamicTexture, Scene } from '@babylonjs/core'

export function createSharedParticleTexture(scene: Scene): DynamicTexture {
  const size = 64
  const tex = new DynamicTexture('sharedParticleTex', size, scene, false)
  const ctx = tex.getContext() as CanvasRenderingContext2D

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  tex.update()
  return tex
}
