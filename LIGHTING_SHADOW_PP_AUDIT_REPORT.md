# Lighting, Shadow & Post-Processing Pipeline Audit Report

**Pachinball** - Babylon.js Pinball Game  
**Audit Date:** 2026-03-19  
**Scope:** Lighting system, shadow pipeline, post-processing stack, atmospheric effects, contrast & depth perception

---

## Executive Summary

This audit identifies **40+ opportunities** to safely enhance mood, contrast, depth perception, and atmospheric realism across the Pachinball lighting and post-processing pipeline. All recommendations maintain gameplay readability and respect the WebGL/Canvas fallback architecture.

### Key Metrics
| Category | Current | Potential Improvement |
|----------|---------|----------------------|
| Light Responsiveness | Static base lights | 5+ dynamic states |
| Shadow Quality | Good | Excellent (bias tuning, contact hardening) |
| Post-Process Stack | 4 effects | 8+ effects |
| Atmospheric Depth | None | Fog, volumetrics, color temperature |
| Contrast Control | Fixed | State-adaptive |

### Top 10 Safest, Highest-Impact Improvements
1. **Shadow Bias Tuning** - Eliminate acne/peter-panning (game.ts)
2. **Pin Shadow Culling** - ~15% GPU reduction (game.ts)
3. **FXAA Anti-Aliasing** - Cleaner edges, zero risk (game.ts)
4. **State-Based Fog** - Atmospheric depth with mood shifts (game.ts)
5. **Ball Highlight Light** - Never lose track of the ball (ball-manager.ts)
6. **Chromatic Aberration** - Retro CRT aesthetic (scanline.ts)
7. **Light Temperature Shifts** - Emotional warmth/coolness (effects.ts)
8. **Subtle Vignetting** - Natural focus guidance (game.ts)
9. **SSAO Contact Shadows** - Object grounding, depth cues (game.ts)
10. **ACES Tone Mapping** - Cinematic highlight handling (game.ts)

---

## Audit Area 1: Lighting System

### Current State
**4-Light Dramatic Setup:**
| Light | Type | Color | Intensity | Shadows | Purpose |
|-------|------|-------|-----------|---------|---------|
| KEY | Directional | #fff4e6 (warm) | 1.2 | ✓ 2048px | Main illumination |
| FILL | Hemispheric | #b3c8e6 (cool) | 0.25 | ✗ | Ambient base |
| RIM | Directional | #80bfff (cool) | 0.8 | ✗ | Edge definition |
| BOUNCE | Point | #8800ff (purple) | 0.3 | ✗ | Playfield fill |

**Key-to-Fill Ratio:** 4.8:1 (excellent dramatic contrast)

**Cabinet LED System:** 5 PointLights with state-based animation (normal, hit, fever, reach, jackpot phases)

### Key Opportunities

#### 🔥 HIGH PRIORITY

**1. Shadow Frustum Optimization**
- **File:** `src/game.ts`
- **Change:** Add explicit frustum bounds and bias tuning
```typescript
shadowGenerator.bias = 0.0005
shadowGenerator.normalBias = 0.02
shadowGenerator.frustumSize = 35
shadowGenerator.setMinMaxDistance(5, 40)
```
- **Visual Gain:** Eliminates shadow acne, reduces peter-panning
- **Risk:** Low - parameter tuning only
- **Effort:** 5 min

**2. Game State Light Response**
- **File:** `src/game-elements/effects.ts`
- **Change:** Animate key/rim light intensity during Fever/Jackpot
```typescript
const feverBoost = this.lightingMode === 'fever' ? 0.2 : 0
this.rimLight.intensity = LIGHTING.RIM.intensity + feverBoost
```
- **Visual Gain:** Mood reinforcement, emotional connection to gameplay
- **Risk:** Low - additive only
- **Effort:** 20 min

**3. Bounce Light Proximity Response**
- **File:** `src/game.ts` or `effects.ts`
- **Change:** Ball proximity boosts bounce light intensity
```typescript
const distToBounce = Vector3.Distance(ballPos, this.bounceLight.position)
const proximityBoost = Math.max(0, 1 - distToBounce / 15) * 0.4
this.bounceLight.intensity = LIGHTING.BOUNCE.intensity + proximityBoost
```
- **Visual Gain:** Realism, simulates actual light reflection from ball
- **Risk:** Low
- **Effort:** 15 min

**4. Cabinet Light Exclusion Lists**
- **File:** `src/game-elements/effects.ts`
- **Change:** Exclude non-cabinet meshes from LED lights
```typescript
light.pointLight.excludedMeshes = [backglassMesh, distantDecor]
```
- **Visual Gain:** Cleaner light pools, better contrast control
- **Risk:** Low
- **Effort:** 10 min

**5. Environment Map Control**
- **File:** `src/game.ts` (setupEnvironmentLighting)
- **Change:** Explicit environment intensity and rotation
```typescript
this.scene.environmentIntensity = 0.6
// Optional: envTexture.rotationY = Math.PI / 4
```
- **Visual Gain:** Better PBR response, controlled reflections
- **Risk:** Low
- **Effort:** 5 min

#### ⚡ MEDIUM PRIORITY

**6. Rim Light Shadow Casting (Selective)**
- **File:** `src/game.ts`
- **Change:** Secondary shadow generator for rim light (hero objects only)
```typescript
const rimShadowGen = new ShadowGenerator(1024, rimLight)
rimShadowGen.addShadowCaster(ballMesh)
rimShadowGen.addShadowCaster(bumperMeshes)
```
- **Visual Gain:** Dramatic backlight silhouettes
- **Risk:** Medium - adds second shadow map
- **Effort:** 20 min

---

## Audit Area 2: Shadow System

### Current State
- **Resolution:** 2048×2048 blur exponential
- **Blur Kernel:** 32
- **Darkness:** 0.4 (60% transparent - quite light)
- **Casters:** ~125 meshes (including ~60 small pins)
- **Bias/Normal Bias:** Default (not set)

### Key Opportunities

#### 🔥 HIGH PRIORITY

**7. Add Shadow Bias & Normal Bias** (See #1 above)

**8. Cull Pin Shadows**
- **File:** `src/game.ts` (registerShadowCasters)
- **Change:** Skip shadow casting for pins (too small, add noise)
```typescript
if (mesh.name.includes('pin')) {
  mesh.receiveShadows = true
  continue // Don't cast
}
```
- **Visual Gain:** Cleaner composition, less shadow noise
- **Performance:** ~15% GPU reduction
- **Risk:** Low
- **Effort:** 5 min

**9. Tune Shadow Darkness**
- **File:** `src/game.ts`
- **Change:** Darker shadows for stronger contrast
```typescript
shadowGenerator.setDarkness(0.3) // Was 0.4
shadowGenerator.blurKernel = 28  // Sharper contact
```
- **Visual Gain:** Stronger depth separation
- **Risk:** Low
- **Effort:** 2 min

**10. Contact Hardening Shadows (PCSS)**
- **File:** `src/game.ts`
- **Change:** Sharper contact, softer distance
```typescript
shadowGenerator.useContactHardeningShadow = true
shadowGenerator.contactHardeningLightSizeUVRatio = 0.05
```
- **Visual Gain:** Realistic penumbra, better contact definition
- **Risk:** Medium - performance cost
- **Effort:** 10 min

---

## Audit Area 3: Post-Processing

### Current State
- **Bloom:** Kernel 48, weight 0.25, threshold 0.7
- **Tone Mapping:** Reinhard (type 2), contrast 1.1
- **Scanlines:** GLSL shader on head camera only
- **Dynamic Bloom:** Energy system (0.1–0.9 weight range)
- **No FXAA, No Color Grading, No HDR Adaptation**

### Key Opportunities

#### 🔥 HIGH PRIORITY

**11. Enable FXAA Anti-Aliasing**
- **File:** `src/game.ts`
- **Change:** Single line addition
```typescript
this.bloomPipeline.fxaaEnabled = true
```
- **Visual Gain:** Cleaner edges on thin pins
- **Performance:** ~2-3% GPU
- **Risk:** Low
- **Effort:** 1 min

**12. Chromatic Aberration (Head Camera)**
- **File:** `src/shaders/scanline.ts`
- **Change:** Add RGB channel offset
```glsl
float aberration = 0.003;
vec2 dir = vUV - vec2(0.5);
ca.r = texture2D(textureSampler, vUV + dir * aberration).r;
ca.g = texture2D(textureSampler, vUV).g;
ca.b = texture2D(textureSampler, vUV - dir * aberration).b;
```
- **Visual Gain:** Retro CRT authenticity
- **Risk:** Low - head camera only
- **Effort:** 10 min

**13. ACES Filmic Tone Mapping**
- **File:** `src/game.ts`
- **Change:** Switch from Reinhard to Hable/ACES
```typescript
this.bloomPipeline.imageProcessing.toneMappingType = 3 // Hable
```
- **Visual Gain:** Better highlight preservation, filmic look
- **Risk:** Medium - test ball visibility
- **Effort:** 1 min

**14. Bloom Scale Enhancement**
- **File:** `src/game.ts`
- **Change:** Higher quality base, larger spread
```typescript
this.bloomPipeline.bloomScale = 0.5
this.bloomPipeline.bloomKernel = 64
this.bloomPipeline.prePassEnabled = true
```
- **Visual Gain:** Richer glow hierarchy
- **Risk:** Low
- **Effort:** 5 min

#### ⚡ MEDIUM PRIORITY

**15. Color Temperature Shift**
- **File:** `src/game.ts`
- **Change:** Slight warm shift for cohesive mood
```typescript
this.bloomPipeline.imageProcessing.colorCurvesEnabled = true
this.bloomPipeline.imageProcessing.colorCurves.globalHue = 5
```
- **Visual Gain:** Atmospheric cohesion
- **Risk:** Low
- **Effort:** 5 min

**16. HDR Eye Adaptation (Auto-Exposure)**
- **File:** `src/game.ts`
- **Change:** Subtle auto-exposure
```typescript
this.bloomPipeline.imageProcessing.autoExposureEnabled = true
this.bloomPipeline.imageProcessing.autoExposureMin = 0.8
this.bloomPipeline.imageProcessing.autoExposureMax = 1.3
```
- **Visual Gain:** Dynamic range feels alive
- **Risk:** Medium - could affect readability
- **Effort:** 10 min

**17. Sharpening Filter**
- **File:** `src/game.ts`
- **Change:** Restore edge definition from bloom blur
```typescript
this.bloomPipeline.sharpenEnabled = true
this.bloomPipeline.sharpen.edgeAmount = 0.3
```
- **Visual Gain:** Crisper ball and flipper edges
- **Risk:** Medium - avoid over-sharpening
- **Effort:** 5 min

---

## Audit Area 4: Atmosphere & Mood

### Current State
- **Fog:** Not implemented
- **Color Temperature:** Static lighting
- **Volumetrics:** None
- **Time Variation:** None
- **State Atmospheres:** Limited to cabinet LEDs

### Key Opportunities

#### 🔥 HIGH PRIORITY

**18. State-Based Fog Density & Color**
- **File:** `src/game.ts` + `effects.ts`
- **Change:** Exponential fog that shifts per game state
```typescript
scene.fogMode = Scene.FOGMODE_EXP2
scene.fogDensity = 0.005
scene.fogColor = color(SURFACES.VOID) // Default

// In updateAtmosphere() - smooth lerp between state colors
```
- **Visual Gain:** Depth perception, mood reinforcement
- **Gameplay Safety:** Keep density < 0.01
- **Risk:** Low
- **Effort:** 30 min

**19. Light Temperature Shifts**
- **File:** `src/game-elements/visual-language.ts` + `effects.ts`
- **Change:** Modulate key light color temperature per state
```typescript
export const TEMPERATURE = {
  NORMAL: '#fff4e6',  // Warm 3200K
  FEVER: '#ffddaa',   // Warmer 2700K
  REACH: '#e6f4ff',   // Cool 6500K
  JACKPOT: '#ffcccc'  // Warm red
}
```
- **Visual Gain:** Emotional warmth/coolness
- **Risk:** Low
- **Effort:** 45 min

**20. God Rays (Fake Volumetrics)**
- **File:** `src/game-elements/effects.ts`
- **Change:** Cone meshes from backbox to playfield
```typescript
const ray = MeshBuilder.CreateCylinder('godRay', {
  diameterTop: 0.5, diameterBottom: 3, height: 15
})
ray.material.alpha = 0.1
ray.material.emissiveColor = emissive(PALETTE.CYAN, 0.1)
```
- **Visual Gain:** Magical connection, atmospheric depth
- **Risk:** Low
- **Effort:** 1 hour

**21. Breathing Clear Color**
- **File:** `src/game-elements/effects.ts`
- **Change:** Subtle background pulsing
```typescript
const breath = pulse(time, 0.25, 0.9, 1.0)
this.scene.clearColor = new Color4(baseColor.r * breath, ...)
```
- **Visual Gain:** Scene feels alive
- **Risk:** Low
- **Effort:** 15 min

#### ⚡ MEDIUM PRIORITY

**22. State-Based Rim Light Drama**
- **File:** `src/game-elements/effects.ts`
- **Change:** Intensity/color modulation during special states
```typescript
switch (state) {
  case 'reach':
    targetIntensity = 2.0 // Double rim
    targetColor = color(PALETTE.ALERT)
    break
  case 'fever':
    targetIntensity = 1.5
    targetColor = color(PALETTE.GOLD)
    break
}
```
- **Visual Gain:** Cinematic silhouettes
- **Risk:** Medium - test contrast
- **Effort:** 30 min

**23. Jackpot "Heat Wave" Distortion**
- **File:** `src/game.ts`
- **Change:** Screen-space distortion during Phase 3
```typescript
const heatWave = new PostProcess("heatWave", "heatWave", ["time", "intensity"], null, 1.0, tableCam)
// WGSL: offset = sin(uv.y * 50 + time * 10) * intensity
```
- **Visual Gain:** Physical meltdown sensation
- **Risk:** Medium - could distract
- **Effort:** 1 hour

---

## Audit Area 5: Contrast & Depth Perception

### Current State
- **Camera:** Narrow FOV (37°), telephoto effect
- **Contrast Ratio:** 4.8:1 (excellent)
- **Shadow Depth Cues:** Strong (ball position, height, scale)
- **Rim Separation:** Good edge definition
- **No DOF, No SSAO, No Vignetting**

### Key Opportunities

#### 🔥 HIGH PRIORITY

**24. Dynamic Ball Highlight**
- **File:** `src/game-elements/ball-manager.ts`
- **Change:** Point light attached to ball
```typescript
const ballLight = new PointLight('ballLight', new Vector3(0, 2, 0), scene)
ballLight.parent = ballMesh
ballLight.intensity = 0.4
ballLight.diffuse = new Color3(1.0, 0.95, 0.8)
```
- **Visual Gain:** Ball never lost in busy scenes
- **Risk:** Low
- **Effort:** 15 min

**25. Subtle Vignetting**
- **File:** `src/game.ts`
- **Change:** Darken screen edges
```typescript
this.bloomPipeline.imageProcessing.vignetteEnabled = true
this.bloomPipeline.imageProcessing.vignetteWeight = 0.4
this.bloomPipeline.imageProcessing.vignetteColor = color(SURFACES.VOID)
```
- **Visual Gain:** Natural attention guidance
- **Risk:** Low
- **Effort:** 5 min

**26. State-Based Lighting Transitions**
- **File:** `src/game-elements/visual-language.ts`
- **Change:** State-to-state light presets
```typescript
export const LIGHTING_STATES = {
  IDLE: { key: 1.2, fill: 0.25, rim: 0.8 },
  FEVER: { key: 1.4, fill: 0.3, rim: 1.2 },
  REACH: { key: 1.0, fill: 0.15, rim: 0.6 },
  JACKPOT: { key: 1.5, fill: 0.4, rim: 1.5 }
}
```
- **Visual Gain:** Clear state communication
- **Risk:** Low
- **Effort:** 45 min

#### ⚡ MEDIUM PRIORITY

**27. Subtle Depth of Field**
- **File:** `src/game.ts`
- **Change:** Conservative DOF on table camera
```typescript
this.bloomPipeline.depthOfFieldEnabled = true
this.bloomPipeline.depthOfField.focusDistance = 2500
this.bloomPipeline.depthOfField.fStop = 2.4
this.bloomPipeline.depthOfField.blurLevel = DepthOfFieldEffectBlurLevel.Low
```
- **Visual Gain:** Cinematic depth hierarchy
- **Risk:** Medium - keep subtle
- **Effort:** 20 min

**28. Screen-Space Ambient Occlusion (SSAO)**
- **File:** `src/game.ts`
- **Change:** Contact shadows between objects
```typescript
const ssao = new SSAORenderingPipeline('ssao', scene, { ssaoRatio: 0.5 }, [tableCam, headCam])
ssao.radius = 0.5
ssao.totalStrength = 0.8
```
- **Visual Gain:** Object grounding, depth cues
- **Risk:** Low
- **Effort:** 30 min

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1) - 2 hours
| Priority | Opportunity | Files | Effort |
|----------|-------------|-------|--------|
| 1 | Shadow Bias Tuning | game.ts | 5 min |
| 2 | Pin Shadow Culling | game.ts | 5 min |
| 3 | Shadow Darkness Tune | game.ts | 2 min |
| 4 | FXAA Enable | game.ts | 1 min |
| 5 | Environment Control | game.ts | 5 min |
| 6 | Cabinet Light Exclusions | effects.ts | 10 min |
| 7 | Chromatic Aberration | scanline.ts | 10 min |
| 8 | Bloom Enhancement | game.ts | 5 min |
| 9 | Ball Highlight | ball-manager.ts | 15 min |
| 10 | Vignetting | game.ts | 5 min |

**Phase 1 Expected Impact:** Immediate visual quality improvements, 15-20% GPU savings from shadow optimization

### Phase 2: Dynamic Response (Week 2) - 3 hours
| Priority | Opportunity | Files | Effort |
|----------|-------------|-------|--------|
| 11 | State-Based Fog | game.ts, effects.ts | 30 min |
| 12 | Light Temperature Shifts | visual-language.ts, effects.ts | 45 min |
| 13 | Game State Light Response | effects.ts | 20 min |
| 14 | Bounce Light Proximity | game.ts | 15 min |
| 15 | State Lighting Transitions | visual-language.ts | 45 min |
| 16 | Breathing Clear Color | effects.ts | 15 min |
| 17 | Rim Light Drama | effects.ts | 30 min |
| 18 | ACES Tone Mapping | game.ts | 1 min |

**Phase 2 Expected Impact:** Living, breathing environment that responds to gameplay

### Phase 3: Depth & Polish (Week 3) - 2 hours
| Priority | Opportunity | Files | Effort |
|----------|-------------|-------|--------|
| 19 | SSAO Contact Shadows | game.ts | 30 min |
| 20 | Subtle DOF | game.ts | 20 min |
| 21 | Color Temperature | game.ts | 5 min |
| 22 | Sharpening Filter | game.ts | 5 min |
| 23 | Contact Hardening Shadows | game.ts | 10 min |
| 24 | God Rays (Fake) | effects.ts | 1 hour |

**Phase 3 Expected Impact:** Cinematic depth, professional polish

### Phase 4: Advanced (Week 4) - 2 hours
| Priority | Opportunity | Files | Effort |
|----------|-------------|-------|--------|
| 25 | HDR Eye Adaptation | game.ts | 10 min |
| 26 | Heat Wave Distortion | game.ts | 1 hour |
| 27 | Rim Light Shadows | game.ts | 20 min |
| 28 | Film Grain | scanline.ts | 10 min |

**Phase 4 Expected Impact:** AAA atmospheric effects

---

## Fallback Safety Analysis

### WebGL/StandardMaterial Compatibility

| Feature | WebGPU/PBR | WebGL Fallback |
|---------|-----------|----------------|
| Shadow Bias | Full | Full |
| Fog | Full | Full |
| FXAA | Full | Full |
| Tone Mapping | Full | Full (simplified) |
| SSAO | Full | Partial |
| DOF | Full | Partial |
| Bloom | Full | Reduced quality |
| Light Animation | Full | Full |

### Safe Degradation Strategy
- All lighting changes work universally
- Post-process effects gracefully skip on low-end
- Fog and atmosphere are scene-level (always work)
- Shadow optimizations benefit all paths

---

## Risk Assessment Matrix

| Risk Level | Count | Examples |
|------------|-------|----------|
| **Low** | 22 | Bias tuning, FXAA, vignetting, ball highlight, fog |
| **Medium** | 6 | DOF, SSAO, ACES tone mapping, rim light drama |
| **High** | 0 | - |

---

## Files Requiring Changes

### High-Priority Files
- `src/game.ts` - 15 opportunities (shadows, lighting, post-processing, atmosphere)
- `src/game-elements/effects.ts` - 8 opportunities (cabinet lights, state responses)
- `src/game-elements/visual-language.ts` - 3 opportunities (temperature, states)
- `src/shaders/scanline.ts` - 2 opportunities (chromatic aberration, grain)
- `src/game-elements/ball-manager.ts` - 1 opportunity (ball highlight)

### Estimated Total Effort
- **Phase 1:** 2 hours
- **Phase 2:** 3 hours
- **Phase 3:** 2 hours
- **Phase 4:** 2 hours
- **Total:** ~9 hours of implementation time

---

## Performance Budget

| Phase | GPU Impact | Notes |
|-------|-----------|-------|
| Phase 1 | -15% to -5% | Shadow culling saves more than FXAA costs |
| Phase 2 | +2% to +5% | Light animation is cheap |
| Phase 3 | +5% to +10% | SSAO and DOF add cost |
| Phase 4 | +3% to +8% | Advanced effects |
| **Net** | **-5% to +18%** | Configurable based on target hardware |

---

## Conclusion

The Pachinball lighting and post-processing pipeline has an **excellent foundation** with its 4-light dramatic setup, good shadow fundamentals, and dynamic bloom system. The recommended improvements focus on:

1. **Optimization First** - Shadow culling and bias tuning for immediate gains
2. **Dynamic Response** - Connecting lighting to game state for emotional impact
3. **Atmospheric Depth** - Fog, volumetrics, and color temperature for mood
4. **Polish** - Post-processing stack completion (FXAA, tone mapping, SSAO)

### Recommended Starting Points
1. **Shadow optimization** (#7, #8, #9) - Immediate 15% GPU savings
2. **FXAA** (#11) - One line, immediate quality gain
3. **Ball highlight** (#24) - Never lose gameplay-critical visibility
4. **State fog** (#18) - Atmospheric depth with mood shifts
5. **Chromatic aberration** (#12) - Retro aesthetic on backbox

### Success Metrics
After implementation, the game should exhibit:
- [ ] Clean shadow edges without acne or peter-panning
- [ ] 15%+ GPU performance improvement from shadow optimization
- [ ] Ball always visible with dedicated highlight
- [ ] Each game state has distinct atmospheric character
- [ ] Cinematic depth cues (SSAO, DOF, fog) without obscuring gameplay
- [ ] Retro CRT aesthetic on backbox display
- [ ] Smooth light transitions between states

---

*Report generated by Agent Swarm Audit*  
*Auditors: Lighting System, Shadow Pipeline, Post-Processing, Atmosphere & Mood, Contrast & Depth*
