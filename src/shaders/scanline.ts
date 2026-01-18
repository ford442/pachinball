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
        float vignette = smoothstep(1.0, 0.4, dist);
        color *= vignette;

        // 3. Subtle LCD Grid (Vertical lines)
        // float gridCount = 1000.0;
        // float grid = sin(vUV.x * gridCount) * 0.05;
        // color -= grid;

        gl_FragColor = vec4(color, 1.0);
    }
  `
}
