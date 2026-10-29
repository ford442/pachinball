/**
 * Jackpot overlay, WGSL (WebGPU) twin of `jackpotOverlayPostProcessFragment` in
 * `../jackpotOverlay.ts`: same uniforms, samplers, math and output. Runs as the backbox `jackpot`
 * pass: `textureSampler` is the composite, `myTexture` the canvas holding the jackpot text.
 *
 * Both samples sit before any branch: WGSL rejects `textureSample` outside uniform control flow.
 */

export const jackpotOverlayFragmentWGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var myTextureSampler: sampler;
var myTexture: texture_2d<f32>;
uniform uTime: f32;
uniform uPhase: i32;
uniform uCrackProgress: f32;
uniform uShockwaveRadius: f32;
uniform uGlitchIntensity: f32;

#define CUSTOM_FRAGMENT_DEFINITIONS

fn rand(co: vec2f) -> f32 {
  return fract(sin(dot(co, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn valueNoise(p: vec2f) -> f32 {
  let ip = floor(p);
  var u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(
    mix(rand(ip), rand(ip + vec2f(1.0, 0.0)), u.x),
    mix(rand(ip + vec2f(0.0, 1.0)), rand(ip + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

// GLSL mod(): x - y * floor(x / y). WGSL's % truncates instead.
fn glslMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  // The glitch offset is branchless so both samples run unconditionally.
  var uv = fragmentInputs.vUV;
  let noiseVal = rand(vec2f(uniforms.uTime, uv.y * 10.0));
  let glitchShift = (rand(vec2f(uv.x * 10.0, uniforms.uTime)) - 0.5) * uniforms.uGlitchIntensity * 0.02;
  // Apply the shift only when noiseVal > 0.9 AND uGlitchIntensity > 0
  uv.x += glitchShift * step(0.9, noiseVal) * step(0.001, uniforms.uGlitchIntensity);

  let sceneColor = textureSample(textureSampler, textureSamplerSampler, uv);
  let baseColor = textureSample(myTexture, myTextureSampler, uv);
  var finalColor = baseColor.rgb;
  var alpha = 0.0;

  // Boost text drawn into myTexture (white/yellow content) during jackpot phases
  let baseLuma = dot(baseColor.rgb, vec3f(0.299, 0.587, 0.114));
  if (uniforms.uPhase >= 1 && baseLuma > 0.6) {
    alpha = max(alpha, 0.85);
  }

  let center = vec2f(0.5, 0.5);
  let distFromCenter = distance(uv, center);

  // PHASE 1: BREACH (Red Tint + Cracks)
  if (uniforms.uPhase == 1) {
    let pulse = 0.5 + 0.5 * sin(uniforms.uTime * 15.0);
    finalColor += vec3f(0.5, 0.0, 0.0) * pulse * 0.3;
    alpha = 0.3;

    if (uniforms.uCrackProgress > 0.0) {
      let angle = atan2(uv.y - 0.5, uv.x - 0.5);
      let crack = sin(angle * 10.0 + valueNoise(vec2f(distFromCenter * 10.0)))
                * sin(distFromCenter * 20.0);
      if (abs(crack) < 0.02 * uniforms.uCrackProgress && distFromCenter < uniforms.uCrackProgress) {
        finalColor = vec3f(0.8, 0.8, 1.0);
        alpha = 0.8;
      }
    }
  }

  // PHASE 2: CRITICAL ERROR (Hex Shield Peel + Strobing)
  if (uniforms.uPhase == 2) {
    if (distFromCenter < (uniforms.uTime * 0.5 - 1.0)) {
      finalColor = vec3f(1.0, 1.0, 0.8);
      alpha = 1.0;
    } else {
      if (glslMod(uniforms.uTime * 20.0, 2.0) < 1.0) {
        finalColor += vec3f(0.2, 0.2, 0.0);
      }
      alpha = 0.4;
    }
  }

  // PHASE 3: MELTDOWN (Shockwaves + Rainbow)
  if (uniforms.uPhase == 3) {
    let waveWidth = 0.1;
    let waveDist = abs(distFromCenter - uniforms.uShockwaveRadius);
    if (waveDist < waveWidth) {
      let intensity = 1.0 - (waveDist / waveWidth);
      finalColor += vec3f(0.0, 1.0, 1.0) * intensity;
      alpha = max(alpha, intensity);
    }
    let hue = uv.y + uniforms.uTime * 0.5;
    let rainbow = 0.5 + 0.5 * cos(6.28318 * (hue + vec3f(0.0, 0.33, 0.67)));
    finalColor += rainbow * 0.2;
    alpha = max(alpha, 0.2);
  }

  // Composite jackpot effect over the scene
  fragmentOutputs.color = mix(sceneColor, vec4f(finalColor, 1.0), alpha);
}
`
