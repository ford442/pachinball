# Asset Guide for Pachinball

This game is designed to work with procedural generation, but it supports PBR materials if you provide the assets. To take the visual quality to the next level (Realistic + Neon), you can add the following textures.

## How to Add Textures

Modify `src/game.ts` to load these textures in the `buildScene` function. Look for `groundMat`, `wallMat`, etc.

Example:
```typescript
const tex = new Texture("/assets/textures/my_texture_albedo.png", scene);
myMaterial.albedoTexture = tex;
```

## Recommended Assets

### 1. Environment (Skybox/Reflection)
*   **Type:** `.env` or `.dds` (Prefiltered cubemap)
*   **Location:** `public/textures/environment.env`
*   **Usage:**
    ```typescript
    scene.environmentTexture = CubeTexture.CreateFromPrefilteredData("/textures/environment.env", scene);
    ```
*   **Effect:** This is the single most important asset for "realistic mirroring". It provides the reflections for the metallic ball and the glass walls. Without it, we rely on a simple black skybox and `MirrorTexture` for the floor only.

### 2. Floor / Playfield
*   **Type:** Diffuse, Normal, Roughness, Emissive maps.
*   **Style:** Dark metal grid, carbon fiber, or a printed circuit board pattern with glowing traces.
*   **Usage:** Replace the procedural `createGridTexture` with a real texture set.

### 3. Sounds
*   **Fever/Bumper Hit:** `public/voice/fever.mp3` (Existing, but can be replaced)
*   **Background Music:** Add an `audio` element or load via `AudioContext` for a synthwave backing track.

## Current Procedural Setup

*   **Floor:** A generated grid texture on a standard material with a `MirrorTexture` for real-time planar reflections.
*   **Walls:** Simple semi-transparent standard material.
*   **Ball:** High specular standard material.
*   **Neon:** Emissive colors and a Post-Process Bloom pipeline are used to create the glow.
