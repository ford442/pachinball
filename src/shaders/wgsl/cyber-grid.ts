/**
 * Cyber-grid background, WGSL (WebGPU) twin of `../cyber-grid.ts`. Same attributes, uniforms and
 * output; Babylon's WGSL dialect (`uniforms.x`, `vertexInputs` / `fragmentInputs`).
 */

export const cyberGridVertexWGSL = `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
varying vUV: vec2f;

#define CUSTOM_VERTEX_DEFINITIONS

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vUV = vertexInputs.uv;
}
`

export const cyberGridFragmentWGSL = `
uniform time: f32;
uniform speed: f32;
uniform colorTint: vec3f;
varying vUV: vec2f;

#define CUSTOM_FRAGMENT_DEFINITIONS

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let t = uniforms.time * uniforms.speed;
  let gridX = step(0.95, fract(fragmentInputs.vUV.x * 20.0 + sin(t * 0.5) * 0.5));
  let gridY = step(0.95, fract(fragmentInputs.vUV.y * 10.0 + t));
  let base = uniforms.colorTint * 0.2;
  let lines = uniforms.colorTint * (gridX + gridY) * 0.8;
  let alpha = 0.05 + (gridX + gridY) * 0.4;
  fragmentOutputs.color = vec4f(base + lines, alpha);
}
`
