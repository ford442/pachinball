/**
 * CRT effect, WGSL (WebGPU) twin of `crtEffectShader.fragment` in `../crt-effect.ts`: same
 * uniforms, same math, same output. Runs as the backbox `crt` pass on the composite, which binds
 * the composite as `textureSampler` (+ `textureSamplerSampler`).
 *
 * All three samples sit before any branch: WGSL rejects `textureSample` outside uniform control flow.
 */

export const crtEffectFragmentWGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform uTime: f32;
uniform uScanlineIntensity: f32;
uniform uCurvature: f32;
uniform uVignette: f32;
uniform uChromaticAberration: f32;
uniform uGlow: f32;
uniform uNoise: f32;
uniform uFlicker: f32;

#define CUSTOM_FRAGMENT_DEFINITIONS

// Random function for noise
fn rand(co: vec2f) -> f32 {
  return fract(sin(dot(co.xy, vec2f(12.9898, 78.233))) * 43758.5453);
}

// Apply screen curvature
fn applyCurvature(uv: vec2f, curve: f32) -> vec2f {
  let centered = uv - 0.5;
  let dist = length(centered);
  let curveAmount = dist * dist * curve;
  return uv + centered * curveAmount;
}

// Scanline effect
fn scanlines(uv: vec2f, intensity: f32) -> f32 {
  let scanlineCount = 240.0;
  let y = fract(uv.y * scanlineCount);
  var scan = sin(y * 3.14159);
  scan = pow(scan, 0.5) * 0.15;
  return 1.0 - (intensity * scan);
}

// Vignette effect
fn vignette(uv: vec2f, intensity: f32) -> f32 {
  let centered = uv - 0.5;
  let dist = length(centered);
  return 1.0 - smoothstep(0.3, 0.9, dist) * intensity;
}

// Shadow mask / aperture grille
fn shadowMask(uv: vec2f, intensity: f32) -> vec3f {
  let maskCount = 320.0;
  let x = fract(uv.x * maskCount);

  // Triad of RGB subpixels
  let rMask = smoothstep(0.0, 0.33, x) * (1.0 - smoothstep(0.33, 0.66, x));
  let gMask = smoothstep(0.33, 0.66, x) * (1.0 - smoothstep(0.66, 1.0, x));
  var bMask = smoothstep(0.66, 1.0, x) * (1.0 - smoothstep(1.0, 1.33, x));

  // Wrap-around for b channel
  bMask += smoothstep(0.0, 0.33, x) * (1.0 - smoothstep(0.33, 0.66, x));

  var grille = vec3f(
    mix(1.0, rMask, intensity),
    mix(1.0, gMask, intensity),
    mix(1.0, bMask, intensity)
  );

  // Very fine vertical grille bars
  let y = fract(uv.y * maskCount * 0.75);
  let yMask = 1.0 - (step(0.92, y) * intensity * 0.5);
  grille *= yMask;

  return grille;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let curvedUV = applyCurvature(fragmentInputs.vUV, uniforms.uCurvature);

  // Clamping keeps sampling in bounds; the inBounds mask below blacks out what falls outside
  // the curved screen without a branch.
  let sampledUV = clamp(curvedUV, vec2f(0.0), vec2f(1.0));
  let r = textureSample(textureSampler, textureSamplerSampler, sampledUV + vec2f(uniforms.uChromaticAberration * 0.01, 0.0)).r;
  let g = textureSample(textureSampler, textureSamplerSampler, sampledUV).g;
  let b = textureSample(textureSampler, textureSamplerSampler, sampledUV - vec2f(uniforms.uChromaticAberration * 0.01, 0.0)).b;
  var color = vec3f(r, g, b);

  // Branchless out-of-bounds mask: 1.0 inside screen, 0.0 outside.
  let inBounds = step(0.0, curvedUV.x) * step(curvedUV.x, 1.0)
               * step(0.0, curvedUV.y) * step(curvedUV.y, 1.0);

  // Modern bloom/glow
  if (uniforms.uGlow > 0.0) {
    let brightness = (color.r + color.g + color.b) / 3.0;
    color += color * brightness * uniforms.uGlow * 0.8 * step(0.5, brightness);
    color = color * (1.0 + uniforms.uGlow * 0.2);
  }

  // Apply shadow mask / aperture grille (very subtle for modern look)
  let grille = shadowMask(curvedUV, 0.15);
  color *= grille;

  // Apply scanlines (soft for modern screens)
  let scan = scanlines(curvedUV, uniforms.uScanlineIntensity);
  color *= scan;

  // Apply vignette
  let vig = vignette(curvedUV, uniforms.uVignette);
  color *= vig;

  // Add subtle noise/static
  if (uniforms.uNoise > 0.0) {
    let staticNoise = rand(curvedUV + uniforms.uTime) * uniforms.uNoise;
    color += staticNoise;
  }

  // Add occasional flicker
  if (uniforms.uFlicker > 0.0) {
    let flicker = 1.0 - (rand(vec2f(uniforms.uTime * 10.0, 0.0)) * uniforms.uFlicker * 0.1);
    color *= flicker;
  }

  // Modern color grading for LCD/OLED vibrancy
  let luminance = dot(color, vec3f(0.299, 0.587, 0.114));

  // Enhance saturation slightly for modern screens
  let desaturated = vec3f(luminance);
  color = mix(desaturated, color, 1.15); // 15% saturation boost

  // Modern color tone: neutral-to-slightly-warm
  color.r *= 1.02;
  color.g *= 1.0;
  color.b *= 0.98;

  // Contrast enhancement via S-curve
  color = pow(color, vec3f(0.95)) + pow(color, vec3f(2.1)) * 0.05;

  // Apply out-of-bounds mask: black outside the curved screen area
  fragmentOutputs.color = vec4f(color * inBounds, 1.0);
}
`
