/**
 * Display Shader Layer
 * 
 * Handles shader background and effects.
 * Extracted from display.ts for modularity.
 */

import { ShaderMaterial, Color3, MeshBuilder, type Mesh, type Scene } from '@babylonjs/core'
import { DisplayState, type DisplayConfig, CRT_PRESETS, type CRTEffectParams } from './display-types'
import { crtEffectShader } from '../shaders/crt-effect'

export class DisplayShaderLayer {
  private scene: Scene
  private material: ShaderMaterial | null = null
  private crtMaterial: ShaderMaterial | null = null
  private backgroundMesh: Mesh | null = null
  private crtMesh: Mesh | null = null
  private time = 0
  private crtEffectActive = false
  private crtEffectParams: CRTEffectParams = CRT_PRESETS.STORY

  constructor(scene: Scene, config: DisplayConfig) {
    this.scene = scene
    this.createBackgroundShader(config)
    this.createCRTEffectLayer(config)
  }

  private createBackgroundShader(config: DisplayConfig): void {
    // Create background plane
    this.backgroundMesh = MeshBuilder.CreatePlane(
      'shaderBg',
      { width: config.width, height: config.height },
      this.scene
    )
    this.backgroundMesh.position.z = -0.5
    this.backgroundMesh.rotation.y = Math.PI

    // Create cyber grid shader
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

    this.material = cyberShader
    this.backgroundMesh.material = cyberShader
  }

  private createCRTEffectLayer(config: DisplayConfig): void {
    // Create CRT effect plane (hidden by default)
    this.crtMesh = MeshBuilder.CreatePlane(
      'crtEffect',
      { width: config.width, height: config.height },
      this.scene
    )
    this.crtMesh.position.z = -0.25
    this.crtMesh.rotation.y = Math.PI
    this.crtMesh.isVisible = false

    // Create CRT shader material
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

    this.crtMesh.material = crtMat
    this.crtMaterial = crtMat
  }

  update(dt: number, state: DisplayState, jackpotPhase: number): void {
    this.time += dt

    // Update background shader
    if (this.material) {
      this.material.setFloat('time', this.time)

      // State-specific colors
      let speed = 0.5
      let color = '#00ffd9'

      switch (state) {
        case DisplayState.REACH:
          speed = 5.0
          color = '#ff0055'
          break
        case DisplayState.FEVER:
          speed = 10.0
          color = '#ffd700'
          break
        case DisplayState.JACKPOT:
          speed = 20.0
          color = '#ff00ff'
          break
        case DisplayState.ADVENTURE:
          speed = 1.0
          color = '#00aa00'
          break
      }

      this.material.setFloat('speed', speed)
      this.material.setColor3('colorTint', Color3.FromHexString(color))
    }

    // Update CRT effect shader
    if (this.crtEffectActive && this.crtMaterial) {
      this.crtMaterial.setFloat('uTime', this.time)
    }

    // Jackpot effects
    if (state === DisplayState.JACKPOT && this.material) {
      let glitch = 0
      let crack = 0
      let shock = 0

      if (jackpotPhase === 1) {
        glitch = 0.1
        crack = Math.min(1, this.time * 0.5)
      } else if (jackpotPhase === 2) {
        glitch = 0.5
        crack = 1
      } else if (jackpotPhase === 3) {
        shock = (this.time - 5) * 0.5
      }

      // These would be set if using a jackpot-specific shader
      void glitch
      void crack
      void shock
    }
  }

  onStateChange(_state: DisplayState): void {
    // Handle state-specific shader changes
    if (_state === DisplayState.JACKPOT) {
      // Intensify effects for jackpot
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

  getMaterial(): ShaderMaterial | null {
    return this.material
  }

  getCRTMaterial(): ShaderMaterial | null {
    return this.crtMaterial
  }

  dispose(): void {
    this.material?.dispose()
    this.crtMaterial?.dispose()
    this.backgroundMesh?.dispose()
    this.crtMesh?.dispose()
    this.material = null
    this.crtMaterial = null
    this.backgroundMesh = null
    this.crtMesh = null
  }
}
