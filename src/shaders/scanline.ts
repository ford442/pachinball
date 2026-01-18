export const scanlinePixelShader = {
  name: "scanline",
  fragment: `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D textureSampler;
    uniform float uTime;

    void main(void) {
        vec3 color = texture2D(textureSampler, vUV).rgb;

        // 1. Scanlines
        // A high frequency sine wave along the Y axis
        float scanlineCount = 1000.0;
        float scanline = sin(vUV.y * scanlineCount) * 0.1;
        color -= scanline; // Subtract slightly to create dark lines

        // 2. Vignette
        // Darken the corners to simulate a CRT/curved screen
        float dist = distance(vUV, vec2(0.5, 0.5));
        // correct smoothstep usage: edge0 < edge1
        // we want 1.0 at center (dist=0) and 0.0 at corners (dist=0.7)
        float vignette = 1.0 - smoothstep(0.3, 0.8, dist);
        color *= vignette;

        gl_FragColor = vec4(color, 1.0);
    }
  `
}
