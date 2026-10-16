/**
 * PostProcess-compatible jackpot overlay fragment shader.
 * Replaces vertex glitch displacement with UV distortion in the fragment stage,
 * and composites the jackpot effect on top of the scene texture.
 */
export const jackpotOverlayPostProcessFragment = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D textureSampler; // auto-provided scene texture
    uniform sampler2D myTexture;      // DynamicTexture base
    uniform float uTime;
    uniform int uPhase; // 0=Idle, 1=Breach, 2=Error, 3=Meltdown
    uniform float uCrackProgress;
    uniform float uShockwaveRadius;
    uniform float uGlitchIntensity;

    float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    float noise(vec2 p) {
        vec2 ip = floor(p);
        vec2 u = fract(p);
        u = u * u * (3.0 - 2.0 * u);
        return mix(
            mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
            mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    void main(void) {
        // WebGPU (WGSL) requires textureSample in uniform control flow.
        // Compute glitch offset branchlessly so texture2D is always called
        // unconditionally; step() replaces the per-fragment if-branches.
        vec2 uv = vUV;
        float noiseVal    = rand(vec2(uTime, uv.y * 10.0));
        float glitchShift = (rand(vec2(uv.x * 10.0, uTime)) - 0.5) * uGlitchIntensity * 0.02;
        // Apply shift only when noiseVal > 0.9 AND uGlitchIntensity > 0 (both branchless)
        uv.x += glitchShift * step(0.9, noiseVal) * step(0.001, uGlitchIntensity);

        vec4 sceneColor = texture2D(textureSampler, uv);
        vec4 baseColor  = texture2D(myTexture, uv);
        vec3 finalColor = baseColor.rgb;
        float alpha = 0.0;

        // Boost text drawn into myTexture (white/yellow content) during jackpot phases
        float baseLuma = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
        if (uPhase >= 1 && baseLuma > 0.6) {
          alpha = max(alpha, 0.85);
        }

        vec2 center = vec2(0.5, 0.5);
        float distFromCenter = distance(uv, center);

        // PHASE 1: BREACH (Red Tint + Cracks)
        if (uPhase == 1) {
            float pulse = 0.5 + 0.5 * sin(uTime * 15.0);
            finalColor += vec3(0.5, 0.0, 0.0) * pulse * 0.3;
            alpha = 0.3;

            if (uCrackProgress > 0.0) {
                float angle = atan(uv.y - 0.5, uv.x - 0.5);
                float crack = sin(angle * 10.0 + noise(vec2(distFromCenter * 10.0)))
                            * sin(distFromCenter * 20.0);
                if (abs(crack) < 0.02 * uCrackProgress && distFromCenter < uCrackProgress) {
                    finalColor = vec3(0.8, 0.8, 1.0);
                    alpha = 0.8;
                }
            }
        }

        // PHASE 2: CRITICAL ERROR (Hex Shield Peel + Strobing)
        if (uPhase == 2) {
            if (distFromCenter < (uTime * 0.5 - 1.0)) {
                finalColor = vec3(1.0, 1.0, 0.8);
                alpha = 1.0;
            } else {
                if (mod(uTime * 20.0, 2.0) < 1.0) {
                    finalColor += vec3(0.2, 0.2, 0.0);
                }
                alpha = 0.4;
            }
        }

        // PHASE 3: MELTDOWN (Shockwaves + Rainbow)
        if (uPhase == 3) {
            float waveWidth = 0.1;
            float waveDist  = abs(distFromCenter - uShockwaveRadius);
            if (waveDist < waveWidth) {
                float intensity = 1.0 - (waveDist / waveWidth);
                finalColor += vec3(0.0, 1.0, 1.0) * intensity;
                alpha = max(alpha, intensity);
            }
            float hue = uv.y + uTime * 0.5;
            vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));
            finalColor += rainbow * 0.2;
            alpha = max(alpha, 0.2);
        }

        // Composite jackpot effect over the scene
        gl_FragColor = mix(sceneColor, vec4(finalColor, 1.0), alpha);
    }
`
