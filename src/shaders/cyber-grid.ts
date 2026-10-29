/**
 * Cyber-grid background (GLSL, WebGL2): the animated grid on the backbox `grid` layer plane.
 * The WGSL twin for WebGPU is `./wgsl/cyber-grid.ts`, loaded lazily by display-shader.ts.
 */

export const cyberGridShader = {
  name: 'cyberGrid',
  vertex: `
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    void main() {
      gl_Position = worldViewProjection * vec4(position, 1.0);
      vUV = uv;
    }
  `,
  fragment: `
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
}
