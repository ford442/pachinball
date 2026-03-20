export const scanlinePixelShader = {
  name: "scanline",
  fragment: `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D textureSampler;
    uniform float uTime;

    void main(void) {
        // 1. Chromatic Aberration - RGB channel offset for retro CRT look
        float aberration = 0.003;
        vec2 dir = vUV - vec2(0.5);
        vec4 ca;
        ca.r = texture2D(textureSampler, vUV + dir * aberration).r;
        ca.g = texture2D(textureSampler, vUV).g;
        ca.b = texture2D(textureSampler, vUV - dir * aberration).b;
        ca.a = 1.0;
        vec3 color = ca.rgb;

        // 2. Scanlines
        float scanlineCount = 800.0;
        float scanlineIntensity = 0.25;
        float scanline = sin(vUV.y * scanlineCount);
        float lineFactor = 1.0 - (scanlineIntensity * 0.5 * (scanline + 1.0));
        color *= lineFactor;

        // 3. Subtle Film Grain - adds texture and avoids clinical perfection
        float grain = fract(sin(dot(vUV + uTime * 0.1, vec2(127.1, 311.7))) * 43758.5453);
        color += (grain - 0.5) * 0.025;

        // 4. Vignette - darken corners for CRT/curved screen effect
        float dist = distance(vUV, vec2(0.5, 0.5));
        float vignette = 1.0 - smoothstep(0.4, 0.9, dist);
        color *= vignette;

        gl_FragColor = vec4(color, 1.0);
    }
  `
}
