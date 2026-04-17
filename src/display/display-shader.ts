/**
 * Display Shader Layer
 * 
 * Handles shader background and effects.
 * Extracted from display.ts for modularity.
 */

import { ShaderMaterial, Color3, MeshBuilder, type Mesh, type Scene, type TransformNode, DynamicTexture } from '@babylonjs/core'
import { DisplayState, type DisplayConfig, CRT_PRESETS, type CRTEffectParams } from './display-types'
import { crtEffectShader } from '../shaders/crt-effect'
import { jackpotOverlayShader } from '../shaders/jackpotOverlay'

export class DisplayShaderLayer {
  private scene: Scene
  private config: DisplayConfig
  private material: ShaderMaterial | null = null
  private crtMaterial: ShaderMaterial | null = null
  private jackpotMaterial: ShaderMaterial | null = null
  private backgroundMesh: Mesh | null = null
  private crtMesh: Mesh | null = null
  private jackpotMesh: Mesh | null = null
  private time = 0
  private crtEffectActive = false
  private crtEffectParams: CRTEffectParams = CRT_PRESETS.STORY

  constructor(scene: Scene, config: DisplayConfig) {
    this.scene = scene
    this.config = config
    this.createBackgroundMaterial()
    this.createCRTMaterial()
    this.createJackpotMaterial()
  }

  private createBackgroundMaterial(): void {
    // Create cyber grid shader material
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

    cyberShader.setFloat('speed', 0.5)
    cyberShader.setColor3('colorTint', Color3.FromHexString('#00ffd9'))
    this.material = cyberShader
  }

  private createCRTMaterial(): void {
    // Create CRT shader material (mesh created in createLayer)
    const crtMat = new ShaderMaterial(
      'crtMat',
      this.scene,
      {
        vertexSource: crtEffectShader.vertex,
        fragmentSource: crtEffectShader.fragment,
      },
      {
        attributes: ['position', 'uv'],
        uniforms: [
          'worldViewProjection',
          'uTime',
          'uScanlineIntensity',
          'uCurvature',
          'uVignette',
          'uChromaticAberration',
          'uGlow',
          'uNoise',
          'uFlicker',
        ],
        samplers: ['textureSampler'],
        needAlphaBlending: false,
      }
    )

    // Set default params
    crtMat.setFloat('uTime', 0)
    crtMat.setFloat('uScanlineIntensity', this.crtEffectParams.scanlineIntensity)
    crtMat.setFloat('uCurvature', this.crtEffectParams.curvature)
    crtMat.setFloat('uVignette', this.crtEffectParams.vignette)
    crtMat.setFloat('uChromaticAberration', this.crtEffectParams.chromaticAberration)
    crtMat.setFloat('uGlow', this.crtEffectParams.glow)
    crtMat.setFloat('uNoise', this.crtEffectParams.noise)
    crtMat.setFloat('uFlicker', this.crtEffectParams.flicker)

    this.crtMaterial = crtMat
  }

  private createJackpotMaterial(): void {
    // Create a base dynamic texture for the jackpot overlay shader
    const baseTex = new DynamicTexture('jackpotBase', 512, this.scene, true)
    const ctx = baseTex.getContext()
    ctx.fillStyle = '#050505'
    ctx.fillRect(0, 0, 512, 512)
    baseTex.update()

    const jackpotMat = new ShaderMaterial(
      'jackpotMat',
      this.scene,
      {
        vertexSource: jackpotOverlayShader.vertex,
        fragmentSource: jackpotOverlayShader.fragment,
      },
      {
        attributes: ['position', 'uv'],
        uniforms: [
          'worldViewProjection',
          'uTime',
          'uPhase',
          'uCrackProgress',
          'uShockwaveRadius',
          'uGlitchIntensity',
        ],
        samplers: ['myTexture'],
        needAlphaBlending: true,
      }
    )

    jackpotMat.setTexture('myTexture', baseTex)
    jackpotMat.setFloat('uTime', 0)
    jackpotMat.setInt('uPhase', 0)
    jackpotMat.setFloat('uCrackProgress', 0)
    jackpotMat.setFloat('uShockwaveRadius', 0)
    jackpotMat.setFloat('uGlitchIntensity', 0)

    this.jackpotMaterial = jackpotMat
  }

  /**
   * Create shader meshes parented to the given root node.
   * This fixes orphaned meshes by attaching them to the backbox hierarchy.
   */
  createLayer(parent: TransformNode): void {
    this.backgroundMesh?.dispose()
    this.crtMesh?.dispose()
    this.jackpotMesh?.dispose()

    this.backgroundMesh = MeshBuilder.CreatePlane(
      'shaderBg',
      { width: this.config.width, height: this.config.height },
      this.scene
    )
    this.backgroundMesh.parent = parent
    this.backgroundMesh.position.z = -0.5
    this.backgroundMesh.rotation.y = Math.PI
    this.backgroundMesh.material = this.material

    this.crtMesh = MeshBuilder.CreatePlane(
      'crtEffect',
      { width: this.config.width, height: this.config.height },
      this.scene
    )
    this.crtMesh.parent = parent
    this.crtMesh.position.z = -0.25
    this.crtMesh.rotation.y = Math.PI
    this.crtMesh.isVisible = this.crtEffectActive
    this.crtMesh.material = this.crtMaterial

    this.jackpotMesh = MeshBuilder.CreatePlane(
      'jackpotOverlay',
      { width: this.config.width, height: this.config.height },
      this.scene
    )
    this.jackpotMesh.parent = parent
    this.jackpotMesh.position.z = -0.15
    this.jackpotMesh.rotation.y = Math.PI
    this.jackpotMesh.isVisible = false
    this.jackpotMesh.material = this.jackpotMaterial
  }

  update(dt: number, state: DisplayState, jackpotPhase: number): void {
    this.time += dt

    // Update background shader time
    if (this.material) {
      this.material.setFloat('time', this.time)
    }

    // Update CRT effect shader
    if (this.crtEffectActive && this.crtMaterial) {
      this.crtMaterial.setFloat('uTime', this.time)
    }

    // Jackpot effects
    if (this.jackpotMaterial && this.jackpotMesh) {
      const isJackpot = state === DisplayState.JACKPOT
      this.jackpotMesh.isVisible = isJackpot

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

        this.jackpotMaterial.setFloat('uTime', this.time)
        this.jackpotMaterial.setInt('uPhase', phase)
        this.jackpotMaterial.setFloat('uCrackProgress', crack)
        this.jackpotMaterial.setFloat('uShockwaveRadius', shock)
        this.jackpotMaterial.setFloat('uGlitchIntensity', phase === 2 ? 0.5 : (phase === 1 ? 0.1 : 0.0))
      }
    }
  }

  onStateChange(_state: DisplayState): void {
    // Handle state-specific shader changes
    if (_state === DisplayState.JACKPOT) {
      // Intensify effects for jackpot
    }
  }

  /**
   * Show or hide the shader background mesh
   */
  setBackgroundVisible(visible: boolean): void {
    if (this.backgroundMesh) {
      this.backgroundMesh.isVisible = visible
    }
  }

  /**
   * Enable/disable CRT effect overlay
   */
  setCRTEffectEnabled(enabled: boolean): void {
    this.crtEffectActive = enabled
    if (this.crtMesh) {
      this.crtMesh.isVisible = enabled
    }
  }

  /**
   * Set CRT effect parameters
   */
  setCRTEffectParams(params: Partial<CRTEffectParams>): void {
    this.crtEffectParams = { ...this.crtEffectParams, ...params }

    if (this.crtMaterial) {
      this.crtMaterial.setFloat('uScanlineIntensity', this.crtEffectParams.scanlineIntensity)
      this.crtMaterial.setFloat('uCurvature', this.crtEffectParams.curvature)
      this.crtMaterial.setFloat('uVignette', this.crtEffectParams.vignette)
      this.crtMaterial.setFloat('uChromaticAberration', this.crtEffectParams.chromaticAberration)
      this.crtMaterial.setFloat('uGlow', this.crtEffectParams.glow)
      this.crtMaterial.setFloat('uNoise', this.crtEffectParams.noise)
      this.crtMaterial.setFloat('uFlicker', this.crtEffectParams.flicker)
    }
  }

  /**
   * Update shader background parameters (speed and color)
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

  getCRTMaterial(): ShaderMaterial | null {
    return this.crtMaterial
  }

  dispose(): void {
    this.material?.dispose()
    this.crtMaterial?.dispose()
    this.jackpotMaterial?.dispose()
    this.backgroundMesh?.dispose()
    this.crtMesh?.dispose()
    this.jackpotMesh?.dispose()
    this.material = null
    this.crtMaterial = null
    this.jackpotMaterial = null
    this.backgroundMesh = null
    this.crtMesh = null
    this.jackpotMesh = null
  }
}
