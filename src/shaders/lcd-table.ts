/**
 * LCD Table Shader - Glowing phosphor display with pixel grid and scanlines
 * 
 * Creates a realistic LCD/CRT hybrid look:
 * - Subpixel RGB layout simulation
 * - Pixel grid overlay
 * - Scanlines with phosphor persistence
 * - Slight curvature (flatter than CRT)
 * - Phosphor bloom glow
 */

export const lcdTablePixelShader = {
  name: "lcdTable",
  fragment: `
    precision highp float;
    varying vec2 vUV;
    varying vec3 vPosition;
    uniform sampler2D textureSampler;
    uniform vec3 uBaseColor;
    uniform vec3 uAccentColor;
    uniform float uTime;
    uniform float uScanlineIntensity;
    uniform float uPixelGridIntensity;
    uniform float uSubpixelIntensity;
    uniform float uGlowIntensity;
    uniform float uMapBlend;
    
    // RGB subpixel pattern
    vec3 subpixelPattern(vec2 uv, vec3 color) {
      float subpixelSize = 3.0;
      float x = fract(uv.x * subpixelSize);
      
      vec3 result = vec3(0.0);
      result.r = color.r * (1.0 - smoothstep(0.0, 0.33, x) + smoothstep(0.66, 1.0, x));
      result.g = color.g * smoothstep(0.33, 0.66, x);
      result.b = color.b * (smoothstep(0.0, 0.33, x) - smoothstep(0.66, 1.0, x));
      
      return result * uSubpixelIntensity + color * (1.0 - uSubpixelIntensity);
    }
    
    // Pixel grid effect
    float pixelGrid(vec2 uv) {
      vec2 pixelUV = fract(uv * vec2(64.0, 64.0));
      vec2 grid = abs(pixelUV - 0.5) * 2.0;
      float gridLine = max(grid.x, grid.y);
      return 1.0 - smoothstep(0.9, 1.0, gridLine) * uPixelGridIntensity * 0.3;
    }
    
    // Scanline effect
    float scanlines(vec2 uv) {
      float scanlineCount = 200.0;
      float scan = sin(uv.y * scanlineCount * 3.14159);
      return 1.0 - (uScanlineIntensity * 0.5 * (scan + 1.0) * 0.5);
    }
    
    // Slight curvature (flat LCD with subtle curve)
    vec2 applyCurvature(vec2 uv) {
      vec2 centered = uv - 0.5;
      float dist = length(centered);
      float curve = dist * dist * 0.02; // Very subtle curve
      return uv + centered * curve;
    }
    
    // Phosphor glow
    vec3 phosphorGlow(vec3 color, float intensity) {
      vec3 phosphor = color * color * 2.0; // Square for glow boost
      return color + phosphor * intensity;
    }
    
    // Map pattern generation (procedural backgrounds)
    vec3 generateMapPattern(vec2 uv, float blend) {
      vec3 pattern = vec3(0.0);
      
      // Hexagonal grid pattern
      vec2 hexUV = uv * 8.0;
      float hex = abs(fract(hexUV.x * 0.5) - 0.5) + abs(fract(hexUV.y * 0.866) - 0.5) * 0.5;
      hex = 1.0 - smoothstep(0.3, 0.4, hex);
      
      // Circuit traces
      float traceX = smoothstep(0.48, 0.52, abs(fract(uv.x * 16.0) - 0.5));
      float traceY = smoothstep(0.48, 0.52, abs(fract(uv.y * 16.0) - 0.5));
      float traces = max(traceX, traceY) * 0.5;
      
      // Data flow lines (animated)
      float flow = smoothstep(0.45, 0.55, fract(uv.y * 32.0 + uTime * 0.5));
      flow *= smoothstep(0.0, 0.2, fract(uv.x * 4.0));
      
      pattern = uBaseColor * (0.2 + hex * 0.3 + traces * 0.4 + flow * 0.5 * blend);
      
      return pattern;
    }
    
    void main(void) {
      vec2 curvedUV = applyCurvature(vUV);
      
      // Sample base texture or generate procedural pattern
      vec3 baseColor = texture2D(textureSampler, curvedUV).rgb;
      
      // Blend in procedural map pattern
      vec3 mapPattern = generateMapPattern(curvedUV, uMapBlend);
      baseColor = mix(baseColor, mapPattern, uMapBlend);
      
      // Apply subpixel RGB pattern
      vec3 subpixel = subpixelPattern(curvedUV, baseColor);
      
      // Apply pixel grid
      float grid = pixelGrid(curvedUV);
      
      // Apply scanlines
      float scan = scanlines(curvedUV);
      
      // Combine effects
      vec3 color = subpixel * grid * scan;
      
      // Add phosphor glow
      color = phosphorGlow(color, uGlowIntensity);
      
      // Vignette (darker corners like real LCD)
      float dist = distance(curvedUV, vec2(0.5));
      float vignette = 1.0 - smoothstep(0.4, 0.8, dist) * 0.3;
      color *= vignette;
      
      // Accent color overlay for map theming
      color = mix(color, uAccentColor * color, 0.2);
      
      gl_FragColor = vec4(color, 1.0);
    }
  `
}

/**
 * LCD Table Map Definitions
 * Each map defines the visual theme for the LCD playfield
 */
export type TableMapType = 
  | 'neon-helix'
  | 'cyber-core' 
  | 'quantum-grid'
  | 'singularity-well'
  | 'glitch-spire'
  | 'matrix-core'
  | 'cyan-void'
  | 'magenta-dream'

export interface TableMapConfig {
  name: string
  baseColor: string      // Primary phosphor color (hex)
  accentColor: string    // Secondary glow color (hex)
  scanlineIntensity: number
  pixelGridIntensity: number
  subpixelIntensity: number
  glowIntensity: number
  backgroundPattern: 'hex' | 'grid' | 'circuit' | 'data-flow' | 'none'
  animationSpeed: number
}

export const TABLE_MAPS: Record<TableMapType, TableMapConfig> = {
  'neon-helix': {
    name: 'Neon Helix',
    baseColor: '#00d9ff',
    accentColor: '#ff00aa',
    scanlineIntensity: 0.25,
    pixelGridIntensity: 0.8,
    subpixelIntensity: 0.6,
    glowIntensity: 1.2,
    backgroundPattern: 'hex',
    animationSpeed: 0.5,
  },
  'cyber-core': {
    name: 'Cyber Core',
    baseColor: '#8800ff',
    accentColor: '#00d9ff',
    scanlineIntensity: 0.3,
    pixelGridIntensity: 0.7,
    subpixelIntensity: 0.5,
    glowIntensity: 1.0,
    backgroundPattern: 'circuit',
    animationSpeed: 0.3,
  },
  'quantum-grid': {
    name: 'Quantum Grid',
    baseColor: '#00ff44',
    accentColor: '#ffffff',
    scanlineIntensity: 0.2,
    pixelGridIntensity: 0.9,
    subpixelIntensity: 0.7,
    glowIntensity: 1.4,
    backgroundPattern: 'grid',
    animationSpeed: 1.0,
  },
  'singularity-well': {
    name: 'Singularity Well',
    baseColor: '#ff4400',
    accentColor: '#ff0000',
    scanlineIntensity: 0.35,
    pixelGridIntensity: 0.6,
    subpixelIntensity: 0.4,
    glowIntensity: 1.5,
    backgroundPattern: 'data-flow',
    animationSpeed: 0.8,
  },
  'glitch-spire': {
    name: 'Glitch Spire',
    baseColor: '#ff00aa',
    accentColor: '#ffffff',
    scanlineIntensity: 0.4,
    pixelGridIntensity: 0.5,
    subpixelIntensity: 0.8,
    glowIntensity: 1.3,
    backgroundPattern: 'circuit',
    animationSpeed: 2.0,
  },
  'matrix-core': {
    name: 'Matrix Core',
    baseColor: '#00ff00',
    accentColor: '#003300',
    scanlineIntensity: 0.15,
    pixelGridIntensity: 0.85,
    subpixelIntensity: 0.3,
    glowIntensity: 1.1,
    backgroundPattern: 'data-flow',
    animationSpeed: 0.6,
  },
  'cyan-void': {
    name: 'Cyan Void',
    baseColor: '#00ffff',
    accentColor: '#0088ff',
    scanlineIntensity: 0.25,
    pixelGridIntensity: 0.75,
    subpixelIntensity: 0.55,
    glowIntensity: 1.0,
    backgroundPattern: 'none',
    animationSpeed: 0.2,
  },
  'magenta-dream': {
    name: 'Magenta Dream',
    baseColor: '#ff00ff',
    accentColor: '#aa00ff',
    scanlineIntensity: 0.3,
    pixelGridIntensity: 0.65,
    subpixelIntensity: 0.5,
    glowIntensity: 1.2,
    backgroundPattern: 'hex',
    animationSpeed: 0.4,
  },
}

/**
 * LCD Table State Manager
 * Handles map switching and shader parameter updates
 */
export class LCDTableState {
  private _currentMap: TableMapType = 'neon-helix'
  private _targetMap: TableMapType = 'neon-helix'
  private _blendFactor: number = 0.0
  private _isTransitioning: boolean = false
  private _transitionTime: number = 0.0
  private _transitionDuration: number = 0.5 // seconds
  
  // Shader uniform callbacks
  private _uniformCallbacks: Map<string, (value: number | string | Color3) => void> = new Map()
  
  get currentMap(): TableMapType {
    return this._currentMap
  }
  
  get isTransitioning(): boolean {
    return this._isTransitioning
  }
  
  /**
   * Switch to a new map with smooth transition
   */
  switchMap(newMap: TableMapType): void {
    if (newMap === this._currentMap || this._isTransitioning) return
    
    this._targetMap = newMap
    this._isTransitioning = true
    this._transitionTime = 0.0
    this._blendFactor = 0.0
    
    console.log(`[LCDTable] Switching map: ${this._currentMap} -> ${newMap}`)
  }
  
  /**
   * Update transition animation
   */
  update(deltaTime: number): void {
    if (!this._isTransitioning) return
    
    this._transitionTime += deltaTime
    this._blendFactor = Math.min(this._transitionTime / this._transitionDuration, 1.0)
    
    // Apply eased blend
    const easedBlend = this.easeInOutCubic(this._blendFactor)
    this.updateShaderUniforms(easedBlend)
    
    if (this._blendFactor >= 1.0) {
      this._currentMap = this._targetMap
      this._isTransitioning = false
      this._blendFactor = 0.0
      console.log(`[LCDTable] Map switch complete: ${this._currentMap}`)
    }
  }
  
  /**
   * Get current map configuration (interpolated during transition)
   */
  getCurrentConfig(): TableMapConfig {
    const current = TABLE_MAPS[this._currentMap]
    
    if (!this._isTransitioning) return current
    
    const target = TABLE_MAPS[this._targetMap]
    const t = this.easeInOutCubic(this._blendFactor)
    
    return {
      name: target.name,
      baseColor: this.lerpColor(current.baseColor, target.baseColor, t),
      accentColor: this.lerpColor(current.accentColor, target.accentColor, t),
      scanlineIntensity: this.lerp(current.scanlineIntensity, target.scanlineIntensity, t),
      pixelGridIntensity: this.lerp(current.pixelGridIntensity, target.pixelGridIntensity, t),
      subpixelIntensity: this.lerp(current.subpixelIntensity, target.subpixelIntensity, t),
      glowIntensity: this.lerp(current.glowIntensity, target.glowIntensity, t),
      backgroundPattern: t > 0.5 ? target.backgroundPattern : current.backgroundPattern,
      animationSpeed: this.lerp(current.animationSpeed, target.animationSpeed, t),
    }
  }
  
  /**
   * Register a callback for shader uniform updates
   */
  onUniformUpdate(uniformName: string, callback: (value: number | string | Color3) => void): void {
    this._uniformCallbacks.set(uniformName, callback)
  }
  
  private updateShaderUniforms(blend: number): void {
    const config = this.getCurrentConfig()
    
    // Update all registered uniforms
    this._uniformCallbacks.forEach((callback, name) => {
      switch (name) {
        case 'uBaseColor':
        case 'uAccentColor':
          callback(config[name as keyof TableMapConfig] as string)
          break
        case 'uScanlineIntensity':
          callback(config.scanlineIntensity)
          break
        case 'uPixelGridIntensity':
          callback(config.pixelGridIntensity)
          break
        case 'uSubpixelIntensity':
          callback(config.subpixelIntensity)
          break
        case 'uGlowIntensity':
          callback(config.glowIntensity)
          break
        case 'uMapBlend':
          callback(blend)
          break
      }
    })
  }
  
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }
  
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
  
  private lerpColor(a: string, b: string, t: number): string {
    const ca = this.hexToRgb(a)
    const cb = this.hexToRgb(b)
    const r = Math.round(ca.r + (cb.r - ca.r) * t)
    const g = Math.round(ca.g + (cb.g - ca.g) * t)
    const b_ = Math.round(ca.b + (cb.b - ca.b) * t)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b_.toString(16).padStart(2, '0')}`
  }
  
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '')
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    }
  }
}

// Babylon.js Color3 type for type safety
interface Color3 {
  r: number
  g: number
  b: number
}
