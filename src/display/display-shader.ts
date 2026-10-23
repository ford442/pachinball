/**
 * Display Shader Layer
 *
 * Handles the cyber-grid background and the two passes the backbox graph runs on the composite.
 *
 * Architecture
 * ─────────────
 * • backgroundMesh – a plane in the backbox hierarchy; renders the animated cyber grid via
 *                    ShaderMaterial. It is the `grid` layer of the backbox Frame Graph.
 * • CRT pass       – `crtEffect` fragment shader, run by backbox-frame-graph.ts on the backbox
 *                    composite (not on the camera: the playfield is never scanned).
 * • Jackpot pass   – `jackpotOverlay` fragment shader over the composite, plus the canvas texture
 *                    holding its WARNING / countdown / JACKPOT text. `getEffectPasses()` hands both
 *                    passes to the graph; this class only owns their uniforms and per-frame state.
 */

import { Effect } from '@babylonjs/core/Materials/effect'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { DisplayState, type DisplayConfig, CRT_PRESETS, type CRTEffectParams } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'
import type { BackboxEffectNode } from './backbox-graph-plan'
import type { BackboxEffectPass } from './backbox-frame-graph'
import { crtEffectShader } from '../shaders/crt-effect'
import { jackpotOverlayPostProcessFragment } from '../shaders/jackpotOverlay'
import { SCANLINE_UNIFORM, computeEffectiveScanlineIntensity } from '../shaders/scanline'

// ─── Register the pass fragment shaders once at module load ───────────────────
// Babylon resolves the shader by looking up "<name>FragmentShader" in the store.
Effect.ShadersStore['crtEffectFragmentShader'] = crtEffectShader.fragment
Effect.ShadersStore['jackpotOverlayFragmentShader'] = jackpotOverlayPostProcessFragment

const CRT_UNIFORMS = ['uTime', SCANLINE_UNIFORM, 'uCurvature', 'uVignette', 'uChromaticAberration', 'uGlow', 'uNoise', 'uFlicker']
const JACKPOT_UNIFORMS = ['uTime', 'uPhase', 'uCrackProgress', 'uShockwaveRadius', 'uGlitchIntensity']

/** The reduced-motion jackpot frame: full crack, one shockwave ring, no glitch, time frozen. */
const JACKPOT_STILL = { time: 0, crack: 1, shock: 0.55, glitch: 0 } as const

// ─── Private type for jackpot phase state ────────────────────────────────────
interface JackpotPhaseState {
  phase: number
  crack: number
  shock: number
  glitch: number
}

export class DisplayShaderLayer {
  private scene: Scene
  private config: DisplayConfig

  // Background – remains a 3-D plane inside the backbox hierarchy
  private material: ShaderMaterial | null = null
  private backgroundMesh: Mesh | null = null

  // Canvas text sampled by the jackpot pass (`myTexture`)
  private jackpotBaseTex: DynamicTexture | null = null
  private jackpotActive = false
  /** Reduced motion: the graph runs the still jackpot pass, so draw its text once, without motion. */
  private jackpotStill = false
  private jackpotStillPhase = -1

  private time = 0
  private crtEffectActive = false
  private playerScanlineEnabled = true
  private crtEffectParams: CRTEffectParams = CRT_PRESETS.MODERN_LCD
  private scanlineIntensityMultiplier = 1.0
  private accessibilityScanlineFactor = 1.0

  // Cached jackpot phase state – updated in update(), read when the pass binds
  private jackpotState: JackpotPhaseState = { phase: 0, crack: 0, shock: 0, glitch: 0 }

  constructor(scene: Scene, config: DisplayConfig) {
    this.scene = scene
    this.config = config
    this.createBackgroundMaterial()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Background – ShaderMaterial plane (world-space, part of backbox hierarchy)
  // ──────────────────────────────────────────────────────────────────────────
  private createBackgroundMaterial(): void {
    const cyberShader = new ShaderMaterial(
      'cyberBg',
      this.scene,
      {
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
          precision highp float;
          uniform float time;
          uniform float speed;
          uniform vec3 colorTint;
          varying vec2 vUV;
          void main() {
            float t = time * speed;
            float gridX = step(0.95, fract(vUV.x * 20.0 + sin(t*0.5)*0.5));
            float gridY = step(0.95, fract(vUV.y * 10.0 + t));
            vec3 base = colorTint * 0.2;
            vec3 lines = colorTint * (gridX + gridY) * 0.8;
            float alpha = 0.05 + (gridX + gridY) * 0.4;
            gl_FragColor = vec4(base + lines, alpha);
          }
        `,
      },
      {
        attributes: ['position', 'uv'],
        uniforms: ['worldViewProjection', 'time', 'speed', 'colorTint'],
        needAlphaBlending: true,
      }
    )

    // Static uniforms – set once, never touched in update()
    cyberShader.setFloat('speed', 0.5)
    cyberShader.setColor3('colorTint', Color3.FromHexString('#00ffd9'))
    this.material = cyberShader
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Effect passes (run by the backbox Frame Graph on the composite)
  // ──────────────────────────────────────────────────────────────────────────

  /** CRT runs while a game system asked for it AND the player has scanlines on. */
  isCrtActive(): boolean {
    return this.crtEffectActive && this.playerScanlineEnabled
  }

  isJackpotActive(): boolean {
    return this.jackpotActive
  }

  /** Reduced motion: the graph built the still jackpot pass (see planBackboxGraph). */
  setJackpotStill(still: boolean): void {
    if (this.jackpotStill === still) return
    this.jackpotStill = still
    this.jackpotStillPhase = -1
  }

  private bindCrt(effect: Effect): void {
    const p = this.crtEffectParams
    const scanlineIntensity = computeEffectiveScanlineIntensity(
      p.scanlineIntensity,
      this.scanlineIntensityMultiplier,
      this.accessibilityScanlineFactor
    )

    effect.setFloat('uTime', this.time)
    effect.setFloat(SCANLINE_UNIFORM, scanlineIntensity)
    effect.setFloat('uCurvature', p.curvature)
    effect.setFloat('uVignette', p.vignette)
    effect.setFloat('uChromaticAberration', p.chromaticAberration)
    effect.setFloat('uGlow', p.glow)
    effect.setFloat('uNoise', p.noise)
    effect.setFloat('uFlicker', p.flicker)
  }

  private bindJackpot(effect: Effect, still: boolean): void {
    if (this.jackpotBaseTex) effect.setTexture('myTexture', this.jackpotBaseTex)
    const s = this.jackpotState
    effect.setFloat('uTime', still ? JACKPOT_STILL.time : this.time)
    effect.setInt('uPhase', s.phase)
    effect.setFloat('uCrackProgress', still ? JACKPOT_STILL.crack : s.crack)
    effect.setFloat('uShockwaveRadius', still ? JACKPOT_STILL.shock : s.shock)
    effect.setFloat('uGlitchIntensity', still ? JACKPOT_STILL.glitch : s.glitch)
  }

  /** The CRT and jackpot passes, for backbox-frame-graph.ts. Which of them exist is the plan's call. */
  getEffectPasses(): Record<BackboxEffectNode, BackboxEffectPass> {
    return {
      crt: {
        fragmentShader: 'crtEffect',
        uniforms: CRT_UNIFORMS,
        samplers: [],
        isActive: () => this.isCrtActive(),
        bind: (effect) => this.bindCrt(effect),
      },
      jackpot: {
        fragmentShader: 'jackpotOverlay',
        uniforms: JACKPOT_UNIFORMS,
        samplers: ['myTexture'],
        isActive: () => this.jackpotActive,
        bind: (effect) => this.bindJackpot(effect, false),
      },
      jackpotStill: {
        fragmentShader: 'jackpotOverlay',
        uniforms: JACKPOT_UNIFORMS,
        samplers: ['myTexture'],
        isActive: () => this.jackpotActive,
        bind: (effect) => this.bindJackpot(effect, true),
      },
    }
  }

  getMeshes(): AbstractMesh[] {
    return this.backgroundMesh ? [this.backgroundMesh] : []
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create the background mesh, parented to the given root node, and the jackpot pass's canvas.
   */
  createLayer(parent: TransformNode): void {
    this.backgroundMesh?.dispose()

    this.backgroundMesh = MeshBuilder.CreatePlane(
      'shaderBg',
      { width: this.config.width, height: this.config.height },
      this.scene
    )
    this.backgroundMesh.parent = parent
    this.backgroundMesh.position.z = DISPLAY_LAYER_Z.SHADER
    this.backgroundMesh.rotation.y = Math.PI
    this.backgroundMesh.material = this.material
    // Static mesh optimisations
    this.backgroundMesh.isPickable = false
    this.backgroundMesh.freezeWorldMatrix()

    // 256×256 is plenty for the procedural crack/shockwave text
    this.jackpotBaseTex?.dispose()
    this.jackpotBaseTex = new DynamicTexture('jackpotBase', 256, this.scene, true)
    const ctx = this.jackpotBaseTex.getContext()
    ctx.fillStyle = '#050505'
    ctx.fillRect(0, 0, 256, 256)
    this.jackpotBaseTex.update()
  }

  update(dt: number, state: DisplayState, jackpotPhase: number): void {
    this.time += dt

    // Only `time` changes each frame for the background
    if (this.material) {
      this.material.setFloat('time', this.time)
    }

    // The graph runs the jackpot pass only while this is true
    const isJackpot = state === DisplayState.JACKPOT
    const wasJackpot = this.jackpotActive
    this.jackpotActive = isJackpot

    if (isJackpot) {
      let phase = 0
      let crack = 0.0
      let shock = 0.0
      let glitch = 0.0

      // Use relative timing within each phase for clean animation curves
      const rel = Math.max(0, this.time % 12)

      if (jackpotPhase === 1) {
        phase = 1
        crack = Math.min(1.0, rel * 0.7)
        glitch = 0.12
      } else if (jackpotPhase === 2) {
        phase = 2
        crack = 1.0
        glitch = 0.65 + Math.sin(this.time * 28) * 0.15
      } else if (jackpotPhase === 3) {
        phase = 3
        shock = ((rel * 0.9) % 1.6)
        glitch = 0.15
      }

      this.jackpotState = { phase, crack, shock, glitch }

      // Draw phase-specific overlay content into the base texture so the pass can show text.
      // The still pass gets one static frame per phase instead of a redraw every frame.
      if (!this.jackpotStill) {
        this.drawJackpotBaseContent(phase)
      } else if (this.jackpotStillPhase !== phase) {
        this.jackpotStillPhase = phase
        this.drawJackpotBaseContent(phase, true)
      }
    } else if (wasJackpot && this.jackpotBaseTex) {
      this.jackpotStillPhase = -1
      // Clear when not in jackpot
      const ctx = this.jackpotBaseTex.getContext()
      ctx.clearRect(0, 0, 256, 256)
      this.jackpotBaseTex.update()
    }
  }

  updateParallax(time: number): void {
    if (this.backgroundMesh) {
      // Period 4.5 s, amplitude 0.02, phase π/4
      this.backgroundMesh.position.z = DISPLAY_LAYER_Z.SHADER + Math.sin(time * (2 * Math.PI / 4.5) + Math.PI / 4) * 0.02
    }
  }

  onStateChange(_state: DisplayState): void {
    void _state
    // Reserved for future state-specific shader changes
  }

  /**
   * Show or hide the shader background mesh.
   */
  setBackgroundVisible(visible: boolean): void {
    if (this.backgroundMesh) {
      this.backgroundMesh.isVisible = visible
    }
  }

  /**
   * Draw phase-specific text/content into the jackpot base texture (sampled by the jackpot pass).
   * This provides the WARNING / COUNTDOWN / JACKPOT text. `still` (reduced motion) draws one
   * static frame: no running countdown, no spinning burst.
   */
  private drawJackpotBaseContent(phase: number, still = false): void {
    if (!this.jackpotBaseTex) return
    const raw = this.jackpotBaseTex.getContext()
    const ctx = raw as CanvasRenderingContext2D
    const tw = 256, th = 256
    ctx.clearRect(0, 0, tw, th)

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (phase === 1) {
      ctx.fillStyle = '#ff3344'
      ctx.font = 'bold 18px monospace'
      ctx.shadowColor = '#ff0000'
      ctx.shadowBlur = 8
      ctx.fillText('WARNING', tw / 2, th * 0.32)
      ctx.font = 'bold 13px monospace'
      ctx.fillText('CORE UNSTABLE', tw / 2, th * 0.44)
    } else if (phase === 2 && still) {
      ctx.fillStyle = '#ffffee'
      ctx.font = 'bold 28px monospace'
      ctx.fillText('JACKPOT', tw / 2, th * 0.5)
    } else if (phase === 2) {
      // Countdown digits 3 -> 2 -> 1
      const idx = Math.floor((this.time * 1.05) % 3)
      const digits = ['3', '2', '1']
      ctx.fillStyle = '#ffffee'
      ctx.font = 'bold 92px monospace'
      ctx.shadowColor = '#ff0'
      ctx.shadowBlur = 16
      ctx.fillText(digits[idx], tw / 2, th * 0.5)
    } else if (phase === 3) {
      ctx.fillStyle = '#ffeb3b'
      ctx.font = 'bold 28px monospace'
      ctx.shadowColor = '#ffd700'
      ctx.shadowBlur = 14
      ctx.fillText('JACKPOT', tw / 2, th * 0.42)
      // small radial burst lines (they spin, so the still frame leaves them out)
      if (still) {
        ctx.restore()
        this.jackpotBaseTex.update()
        return
      }
      ctx.strokeStyle = 'rgba(255,215,0,0.6)'
      ctx.lineWidth = 2
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.time * 3
        ctx.beginPath()
        ctx.moveTo(tw / 2, th * 0.58)
        ctx.lineTo(tw / 2 + Math.cos(a) * 70, th * 0.58 + Math.sin(a) * 70)
        ctx.stroke()
      }
    }

    ctx.restore()
    this.jackpotBaseTex.update()
  }

  /**
   * Ask for the CRT pass (game-system control). It runs while this and the player toggle are on.
   */
  setCRTEffectEnabled(enabled: boolean): void {
    this.crtEffectActive = enabled
  }

  /**
   * Player-facing toggle — gates whether the CRT pass runs at all.
   * Works independently of the active preset (even OFF-preset → pass is skipped).
   */
  setPlayerScanlineEnabled(enabled: boolean): void {
    this.playerScanlineEnabled = enabled
  }

  /**
   * Update CRT parameters. The pass reads them when it binds on the next frame.
   */
  setCRTEffectParams(params: Partial<CRTEffectParams>): void {
    this.crtEffectParams = { ...this.crtEffectParams, ...params }
  }

  setScanlineWeight(weight: number): void {
    // Legacy shim — delegates to setScanlineIntensityMultiplier
    this.setScanlineIntensityMultiplier(weight)
  }

  /**
   * Set the global user intensity multiplier (range 0.0–1.5, default 1.0).
   */
  setScanlineIntensityMultiplier(multiplier: number): void {
    this.scanlineIntensityMultiplier = Math.min(1.5, Math.max(0, multiplier))
  }

  setAccessibilityScanlineFactor(factor: number): void {
    this.accessibilityScanlineFactor = Math.min(1, Math.max(0, factor))
  }

  /**
   * Update shader background speed and/or colour tint.
   */
  setShaderParams(params?: { speed?: number; color?: string }): void {
    if (this.material) {
      if (params?.speed !== undefined) {
        this.material.setFloat('speed', params.speed)
      }
      if (params?.color !== undefined) {
        this.material.setColor3('colorTint', Color3.FromHexString(params.color))
      }
    }
  }

  getMaterial(): ShaderMaterial | null {
    return this.material
  }

  dispose(): void {
    this.material?.dispose()
    this.backgroundMesh?.dispose()
    this.jackpotBaseTex?.dispose()
    this.material = null
    this.backgroundMesh = null
    this.jackpotBaseTex = null
  }
}
