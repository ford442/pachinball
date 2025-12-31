export const numberScrollShader = {
    vertex: `
        // BabylonJS standard uniforms
        uniform worldViewProjection : mat4x4<f32>;

        struct VertexInput {
            @location(0) position : vec3<f32>,
            @location(1) uv : vec2<f32>
        };

        struct VertexOutput {
            @builtin(position) position : vec4<f32>,
            @location(0) vUV : vec2<f32>
        };

        @vertex
        fn main(input : VertexInput) -> VertexOutput {
            var output : VertexOutput;
            output.position = worldViewProjection * vec4<f32>(input.position, 1.0);
            output.vUV = input.uv;
            return output;
        }
    `,

    fragment: `
        // Custom Uniforms
        uniform uOffset : f32; // 0.0 to 1.0 (Scroll position)
        uniform uSpeed : f32;  // 0.0 = Static, 1.0 = Fast Blur
        uniform uColor : vec3<f32>;

        // Texture
        var mySampler : sampler;
        var myTexture : texture_2d<f32>;

        struct FragmentInput {
            @location(0) vUV : vec2<f32>
        };

        @fragment
        fn main(input : FragmentInput) -> @location(0) vec4<f32> {
            var uv = input.vUV;

            // 1. Scroll Effect (Vertical)
            // We assume the texture is a vertical strip of numbers 0-9
            // uOffset shifts the UVs down
            uv.y = uv.y + uOffset;

            // 2. Motion Blur Distortion
            // As speed increases, we sample slightly above/below and blend

            var color = vec4<f32>(0.0);
            let samples = 5;
            let blurStrength = uSpeed * 0.1; // Amount of stretch

            for (var i = 0; i < samples; i++) {
                let offset = (f32(i) / f32(samples) - 0.5) * blurStrength;
                let sampleUV = vec2<f32>(uv.x, uv.y + offset);

                // Note: Texture wrapping handles the modulo 1.0 automatically if configured

                color = color + textureSample(myTexture, mySampler, sampleUV);
            }
            color = color / f32(samples);

            // 3. Colorization & Glow
            // Multiply by our target LED color (e.g., Red, Blue, Gold)
            let glow = color.rgb * uColor * 2.0; // Boost brightness for HDR bloom

            // 4. Alpha Masking (assume black background in png is transparent)
            // Or use texture alpha if it exists
            let alpha = color.a;

            return vec4<f32>(glow, alpha);
        }
    `
};
