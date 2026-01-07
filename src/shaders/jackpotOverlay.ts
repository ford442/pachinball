export const jackpotOverlayShader = {
  vertex: `
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    uniform float uGlitchIntensity;
    uniform float uTime;

    varying vec2 vUV;

    // Simple pseudo-random
    float rand(vec2 co){
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
        vUV = uv;
        vec3 pos = position;

        // Glitch displacement (Vertex Jitter)
        if (uGlitchIntensity > 0.0) {
            float noiseVal = rand(vec2(uTime, pos.y));
            if (noiseVal > 0.9) {
                pos.x += (rand(vec2(pos.x, uTime)) - 0.5) * uGlitchIntensity * 0.5;
            }
        }

        gl_Position = worldViewProjection * vec4(pos, 1.0);
    }
  `,
  fragment: `
    uniform float uTime;
    uniform int uPhase; // 0=Idle, 1=Breach, 2=Error, 3=Meltdown
    uniform float uCrackProgress;
    uniform float uShockwaveRadius;
    uniform sampler2D myTexture; // The dynamic UI texture

    varying vec2 vUV;

    float rand(vec2 co){
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Simple 2D noise
    float noise(vec2 p) {
        vec2 ip = floor(p);
        vec2 u = fract(p);
        u = u*u*(3.0-2.0*u);

        float res = mix(
            mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
            mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
        return res;
    }

    void main() {
        vec4 baseColor = texture2D(myTexture, vUV);
        vec3 finalColor = baseColor.rgb;
        float alpha = baseColor.a;

        // CENTER UV for radial effects
        vec2 center = vec2(0.5, 0.5);
        float distFromCenter = distance(vUV, center);

        // PHASE 1: BREACH (Red Tint + Cracks)
        if (uPhase == 1) {
            // Pulse Red
            float pulse = 0.5 + 0.5 * sin(uTime * 15.0);
            finalColor += vec3(0.5, 0.0, 0.0) * pulse * 0.3;

            // Cracks
            if (uCrackProgress > 0.0) {
                // Simple spiderweb crack
                float angle = atan(vUV.y - 0.5, vUV.x - 0.5);
                float crack = sin(angle * 10.0 + noise(vec2(distFromCenter*10.0))) * sin(distFromCenter * 20.0);
                // Make it look like lines
                if (abs(crack) < 0.02 * uCrackProgress && distFromCenter < uCrackProgress) {
                    finalColor = vec3(0.8, 0.8, 1.0); // White crack
                    alpha = max(alpha, 0.8);
                }
            }
        }

        // PHASE 2: CRITICAL ERROR (Hex Shield Peel + Strobing)
        if (uPhase == 2) {
           // Hexagon Pattern
           vec2 r = vUV * 20.0;
           r.x *= 1.15470053839;
           float isHex = step(mod(r.x + r.y, 2.0), 1.0);

           // "Peel" effect: Pixels discard if inside the expanding radius
           if (distFromCenter < (uTime * 0.5 - 1.0)) { // Expanding hole
              // White blinding light underneath
              finalColor = vec3(1.0, 1.0, 0.8);
              alpha = 1.0;
           } else {
              // Strobe
              if (mod(uTime * 20.0, 2.0) < 1.0) {
                  finalColor += vec3(0.2, 0.2, 0.0);
              }
           }
        }

        // PHASE 3: MELTDOWN (Shockwaves + Rainbow)
        if (uPhase == 3) {
            // Shockwave Ring
            float waveWidth = 0.1;
            float waveDist = abs(distFromCenter - uShockwaveRadius);

            if (waveDist < waveWidth) {
                float intensity = 1.0 - (waveDist / waveWidth);
                finalColor += vec3(0.0, 1.0, 1.0) * intensity; // Cyan wave
                alpha = max(alpha, intensity);
            }

            // Rainbow background wash
            float hue = vUV.y + uTime * 0.5;
            vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));
            finalColor += rainbow * 0.2;
        }

        gl_FragColor = vec4(finalColor, alpha);
    }
  `
}
