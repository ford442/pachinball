# Camera & Lighting Tuning Guide

This document explains the camera and lighting adjustments made to improve 3D depth perception and dramatic presentation while maintaining gameplay readability.

---

## Camera Adjustments

### Overview
The table camera was tuned to create stronger perspective cues and a more cinematic framing of the playfield.

| Parameter | Before | After | Rationale |
|-----------|--------|-------|-----------|
| **FOV** | 0.8 (46°) | 0.65 (37°) | Narrower FOV creates telephoto effect, enhancing depth through stronger perspective convergence |
| **Beta (tilt)** | π/4 (45°) | π/3.5 (~51°) | More side-angle view shows cabinet depth and 3D structure |
| **Radius** | 35 | 32 | Closer camera for intimacy with playfield action |
| **Target Z** | 5 | 2 | Shifted toward flippers where gameplay happens |
| **Inertia** | default | 0.85 | Smoother camera feel during control |

### Visual Impact
- **Stronger Depth**: Narrower FOV makes parallel lines converge more dramatically
- **Better Framing**: Target shift focuses on action area while still showing upper playfield
- **Cabinet Presence**: Lower beta angle reveals more of the cabinet sides and vertical structure
- **Cinematic Feel**: Telephoto perspective mimics professional pinball photography

---

## Lighting System

### 4-Light Setup
The lighting was redesigned from flat ambient to dramatic contrast lighting:

```
                    [RIM LIGHT]
                       ↓
                    (behind)
                      ____
                     /    \
    [KEY LIGHT] →  | BALL |  ← player view
    (front-left)   |      |
                      ‾‾‾‾
                    (bounce)
                       ↑
                   [BOUNCE]
                   
    [FILL] - ambient hemisphere (reduced)
```

### Light Details

#### 1. Key Light (Directional)
- **Intensity**: 0.6 → 1.2 (doubled for drama)
- **Color**: Warm white (1.0, 0.92, 0.85)
- **Position**: (-15, 25, -15)
- **Direction**: Front-left, casting shadows toward back-right
- **Shadows**: Enabled with 2048px blur shadow map

**Rationale**: Strong key light creates:
- Defined highlights on ball and metal surfaces
- Clear shadow direction for depth cues
- Separation between objects and playfield

#### 2. Fill Light (Hemispheric)
- **Intensity**: 0.4 → 0.25 (reduced for contrast)
- **Color**: Cool blue-tinted (0.7, 0.8, 0.95)
- **Ground Color**: Darker (0.05, 0.05, 0.08)

**Rationale**: Reduced fill maintains contrast:
- Shadow areas stay rich and dark
- Less flattening of 3D forms
- Cool color complements warm key

#### 3. Rim Light (Directional)
- **Intensity**: 0.4 → 0.8 (doubled for edge definition)
- **Color**: Cool blue (0.5, 0.75, 1.0)
- **Position**: (5, 12, -25) - behind table

**Rationale**: Strong rim light provides:
- Edge glow on bumpers and pins
- Separation from dark background
- "Hero lighting" aesthetic

#### 4. Bounce Light (Point)
- **Intensity**: 0.3
- **Color**: Purple-tinted (0.6, 0.5, 0.8)
- **Position**: (0, -2, 5) - below playfield

**Rationale**: Simulates real light behavior:
- Light reflecting off playfield surface
- Softens harsh shadows under objects
- Adds color complexity

---

## Shadow System

### Implementation
- **Shadow Map**: 2048x2048 blur exponential
- **Blur Kernel**: 32 (soft shadows)
- **Darkness**: 0.4 (not pure black)

### Meshes Casting Shadows
- Ball (critical for position reading)
- Bumpers
- Pins
- Flippers
- Cabinet rails
- Walls (receive only)

### Visual Purpose
Shadows provide critical depth cues:
1. **Ball Position**: Shadow shows exact contact point with playfield
2. **Object Height**: Shadow offset indicates elevation
3. **Scale Reference**: Shadow size reinforces object size
4. **Ground Plane**: Anchors objects to playfield surface

---

## Post-Processing Adjustments

### Bloom
| Parameter | Before | After | Rationale |
|-----------|--------|-------|-----------|
| Kernel | 32 | 48 | Softer, more atmospheric glow |
| Weight | 0.2 | 0.25 | Stronger response to key light |
| Threshold | 0.8 | 0.7 | Catches more highlight areas |

### Tone Mapping
- **Enabled**: Reinhard tone mapping
- **Purpose**: Preserve highlight detail with strong key light
- **Contrast**: 1.1 (slight punch-up)

---

## Gameplay Visibility Considerations

### Maintained Readability
1. **Ball Visibility**: Strong key light makes chrome ball pop
2. **Flipper Definition**: Shadows and rim light define edges
3. **Bumper Clarity**: Emissive materials + rim light = visible targets
4. **Playfield Grid**: Still visible with reduced fill light

### Avoided Problems
- No harsh shadows on critical gameplay areas
- Rim light doesn't overpower emissive elements
- Fill light still provides base visibility
- Camera angle doesn't obscure ball trajectory

---

## Performance Impact

| Feature | Cost | Mitigation |
|---------|------|------------|
| 2048px Shadows | Medium | Blur filter reduces aliasing |
| 4 Lights | Low | Directional lights are cheap |
| Tone Mapping | Minimal | GPU-native operation |
| Bloom | Low | Already present, just tuned |

**Total Impact**: ~5-10% GPU increase, acceptable for visual gain.

---

## Fine-Tuning Guide

### If Shadows Are Too Harsh
```typescript
shadowGenerator.blurKernel = 48  // Increase softness
shadowGenerator.setDarkness(0.5) // Lighter shadows
```

### If Scene Is Too Dark
```typescript
hemiLight.intensity = 0.35  // Increase fill
keyLight.intensity = 1.0    // Reduce key contrast
```

### If Ball Is Hard to Track
```typescript
tableCam.fov = 0.7  // Wider FOV
// or
keyLight.intensity = 1.3  // Stronger highlight on ball
```

### For More Drama
```typescript
hemiLight.intensity = 0.15   // Less fill
rimLight.intensity = 1.0     // Stronger rim
keyLight.intensity = 1.4     // Hotter key
```

---

## Summary

The tuning transforms the visual presentation from flat and functional to dramatic and dimensional while preserving gameplay clarity:

**Before**: Even lighting, wide angle, flat presentation  
**After**: Contrast lighting, telephoto perspective, strong depth cues

The key insight is that **shadows and contrast** are the primary depth cues in 3D rendering. By increasing the ratio between key and fill light, and adding directional shadows, we create a much stronger sense of space and scale.
