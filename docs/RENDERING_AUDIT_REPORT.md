# Rendering & Shader Pipeline Audit Report

**Pachinball** - Babylon.js Pinball Game
**Audit Date:** 2026-03-19
**Last Updated:** 2026-05-08
**Scope:** Rendering pipeline, shaders, geometry, materials, post-processing, and display systems

---

## Status as of May 2026

**Architecture Changes Since March 2026:**
- **Display system** was split from monolithic `src/game-elements/display.ts` into `src/display/` (display-core.ts, display-reels.ts, display-shader.ts, display-video.ts, display-image.ts).
- **Effects system** moved from `src/game-elements/effects.ts` to `src/effects/` (effects-core.ts, effects-particles.ts, effects-trails.ts, effects-lighting.ts, effects-camera.ts).
- **Materials** moved from `src/game-elements/material-library.ts` to `src/materials/` (material-core.ts, material-ball.ts, material-metallic.ts, material-interactive.ts, material-structural.ts).
- **Game objects** moved from `src/game-elements/game-objects.ts` to `src/objects/` (object-core.ts, object-flippers.ts, object-bumpers.ts, object-walls.ts, object-rails.ts, object-pachinko.ts, object-decoration.ts).
- **EventBus** introduced (May 2026) — display/effects/audio state changes are now event-driven.

**Implemented Since Audit:**
- ✅ Ball Motion Trails (`src/effects/effects-trails.ts`)
- ✅ Enhanced Shard Particles (`src/effects/effects-particles.ts`)
- ✅ Bumper Emissive Pulse / Neon Rings (`src/objects/object-bumpers.ts`)
- ✅ Brushed Metal Anisotropy (`src/materials/material-metallic.ts`)
- ✅ Playfield Fog (`src/game.ts` — `GameConfig.visuals.fogDensity`)
- ✅ Clear Coat / Iridescence (`src/materials/material-ball.ts`, gated by `QualityTier`)
- ✅ Quality Tiering (`detectQualityTier()`, used across materials, effects, trails)

---

## Executive Summary

This audit identifies **35+ opportunities** to safely enhance perceived geometric richness, motion detail, and visual depth across the Pachinball rendering pipeline. All recommendations respect the existing dual-path architecture (WebGPU/WGSL → WebGL/Canvas fallback) and maintain gameplay readability.

### Key Metrics
| Category | Current | Potential Improvement |
|----------|---------|----------------------|
| Shader Effects | 4 | 10+ |
| PBR Features | 3 | 8+ |
| Procedural Textures | 1 | 5+ |
| Animated Materials | 0 | 3+ |
| Post-Process Stack | 2 | 6+ |

### Top 10 Safest, Highest-Impact Improvements
1. **Cyber Grid Atmospheric Glow** - Add flowing data particles, vignette (`src/display/display-shader.ts`)
2. **Ball Motion Trails** - TrailMesh following ball trajectory (`src/effects/effects-trails.ts`) — ✅ **IMPLEMENTED**
3. **Enhanced Canvas Fallback** - Gradient symbols, glow effects for non-WebGPU users (`src/display/display-reels.ts`)
4. **CRT Scanline Enhancement** - Temporal flicker, chromatic aberration (`src/shaders/scanline.ts`)
5. **Pin Collar Details** - Small rings at pin bases for manufacturing detail (`src/objects/object-pachinko.ts`)
6. **Bumper Emissive Pulse** - Idle animation for "alive" feel (`src/objects/object-bumpers.ts`) — ✅ **IMPLEMENTED**
7. **Playfield Normal Map** - Procedural surface imperfections (`src/materials/material-structural.ts`)
8. **Parallax Display Layers** - Subtle Z-axis breathing per layer (`src/display/display-core.ts`)
9. **Enhanced Shard Particles** - Textured, rotating debris (`src/effects/effects-particles.ts`) — ✅ **IMPLEMENTED**
10. **Flipper Detail Enhancement** - Grip texture, raised edge rails (`src/objects/object-flippers.ts`)

---

## Audit Area 1: Shader Pipeline

### Current State
- **Dual Path:** WebGPU (WGSL) preferred → WebGL (GLSL/Canvas2D) fallback
- **Shaders:** 4 active (scanline, numberScroll, jackpotOverlay, cyber grid)
- **Post-Process:** Bloom + tone mapping + scanlines (head camera only)

### Key Opportunities

#### 🔥 HIGH PRIORITY

**1. Enhanced CRT Scanlines with Temporal Flicker**
- **File:** `src/shaders/scanline.ts`
- **Change:** Add subtle brightness flicker + chromatic aberration at edges
- **Visual Gain:** Motion detail (flicker) + geometric richness (chromatic separation)
- **Risk:** Low - GLSL only, head-cam exclusive
- **Effort:** 20 min

**2. Parallax Depth for Slot Reels (WGSL)**
- **File:** `src/shaders/numberScroll.ts`
- **Change:** Add cylinder curve + parallax offset per reel in vertex shader
- **Visual Gain:** Geometric richness (3D curvature) + visual depth
- **Risk:** Low - Canvas fallback unchanged
- **Effort:** 25 min

**3. Atmospheric Glow on Cyber Grid Background**
- **File:** `src/display/display-shader.ts` (createShaderLayer)
- **Change:** Add data flow particles, vignette darkening, circuit traces
- **Visual Gain:** Motion detail (flowing particles) + visual depth (vignette)
- **Risk:** Low - GLSL only, same shader runs both paths
- **Effort:** 30 min

---

## Audit Area 2: Geometry & Meshes

### Current State
- **All procedural** - no external model dependencies
- **~3,500 vertices** total (very lightweight)
- **Primitives:** Box, Sphere, Cylinder, Tube, Torus
- **Shadow-casting enabled** for gameplay depth cues

### Key Opportunities

#### 🔥 HIGH PRIORITY

**4. Pin Collar Details**
- **File:** `src/objects/object-pachinko.ts` (createPachinkoField)
- **Change:** Add small collar rings at pin bases
```typescript
const collar = MeshBuilder.CreateCylinder(`pinCollar_${r}_${c}`, { 
  diameter: 0.35, height: 0.1, tessellation: 12 
}, this.scene)
collar.position.set(x, 0.1, z)
```
- **Visual Gain:** Manufacturing detail, better light catching
- **Risk:** Low - purely decorative (+48 low-poly cylinders)
- **Effort:** 15 min

**5. Beveled Cabinet Edges**
- **File:** `src/game.ts` (createEnhancedCabinet via `GameCabinetBuilder`)
- **Change:** Add thin chrome bevel strips at key cabinet edges
- **Visual Gain:** Catches rim light, defines silhouette, professional finish
- **Risk:** Low - purely visual (+6 thin boxes)
- **Effort:** 20 min

**6. Flipper Detail Enhancement**
- **File:** `src/objects/object-flippers.ts` (createFlippers)
- **Change:** Add segmented grip texture and raised edge rail
- **Visual Gain:** Better ball control visualization, mechanical authenticity
- **Risk:** Low - decorative only, no physics change
- **Effort:** 20 min

#### ⚡ MEDIUM PRIORITY

**7. Bumper Ring Grooves**
- **File:** `src/objects/object-bumpers.ts` (createBumpers)
- **Change:** Add concentric torus rings for classic bumper aesthetic
- **Visual Gain:** Classic pinball look, better specular highlights
- **Risk:** Low - visual only (+9 tori)
- **Effort:** 25 min

---

## Audit Area 3: Post-Processing & Effects

### Current State
- **Bloom:** DefaultRenderingPipeline (kernel=48, weight=0.25)
- **Tone Mapping:** Reinhard with contrast 1.1
- **Shadows:** 2048px blur exponential
- **Particles:** CPU-driven mesh shards (basic boxes)
- **Trails:** ✅ TrailMesh system with velocity-proportional emit rate (`src/effects/effects-trails.ts`)

### Key Opportunities

#### 🔥 HIGH PRIORITY

**8. Ball Motion Trails**
- **File:** `src/effects/effects-trails.ts`
- **Status:** ✅ **IMPLEMENTED** — TrailMesh following ball with fading opacity, gated by `QualityTier.LOW`
- **Visual Gain:** Perceived speed, trajectory readability
- **Risk:** Low

**9. Enhanced Shard Particles**
- **File:** `src/effects/effects-particles.ts` (spawnShardBurst)
- **Status:** ✅ **IMPLEMENTED** — Textured, rotating debris with variable size
- **Visual Gain:** Richness, energy, visual clarity of impacts
- **Risk:** Low

**10. Bumper Burst Effects**
- **File:** `src/effects/effects-core.ts`
- **Change:** Add expanding ring + bloom flash on bumper hits
- **Visual Gain:** Feedback clarity, energy, satisfaction
- **Risk:** Low - event-triggered, short duration
- **Effort:** 1 hour

#### ⚡ MEDIUM PRIORITY

**11. Chromatic Aberration (Head Camera)**
- **File:** `src/game.ts` (post-process section via `GameRenderer`)
- **Change:** Add RGB channel separation at screen edges
- **Visual Gain:** Visual depth, retro CRT aesthetic
- **Risk:** Low - single pass, simple offset
- **Effort:** 30 min

**12. Subtle Playfield Fog**
- **File:** `src/game.ts` (lighting setup via `GameRenderer`)
- **Status:** ✅ **IMPLEMENTED** — `GameConfig.visuals.fogDensity` with `reducedMotion` gating
- **Visual Gain:** Depth perception, atmospheric immersion
- **Risk:** Medium - must not obscure gameplay

---

## Audit Area 4: Materials & PBR

### Current State
- **83% PBR adoption** (20 PBR vs 4 Standard materials)
- **Environment map** support with intensity 0.6
- **Clear coat** used strategically (pins, playfield, glass, ball)
- **Material caching** prevents duplicate creation
- **Advanced PBR:** ✅ Anisotropy, sheen, iridescence, clear-coat gated by `QualityTier`

### Key Opportunities

#### 🔥 HIGH PRIORITY

**13. Playfield Normal Map**
- **File:** `src/materials/material-structural.ts`
- **Change:** Add procedural normal map for surface imperfections
```typescript
private createPlayfieldNormalTexture(): DynamicTexture {
  // Perlin-like noise for subtle surface variation
  // Applied with low intensity (0.3)
}
```
- **Visual Gain:** Geometric richness without geometry cost
- **Risk:** Low - additive, bumpTexture ignored on StandardMaterial
- **Effort:** 15 min

**14. Glass Refraction Enhancement**
- **File:** `src/materials/material-structural.ts` (getSmokedGlassMaterial)
- **Change:** Enable subsurface refraction for realistic glass
```typescript
mat.subSurface.isRefractionEnabled = true
mat.subSurface.refractionIntensity = 0.8
```
- **Visual Gain:** Visual depth - objects behind glass appear distorted
- **Risk:** Low - gracefully degrades on StandardMaterial
- **Effort:** 6 lines

**15. Bumper Emissive Pulse Animation**
- **File:** `src/objects/object-bumpers.ts` (updateBumpers)
- **Status:** ✅ **IMPLEMENTED** — Neon rings with pulse animation on `QualityTier.HIGH`
- **Visual Gain:** Motion detail - energetic even when idle
- **Risk:** Low

#### ⚡ MEDIUM PRIORITY

**16. Brushed Metal Anisotropy**
- **File:** `src/materials/material-metallic.ts` (getBrushedMetalMaterial)
- **Status:** ✅ **IMPLEMENTED** — Anisotropic reflections for brushed appearance
- **Visual Gain:** Geometric richness - elongated highlights
- **Risk:** Low

**17. Hologram Fresnel/Rim Effect**
- **File:** `src/materials/material-interactive.ts` (getHologramMaterial)
- **Change:** Add fresnel-based rim lighting for "projected" look
```typescript
mat.emissiveFresnel = true
mat.emissiveFresnelParameters.bias = 0.2
mat.emissiveFresnelParameters.power = 2.0
```
- **Visual Gain:** Visual depth - stronger edges, disappears at glancing angles
- **Risk:** Medium - requires material type change (Standard → PBR)
- **Effort:** 10 lines

---

## Audit Area 5: Display System

### Current State
- **5-layer architecture:** reels → shader grid → video → image → overlay
- **Dual path:** WGSL shaders (WebGPU) or Canvas2D fallback
- **Display states:** IDLE, REACH, FEVER, JACKPOT, ADVENTURE
- **Jackpot shader:** 3-phase effects (Breach, Error, Meltdown)
- **Event-driven:** `DisplaySystem.subscribeToEvents()` reacts to `display:set` events via `EventBus`

### Key Opportunities

#### 🔥 HIGH PRIORITY

**18. Enhanced Canvas Fallback Rendering**
- **File:** `src/display/display-reels.ts` (drawSlots)
- **Change:** Add gradient fills, glow effects, symbol backgrounds
```typescript
// Gradient background for symbol
const grad = ctx.createRadialGradient(x, y, 0, x, y, 80)
grad.addColorStop(0, isWinning ? '#ffaa00' : '#333')
grad.addColorStop(1, isWinning ? '#ff4400' : '#000')
```
- **Visual Gain:** Makes Canvas fallback feel premium despite no WGSL
- **Risk:** Low - this IS the fallback, purely additive
- **Effort:** 30 min

**19. Parallax Depth Layering**
- **File:** `src/display/display-core.ts` (update)
- **Change:** Add subtle Z-axis animation based on game state intensity
```typescript
// Layer 0 (Reels) - subtle breathing
this.layers.reels.position.z = this.baseZ.reels + Math.sin(time * 2) * 0.05 * intensity
```
- **Visual Gain:** Visual depth - display feels alive and 3D
- **Risk:** Low - simple position offsets
- **Effort:** 15 min

**20. Richer State Overlay Effects**
- **File:** `src/display/display-core.ts` (drawReachOverlay, drawFeverOverlay, etc.)
- **Change:** Add animated borders, gradient text, corner accents
```typescript
// Animated hexagon frame
const pulse = (Math.sin(time * 8) + 1) / 2
ctx.strokeStyle = `rgba(255, 0, 85, ${0.5 + pulse * 0.5})`
```
- **Visual Gain:** Geometric richness - each state visually distinct
- **Risk:** Low - drawing code additions only
- **Effort:** 1 hour

#### ⚡ MEDIUM PRIORITY

**21. Reel Stop "Bounce" Physics**
- **File:** `src/display/display-shader.ts` (updateWGSLReels)
- **Change:** Add overshoot and elastic settle for mechanical feel
```typescript
// Spring physics for satisfying settle
const springK = 150
const damping = 12
const accel = diff * springK - this.reelVelocity[i] * damping
```
- **Visual Gain:** Motion detail - mechanical satisfaction
- **Risk:** Low - physics tweak, no structural changes
- **Effort:** 30 min

**22. Particle Burst Integration**
- **File:** `src/display/display-core.ts`
- **Change:** Add Canvas-based particle bursts for wins, state changes
```typescript
interface DisplayParticle { x, y, vx, vy, life, color, size }
// Spawn on win events, update in draw loop
```
- **Visual Gain:** Motion detail - celebration effects
- **Risk:** Medium - new system to maintain
- **Effort:** 1 hour

---

## Implementation Roadmap

### Phase 1: Immediate Wins (Week 1)
| Priority | Opportunity | File | Effort | Status |
|----------|-------------|------|--------|--------|
| 1 | Enhanced Canvas Fallback | display-reels.ts | 30 min | Open |
| 2 | Atmospheric Grid Glow | display-shader.ts | 30 min | Open |
| 3 | Pin Collar Details | object-pachinko.ts | 15 min | Open |
| 4 | Beveled Cabinet Edges | cabinet-builder.ts | 20 min | Open |
| 5 | CRT Scanline Enhancement | scanline.ts | 20 min | Open |

**Phase 1 Expected Impact:** Visual polish for all users, especially Canvas fallback (~30-50% of users)

### Phase 2: Motion & Feedback (Week 2)
| Priority | Opportunity | File | Effort | Status |
|----------|-------------|------|--------|--------|
| 6 | Ball Motion Trails | effects-trails.ts | 30 min | ✅ Done |
| 7 | Enhanced Shard Particles | effects-particles.ts | 45 min | ✅ Done |
| 8 | Bumper Burst Effects | effects-core.ts | 1 hr | Open |
| 9 | Bumper Emissive Pulse | object-bumpers.ts | 15 min | ✅ Done |
| 10 | Reel Stop Bounce | display-shader.ts | 30 min | Open |

**Phase 2 Expected Impact:** Better gameplay feedback, perceived speed, and interactivity

### Phase 3: Depth & Richness (Week 3)
| Priority | Opportunity | File | Effort | Status |
|----------|-------------|------|--------|--------|
| 11 | Playfield Normal Map | material-structural.ts | 15 min | Open |
| 12 | Parallax Display Layers | display-core.ts | 15 min | Open |
| 13 | Glass Refraction | material-structural.ts | 10 min | Open |
| 14 | Flipper Detail Enhancement | object-flippers.ts | 20 min | Open |
| 15 | Chromatic Aberration | game.ts (GameRenderer) | 30 min | Open |

**Phase 3 Expected Impact:** Geometric richness, visual depth, premium feel

### Phase 4: Advanced Features (Week 4)
| Priority | Opportunity | File | Effort | Status |
|----------|-------------|------|--------|--------|
| 16 | Brushed Metal Anisotropy | material-metallic.ts | 10 min | ✅ Done |
| 17 | Hologram Fresnel | material-interactive.ts | 15 min | Open |
| 18 | Playfield Fog | game.ts (GameRenderer) | 20 min | ✅ Done |
| 19 | Particle Display Bursts | display-core.ts | 1 hr | Open |
| 20 | State Overlay Polish | display-core.ts | 1 hr | Open |

**Phase 4 Expected Impact:** Professional polish, distinct visual identity per state

---

## Fallback Safety Analysis

### WebGPU → WebGL Degradation Path

| Feature | WebGPU | WebGL Fallback |
|---------|--------|----------------|
| WGSL Shaders | Full effects | Canvas2D or GLSL equivalent |
| Motion Blur | Shader-based | Simplified or disabled |
| HDR Bloom | Full intensity | Reduced threshold |
| PBR Materials | All features | StandardMaterial subset |

### Canvas Fallback Strategy

The Canvas fallback (for browsers without WebGPU) benefits from:
1. Enhanced symbol rendering with gradients and glow
2. Parallax depth via position animations
3. Richer overlay effects (hexagon frames, pulsing borders)
4. Particle bursts for celebrations

**Key Principle:** Canvas users get *richer* 2D effects to compensate for lack of 3D shaders.

---

## Risk Assessment Matrix

| Risk Level | Count | Examples |
|------------|-------|----------|
| **Low** | 28 | Pin collars, cabinet bevels, bloom trails, Canvas enhancements |
| **Medium** | 7 | Fog (gameplay visibility), particle systems (performance), hologram material type change |
| **High** | 0 | - |

---

## Files Requiring Changes

### High-Priority Files (Phase 1-2)
- `src/display/display-core.ts` - 8 opportunities
- `src/display/display-reels.ts` - 3 opportunities
- `src/display/display-shader.ts` - 3 opportunities
- `src/effects/effects-core.ts` - 5 opportunities
- `src/effects/effects-particles.ts` - 1 opportunity (done)
- `src/effects/effects-trails.ts` - 1 opportunity (done)
- `src/objects/object-core.ts` - 2 opportunities
- `src/objects/object-pachinko.ts` - 1 opportunity
- `src/objects/object-bumpers.ts` - 2 opportunities (1 done)
- `src/objects/object-flippers.ts` - 1 opportunity
- `src/materials/material-structural.ts` - 3 opportunities
- `src/materials/material-metallic.ts` - 1 opportunity (done)
- `src/materials/material-interactive.ts` - 1 opportunity
- `src/game.ts` / `src/game/game-renderer.ts` - 3 opportunities (1 done)
- `src/shaders/scanline.ts` - 2 opportunities

### Estimated Total Effort
- **Phase 1:** 2 hours
- **Phase 2:** 3 hours (1.5 hr remaining)
- **Phase 3:** 2 hours
- **Phase 4:** 3 hours (1.5 hr remaining)
- **Total:** ~10 hours of implementation time (~6 hours remaining)

---

## Conclusion

The Pachinball rendering pipeline has a **solid foundation** with good architectural separation and fallback handling. The recommended improvements are **additive and safe** - they enhance visual quality without breaking existing functionality or gameplay readability.

### Recommended Starting Points
1. **Enhanced Canvas Fallback** (O1) - Immediately improves experience for ~30-50% of users
2. **Atmospheric Grid Glow** (O3) - Isolated change with immediate visual impact
3. **Ball Motion Trails** (O8) - High gameplay value, low risk — ✅ Done
4. **Pin Collar Details** (O4) - Instant manufacturing detail across 48 instances

### Success Metrics
After implementation, the game should exhibit:
- [x] Ball trajectory is readable via motion trails
- [x] Bumpers pulse with life even when idle
- [x] PBR surfaces show anisotropic highlight detail
- [ ] Canvas fallback users see rich symbol rendering with glow
- [ ] Cabinet catches light on beveled edges
- [ ] State transitions feel distinct and polished
- [ ] PBR surfaces show subtle normal map detail
- [ ] Display layers have subtle parallax depth

---

*Report generated by Agent Swarm Audit*  
*Updated 2026-05-08 to reflect current file structure and implemented features*
