import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  PointLight,
  Texture,
  DynamicTexture,
} from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { Mesh } from '@babylonjs/core'
import type { CabinetLight, ShardParticle } from './types'
import {
  PALETTE,
  INTENSITY,
  STATE_COLORS,
  color,
  emissive,
  pulse,
} from './visual-language'

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
  private decorativeLights: (StandardMaterial | PBRMaterial)[] = []
  private lightingMode: 'normal' | 'hit' | 'fever' | 'reach' = 'normal'
  private lightingTimer = 0
  private hitFlashIntensity: number = 0

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
  registerDecorativeMaterial(mat: StandardMaterial | PBRMaterial): void {
      this.decorativeLights.push(mat)
  }

  createCabinetLighting(): void {
    // Unified LED strips using Visual Language palette
    const stripConfigs = [
      { 
        pos: new Vector3(-12.5, 1.5, 5), 
        size: new Vector3(0.2, 2.5, 32),
        color: PALETTE.CYAN,
        intensity: INTENSITY.NORMAL
      },
      { 
        pos: new Vector3(13.5, 1.5, 5), 
        size: new Vector3(0.2, 2.5, 32),
        color: PALETTE.CYAN,
        intensity: INTENSITY.NORMAL
      },
      { 
        pos: new Vector3(0.75, 5.5, 5), 
        size: new Vector3(26, 0.2, 32),
        color: PALETTE.MAGENTA,
        intensity: INTENSITY.AMBIENT
      },
      // Lower accent strips - unified purple
      {
        pos: new Vector3(-12.5, -1, 5),
        size: new Vector3(0.3, 0.1, 32),
        color: PALETTE.PURPLE,
        intensity: INTENSITY.AMBIENT
      },
      {
        pos: new Vector3(13.5, -1, 5),
        size: new Vector3(0.3, 0.1, 32),
        color: PALETTE.PURPLE,
        intensity: INTENSITY.AMBIENT
      }
    ]
    
    stripConfigs.forEach((config, idx) => {
      const strip = MeshBuilder.CreateBox(
        `ledStrip${idx}`,
        { width: config.size.x, height: config.size.y, depth: config.size.z },
        this.scene
      )
      strip.position.copyFrom(config.pos)
      
      const mat = new StandardMaterial(`ledStripMat${idx}`, this.scene)
      mat.emissiveColor = emissive(config.color, config.intensity)
      mat.alpha = Math.min(0.8, config.intensity)
      strip.material = mat
      
      const light = new PointLight(`stripLight${idx}`, config.pos, this.scene)
      light.diffuse = color(config.color)
      light.intensity = config.intensity
      light.range = 12
      light.shadowEnabled = false
      
      this.cabinetLights.push({ mesh: strip, material: mat, pointLight: light })
    })
  }

  spawnShardBurst(pos: Vector3, colorHex?: string): void {
    const burstColor = colorHex || PALETTE.CYAN
    for (let i = 0; i < 8; i++) {
      const m = MeshBuilder.CreateBox("s", { size: 0.15 }, this.scene) as Mesh
      m.position.copyFrom(pos)
      
      const mat = new StandardMaterial("sm", this.scene)
      mat.emissiveColor = emissive(burstColor, INTENSITY.FLASH)
      m.material = mat
      
      const vel = new Vector3(Math.random() - 0.5, Math.random() + 1, Math.random() - 0.5).scale(5)
      // Add rotation velocity
      const rotVel = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(10)
      // Random initial scale
      const initialScale = 0.8 + Math.random() * 0.4
      m.scaling.setAll(initialScale)
      
      this.shards.push({ mesh: m, vel, rotVel, life: 1.0, maxLife: 1.0, initialScale, material: mat })
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
      
      // Update position
      s.mesh.position.addInPlace(s.vel.scale(dt))
      s.vel.y -= 9.8 * dt
      s.vel.scaleInPlace(0.98) // Air drag
      
      // Update rotation
      s.mesh.rotation.addInPlace(s.rotVel.scale(dt))
      
      // Scale and alpha based on life
      const lifeNorm = s.life / s.maxLife
      s.material.alpha = lifeNorm * 0.8
      s.mesh.scaling.setAll(s.initialScale * (0.3 + lifeNorm * 0.7))
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
      let intensity = INTENSITY.NORMAL
      
      // Unified state-based lighting using Visual Language
      if (this.isJackpotActive) {
        if (this.jackpotPhase === 1) {
          // Breach: Pulsing alert red
          const p = pulse(time, 4, 0.2, 1.0)
          targetColor = emissive(STATE_COLORS.REACH, p * INTENSITY.FLASH)
          intensity = INTENSITY.FLASH
        } else if (this.jackpotPhase === 2) {
          // Critical: Strobing gold
          const strobe = (Math.sin(time * Math.PI * 4) + 1) * 0.5 // 2Hz smooth pulse
          targetColor = emissive(PALETTE.GOLD, strobe * INTENSITY.BURST)
          intensity = INTENSITY.BURST
        } else {
          // Meltdown: Rainbow wave
          const hue = (time * 0.5 + idx * 0.1) % 1
          targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0).scale(INTENSITY.HIGH)
          intensity = INTENSITY.HIGH
        }
      } else {
        switch (this.lightingMode) {
          case 'hit': {
            // Decay flash over time
            this.hitFlashIntensity = Math.max(0, this.hitFlashIntensity - dt * 5)
            const flashBoost = 1 + this.hitFlashIntensity * 2
            targetColor = emissive(PALETTE.WHITE, INTENSITY.FLASH * flashBoost)
            intensity = INTENSITY.FLASH * flashBoost
            break
          }
          case 'reach':
            // Pulsing alert
            targetColor = emissive(STATE_COLORS.REACH, pulse(time, 2, 0.3, INTENSITY.HIGH))
            intensity = INTENSITY.HIGH
            break
          case 'fever': {
            // Rainbow pulse
            const hue = (time * 2 + idx * 0.3) % 1
            targetColor = Color3.FromHSV(hue * 360, 0.8, 1.0)
            intensity = INTENSITY.HIGH + Math.sin(time * 10) * 0.5
            break
          }
          case 'normal':
          default: {
            // Breathing cyan - unified idle state
            const breath = pulse(time, 0.7, INTENSITY.AMBIENT, INTENSITY.NORMAL)
            targetColor = emissive(PALETTE.CYAN, breath)
            intensity = breath
            break
          }
        }
      }
      
      light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, dt * 10)
      light.pointLight.diffuse = light.material.emissiveColor
      light.pointLight.intensity = intensity
    })

    // Update decorative materials (plastics) with unified colors
    this.decorativeLights.forEach(mat => {
      if (this.isJackpotActive) {
        if (this.jackpotPhase === 3) {
          // Rainbow meltdown
          const hue = (time * 2) % 1
          mat.emissiveColor = Color3.FromHSV(hue * 360, 1.0, INTENSITY.HIGH)
        } else {
          // Red alert
          mat.emissiveColor = emissive(STATE_COLORS.REACH, INTENSITY.HIGH)
        }
      } else if (this.lightingMode === 'fever') {
        // Gold fever
        mat.emissiveColor = emissive(PALETTE.GOLD, pulse(time, 2, INTENSITY.NORMAL, INTENSITY.HIGH))
      } else if (this.lightingMode === 'reach') {
        // Alert pulse
        mat.emissiveColor = emissive(STATE_COLORS.REACH, pulse(time, 5, 0.3, INTENSITY.HIGH))
      } else {
        // Idle magenta tint
        mat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.AMBIENT)
      }
    })
  }

  setLightingMode(mode: 'normal' | 'hit' | 'fever' | 'reach', duration: number = 0): void {
    this.lightingMode = mode
    this.lightingTimer = duration
    if (mode === 'hit') {
      this.hitFlashIntensity = 1.0
    }
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

  // ============================================================================
  // SLOT MACHINE SOUND EFFECTS
  // ============================================================================

  /**
   * Play slot machine spin start sound
   */
  playSlotSpinStart(): void {
    if (!this.audioCtx) return
    
    // Rising pitch effect
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()
    
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(200, this.audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(800, this.audioCtx.currentTime + 0.3)
    
    g.gain.setValueAtTime(0.3, this.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.5)
    
    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    o.stop(this.audioCtx.currentTime + 0.5)
  }

  /**
   * Play reel stop sound (mechanical click)
   */
  playReelStop(reelIndex: number): void {
    if (!this.audioCtx) return
    
    const baseFreq = 400 + (reelIndex * 100)
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()
    
    o.type = 'square'
    o.frequency.setValueAtTime(baseFreq, this.audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, this.audioCtx.currentTime + 0.05)
    
    g.gain.setValueAtTime(0.2, this.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.1)
    
    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    o.stop(this.audioCtx.currentTime + 0.1)
  }

  /**
   * Play slot win sound (small win)
   */
  playSlotWin(multiplier: number): void {
    if (!this.audioCtx) return
    
    // Happy ascending arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.50] // C major chord
    const duration = 0.1 * multiplier
    
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const o = this.audioCtx!.createOscillator()
        const g = this.audioCtx!.createGain()
        
        o.type = 'sine'
        o.frequency.value = freq
        
        g.gain.setValueAtTime(0.3, this.audioCtx!.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx!.currentTime + duration)
        
        o.connect(g)
        g.connect(this.audioCtx!.destination)
        o.start()
        o.stop(this.audioCtx!.currentTime + duration)
      }, i * 100)
    })
  }

  /**
   * Play slot jackpot sound (big win)
   */
  playSlotJackpot(): void {
    if (!this.audioCtx) return
    
    // Fanfare effect
    const now = this.audioCtx.currentTime
    
    // Low drum roll
    for (let i = 0; i < 8; i++) {
      const o = this.audioCtx.createOscillator()
      const g = this.audioCtx.createGain()
      
      o.type = 'sawtooth'
      o.frequency.value = 100 + Math.random() * 50
      
      g.gain.setValueAtTime(0.2, now + i * 0.1)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.08)
      
      o.connect(g)
      g.connect(this.audioCtx.destination)
      o.start(now + i * 0.1)
      o.stop(now + i * 0.1 + 0.1)
    }
    
    // Victory chord
    setTimeout(() => {
      const chord = [523.25, 659.25, 783.99, 1046.50] // C major
      chord.forEach((freq, i) => {
        const o = this.audioCtx!.createOscillator()
        const g = this.audioCtx!.createGain()
        
        o.type = i === 0 ? 'sawtooth' : 'sine'
        o.frequency.value = freq * 2 // Octave up
        
        g.gain.setValueAtTime(i === 0 ? 0.4 : 0.2, this.audioCtx!.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx!.currentTime + 1.5)
        
        o.connect(g)
        g.connect(this.audioCtx!.destination)
        o.start()
        o.stop(this.audioCtx!.currentTime + 1.5)
      })
    }, 800)
  }

  /**
   * Play near miss sound (close to jackpot)
   */
  playNearMiss(): void {
    if (!this.audioCtx) return
    
    const o = this.audioCtx.createOscillator()
    const g = this.audioCtx.createGain()
    
    // Descending "aww" sound
    o.type = 'sine'
    o.frequency.setValueAtTime(400, this.audioCtx.currentTime)
    o.frequency.exponentialRampToValueAtTime(200, this.audioCtx.currentTime + 0.3)
    
    g.gain.setValueAtTime(0.3, this.audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.3)
    
    o.connect(g)
    g.connect(this.audioCtx.destination)
    o.start()
    o.stop(this.audioCtx.currentTime + 0.3)
  }

  // ============================================================================
  // SLOT MACHINE LIGHTING EFFECTS
  // ============================================================================

  private slotLightMode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot' = 'idle'
  private slotLightTimer = 0

  /**
   * Set lighting mode for slot machine effects
   */
  setSlotLightingMode(mode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'): void {
    this.slotLightMode = mode
    this.slotLightTimer = 0
  }

  /**
   * Update slot machine specific lighting
   * Call this from the main update loop
   */
  updateSlotLighting(dt: number): void {
    if (this.slotLightMode === 'idle') return
    
    this.slotLightTimer += dt
    const time = performance.now() * 0.001
    
    this.cabinetLights.forEach((light, idx) => {
      let targetColor: Color3
      let intensity = INTENSITY.NORMAL
      
      switch (this.slotLightMode) {
        case 'spin': {
          // Rapid rainbow chase
          const hue = (time * 5 + idx * 0.3) % 1
          targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0)
          intensity = INTENSITY.HIGH
          break
        }
          
        case 'stop': {
          // Quick flash white
          const flash = Math.sin(time * 20) > 0
          targetColor = flash ? Color3.White() : emissive(PALETTE.GOLD, INTENSITY.AMBIENT)
          intensity = flash ? INTENSITY.FLASH : INTENSITY.NORMAL
          break
        }
          
        case 'win':
          // Pulsing gold
          targetColor = emissive(PALETTE.GOLD, pulse(time, 3, INTENSITY.NORMAL, INTENSITY.HIGH))
          intensity = INTENSITY.HIGH
          break
          
        case 'jackpot': {
          // Intense strobing rainbow
          const jackpotHue = (time * 10 + idx * 0.2) % 1
          targetColor = Color3.FromHSV(jackpotHue * 360, 1.0, 1.0)
          intensity = INTENSITY.BURST
          break
        }
          
        default:
          targetColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
      }
      
      light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, dt * 15)
      light.pointLight.diffuse = light.material.emissiveColor
      light.pointLight.intensity = intensity
    })
  }

  getAudioContext(): AudioContext | null {
    return this.audioCtx
  }

  createParticleTexture(): Texture {
    return createSharedParticleTexture(this.scene)
  }
}
