import { Scene, Vector3, ParticleSystem, Color4, Texture } from '@babylonjs/core'

export class ParticleEffects {
  private scene: Scene
  private activeParticles: ParticleSystem[] = []
  private maxParticles = 100

  constructor(scene: Scene) {
    this.scene = scene
  }

  spawnBumperSpark(position: Vector3, color = '#00d9ff'): void {
    if (this.activeParticles.length >= this.maxParticles) return

    const particleSystem = new ParticleSystem('bumperSpark', 20, this.scene)
    particleSystem.particleTexture = this.getParticleTexture()
    particleSystem.emitter = position

    particleSystem.minEmitBox = new Vector3(-0.1, 0, -0.1)
    particleSystem.maxEmitBox = new Vector3(0.1, 0, 0.1)

    const color4 = Color4.FromHexString(color + 'FF')
    particleSystem.color1 = color4
    particleSystem.color2 = new Color4(1, 1, 1, 1)
    particleSystem.colorDead = new Color4(0, 0, 0, 0)

    particleSystem.minSize = 0.05
    particleSystem.maxSize = 0.15
    particleSystem.minLifeTime = 0.2
    particleSystem.maxLifeTime = 0.5
    particleSystem.emitRate = 100
    particleSystem.targetStopDuration = 0.1

    particleSystem.direction1 = new Vector3(-1, 1, -1)
    particleSystem.direction2 = new Vector3(1, 1, 1)
    particleSystem.minEmitPower = 2
    particleSystem.maxEmitPower = 5
    particleSystem.gravity = new Vector3(0, -5, 0)

    particleSystem.start()
    this.activeParticles.push(particleSystem)

    // Auto-cleanup
    setTimeout(() => {
      particleSystem.dispose()
      const idx = this.activeParticles.indexOf(particleSystem)
      if (idx > -1) this.activeParticles.splice(idx, 1)
    }, 1000)
  }

  spawnShardBurst(position: Vector3, count = 12): void {
    if (this.activeParticles.length >= this.maxParticles) return

    const particleSystem = new ParticleSystem('shardBurst', count, this.scene)
    particleSystem.particleTexture = this.getShardTexture()
    particleSystem.emitter = position

    particleSystem.color1 = new Color4(1, 0.8, 0.2, 1)
    particleSystem.color2 = new Color4(1, 0.5, 0, 1)
    particleSystem.colorDead = new Color4(0.2, 0, 0, 0)

    particleSystem.minSize = 0.1
    particleSystem.maxSize = 0.3
    particleSystem.minLifeTime = 0.5
    particleSystem.maxLifeTime = 1.0
    particleSystem.emitRate = count * 10
    particleSystem.targetStopDuration = 0.1

    particleSystem.direction1 = new Vector3(-1, 0.5, -1)
    particleSystem.direction2 = new Vector3(1, 1, 1)
    particleSystem.minEmitPower = 3
    particleSystem.maxEmitPower = 8
    particleSystem.gravity = new Vector3(0, -9.81, 0)

    particleSystem.start()
    this.activeParticles.push(particleSystem)

    setTimeout(() => {
      particleSystem.dispose()
      const idx = this.activeParticles.indexOf(particleSystem)
      if (idx > -1) this.activeParticles.splice(idx, 1)
    }, 1500)
  }

  spawnJackpotBurst(position: Vector3): void {
    // PERFORMANCE: Enforce particle cap for jackpot burst too
    if (this.activeParticles.length >= this.maxParticles) return

    const particleSystem = new ParticleSystem('jackpotBurst', 100, this.scene)
    particleSystem.particleTexture = this.getParticleTexture()
    particleSystem.emitter = position

    particleSystem.color1 = new Color4(1, 0.8, 0, 1)
    particleSystem.color2 = new Color4(1, 0.2, 0.8, 1)
    particleSystem.colorDead = new Color4(0, 0, 0, 0)

    particleSystem.minSize = 0.2
    particleSystem.maxSize = 0.5
    particleSystem.minLifeTime = 1
    particleSystem.maxLifeTime = 2
    particleSystem.emitRate = 200
    particleSystem.targetStopDuration = 0.5

    particleSystem.direction1 = new Vector3(-1, 1, -1)
    particleSystem.direction2 = new Vector3(1, 1, 1)
    particleSystem.minEmitPower = 5
    particleSystem.maxEmitPower = 15

    particleSystem.start()
    this.activeParticles.push(particleSystem)

    setTimeout(() => {
      particleSystem.dispose()
      const idx = this.activeParticles.indexOf(particleSystem)
      if (idx > -1) this.activeParticles.splice(idx, 1)
    }, 2500)
  }

  spawnTrail(): void {
    // Trail particle implementation - stub for future expansion
  }

  private getParticleTexture(): Texture {
    // Create or return cached particle texture
    return new Texture('assets/particle.png', this.scene)
  }

  private getShardTexture(): Texture {
    return new Texture('assets/shard.png', this.scene)
  }

  update(): void {
    // Update active particles if needed - stub for future expansion
  }

  dispose(): void {
    for (const particles of this.activeParticles) {
      particles.dispose()
    }
    this.activeParticles = []
  }
}
