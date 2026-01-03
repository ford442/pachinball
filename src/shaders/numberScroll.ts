export const numberScrollShader = {
    vertex: `
        attribute position : vec3<f32>;
        attribute uv : vec2<f32>;

        uniform worldViewProjection : mat4x4<f32>;

        varying vUV : vec2<f32>;

        @vertex
        fn main(input : VertexInputs) -> FragmentInputs {
            var output : FragmentInputs;
            output.position = uniforms.worldViewProjection * vec4<f32>(input.position, 1.0);
            output.vUV = input.uv;
            return output;
        }
    `,

    fragment: `
        varying vUV : vec2<f32>;

        uniform uOffset : f32;
        uniform uSpeed : f32;
        uniform uColor : vec3<f32>;

        var myTextureSampler : sampler;
        var myTexture : texture_2d<f32>;

        @fragment
        fn main(input : FragmentInputs) -> FragmentOutputs {
            var output : FragmentOutputs;
            var uv = input.vUV;

            // 1. Scroll Effect (Vertical)
            uv.y = uv.y + uniforms.uOffset;

            // 2. Motion Blur Distortion
            var color = vec4<f32>(0.0);
            let samples = 5;
            let blurStrength = uniforms.uSpeed * 0.1;

            for (var i = 0; i < samples; i++) {
                let offset = (f32(i) / f32(samples) - 0.5) * blurStrength;
                let sampleUV = vec2<f32>(uv.x, uv.y + offset);

                color = color + textureSample(myTexture, myTextureSampler, sampleUV);
            }
            color = color / f32(samples);

            // 3. Colorization & Glow
            let glow = color.rgb * uniforms.uColor * 2.0;

            // 4. Alpha Masking
            let alpha = color.a;

            output.color = vec4<f32>(glow, alpha);
            return output;
        }
    `
};
