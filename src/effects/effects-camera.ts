import { Camera, Vector3 } from '@babylonjs/core'

interface ScreenShakeConfig {
  intensity: number
  duration: number
  decay: number
}

export class CameraEffects {
  private camera: Camera
  private originalPosition: Vector3 = Vector3.Zero()
  private shakeActive = false
  private shakeIntensity = 0
  private shakeDecay = 0
  private shakeTimer = 0

  constructor(camera: Camera) {
    this.camera = camera
    this.originalPosition = camera.position.clone()
  }

  startShake(config: ScreenShakeConfig): void {
    this.shakeActive = true
    this.shakeIntensity = config.intensity
    this.shakeDecay = config.decay
    this.shakeTimer = config.duration
    this.originalPosition = this.camera.position.clone()
  }

  update(dt: number): void {
    if (!this.shakeActive) return

    this.shakeTimer -= dt

    if (this.shakeTimer <= 0) {
      this.stopShake()
      return
    }

    // Apply shake
    const shakeX = (Math.random() - 0.5) * this.shakeIntensity
    const shakeY = (Math.random() - 0.5) * this.shakeIntensity
    const shakeZ = (Math.random() - 0.5) * this.shakeIntensity * 0.5

    this.camera.position.x = this.originalPosition.x + shakeX
    this.camera.position.y = this.originalPosition.y + shakeY
    this.camera.position.z = this.originalPosition.z + shakeZ

    // Decay intensity
    this.shakeIntensity *= this.shakeDecay
  }

  stopShake(): void {
    this.shakeActive = false
    this.camera.position.copyFrom(this.originalPosition)
  }

  dispose(): void {
    this.stopShake()
  }
}
