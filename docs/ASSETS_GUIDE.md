# Asset Guide for Pachinball

## Overview

Pachinball now uses a centralized **MaterialLibrary** system with **PBR (Physically Based Rendering)** materials for a modern, premium look. The system provides procedural fallbacks for all textures, so the game works without any external assets.

## Quick Start

To enhance visuals, add an environment texture:

```
public/
└── textures/
    └── environment.env    ← Optional: Enables realistic reflections
```

That's it! Everything else works procedurally.

---

## Material Categories

The MaterialLibrary organizes materials into 6 clear categories:

### 1. Playfield Surface
**File:** `src/game-elements/material-library.ts` - `getPlayfieldMaterial()`

| Property | Value |
|----------|-------|
| Type | PBRMaterial |
| Metallic | 0.3 |
| Roughness | 0.25 |
| Alpha | 0.92 |
| Clear Coat | Enabled (0.4 intensity) |

**Texture Support:**
- `playfield_albedo.png` - Base color (fallback: procedural grid)
- `playfield_normal.png` - Surface bumps
- `playfield_roughness.png` - Gloss variation
- `playfield_metallic.png` - Metal areas
- `playfield_emissive.png` - Glowing grid lines
- `playfield_ao.png` - Ambient occlusion

### 2. Metal Trim / Rails
**Files:** 
- `getChromeMaterial()` - Highly reflective chrome
- `getBrushedMetalMaterial()` - Brushed steel look
- `getPinMaterial()` - Pachinko pins

| Property | Chrome | Brushed | Pins |
|----------|--------|---------|------|
| Metallic | 1.0 | 0.9 | 1.0 |
| Roughness | 0.15 | 0.4 | 0.25 |
| Clear Coat | No | No | Yes |

### 3. Smoked Glass / Transparent Barriers
**Files:**
- `getSmokedGlassMaterial()` - Wall barriers
- `getGlassTubeMaterial()` - Feed tubes

| Property | Value |
|----------|-------|
| Alpha | 0.25-0.35 |
| IOR | 1.4-1.5 |
| Metallic | 0.0-0.1 |

### 4. Black Plastic Casing
**Files:**
- `getCabinetMaterial()` - Main cabinet (StandardMaterial)
- `getSidePanelMaterial()` - Side panels with glow
- `getBlackPlasticMaterial()` - Control panels (PBR)

### 5. Emissive Neon Inserts
**Files:**
- `getNeonBumperMaterial(color)` - Bumpers
- `getNeonFlipperMaterial()` - Flippers
- `getNeonSlingshotMaterial()` - Slingshots
- `getHologramMaterial(color)` - Wireframe holograms

### 6. Ball Materials
**Files:**
- `getChromeBallMaterial()` - Main ball (chrome)
- `getExtraBallMaterial()` - Multiball variant (green)

---

## Environment Texture (Optional)

**Path:** `public/textures/environment.env`

This is a prefiltered DDS cubemap that provides realistic reflections for metallic surfaces.

### Without Environment Texture
- Uses procedural lighting
- Metallic surfaces reflect scene lights
- Slightly less realistic but still good

### With Environment Texture
- Chrome ball reflects environment
- Pins have realistic highlights
- Overall more premium look

### Getting an Environment File

1. **Download HDRi** from [Poly Haven](https://polyhaven.com/hdris)
2. **Convert using [Babylon.js sandbox](https://sandbox.babylonjs.com/)**:
   - Drag HDRi into sandbox
   - Click Inspector → Tools → Generate .env
   - Download the .env file
3. **Place at** `public/textures/environment.env`

---

## Texture Asset Format

All textures are optional. If present, they override procedural defaults.

### Naming Convention
```
public/textures/
├── environment.env              # Environment cubemap
├── playfield_albedo.png         # RGB - Base color
├── playfield_normal.png         # RGB - Normal map
├── playfield_roughness.png      # Grayscale - Roughness
├── playfield_metallic.png       # Grayscale - Metallic
├── playfield_emissive.png       # RGB - Emission
├── playfield_ao.png             # Grayscale - Ambient Occlusion
└── brushed_metal_roughness.png  # Anisotropic roughness
```

### Recommended Formats
- **Resolution:** 1024x1024 or 2048x2048
- **Format:** PNG (lossless) for most
- **Environment:** .env (prefiltered cubemap)

---

## Code Architecture

### Using MaterialLibrary

```typescript
import { getMaterialLibrary } from './game-elements/material-library'

// In your class:
private matLib = getMaterialLibrary(this.scene)

// Get materials:
const ballMat = this.matLib.getChromeBallMaterial()
const groundMat = this.matLib.getPlayfieldMaterial()
```

### Adding a New Material

```typescript
// In MaterialLibrary class:
getCustomMaterial(): PBRMaterial {
  const cacheKey = 'custom'
  if (this.materialCache.has(cacheKey)) {
    return this.materialCache.get(cacheKey) as PBRMaterial
  }

  const mat = new PBRMaterial('customMat', this.scene)
  // ... configure material ...
  
  this.materialCache.set(cacheKey, mat)
  return mat
}
```

### Texture Loading with Fallback

```typescript
private loadTextureSet(name: string): TextureSet {
  return {
    albedo: this.tryLoadTexture(`${name}_albedo.png`),
    normal: this.tryLoadTexture(`${name}_normal.png`),
    // ... etc
  }
}
```

If a texture fails to load, it returns `null` and the material uses fallback colors.

---

## Performance Notes

- **PBR materials** are GPU-accelerated in modern browsers
- **Material caching** prevents duplicate materials
- **Texture caching** prevents duplicate loads
- **Clear coat** has minimal overhead
- **Environment texture** loads once and is shared

### Budget Guidelines
- Environment texture: 1 (optional)
- Custom textures: 5-10 maximum
- Total VRAM impact: <50MB with all textures

---

## Troubleshooting

### Materials Look Too Dark
Check console for: `No environment.env found, using procedural reflections`
- This is normal - the game works without it
- Add environment.env for better reflections

### Textures Not Loading
Check browser Network tab:
- Textures are loaded from `/textures/`
- 404 errors are expected if textures aren't present (fallbacks used)

### Pink/Black Materials
Indicates shader compilation error:
- Check browser console for WebGL errors
- Verify texture dimensions are power-of-2

---

## Backbox Attract Media (Optional)

Display a looped video or static image on the head-of-table backbox screen. Video takes priority; falls back to image, then to procedural reels.

### Priority System
1. **Video** - If configured and loads successfully
2. **Static Image** - If video fails or not configured  
3. **Reels/Slots** - Procedural fallback (always works)

### Video Configuration

In `src/config.ts`:
```typescript
backbox: {
  // Video (highest priority)
  attractVideoPath: '/backbox/attract.mp4',
  videoReplacesReels: true,  // Hide reels when video plays
  
  // Image (fallback)
  attractImagePath: '/backbox/attract.png',
  imageOpacity: 0.85,
  imageBlendMode: 'normal',
}
```

### Video Guidelines
- **Format:** MP4 (H.264) for maximum compatibility
- **Resolution:** 1920x1080 or 1280x720 (16:9)
- **Audio:** Not required (video is muted for autoplay)
- **Loop:** Should loop seamlessly (last frame → first frame)
- **File Size:** Under 50MB for fast loading
- **Location:** `public/backbox/attract.mp4`

### Video Features
- ✅ Autoplay (muted, inline)
- ✅ Automatic loop
- ✅ Graceful fallback on load failure
- ✅ Graceful fallback on autoplay block
- ✅ Aspect ratio preserved (letterboxed if needed)
- ✅ Scanline/overlay effects still apply on top

### Image Configuration (Fallback)

Used when video is not configured or fails to load:
```typescript
backbox: {
  attractVideoPath: '',                      // Disable video
  attractImagePath: '/backbox/attract.png',  // Use image
  imageOpacity: 0.85,                        // 0.0 - 1.0
  imageBlendMode: 'normal',                  // 'normal' | 'additive' | 'multiply'
}
```

### Layering Order (back to front)
1. **Reels/Slots** - Deepest layer (hidden if video replaces reels)
2. **Video** - Looped video (if configured and loaded)
3. **Image** - Static image (fallback if video fails)
4. **Animated Grid** - Cyber grid shader (shows through transparent areas)
5. **UI Overlay** - Text, scanlines, jackpot effects

### Image Guidelines
- **Resolution:** 1024x512 or 1920x1080 (16:9)
- **Format:** PNG with transparency recommended
- **Style:** Dark backgrounds work best with visible grid underneath

### Blend Modes (Images Only)
| Mode | Effect | Best For |
|------|--------|----------|
| `normal` | Standard alpha blend | Most images |
| `additive` | Adds to background | Glow effects, neon art |
| `multiply` | Darkens background | Light/white images |

### Runtime Control
```typescript
// Video controls
displaySystem.playVideo()
displaySystem.pauseVideo()
displaySystem.setVideoOpacity(0.5)
displaySystem.setVideoVisible(false)

// Image controls
displaySystem.setImageVisible(false)
displaySystem.setImageOpacity(0.5)
displaySystem.setImageOpacity(0.5)
```

---

## Migration from Old System

Previous code using `StandardMaterial` directly:
```typescript
const mat = new StandardMaterial('old', this.scene)
mat.diffuseColor = Color3.Red()
```

New code using MaterialLibrary:
```typescript
const mat = this.matLib.getNeonBumperMaterial('#ff0000')
```

Or for custom materials, use `PBRMaterial`:
```typescript
const mat = new PBRMaterial('new', this.scene)
mat.albedoColor = Color3.Red()
mat.metallic = 0.5
mat.roughness = 0.3
```
