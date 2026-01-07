import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  PointLight,
  Texture,
  DynamicTexture,
} from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { Mesh } from '@babylonjs/core'
import type { CabinetLight, ShardParticle } from './types'

export function createSharedParticleTexture(scene: Scene): DynamicTexture {
    const size = 64
    const tex = new DynamicTexture("sharedParticleTex", size, scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D

    const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
    grad.addColorStop(0, "rgba(255, 255, 255, 1)")
    grad.addColorStop(1, "rgba(255, 255, 255, 0)")

    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    tex.update()
    return tex
}

export class EffectsSystem {
  private scene: Scene
  private audioCtx: AudioContext | null = null
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private bloomEnergy = 0
  private shards: ShardParticle[] = []
  private cabinetLights: CabinetLight[] = []
  private decorativeLights: StandardMaterial[] = []
  private lightingMode: 'normal' | 'hit' | 'fever' | 'reach' = 'normal'
  private lightingTimer = 0

  // Jackpot Variables
  public jackpotTimer = 0
  public isJackpotActive = false
  public jackpotPhase = 0 // 0=Idle, 1=Breach, 2=Error, 3=Meltdown

  constructor(scene: Scene, bloomPipeline: DefaultRenderingPipeline | null) {
    this.scene = scene
    this.bloomPipeline = bloomPipeline
    
    try {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch {
      this.audioCtx = null
    }
  }

  /**
   * Call this to register the "Plastic" materials created in GameObjects
   * so they can react to Fever/Reach modes.
   */
  registerDecorativeMaterial(mat: StandardMaterial): void {
      this.decorativeLights.push(mat)
  }

  createCabinetLighting(): void {
    const stripPositions = [
      { pos: new Vector3(-12.5, 2, 5), size: new Vector3(0.3, 3, 30) },
      { pos: new Vector3(13.5, 2, 5), size: new Vector3(0.3, 3, 30) },
      { pos: new Vector3(0.75, 6, 5), size: new Vector3(24, 0.3, 30) },
    ]
    
    stripPositions.forEach((config, idx) => {
      const strip = MeshBuilder.CreateBox(
        `ledStrip${idx}`,
        { width: config.size.x, height: config.size.y, depth: config.size.z },
        this.scene
      )
      strip.position.copyFrom(config.pos)
      
      const mat = new StandardMaterial(`ledStripMat${idx}`, this.scene)
      mat.emissiveColor = Color3.FromHexString("#00aaff")
      mat.alpha = 0.6
      strip.material = mat
      
      const light = new PointLight(`stripLight${idx}`, config.pos, this.scene)
      light.diffuse = Color3.FromHexString("#00aaff")
      light.intensity = 0.5
      light.range = 15
      
      this.cabinetLights.push({ mesh: strip, material: mat, pointLight: light })
    })
  }

  spawnShardBurst(pos: Vector3): void {
    for (let i = 0; i < 8; i++) {
      const m = MeshBuilder.CreateBox("s", { size: 0.15 }, this.scene) as Mesh
      m.position.copyFrom(pos)
      
      const mat = new StandardMaterial("sm", this.scene)
      mat.emissiveColor = Color3.Teal()
      m.material = mat
      
      const vel = new Vector3(Math.random() - 0.5, Math.random() + 1, Math.random() - 0.5).scale(5)
      this.shards.push({ mesh: m, vel, life: 1.0, material: mat })
    }
  }

  updateShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]
      s.life -= dt
      
      if (s.life <= 0) {
        s.mesh.dispose()
        this.shards.splice(i, 1)
        continue
      }
      
      s.mesh.position.addInPlace(s.vel.scale(dt))
      s.vel.y -= 9.8 * dt
    }
  }

  updateBloom(dt: number): void {
    if (this.bloomPipeline) {
      this.bloomEnergy = Math.max(0, this.bloomEnergy - dt)
      this.bloomPipeline.bloomWeight = 0.1 + (this.bloomEnergy * 0.8)
    }
  }

  setBloomEnergy(value: number): void {
    this.bloomEnergy = value
  }

  startJackpotSequence(): void {
    this.isJackpotActive = true
    this.jackpotTimer = 0
    this.jackpotPhase = 1
    this.playBeep(100) // Deep sub-bass start
  }

  updateJackpotSequence(dt: number): void {
    if (!this.isJackpotActive) return

    this.jackpotTimer += dt

    // Phase 1: Breach (0-2s)
    if (this.jackpotTimer < 2.0) {
      this.jackpotPhase = 1
      if (Math.random() < 0.1) this.playBeep(800) // Alarm siren
    }
    // Phase 2: Critical Error (2-5s)
    else if (this.jackpotTimer < 5.0) {
      this.jackpotPhase = 2
      const pitch = 200 + (this.jackpotTimer - 2.0) * 200 // Rising pitch
      if (Math.random() < 0.2) this.playBeep(pitch)
    }
    // Phase 3: Meltdown (5-10s)
    else if (this.jackpotTimer < 10.0) {
      if (this.jackpotPhase !== 3) {
          // One-shot explosion sound simulation
          this.playBeep(50)
      }
      this.jackpotPhase = 3
    }
    // End
    else {
      this.isJackpotActive = false
      this.jackpotPhase = 0
      this.lightingMode = 'normal'
    }
  }

  updateCabinetLighting(dt: number): void {
    const time = performance.now() * 0.001
    
    if (this.isJackpotActive) {
        this.updateJackpotSequence(dt)
    } else if (this.lightingTimer > 0) {
      this.lightingTimer -= dt
      if (this.lightingTimer <= 0) {
        this.lightingMode = 'normal'
      }
    }
    
    this.cabinetLights.forEach((light, idx) => {
      let targetColor: Color3
      let intensity = 0.5
      
      // Override logic for Jackpot
      if (this.isJackpotActive) {
          if (this.jackpotPhase === 1) {
              // Rapid Red Pulsing (4Hz)
              const pulse = Math.sin(time * 25.0) * 0.5 + 0.5
              targetColor = new Color3(1.0, 0.0, 0.0).scale(pulse)
              intensity = 2.0
          } else if (this.jackpotPhase === 2) {
              // Strobing White/Gold (10Hz)
              const strobe = Math.sin(time * 60.0) > 0 ? 1.0 : 0.0
              targetColor = new Color3(1.0, 0.8, 0.0).scale(strobe)
              intensity = 3.0
          } else {
              // Rainbow Wave
              const hue = (time * 0.5 + idx * 0.1) % 1
              targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0)
              intensity = 2.0
          }
      } else {
          switch (this.lightingMode) {
            case 'hit':
              targetColor = Color3.White()
              intensity = 2.0
              break
            case 'reach':
              // Pulsing Red
              targetColor = new Color3(1.0, 0.0, 0.2)
              intensity = 1.0 + Math.sin(time * 15) * 0.8
              break
            case 'fever': {
              const hue = (time * 2 + idx * 0.3) % 1
              targetColor = Color3.FromHSV(hue * 360, 0.8, 1.0)
              intensity = 1.5 + Math.sin(time * 10) * 0.5
              break
            }
            case 'normal':
            default: {
              const breath = 0.5 + Math.sin(time + idx * 0.5) * 0.3
              targetColor = Color3.FromHexString("#00aaff").scale(breath)
              intensity = 0.5 + breath * 0.2
              break
            }
          }
      }
      
      light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, dt * 10)
      light.pointLight.diffuse = light.material.emissiveColor
      light.pointLight.intensity = intensity
    })

    // Update Plastics
    this.decorativeLights.forEach(mat => {
      if (this.isJackpotActive) {
          if (this.jackpotPhase === 3) {
             const r = Math.sin(time * 10) * 0.5 + 0.5
             const g = Math.sin(time * 10 + 2) * 0.5 + 0.5
             const b = Math.sin(time * 10 + 4) * 0.5 + 0.5
             mat.emissiveColor.set(r, g, b)
          } else {
             mat.emissiveColor.set(1.0, 0.0, 0.0) // Red alert
          }
      } else if (this.lightingMode === 'fever') {
        // Rainbow pulse
        const r = Math.sin(time * 5) * 0.5 + 0.5
        const g = Math.sin(time * 5 + 2) * 0.5 + 0.5
        const b = Math.sin(time * 5 + 4) * 0.5 + 0.5
        mat.emissiveColor.set(r, g, b)
      } else if (this.lightingMode === 'reach') {
        // Red Alert pulse
        const val = (Math.sin(time * 10) * 0.5 + 0.5)
        mat.emissiveColor.set(val, 0, 0)
      } else {
        // Idle Blue/Pink glow
        mat.emissiveColor.set(0.2, 0.0, 0.1)
      }
    })
  }

  setLightingMode(mode: 'normal' | 'hit' | 'fever' | 'reach', duration: number = 0): void {
    this.lightingMode = mode
    this.lightingTimer = duration
  }

  playBeep(freq: number): void {
    if (!this.audioCtx) return
    
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()
    
    o.frequency.value = freq
    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.1)
    o.stop(this.audioCtx.currentTime + 0.1)
  }

  getAudioContext(): AudioContext | null {
    return this.audioCtx
  }

  createParticleTexture(): Texture {
    return createSharedParticleTexture(this.scene)
  }
}
