/**
 * Per-track ambient VFX — electric arcs, neon flicker, mist, caustics hints.
 */

import {
  Scene,
  Vector3,
  ParticleSystem,
  Color4,
  Texture,
} from '@babylonjs/core'
import type { TrackAmbientStyle, TrackThemeProfile } from '../game-elements/track-theme-profiles'

export class TrackAmbientEffects {
  private scene: Scene
  private activeStyle: TrackAmbientStyle = 'none'
  private ambientSystems: ParticleSystem[] = []
  private flickerTimer = 0
  private profile: TrackThemeProfile | null = null
  private photosensitiveMode = false

  constructor(scene: Scene) {
    this.scene = scene
  }

  setPhotosensitiveMode(enabled: boolean): void {
    this.photosensitiveMode = enabled
    if (enabled) this.clear()
  }

  applyProfile(profile: TrackThemeProfile | null): void {
    this.clear()
    this.profile = profile
    if (!profile || profile.particles.ambient === 'none' || this.photosensitiveMode) {
      this.activeStyle = 'none'
      return
    }

    this.activeStyle = profile.particles.ambient
    switch (profile.particles.ambient) {
      case 'electric-arc':
        this.spawnElectricArcField(profile)
        break
      case 'neon-flicker':
        this.spawnNeonDust(profile)
        break
      case 'underwater-caustic':
        this.spawnCausticMotes(profile)
        break
      case 'ghost-mist':
        this.spawnGhostMist(profile)
        break
      case 'pixel-scan':
        this.spawnPixelSparks(profile)
        break
      default:
        break
    }
  }

  update(dt: number): number {
    if (!this.profile || this.activeStyle === 'none') return 1

    this.flickerTimer += dt

    if (this.activeStyle === 'neon-flicker' || this.activeStyle === 'electric-arc') {
      const base = 0.92 + Math.sin(this.flickerTimer * 14) * 0.04
      const spike = Math.sin(this.flickerTimer * 37) > 0.97 ? 0.12 : 0
      return Math.min(1.08, base + spike)
    }

    if (this.activeStyle === 'ghost-mist') {
      return 0.88 + Math.sin(this.flickerTimer * 2.5) * 0.08
    }

    return 1
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const ps of this.ambientSystems) {
      ps.stop()
      ps.dispose()
    }
    this.ambientSystems = []
    this.activeStyle = 'none'
    this.profile = null
  }

  private spawnElectricArcField(profile: TrackThemeProfile): void {
    const ps = new ParticleSystem('trackElectricArc', 80, this.scene)
    ps.particleTexture = this.getSparkTexture()
    ps.emitter = new Vector3(0, 6, 4)
    ps.minEmitBox = new Vector3(-12, -2, -14)
    ps.maxEmitBox = new Vector3(12, 8, 18)

    const primary = Color4.FromHexString(profile.particles.hitPrimary + 'cc')
    const accent = Color4.FromHexString(profile.particles.hitAccent + 'aa')
    ps.color1 = primary
    ps.color2 = accent
    ps.colorDead = new Color4(0, 0, 0, 0)

    ps.minSize = 0.02
    ps.maxSize = 0.12
    ps.minLifeTime = 0.08
    ps.maxLifeTime = 0.35
    ps.emitRate = 35
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE
    ps.direction1 = new Vector3(-2, 2, -2)
    ps.direction2 = new Vector3(2, 4, 2)
    ps.minEmitPower = 4
    ps.maxEmitPower = 12
    ps.gravity = new Vector3(0, -3, 0)
    ps.start()
    this.ambientSystems.push(ps)
  }

  private spawnNeonDust(profile: TrackThemeProfile): void {
    const ps = new ParticleSystem('trackNeonDust', 40, this.scene)
    ps.particleTexture = this.getSparkTexture()
    ps.emitter = new Vector3(0, 4, 0)
    ps.minEmitBox = new Vector3(-10, 0, -12)
    ps.maxEmitBox = new Vector3(10, 6, 12)
    ps.color1 = Color4.FromHexString(profile.particles.hitPrimary + '66')
    ps.color2 = Color4.FromHexString(profile.particles.hitAccent + '44')
    ps.colorDead = new Color4(0, 0, 0, 0)
    ps.minSize = 0.04
    ps.maxSize = 0.1
    ps.minLifeTime = 0.5
    ps.maxLifeTime = 1.2
    ps.emitRate = 12
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE
    ps.direction1 = new Vector3(-0.2, 0.5, -0.2)
    ps.direction2 = new Vector3(0.2, 1, 0.2)
    ps.minEmitPower = 0.5
    ps.maxEmitPower = 1.5
    ps.gravity = new Vector3(0, 0.2, 0)
    ps.start()
    this.ambientSystems.push(ps)
  }

  private spawnCausticMotes(profile: TrackThemeProfile): void {
    const ps = new ParticleSystem('trackCaustic', 30, this.scene)
    ps.particleTexture = this.getSparkTexture()
    ps.emitter = new Vector3(0, 2, 0)
    ps.minEmitBox = new Vector3(-8, -1, -10)
    ps.maxEmitBox = new Vector3(8, 5, 10)
    ps.color1 = Color4.FromHexString(profile.particles.hitAccent + '55')
    ps.color2 = Color4.FromHexString(profile.particles.hitPrimary + '33')
    ps.colorDead = new Color4(0, 0, 0, 0)
    ps.minSize = 0.15
    ps.maxSize = 0.35
    ps.minLifeTime = 1.0
    ps.maxLifeTime = 2.5
    ps.emitRate = 8
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
    ps.direction1 = new Vector3(-0.1, 0.1, -0.1)
    ps.direction2 = new Vector3(0.1, 0.3, 0.1)
    ps.minEmitPower = 0.2
    ps.maxEmitPower = 0.6
    ps.gravity = new Vector3(0, -0.1, 0)
    ps.start()
    this.ambientSystems.push(ps)
  }

  private spawnGhostMist(profile: TrackThemeProfile): void {
    const ps = new ParticleSystem('trackGhostMist', 25, this.scene)
    ps.particleTexture = this.getSparkTexture()
    ps.emitter = new Vector3(0, 1, 0)
    ps.minEmitBox = new Vector3(-10, 0, -12)
    ps.maxEmitBox = new Vector3(10, 4, 12)
    ps.color1 = Color4.FromHexString(profile.particles.hitPrimary + '33')
    ps.color2 = Color4.FromHexString(profile.particles.hitAccent + '22')
    ps.colorDead = new Color4(0, 0, 0, 0)
    ps.minSize = 0.4
    ps.maxSize = 1.0
    ps.minLifeTime = 2.0
    ps.maxLifeTime = 4.0
    ps.emitRate = 5
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
    ps.direction1 = new Vector3(-0.05, 0.2, -0.05)
    ps.direction2 = new Vector3(0.05, 0.4, 0.05)
    ps.minEmitPower = 0.1
    ps.maxEmitPower = 0.3
    ps.gravity = new Vector3(0, 0.05, 0)
    ps.start()
    this.ambientSystems.push(ps)
  }

  private spawnPixelSparks(profile: TrackThemeProfile): void {
    const ps = new ParticleSystem('trackPixelSpark', 50, this.scene)
    ps.particleTexture = this.getSparkTexture()
    ps.emitter = new Vector3(0, 3, 0)
    ps.minEmitBox = new Vector3(-10, 0, -12)
    ps.maxEmitBox = new Vector3(10, 6, 12)
    ps.color1 = Color4.FromHexString(profile.particles.hitAccent + 'ff')
    ps.color2 = Color4.FromHexString(profile.particles.hitPrimary + 'cc')
    ps.colorDead = new Color4(0, 0, 0, 0)
    ps.minSize = 0.06
    ps.maxSize = 0.06
    ps.minLifeTime = 0.15
    ps.maxLifeTime = 0.4
    ps.emitRate = 20
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE
    ps.direction1 = new Vector3(-1, 0, -1)
    ps.direction2 = new Vector3(1, 2, 1)
    ps.minEmitPower = 2
    ps.maxEmitPower = 6
    ps.gravity = new Vector3(0, -4, 0)
    ps.start()
    this.ambientSystems.push(ps)
  }

  private sparkTexture: Texture | null = null

  private getSparkTexture(): Texture {
    if (!this.sparkTexture) {
      this.sparkTexture = new Texture(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        this.scene,
      )
    }
    return this.sparkTexture
  }
}
