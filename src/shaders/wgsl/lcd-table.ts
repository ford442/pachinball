/**
 * LCD table, WGSL (WebGPU) twin of `lcdTablePixelShader.fragment` in `../lcd-table.ts`: same
 * uniforms, math and output.
 *
 * Neither twin is compiled today: the LCD playfield renders through a PBRMaterial with a canvas
 * emissive texture (material-lcd-table.ts). Whoever registers the GLSL one registers this one for
 * WebGPU, so a WebGPU boot never needs Babylon's GLSL translator.
 */

export const lcdTableFragmentWGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform uBaseColor: vec3f;
uniform uAccentColor: vec3f;
uniform uTime: f32;
uniform uScanlineIntensity: f32;
uniform uPixelGridIntensity: f32;
uniform uSubpixelIntensity: f32;
uniform uGlowIntensity: f32;
uniform uMapBlend: f32;
uniform uFlashIntensity: f32;
uniform uRippleIntensity: f32;
uniform uRippleTime: f32;

#define CUSTOM_FRAGMENT_DEFINITIONS

// Refined subpixel RGB pattern - subtle and realistic
fn subpixelPattern(uv: vec2f, color: vec3f) -> vec3f {
  // Much finer subpixel structure (~5 pixels per RGB cycle)
  let subpixelCount = 160.0;
  let x = fract(uv.x * subpixelCount);

  // Each RGB triad is 3 subpixels, so each subpixel is 1/3 of the cycle
  let subpixelWidth = 1.0 / 3.0;

  // Soft Gaussian-like falloff for each subpixel (not hard edges)
  var rMask = exp(-pow((x - subpixelWidth * 0.5) / 0.15, 2.0))
            + exp(-pow((x - 1.0 + subpixelWidth * 0.5) / 0.15, 2.0)); // Wrap around
  var gMask = exp(-pow((x - subpixelWidth * 1.5) / 0.15, 2.0));
  var bMask = exp(-pow((x - subpixelWidth * 2.5) / 0.15, 2.0));

  // Normalize masks so they sum to approximately 1
  let totalMask = rMask + gMask + bMask;
  rMask /= totalMask;
  gMask /= totalMask;
  bMask /= totalMask;

  // Apply subtle color shift - mostly preserves original color with slight tint
  var subpixel = vec3f(
    color.r * mix(1.0, rMask * 1.15, uniforms.uSubpixelIntensity),
    color.g * mix(1.0, gMask * 1.15, uniforms.uSubpixelIntensity),
    color.b * mix(1.0, bMask * 1.15, uniforms.uSubpixelIntensity)
  );

  // Very subtle dark gaps between subpixels (almost invisible)
  var gap = sin(x * 3.14159 * 3.0) * 0.5 + 0.5;
  gap = pow(gap, 0.1) * 0.02 * uniforms.uSubpixelIntensity;
  subpixel *= (1.0 - gap);

  return subpixel;
}

// Pixel grid effect
fn pixelGrid(uv: vec2f) -> f32 {
  let pixelUV = fract(uv * vec2f(64.0, 64.0));
  let grid = abs(pixelUV - 0.5) * 2.0;
  let gridLine = max(grid.x, grid.y);
  return 1.0 - smoothstep(0.9, 1.0, gridLine) * uniforms.uPixelGridIntensity * 0.3;
}

// Scanline effect - fine horizontal lines that complement subpixels
fn scanlines(uv: vec2f) -> f32 {
  let scanlineCount = 240.0;
  let y = fract(uv.y * scanlineCount);

  // Very soft scanline - just a slight dimming, not black bands
  var scan = sin(y * 3.14159);
  scan = pow(scan, 0.5) * 0.08;

  return 1.0 - (uniforms.uScanlineIntensity * scan);
}

// Fine LCD cell grid overlay
fn lcdCellGrid(uv: vec2f) -> f32 {
  let cellUV = fract(uv * vec2f(64.0, 64.0));
  let gridEdge = abs(cellUV - 0.5) * 2.0;
  let gridLine = max(gridEdge.x, gridEdge.y);
  return 1.0 - smoothstep(0.98, 1.0, gridLine) * 0.15 * uniforms.uPixelGridIntensity;
}

// Slight curvature (flat LCD with subtle curve)
fn applyCurvature(uv: vec2f) -> vec2f {
  let centered = uv - 0.5;
  let dist = length(centered);
  let curve = dist * dist * 0.02;
  return uv + centered * curve;
}

// Phosphor glow
fn phosphorGlow(color: vec3f, intensity: f32) -> vec3f {
  let phosphor = color * color * 2.0;
  return color + phosphor * intensity;
}

// Interleaved gradient noise dithering to eliminate banding in smooth gradients
fn dither(uv: vec2f) -> f32 {
  let d = fract(52.9829189 * fract(dot(uv, vec2f(0.06711056, 0.00583715))));
  return (d - 0.5) / 255.0;
}

// Map pattern generation (procedural backgrounds)
fn generateMapPattern(uv: vec2f, blend: f32) -> vec3f {
  // Hexagonal grid pattern
  let hexUV = uv * 8.0;
  var hex = abs(fract(hexUV.x * 0.5) - 0.5) + abs(fract(hexUV.y * 0.866) - 0.5) * 0.5;
  hex = 1.0 - smoothstep(0.3, 0.4, hex);

  // Circuit traces
  let traceX = smoothstep(0.48, 0.52, abs(fract(uv.x * 16.0) - 0.5));
  let traceY = smoothstep(0.48, 0.52, abs(fract(uv.y * 16.0) - 0.5));
  let traces = max(traceX, traceY) * 0.5;

  // Data flow lines (animated)
  var flow = smoothstep(0.45, 0.55, fract(uv.y * 32.0 + uniforms.uTime * 0.5));
  flow *= smoothstep(0.0, 0.2, fract(uv.x * 4.0));

  return uniforms.uBaseColor * (0.2 + hex * 0.3 + traces * 0.4 + flow * 0.5 * blend);
}

// Screen ripple distortion
fn applyRipple(uv: vec2f, intensity: f32, time: f32) -> vec2f {
  if (intensity <= 0.0) {
    return uv;
  }
  let centered = uv - 0.5;
  let dist = length(centered);
  var ripple = sin(dist * 30.0 - time * 15.0) * intensity * 0.03;
  ripple *= smoothstep(0.5, 0.0, dist); // Fade at edges
  return uv + normalize(centered + 0.001) * ripple;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  // Apply ripple distortion to UV
  let rippledUV = applyRipple(fragmentInputs.vUV, uniforms.uRippleIntensity, uniforms.uRippleTime);
  let curvedUV = applyCurvature(rippledUV);

  // Sample base texture
  var baseColor = textureSample(textureSampler, textureSamplerSampler, curvedUV).rgb;

  // Blend in procedural map pattern
  let mapPattern = generateMapPattern(curvedUV, uniforms.uMapBlend);
  baseColor = mix(baseColor, mapPattern, uniforms.uMapBlend);

  // Apply subpixel RGB pattern
  let subpixel = subpixelPattern(curvedUV, baseColor);

  // Apply pixel grid and fine LCD cell grid
  let grid = pixelGrid(curvedUV) * lcdCellGrid(curvedUV);

  // Apply soft scanlines
  let scan = scanlines(curvedUV);

  // Combine effects - subpixel tinting is primary, grid and scan are subtle
  var color = subpixel * grid * scan;

  // Subtle color temperature shift (warmer)
  color = pow(color, vec3f(0.95, 0.98, 1.0));

  // Add phosphor glow
  color = phosphorGlow(color, uniforms.uGlowIntensity);

  // Phosphor flash effect (bright flash on map switch)
  if (uniforms.uFlashIntensity > 0.0) {
    let flashColor = vec3f(0.95, 0.95, 1.0);
    color = mix(color, flashColor, uniforms.uFlashIntensity * 0.6);
    // Boost glow during flash
    color = phosphorGlow(color, uniforms.uGlowIntensity * (1.0 + uniforms.uFlashIntensity));
  }

  // Soft vignette (darker corners like real LCD)
  let dist = distance(curvedUV, vec2f(0.5));
  let vignette = 1.0 - smoothstep(0.3, 0.9, dist) * 0.25;
  color *= vignette;

  // Very subtle accent color overlay
  color = mix(color, uniforms.uAccentColor * color * 1.1, 0.1);

  // Dithering to reduce banding
  color += vec3f(dither(fragmentInputs.vUV));

  fragmentOutputs.color = vec4f(color, 1.0);
}
`
