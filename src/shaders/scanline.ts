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
        float scanlineCount = 800.0;
        float scanlineIntensity = 0.25;

        // Use sine wave to create alternating light/dark bands
        // Range [-1, 1] -> [0.85, 1.0] for multiplicative
        float scanline = sin(vUV.y * scanlineCount);
        float lineFactor = 1.0 - (scanlineIntensity * 0.5 * (scanline + 1.0));

        color *= lineFactor;

        // 2. Vignette
        // Darken the corners to simulate a CRT/curved screen
        float dist = distance(vUV, vec2(0.5, 0.5));
        float vignette = 1.0 - smoothstep(0.4, 0.9, dist);

        color *= vignette;

        gl_FragColor = vec4(color, 1.0);
    }
  `
}
