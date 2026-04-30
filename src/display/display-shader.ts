/**
 * Display Shader Layer
 *
 * Handles shader background and effects.
 * Extracted from display.ts for modularity.
 *
 * Architecture
 * ─────────────
 * • backgroundMesh  – a 3-D plane anchored in the backbox hierarchy; renders the
 *                     animated cyber-grid via ShaderMaterial (world-space object).
 * • crtPostProcess  – full-screen PostProcess that applies the CRT effect to the
 *                     rendered scene texture; replaces the old crtMesh plane.
 * • jackpotPostProcess – full-screen PostProcess that composites jackpot overlay
 *                        effects on top of the scene; replaces the old jackpotMesh.
 *
 * Benefits vs. three overlapping planes
 * ─────────────────────────────────────
 * • One draw-call per effect instead of three full-screen rasterisations.
 * • No world/view/projection matrix upload for CRT/jackpot (handled by Babylon).
 * • Zero overdraw from extra blend passes on the background.
 * • Toggle via camera.attachPostProcess / detachPostProcess – no geometry churn.
 */

import {
  Effect,
  PostProcess,
  ShaderMaterial,
  Color3,
  MeshBuilder,
  Texture,
  DynamicTexture,
  type Camera,
  type Mesh,
  type Scene,
  type TransformNode,
} from '@babylonjs/core'
import { DisplayState, type DisplayConfig, CRT_PRESETS, type CRTEffectParams } from './display-types'
import { crtEffectShader } from '../shaders/crt-effect'
import { jackpotOverlayPostProcessFragment } from '../shaders/jackpotOverlay'

// ─── Register PostProcess fragment shaders once at module load ────────────────
// Babylon resolves the shader by looking up "<name>FragmentShader" in the store.
Effect.ShadersStore['crtEffectFragmentShader'] = crtEffectShader.fragment
Effect.ShadersStore['jackpotOverlayFragmentShader'] = jackpotOverlayPostProcessFragment

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

  // CRT and jackpot are now full-screen PostProcesses
  private crtPostProcess: PostProcess | null = null
  private jackpotPostProcess: PostProcess | null = null
  private jackpotBaseTex: DynamicTexture | null = null

  // Track whether each PostProcess is currently attached to the camera
  private crtAttached = false
  private jackpotAttached = false

  private time = 0
  private crtEffectActive = false
  private crtEffectParams: CRTEffectParams = CRT_PRESETS.STORY

  // Cached jackpot phase state – updated in update(), read in onApply
  private jackpotState: JackpotPhaseState = { phase: 0, crack: 0, shock: 0, glitch: 0 }

  constructor(scene: Scene, config: DisplayConfig) {
    this.scene = scene
    this.config = config
    this.createBackgroundMaterial()
    // PostProcesses are created in createLayer() once an active camera exists
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────
  private getCamera(): Camera | null {
    return this.scene.activeCamera
  }

  private attachPP(pp: PostProcess): void {
    const cam = this.getCamera()
    if (cam) cam.attachPostProcess(pp)
  }

  private detachPP(pp: PostProcess): void {
    const cam = this.getCamera()
    if (cam) cam.detachPostProcess(pp)
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
  // CRT PostProcess
  // ──────────────────────────────────────────────────────────────────────────
  private createCRTPostProcess(): void {
    const camera = this.getCamera()
    if (!camera) return

    this.crtPostProcess?.dispose()

    // Create with null camera so we control when it is attached
    this.crtPostProcess = new PostProcess(
      'crtPP',
      'crtEffect',
      ['uTime', 'uScanlineIntensity', 'uCurvature', 'uVignette', 'uChromaticAberration', 'uGlow', 'uNoise', 'uFlicker'],
      null, // textureSampler is auto-provided by Babylon
      1.0,
      null, // manually attached below
      Texture.BILINEAR_SAMPLINGMODE,
      this.scene.getEngine()
    )

    this.crtPostProcess.onApply = (effect) => {
      const p = this.crtEffectParams
      effect.setFloat('uTime', this.time)
      effect.setFloat('uScanlineIntensity', p.scanlineIntensity)
      effect.setFloat('uCurvature', p.curvature)
      effect.setFloat('uVignette', p.vignette)
      effect.setFloat('uChromaticAberration', p.chromaticAberration)
      effect.setFloat('uGlow', p.glow)
      effect.setFloat('uNoise', p.noise)
      effect.setFloat('uFlicker', p.flicker)
    }

    // Attach only if CRT was already requested active
    if (this.crtEffectActive) {
      camera.attachPostProcess(this.crtPostProcess)
      this.crtAttached = true
    } else {
      this.crtAttached = false
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Jackpot PostProcess
  // ──────────────────────────────────────────────────────────────────────────
  private createJackpotPostProcess(): void {
    if (!this.getCamera()) return

    // 256×256 is plenty for the procedural crack/shockwave patterns
    this.jackpotBaseTex?.dispose()
    this.jackpotBaseTex = new DynamicTexture('jackpotBase', 256, this.scene, true)
    const ctx = this.jackpotBaseTex.getContext()
    ctx.fillStyle = '#050505'
    ctx.fillRect(0, 0, 256, 256)
    this.jackpotBaseTex.update()

    this.jackpotPostProcess?.dispose()

    // Create with null camera – attached only when the jackpot state is active
    this.jackpotPostProcess = new PostProcess(
      'jackpotPP',
      'jackpotOverlay',
      ['uTime', 'uPhase', 'uCrackProgress', 'uShockwaveRadius', 'uGlitchIntensity'],
      ['myTexture'],
      1.0,
      null, // manually attached when jackpot becomes active
      Texture.BILINEAR_SAMPLINGMODE,
      this.scene.getEngine()
    )
    this.jackpotAttached = false

    this.jackpotPostProcess.onApply = (effect) => {
      if (!this.jackpotBaseTex) return
      effect.setTexture('myTexture', this.jackpotBaseTex)
      effect.setFloat('uTime', this.time)
      effect.setInt('uPhase', this.jackpotState.phase)
      effect.setFloat('uCrackProgress', this.jackpotState.crack)
      effect.setFloat('uShockwaveRadius', this.jackpotState.shock)
      effect.setFloat('uGlitchIntensity', this.jackpotState.glitch)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create the background mesh and post-process effects, parented to the given
   * root node.  Must be called after the scene has an active camera.
   */
  createLayer(parent: TransformNode): void {
    // Rebuild only the background mesh (PostProcesses live on the camera)
    this.backgroundMesh?.dispose()

    this.backgroundMesh = MeshBuilder.CreatePlane(
      'shaderBg',
      { width: this.config.width, height: this.config.height },
      this.scene
    )
    this.backgroundMesh.parent = parent
    this.backgroundMesh.position.z = -0.5
    this.backgroundMesh.rotation.y = Math.PI
    this.backgroundMesh.material = this.material
    // Static mesh optimisations
    this.backgroundMesh.isPickable = false
    this.backgroundMesh.freezeWorldMatrix()

    // Build (or rebuild) the PostProcesses now that a camera is available
    this.createCRTPostProcess()
    this.createJackpotPostProcess()
  }

  update(dt: number, state: DisplayState, jackpotPhase: number): void {
    this.time += dt

    // Only `time` changes each frame for the background
    if (this.material) {
      this.material.setFloat('time', this.time)
    }

    // Jackpot PostProcess – attach/detach only on state transitions
    const isJackpot = state === DisplayState.JACKPOT
    if (isJackpot !== this.jackpotAttached && this.jackpotPostProcess) {
      if (isJackpot) {
        this.attachPP(this.jackpotPostProcess)
      } else {
        this.detachPP(this.jackpotPostProcess)
      }
      this.jackpotAttached = isJackpot
    }

    if (isJackpot) {
      let phase = 0
      let crack = 0.0
      let shock = 0.0

      if (jackpotPhase === 1) {
        phase = 1
        crack = Math.min(1.0, this.time * 0.5)
      } else if (jackpotPhase === 2) {
        phase = 2
        crack = 1.0
      } else if (jackpotPhase === 3) {
        phase = 3
        shock = Math.max(0.0, (this.time - 5.0) * 0.5)
      }

      this.jackpotState = {
        phase,
        crack,
        shock,
        glitch: phase === 2 ? 0.5 : phase === 1 ? 0.1 : 0.0,
      }
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
   * Enable or disable the CRT PostProcess.
   */
  setCRTEffectEnabled(enabled: boolean): void {
    if (this.crtEffectActive === enabled) return
    this.crtEffectActive = enabled

    if (!this.crtPostProcess) return

    if (enabled && !this.crtAttached) {
      this.attachPP(this.crtPostProcess)
      this.crtAttached = true
    } else if (!enabled && this.crtAttached) {
      this.detachPP(this.crtPostProcess)
      this.crtAttached = false
    }
  }

  /**
   * Update CRT parameters.  The new values are picked up automatically by
   * the PostProcess onApply callback on the next frame.
   */
  setCRTEffectParams(params: Partial<CRTEffectParams>): void {
    this.crtEffectParams = { ...this.crtEffectParams, ...params }
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
    // Detach before disposing to avoid camera pipeline errors
    if (this.crtPostProcess && this.crtAttached) {
      this.detachPP(this.crtPostProcess)
      this.crtAttached = false
    }
    if (this.jackpotPostProcess && this.jackpotAttached) {
      this.detachPP(this.jackpotPostProcess)
      this.jackpotAttached = false
    }

    this.material?.dispose()
    this.backgroundMesh?.dispose()
    this.crtPostProcess?.dispose()
    this.jackpotPostProcess?.dispose()
    this.jackpotBaseTex?.dispose()
    this.material = null
    this.backgroundMesh = null
    this.crtPostProcess = null
    this.jackpotPostProcess = null
    this.jackpotBaseTex = null
  }
}


