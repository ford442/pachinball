/**
 * Scanline pass, WGSL (WebGPU) twin of `scanlinePixelShader.fragment` in `../scanline.ts`: same
 * uniforms, math and output. Like its GLSL twin it is not compiled anywhere today; the backbox
 * CRT pass (`crtEffect`) is what draws scanlines.
 */

export const scanlineFragmentWGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform uTime: f32;
uniform uScanlineIntensity: f32;

#define CUSTOM_FRAGMENT_DEFINITIONS

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;

  // 1. Chromatic Aberration - RGB channel offset for retro CRT look
  let aberration = 0.003;
  let dir = uv - vec2f(0.5);
  var ca: vec4f;
  ca.r = textureSample(textureSampler, textureSamplerSampler, uv + dir * aberration).r;
  ca.g = textureSample(textureSampler, textureSamplerSampler, uv).g;
  ca.b = textureSample(textureSampler, textureSamplerSampler, uv - dir * aberration).b;
  ca.a = 1.0;
  var color = ca.rgb;

  // 2. Scanlines
  let scanlineCount = 800.0;
  let scanline = sin(uv.y * scanlineCount);
  let lineFactor = 1.0 - (uniforms.uScanlineIntensity * 0.5 * (scanline + 1.0));
  color *= lineFactor;

  // 3. Temporal Flicker - subtle CRT phosphor refresh brightness variation
  let flicker = sin(uniforms.uTime * 60.0) * 0.5 + 0.5;
  let flickerAmount = 0.015 * flicker;
  color *= (1.0 - flickerAmount);

  // 4. Subtle Film Grain - adds texture and avoids clinical perfection
  let grain = fract(sin(dot(uv + uniforms.uTime * 0.1, vec2f(127.1, 311.7))) * 43758.5453);
  color += (grain - 0.5) * 0.025;

  // 5. Vignette - darken corners for CRT/curved screen effect
  let dist = distance(uv, vec2f(0.5, 0.5));
  let vignette = 1.0 - smoothstep(0.4, 0.9, dist);
  color *= vignette;

  fragmentOutputs.color = vec4f(color, 1.0);
}
`
