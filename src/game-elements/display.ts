import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture,
  ShaderMaterial,
  ShaderLanguage,
} from '@babylonjs/core'
import { numberScrollShader } from '../shaders/numberScroll'
import { jackpotOverlayShader } from '../shaders/jackpotOverlay'
import { DisplayState } from './types'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { Mesh } from '@babylonjs/core'

function lerp(start: number, end: number, t: number): number {
  return start * (1 - t) + end * t
}

export class DisplaySystem {
  private scene: Scene
  private useWGSL = false
  private displayState: DisplayState = DisplayState.IDLE
  private displayTransitionTimer = 0
  private currentStoryText: string = "LINK ESTABLISHED" // Story text buffer
  
  // Layers
  private backboxLayers: {
    background: Mesh | null
    mainDisplay: Mesh | null
    overlay: Mesh | null
  } = { background: null, mainDisplay: null, overlay: null }

  // Shader materials
  private shaderMaterial: ShaderMaterial | null = null
  private jackpotShader: ShaderMaterial | null = null
  private standardOverlayMat: StandardMaterial | null = null
  private reelMaterials: ShaderMaterial[] = []
  private reelOffsets: number[] = [0, 0, 0]
  private reelSpeeds: number[] = [0, 0, 0]
  
  // Textures
  private overlayTexture: DynamicTexture | null = null
  private slotTexture: DynamicTexture | null = null
  
  // Slot machine state
  private slotSymbols = ['7️⃣', '💎', '🍒', '🔔', '🍇', '⭐']
  private slotReels = [0, 0, 0]
  private slotSpeeds = [0, 0, 0]
  private slotMode = 0
  private slotStopTimer = 0

  constructor(scene: Scene, engine: Engine | WebGPUEngine) {
    this.scene = scene
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.useWGSL = engine.getClassName() === "WebGPUEngine" || (engine as any).isWebGPU === true
  }

  createBackbox(pos: Vector3): void {
    const frame = MeshBuilder.CreateBox("backboxFrame", { width: 22, height: 14, depth: 2 }, this.scene)
    frame.position.copyFrom(pos)
    const frameMat = new StandardMaterial("frameMat", this.scene)
    frameMat.diffuseColor = Color3.Black()
    frameMat.roughness = 0.5
    frame.material = frameMat

    // LAYER 1: PHYSICAL REELS (Deepest)
    if (this.useWGSL) {
      console.log("Initializing WGSL Reels")
      const gap = 7
      const numTexture = new Texture("./reel.png", this.scene)
      numTexture.wrapU = Texture.CLAMP_ADDRESSMODE
      numTexture.wrapV = Texture.WRAP_ADDRESSMODE

      for (let i = 0; i < 3; i++) {
        const reel = MeshBuilder.CreatePlane(`reel_${i}`, { width: 6, height: 10 }, this.scene)
        reel.position.copyFrom(pos)
        reel.position.x += (i - 1) * gap
        reel.position.z -= 0.5 // Deepest layer
        reel.rotation.y = Math.PI

        const mat = new ShaderMaterial(`reelMat_${i}`, this.scene, {
          vertexSource: numberScrollShader.vertex,
          fragmentSource: numberScrollShader.fragment,
        }, {
          attributes: ["position", "uv"],
          uniforms: ["worldViewProjection", "uOffset", "uSpeed", "uColor"],
          samplers: ["myTexture", "myTextureSampler"],
          shaderLanguage: ShaderLanguage.WGSL
        })

        mat.setTexture("myTexture", numTexture)
        mat.setFloat("uOffset", 0.0)
        mat.setFloat("uSpeed", 0.0)
        mat.setColor3("uColor", new Color3(1.0, 0.8, 0.2))

        reel.material = mat
        this.reelMaterials.push(mat)
      }
    } else {
      console.log("WebGPU not detected. Falling back to Canvas Reels.")
      const mainDisplay = MeshBuilder.CreatePlane("backboxScreen", { width: 20, height: 12 }, this.scene)
      mainDisplay.position.copyFrom(pos)
      mainDisplay.position.z -= 0.5 // Deepest layer
      mainDisplay.rotation.y = Math.PI

      const screenMat = new StandardMaterial("screenMat", this.scene)
      this.slotTexture = new DynamicTexture("slotTex", { width: 1024, height: 512 }, this.scene, true)
      this.slotTexture.hasAlpha = true
      screenMat.diffuseTexture = this.slotTexture
      screenMat.emissiveColor = Color3.White()
      mainDisplay.material = screenMat
      this.backboxLayers.mainDisplay = mainDisplay
    }

    // LAYER 2: TRANSPARENT VIDEO SCREEN (Middle)
    const bgLayer = MeshBuilder.CreatePlane("backboxBg", { width: 20, height: 12 }, this.scene)
    bgLayer.position.copyFrom(pos)
    bgLayer.position.z -= 0.8 // Middle layer
    bgLayer.rotation.y = Math.PI

    const cyberShader = new ShaderMaterial("cyberBg", this.scene, {
      vertexSource: `
          attribute vec3 position;
          attribute vec2 uv;
          uniform mat4 worldViewProjection;
          varying vec2 vUV;
          void main() {
              gl_Position = worldViewProjection * vec4(position, 1.0);
              vUV = uv;
          }
      `,
      fragmentSource: `
          uniform float time;
          uniform float speed;
          uniform vec3 colorTint; // New uniform for context-aware color
          varying vec2 vUV;
          void main() {
              float t = time * speed;
              float gridX = step(0.95, fract(vUV.x * 20.0 + sin(t*0.5)*0.5));
              float gridY = step(0.95, fract(vUV.y * 10.0 + t));

              // Use colorTint for the base and lines
              vec3 base = colorTint * 0.2;
              vec3 lines = colorTint * (gridX + gridY) * 0.8;

              // Dynamic alpha based on brightness
              float alpha = 0.05 + (gridX + gridY) * 0.4;
              gl_FragColor = vec4(base + lines, alpha);
          }
      `
    }, {
      attributes: ["position", "uv"],
      uniforms: ["worldViewProjection", "time", "speed", "colorTint"],
      needAlphaBlending: true
    })

    this.shaderMaterial = cyberShader
    bgLayer.material = cyberShader
    this.backboxLayers.background = bgLayer

    // LAYER 3: UI OVERLAY WITH SCANLINES
    const overlay = MeshBuilder.CreatePlane("backboxOverlay", { width: 20, height: 12 }, this.scene)
    overlay.position.copyFrom(pos)
    overlay.position.z -= 1.01
    overlay.rotation.y = Math.PI

    this.overlayTexture = new DynamicTexture("overlayTex", 512, this.scene, true)
    this.overlayTexture.hasAlpha = true

    // Create Standard Material for normal use
    this.standardOverlayMat = new StandardMaterial("overlayMat", this.scene)
    this.standardOverlayMat.diffuseTexture = this.overlayTexture
    this.standardOverlayMat.emissiveColor = Color3.White()
    this.standardOverlayMat.alpha = 0.99

    // Create Jackpot Shader Material
    this.jackpotShader = new ShaderMaterial("jackpotMat", this.scene, {
        vertexSource: jackpotOverlayShader.vertex,
        fragmentSource: jackpotOverlayShader.fragment,
    }, {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "uTime", "uPhase", "uGlitchIntensity", "uCrackProgress", "uShockwaveRadius"],
        samplers: ["myTexture"],
        needAlphaBlending: true
    })
    this.jackpotShader.setTexture("myTexture", this.overlayTexture)

    overlay.material = this.standardOverlayMat
    this.backboxLayers.overlay = overlay
  }

  // Method to update story text
  setStoryText(text: string): void {
    this.currentStoryText = text
    this.updateOverlay() // Force immediate redraw
  }

  setDisplayState(newState: DisplayState): void {
    this.displayState = newState
    this.displayTransitionTimer = 0
    
    // Switch Overlay Material if Jackpot
    if (this.backboxLayers.overlay) {
        if (newState === DisplayState.JACKPOT && this.jackpotShader) {
            if (this.backboxLayers.overlay.material !== this.jackpotShader) {
                this.backboxLayers.overlay.material = this.jackpotShader
            }
        } else {
            // Restore StandardMaterial if it was swapped
            if (this.backboxLayers.overlay.material !== this.standardOverlayMat && this.standardOverlayMat) {
                 this.backboxLayers.overlay.material = this.standardOverlayMat
            }
        }
    }

    if (newState === DisplayState.REACH) {
      this.slotMode = 1
      this.slotSpeeds = [5.0, 5.0, 5.0]
      this.slotStopTimer = 2.0
    } else if (newState === DisplayState.FEVER || newState === DisplayState.JACKPOT) {
      this.slotMode = 2
      this.slotReels = [0.1, 0.4, 0.7]
      this.slotSpeeds = [2.0, 3.0, 4.0]
    } else if (newState === DisplayState.ADVENTURE) {
      // Stop slots immediately for story mode
      this.slotMode = 0
      this.slotSpeeds = [0, 0, 0]
    } else {
      this.slotMode = 0
      this.slotSpeeds = [0, 0, 0]
    }
  }

  getDisplayState(): DisplayState {
    return this.displayState
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  update(dt: number, jackpotPhase: number = 0): void {
    this.displayTransitionTimer += dt
    
    if (this.shaderMaterial) {
      this.shaderMaterial.setFloat("time", performance.now() * 0.001)

      let speed = 0.5
      let color = new Color3(0.0, 1.0, 0.8) // Default Cyan

      if (this.displayState === DisplayState.REACH) {
        speed = 5.0
        color = new Color3(1.0, 0.0, 0.2) // Red
      } else if (this.displayState === DisplayState.FEVER) {
        speed = 10.0
        color = new Color3(1.0, 0.8, 0.0) // Gold
      } else if (this.displayState === DisplayState.JACKPOT) {
        speed = 20.0
        color = new Color3(1.0, 0.0, 1.0) // Magenta/Rainbow base
      } else if (this.displayState === DisplayState.ADVENTURE) {
        // Dark Green Matrix look
        speed = 1.0
        color = new Color3(0.0, 0.3, 0.0)
      }

      this.shaderMaterial.setFloat("speed", speed)
      this.shaderMaterial.setColor3("colorTint", color)
    }

    if (this.jackpotShader && this.displayState === DisplayState.JACKPOT) {
        this.jackpotShader.setFloat("uTime", performance.now() * 0.001)
        this.jackpotShader.setInt("uPhase", jackpotPhase)

        let glitch = 0.0
        let crack = 0.0
        let shock = 0.0

        if (jackpotPhase === 1) { // Breach
            glitch = 0.1
            crack = Math.min(1.0, this.displayTransitionTimer * 0.5)
        } else if (jackpotPhase === 2) { // Error
            glitch = 0.5
            crack = 1.0
        } else if (jackpotPhase === 3) { // Meltdown
            glitch = 0.0
            crack = 0.0
            shock = (this.displayTransitionTimer - 5.0) * 0.5 // Expanding wave
        }

        this.jackpotShader.setFloat("uGlitchIntensity", glitch)
        this.jackpotShader.setFloat("uCrackProgress", crack)
        this.jackpotShader.setFloat("uShockwaveRadius", shock)
    }
    
    // Skip slot updates in Adventure Mode
    if (this.displayState !== DisplayState.ADVENTURE) {
      if (this.useWGSL) {
        this.updateWGSLReels(dt)
      } else {
        this.drawSlots(dt)
      }
    }
    
    this.updateOverlay()
    
    if (this.slotMode === 1) {
      this.slotStopTimer -= dt
      if (this.slotStopTimer <= 0) {
        this.slotMode = 2
        this.slotSpeeds = [0.0, 5.0, 5.0]
      }
    }
    
    if (this.slotMode === 2) {
      let stopped = false
      if (this.useWGSL) {
        stopped = this.reelSpeeds[0] === 0 && this.reelSpeeds[1] === 0 && this.reelSpeeds[2] === 0
      } else {
        stopped = this.slotSpeeds[0] === 0 && this.slotSpeeds[1] === 0 && this.slotSpeeds[2] === 0
      }
      
      if (this.displayState === DisplayState.REACH && stopped) {
        this.setDisplayState(DisplayState.FEVER)
      }
    }
    
    if (this.displayState === DisplayState.FEVER && this.displayTransitionTimer > 6.0) {
      this.setDisplayState(DisplayState.IDLE)
    }
  }

  private updateWGSLReels(dt: number): void {
    for (let i = 0; i < 3; i++) {
      const mat = this.reelMaterials[i]

      if (this.slotMode === 1) {
        this.reelSpeeds[i] = lerp(this.reelSpeeds[i], 8.0, dt * 2)
      } else if (this.slotMode === 2) {
        const symbolHeight = 1.0 / 6.0

        this.reelSpeeds[i] = Math.max(0.5, this.reelSpeeds[i] - dt * 4)

        if (this.reelSpeeds[i] <= 1.0) {
          const currentOffset = this.reelOffsets[i]
          const targetIndex = Math.round(currentOffset / symbolHeight)
          const targetOffset = targetIndex * symbolHeight
          const diff = targetOffset - currentOffset

          if (Math.abs(diff) < 0.005) {
            this.reelOffsets[i] = targetOffset
            this.reelSpeeds[i] = 0
          } else {
            this.reelSpeeds[i] = diff * 10.0
          }
        }
      }
      
      this.reelOffsets[i] += this.reelSpeeds[i] * dt
      mat.setFloat("uOffset", this.reelOffsets[i])
      mat.setFloat("uSpeed", Math.abs(this.reelSpeeds[i]))
    }
  }

  private drawSlots(dt: number): void {
    if (!this.slotTexture) return
    
    for (let i = 0; i < 3; i++) {
      this.slotReels[i] += this.slotSpeeds[i] * dt
      this.slotReels[i] %= 1.0

      if (this.slotMode === 2) {
        if (this.slotSpeeds[i] > 0 && this.slotSpeeds[i] < 0.5) {
          const snap = Math.round(this.slotReels[i] * this.slotSymbols.length) / this.slotSymbols.length
          if (Math.abs(this.slotReels[i] - snap) < 0.01) {
            this.slotReels[i] = snap
            this.slotSpeeds[i] = 0
          }
        }
      }
    }

    const ctx = this.slotTexture.getContext() as CanvasRenderingContext2D
    const w = 1024
    const h = 512
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, w, h)

    const reelW = w / 3
    ctx.font = 'bold 140px Orbitron, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let i = 0; i < 3; i++) {
      const centerX = i * reelW + reelW / 2
      const offset = this.slotReels[i]
      const totalSyms = this.slotSymbols.length
      const rawIdx = offset * totalSyms
      const baseIdx = Math.floor(rawIdx)
      const subOffset = (rawIdx - baseIdx)

      for (let row = -1; row <= 1; row++) {
        let symIdx = (baseIdx - row) % totalSyms
        if (symIdx < 0) symIdx += totalSyms
        const symbol = this.slotSymbols[symIdx]
        const y = h / 2 + (row * 180) + (subOffset * 180)

        ctx.fillStyle = (this.slotMode === 0 && row === 0) ? '#ffffff' : '#888888'
        if (this.displayState === DisplayState.FEVER && row === 0) {
          ctx.fillStyle = '#ffff00'
          ctx.shadowBlur = 40
          ctx.shadowColor = '#ffaa00'
        } else {
          ctx.shadowBlur = 0
        }
        ctx.fillText(symbol, centerX, y)
      }
    }
    this.slotTexture.update()
  }

  private updateOverlay(): void {
    if (!this.overlayTexture) return
    
    const ctx = this.overlayTexture.getContext() as CanvasRenderingContext2D
    const w = 512
    const h = 512
    ctx.clearRect(0, 0, w, h)

    const time = performance.now() * 0.001

    if (this.displayState === DisplayState.ADVENTURE) {
      // Adventure Mode HUD

      // 1. Live Feed Box
      ctx.strokeStyle = "rgba(0, 255, 0, 0.5)"
      ctx.lineWidth = 4
      ctx.strokeRect(40, 40, w-80, h-160)

      // 2. "REC" Indicator
      if (Math.floor(time * 2) % 2 === 0) {
        ctx.fillStyle = "red"
        ctx.beginPath(); ctx.arc(60, 60, 8, 0, Math.PI*2); ctx.fill()
        ctx.fillStyle = "white"; ctx.font = "20px Orbitron"; ctx.fillText("LIVE", 80, 66)
      }

      // 3. Story Text (Mission Objectives)
      ctx.fillStyle = "#ccffcc"
      ctx.font = "28px Orbitron"
      ctx.textAlign = "center"
      ctx.shadowBlur = 10; ctx.shadowColor = "#00ff00"
      ctx.fillText(this.currentStoryText, w/2, h - 60)

      // 4. Data Stream Deco
      ctx.fillStyle = "rgba(0, 255, 0, 0.2)"
      ctx.fillRect(40, h-40, (Math.sin(time)*0.5+0.5) * (w-80), 5)

      ctx.shadowBlur = 0 // Reset
    } else if (this.displayState === DisplayState.IDLE) {
      // Random "Walk-by" shapes
      if (Math.floor(time) % 5 === 0) {
        ctx.fillStyle = 'rgba(0, 255, 255, 0.1)'
        const x = (time * 50) % w
        ctx.fillRect(x, h/2 - 20, 40, 40)
        ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'
        ctx.font = '20px Orbitron'
        ctx.fillText('SYSTEM READY', x + 20, h/2 + 40)
      }
    } else if (this.displayState === DisplayState.REACH) {
      // Flashing Reach
      const flash = Math.sin(time * 10) > 0
      if (flash) {
        ctx.fillStyle = 'rgba(255, 0, 85, 0.8)'
        ctx.font = 'bold 60px Orbitron, Arial'
        ctx.textAlign = 'center'
        ctx.shadowBlur = 20
        ctx.shadowColor = '#ff0055'
        ctx.fillText('REACH!', w / 2, h / 2)
      }

      // Target Reticles
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(w/2, h/2, 150 + Math.sin(time * 5) * 20, 0, Math.PI * 2)
      ctx.stroke()

    } else if (this.displayState === DisplayState.FEVER) {
      // Standard Fever Text
      ctx.fillStyle = 'rgba(255, 215, 0, 1.0)'
      ctx.font = 'bold 70px Orbitron, Arial'
      ctx.textAlign = 'center'
      ctx.shadowBlur = 30
      ctx.shadowColor = '#ffd700'
      ctx.fillText('FEVER MODE', w / 2, h / 2)
    } else if (this.displayState === DisplayState.JACKPOT) {
      // The text is handled partially by the shader effects, but we draw the core text here
      ctx.clearRect(0, 0, w, h) // Clear mostly to let shader do work

      // We know uPhase is an int, but Babylon's ShaderMaterial doesn't expose getInt() trivially on the type unless custom.
      // However, we are passing `jackpotPhase` to the update method of DisplaySystem.
      // Let's rely on that instead of trying to read back from the shader uniform.
      // But updateOverlay doesn't have jackpotPhase argument.
      // We can use the jackpotTimer or store the phase in a class member or just read it from game logic.
      // Actually, DisplaySystem.update() sets the shader uniform. We can just mirror it.

      // Let's assume we can deduce phase from time or just re-calculate it roughly here for display purposes,
      // OR better, update `updateOverlay` to accept phase or store it.

      // I will read `this.displayTransitionTimer` which aligns with the phases roughly.
      let phase = 0;
      if (this.displayTransitionTimer < 2.0) phase = 1;
      else if (this.displayTransitionTimer < 5.0) phase = 2;
      else phase = 3;

      if (phase === 1) {
          ctx.fillStyle = "red"
          ctx.font = "bold 60px Orbitron"
          ctx.textAlign = "center"
          ctx.fillText("WARNING", w/2, h/2 - 40)
          ctx.font = "30px Orbitron"
          ctx.fillText("CORE UNSTABLE", w/2, h/2 + 40)
      } else if (phase === 2) {
          const countdown = Math.ceil(5.0 - this.displayTransitionTimer)
          ctx.fillStyle = "white"
          ctx.font = "bold 150px Orbitron"
          ctx.textAlign = "center"
          ctx.fillText(String(countdown), w/2, h/2 + 50)
      } else if (phase === 3) {
          ctx.fillStyle = "#FFD700" // Gold
          ctx.font = "bold 80px Orbitron"
          ctx.textAlign = "center"
          ctx.shadowBlur = 50
          ctx.shadowColor = "white"
          ctx.fillText("JACKPOT", w/2, h/2)
          ctx.shadowBlur = 0
      }
    }

    // Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 2)
    }

    this.overlayTexture.update()
  }
}
