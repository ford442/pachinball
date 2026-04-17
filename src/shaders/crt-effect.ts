/**
 * CRT Effect Shader - Retro CRT monitor effect for backbox video
 *
 * Features:
 * - Scanline overlay
 * - Screen curvature
 * - RGB subpixel chromatic aberration
 * - Vignette darkening
 * - Subtle noise/static
 * - Phosphor glow
 */

export const crtEffectShader = {
  name: "crtEffect",
  vertex: `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUV;
    uniform mat4 worldViewProjection;
    
    void main(void) {
      gl_Position = worldViewProjection * vec4(position, 1.0);
      vUV = uv;
    }
  `,
  fragment: `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D textureSampler;
    uniform float uTime;
    uniform float uScanlineIntensity;
    uniform float uCurvature;
    uniform float uVignette;
    uniform float uChromaticAberration;
    uniform float uGlow;
    uniform float uNoise;
    uniform float uFlicker;
    
    // Random function for noise
    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }
    
    // Apply screen curvature
    vec2 applyCurvature(vec2 uv, float curve) {
      vec2 centered = uv - 0.5;
      float dist = length(centered);
      float curveAmount = dist * dist * curve;
      return uv + centered * curveAmount;
    }
    
    // Scanline effect
    float scanlines(vec2 uv, float intensity) {
      float scanlineCount = 240.0;
      float y = fract(uv.y * scanlineCount);
      float scan = sin(y * 3.14159);
      scan = pow(scan, 0.5) * 0.15;
      return 1.0 - (intensity * scan);
    }
    
    // Vignette effect
    float vignette(vec2 uv, float intensity) {
      vec2 centered = uv - 0.5;
      float dist = length(centered);
      return 1.0 - smoothstep(0.3, 0.9, dist) * intensity;
    }
    
    // Shadow mask / aperture grille
    vec3 shadowMask(vec2 uv, float intensity) {
      float maskCount = 320.0;
      float x = fract(uv.x * maskCount);
      
      // Triad of RGB subpixels
      float rMask = smoothstep(0.0, 0.33, x) * (1.0 - smoothstep(0.33, 0.66, x));
      float gMask = smoothstep(0.33, 0.66, x) * (1.0 - smoothstep(0.66, 1.0, x));
      float bMask = smoothstep(0.66, 1.0, x) * (1.0 - smoothstep(1.0, 1.33, x));
      
      // Wrap-around for b channel
      bMask += smoothstep(0.0, 0.33, x) * (1.0 - smoothstep(0.33, 0.66, x));
      
      vec3 mask = vec3(
        mix(1.0, rMask, intensity),
        mix(1.0, gMask, intensity),
        mix(1.0, bMask, intensity)
      );
      
      // Very fine vertical grille bars
      float y = fract(uv.y * maskCount * 0.75);
      float yMask = 1.0 - (step(0.92, y) * intensity * 0.5);
      mask *= yMask;
      
      return mask;
    }
    
    void main(void) {
      vec2 curvedUV = applyCurvature(vUV, uCurvature);
      
      // Discard if outside screen bounds (for curvature)
      if (curvedUV.x < 0.0 || curvedUV.x > 1.0 || curvedUV.y < 0.0 || curvedUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      
      // Chromatic aberration (RGB shift)
      float r = texture2D(textureSampler, curvedUV + vec2(uChromaticAberration * 0.01, 0.0)).r;
      float g = texture2D(textureSampler, curvedUV).g;
      float b = texture2D(textureSampler, curvedUV - vec2(uChromaticAberration * 0.01, 0.0)).b;
      vec3 color = vec3(r, g, b);
      
      // Apply phosphor glow (brightness boost)
      color = color * (1.0 + uGlow * 0.3) + color * color * uGlow * 0.5;
      
      // Apply shadow mask / aperture grille
      vec3 mask = shadowMask(curvedUV, 0.4);
      color *= mask;
      
      // Apply scanlines
      float scan = scanlines(curvedUV, uScanlineIntensity);
      color *= scan;
      
      // Apply vignette
      float vig = vignette(curvedUV, uVignette);
      color *= vig;
      
      // Add subtle noise/static
      if (uNoise > 0.0) {
        float noise = rand(curvedUV + uTime) * uNoise;
        color += noise;
      }
      
      // Add occasional flicker
      if (uFlicker > 0.0) {
        float flicker = 1.0 - (rand(vec2(uTime * 10.0, 0.0)) * uFlicker * 0.1);
        color *= flicker;
      }
      
      // Slight green tint for vintage CRT feel
      color.g *= 1.05;
      color.b *= 0.98;
      
      gl_FragColor = vec4(color, 1.0);
    }
  `
}

/**
 * CRT Effect Parameters
 */
export interface CRTEffectParams {
  /** Scanline visibility (0-1) */
  scanlineIntensity: number
  /** Screen curvature amount (0-0.5) */
  curvature: number
  /** Vignette darkness (0-1) */
  vignette: number
  /** RGB chromatic aberration (0-1) */
  chromaticAberration: number
  /** Phosphor glow intensity (0-1) */
  glow: number
  /** Static noise amount (0-1) */
  noise: number
  /** Screen flicker amount (0-1) */
  flicker: number
}

/**
 * Preset CRT configurations
 */
export const CRT_PRESETS = {
  /** Subtle modern CRT look */
  MODERN: {
    scanlineIntensity: 0.2,
    curvature: 0.02,
    vignette: 0.3,
    chromaticAberration: 0.2,
    glow: 0.4,
    noise: 0.02,
    flicker: 0.01,
  } as CRTEffectParams,
  
  /** Strong retro CRT look */
  RETRO: {
    scanlineIntensity: 0.6,
    curvature: 0.05,
    vignette: 0.5,
    chromaticAberration: 0.5,
    glow: 0.6,
    noise: 0.05,
    flicker: 0.03,
  } as CRTEffectParams,
  
  /** Subtle effect for story videos */
  STORY: {
    scanlineIntensity: 0.15,
    curvature: 0.03,
    vignette: 0.25,
    chromaticAberration: 0.15,
    glow: 0.35,
    noise: 0.01,
    flicker: 0.005,
  } as CRTEffectParams,
  
  /** Off/no effect */
  OFF: {
    scanlineIntensity: 0.0,
    curvature: 0.0,
    vignette: 0.0,
    chromaticAberration: 0.0,
    glow: 0.0,
    noise: 0.0,
    flicker: 0.0,
  } as CRTEffectParams,
}
