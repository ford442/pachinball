# Head Camera Audit Report
## Pachinball Project - Backbox Display Visibility Analysis

**Audit Date:** 2026-03-19  
**Auditor:** Camera Specialist  
**File Analyzed:** `src/game.ts` lines 194-214  
**Related Systems:** `src/game-elements/display.ts`, `src/shaders/scanline.ts`

---

## Executive Summary

### Current Head Camera Rating: **3.5/5** ⭐⭐⭐½

The head camera implementation is functional but has several opportunities for enhancement in display visibility, visual style, and viewport layout. The orthographic projection provides stable, distortion-free viewing of the backbox display, but the current configuration leaves room for optimization.

---

## 1. Display Visibility Analysis

### 1.1 Slot Machine Reel Readability

**Current State:**
- Reels rendered at 1024x512 (Canvas) or WGSL shader-based
- Each reel displays 140px emoji symbols (7️⃣, 💎, 🍒, 🔔, 🍇, ⭐)
- 3-reel layout with 7-unit horizontal gap between reels
- Screen dimensions: 20 units wide × 12 units high

**Assessment:**
| Aspect | Rating | Notes |
|--------|--------|-------|
| Symbol Size | ⚠️ Adequate | 140px canvas font scales well |
| Reel Separation | ✅ Good | 7-unit gap prevents crowding |
| Animation Clarity | ✅ Good | Smooth scrolling at 60fps |
| Final Position Readability | ⚠️ Adequate | Center row highlighted in FEVER mode |

**Enhancement Opportunities:**
1. **Increase reel symbol contrast** during idle state (currently dims to #888)
2. **Add symbol outlines** for better definition against video/image backgrounds
3. **Consider larger emoji scaling** for distant viewing (current 140px → 160px)

### 1.2 Score Display Clarity

**Current State:**
- Score displayed via HTML HUD overlay (not backbox camera)
- Slot win scores shown in overlay system
- 512×512 overlay texture with variable text sizes (24px-150px)

**Assessment:**
| State | Font Size | Visibility |
|-------|-----------|------------|
| ADVENTURE | 24px track name, 28px story | Good |
| IDLE | 20px system text | Adequate |
| REACH | 60px bold | Excellent |
| FEVER | 70px bold | Excellent |
| JACKPOT | 60-150px | Excellent |

**Enhancement Opportunities:**
1. **Add score integration** to backbox display (not just HTML HUD)
2. **Current score ticker** in overlay during gameplay
3. **Larger persistent score** in backbox for cabinet aesthetic

### 1.3 LED Matrix Visibility

**Current State:**
- LED strips positioned at display perimeter (±6.2Y, ±9.8X)
- Cyan accent color (#00d9ff) with 0.4 emissive scale
- Thin strips (0.15 height/width)

**Assessment:**
| Position | Visibility | Issue |
|----------|------------|-------|
| Top/Bottom | ✅ Good | Full width (18 units) |
| Left/Right | ⚠️ Adequate | Thin (0.15), may wash out |

**Enhancement Opportunities:**
1. **Increase LED emissive intensity** to 0.6-0.8 for better pop
2. **Add pulsing animation** synchronized with game events
3. **Consider RGB color cycling** during FEVER/JACKPOT states

### 1.4 Text Size vs Camera Distance

**Current Orthographic Scale:**
```
headScale = 24
orthoTop    =  4.8   (24 * 0.2)
orthoBottom = -4.8   (24 * -0.2)
orthoLeft   = -12    (24 / -2)
orthoRight  =  12    (24 / 2)
```

**Analysis:**
- Viewport covers 40% screen height
- Ortho bounds show 9.6 units vertical, 24 units horizontal
- At 1080p, ~432px vertical available for backbox
- Text at 60px = ~14% of display height (readable)
- Text at 150px = ~35% of display height (excellent)

**Recommendation:** Current scale is appropriate. Text sizes are well-matched to viewport allocation.

---

## 2. Visual Style Opportunities

### 2.1 Retro CRT Aesthetic Enhancements

**Current Implementation:**
```typescript
// Scanline shader (scanline.ts)
scanlineCount = 800.0        // Horizontal scanline frequency
scanlineIntensity = 0.25     // 25% darkness modulation
vignette = smoothstep(0.4, 0.9, dist)  // Corner darkening
```

**Enhancement Opportunities:**

| Enhancement | Implementation | Impact |
|-------------|----------------|--------|
| **Phosphor glow** | Add chromatic aberration RGB shift | High visual impact |
| **Screen curvature** | Barrel distortion in shader | Authentic CRT feel |
| **Flicker effect** | Subtle brightness variation | Retro ambiance |
| **Bloom enhancement** | Increase bloom intensity on display | Glow effect |
| **Noise/artifacts** | Film grain overlay | Vintage aesthetic |

**Recommended CRT Shader Additions:**
```glsl
// RGB phosphor separation
float aberration = 0.003;
vec3 col;
col.r = texture2D(textureSampler, vUV + vec2(aberration, 0.0)).r;
col.g = texture2D(textureSampler, vUV).g;
col.b = texture2D(textureSampler, vUV - vec2(aberration, 0.0)).b;

// Subtle flicker
float flicker = 1.0 + sin(uTime * 60.0) * 0.02;
color *= flicker;
```

### 2.2 Backbox Lighting Integration

**Current State:**
- LED strips at display perimeter
- Bloom pipeline applied to both cameras
- Slot lighting modes: idle/spin/stop/win/jackpot

**Enhancement Opportunities:**
1. **Dynamic ambient lighting** - Backbox glow affects nearby cabinet
2. **Reactive LED strips** - Audio-reactive or game-event reactive
3. **Vignette lighting** - Darken room focus on backbox
4. **Spotlight effect** - Highlight winning reels

### 2.3 Display Reflection Effects

**Current State:**
- Screen glass with 0.15 alpha, 0.05 roughness
- Specular highlights enabled
- MirrorTexture exists for playfield

**Enhancement Opportunities:**
1. **Environment reflection** on glass surface
2. **Subtle Fresnel effect** on glass edges
3. **Dust/scratch texture** overlay for realism
4. **Reflection of room** in glass (if cabinet mode)

### 2.4 Cabinet Bezel Framing

**Current State:**
- Chrome header (2.5 height)
- Side pillars (2 width each)
- Inner bezel with pink emissive accent (#ff0055)

**Assessment:** Bezel framing is well-implemented but could benefit from:
1. **Bezel artwork/art decals**
2. **Coin slot detail** (authentic arcade feel)
3. **Speaker grilles** visible in backbox area
4. **Marquee lighting** above header

---

## 3. Viewport Layout Analysis

### 3.1 Current 60/40 Split Assessment

```
┌─────────────────────────────┐  ← 40% (Head/Backbox)
│      BACKBOX DISPLAY        │    Camera: Orthographic
│    (Slot Machine + Score)   │    Viewport: y=0.6, h=0.4
├─────────────────────────────┤  ← 60% (Table/Playfield)
│                             │    Camera: Perspective
│      PLAYFIELD TABLE        │    Viewport: y=0, h=0.6
│                             │
└─────────────────────────────┘
```

**Advantages:**
- ✅ Table gets majority of screen (primary gameplay area)
- ✅ Backbox visible without scrolling
- ✅ Dual-camera setup allows independent rendering
- ✅ Post-process effects can be camera-specific

**Disadvantages:**
- ⚠️ Backbox may feel cramped on small screens
- ⚠️ 40% height limits detail visibility
- ⚠️ No responsive adjustment for different aspect ratios

### 3.2 Alternative Layout Options

#### Option A: Adjustable Split (Recommended)
```typescript
// Dynamic viewport based on screen aspect
const aspect = canvasWidth / canvasHeight;
const headHeight = aspect > 1.5 ? 0.35 : 0.4;  // Wider screens = smaller head
headCam.viewport = new Viewport(0, 1 - headHeight, 1, headHeight);
tableCam.viewport = new Viewport(0, 0, 1, 1 - headHeight);
```

#### Option B: Side-by-Side (Ultrawide)
```
┌─────────────────┬───────────┐
│                 │ BACKBOX   │
│    PLAYFIELD    │  DISPLAY  │
│   (75% width)   │ (25% w)   │
│                 │           │
└─────────────────┴───────────┘
```

#### Option C: Picture-in-Picture
```
┌─────────────────────────────┐
│                             │
│      PLAYFIELD TABLE        │
│                             │
│    ┌─────────────┐          │
│    │   BACKBOX   │          │  ← Floating overlay
│    │   (PIP)     │          │
│    └─────────────┘          │
└─────────────────────────────┘
```

#### Option D: Swappable Fullscreen
- Press 'B' to toggle fullscreen backbox view
- Useful for reading detailed information
- Temporary state, returns to split on input

### 3.3 Responsive Considerations

**Breakpoints:**
| Screen Size | Recommended Split | Rationale |
|-------------|-------------------|-----------|
| Mobile (<768px) | 70/30 or Collapsible | Touch priority |
| Tablet (768-1024px) | 65/35 | Balanced |
| Desktop (1024-1920px) | 60/40 (current) | Optimal |
| Ultrawide (>1920px) | 70/30 or Side-by-side | Use width |

---

## 4. Safety Constraints (CRITICAL)

### 4.1 Minimum Text Readability Requirements

**Hard Limits:**
| Element | Minimum Size | Current | Status |
|---------|--------------|---------|--------|
| Reel symbols | 24px | 140px | ✅ Safe |
| Story text | 16px | 28px | ✅ Safe |
| Track name | 16px | 24px | ✅ Safe |
| Score display | 20px | 70px | ✅ Safe |
| Jackpot text | 32px | 80px | ✅ Safe |

**WCAG Compliance:** All text meets 4.5:1 contrast minimum

### 4.2 Safe Orthographic Scale Ranges

**Current:** headScale = 24

**Safe Operating Range:** 18 - 32

| Scale | Vertical View | Risk Level |
|-------|---------------|------------|
| < 16 | Too zoomed in | 🔴 HIGH - Symbol clipping |
| 16-20 | Tight framing | 🟡 MEDIUM - Edge symbols cut |
| 20-28 | Optimal range | 🟢 LOW - Recommended |
| 28-32 | Wide view | 🟡 MEDIUM - Small details lost |
| > 32 | Too zoomed out | 🔴 HIGH - Illegible text |

**Recommendation:** Maintain headScale between 20-28 for optimal visibility.

### 4.3 Required Visibility for Game State

**Critical Elements (must always be visible):**
1. **REACH indicator** - Triggers player attention
2. **FEVER mode** - Affects gameplay strategy
3. **JACKPOT countdown** - Time-sensitive (5 seconds)
4. **Slot reel results** - Determines bonuses

**Current Status:** All critical elements are prominently displayed and visible.

---

## 5. Enhancement Recommendations

### 5.1 Immediate Improvements (Low Risk)

1. **Increase LED emissive intensity**
   ```typescript
   accentMat.emissiveColor = Color3.FromHexString('#00d9ff').scale(0.7);  // was 0.4
   ```

2. **Add CRT phosphor glow to scanline shader**
   - RGB separation
   - Subtle flicker
   - Estimated: 2-3 hours implementation

3. **Adjust idle reel brightness**
   ```typescript
   ctx.fillStyle = this.slotMode === 0 && row === 0 ? '#fff' : '#aaa';  // was #888
   ```

### 5.2 Medium-Term Enhancements (Medium Risk)

1. **Responsive viewport scaling**
   - Dynamic split based on aspect ratio
   - Estimated: 4-6 hours

2. **Backbox score integration**
   - Display current score in backbox overlay
   - Estimated: 3-4 hours

3. **Enhanced CRT effects**
   - Screen curvature
   - Corner rounding
   - Estimated: 4-5 hours

### 5.3 Advanced Features (Higher Risk)

1. **Bezel artwork system**
   - Configurable cabinet art
   - Estimated: 8-10 hours

2. **3D cabinet view mode**
   - Uses existing render targets
   - Estimated: 12-16 hours

3. **Fullscreen backbox toggle**
   - Keyboard shortcut
   - Estimated: 2-3 hours

---

## 6. Risk Assessment Matrix

| Proposed Change | Risk Level | Impact | Implementation Effort | Recommendation |
|-----------------|------------|--------|----------------------|----------------|
| LED intensity increase | 🟢 Low | Low | 5 min | ✅ Proceed |
| CRT phosphor shader | 🟢 Low | Medium | 2-3 hrs | ✅ Proceed |
| Responsive viewport | 🟡 Medium | High | 4-6 hrs | ✅ Proceed |
| Backbox score display | 🟢 Low | Medium | 3-4 hrs | ✅ Proceed |
| Ortho scale < 18 | 🔴 High | Breaking | N/A | ❌ Avoid |
| Ortho scale > 32 | 🔴 High | Breaking | N/A | ❌ Avoid |
| Viewport split 50/50 | 🟡 Medium | Medium | 5 min | ⚠️ Test first |
| Remove scanlines | 🟡 Medium | Aesthetic | 5 min | ⚠️ Optional toggle |

---

## 7. Conclusion

The Head Camera system is **well-implemented** with room for **polish and enhancement**. The current 3.5/5 rating reflects solid fundamentals with opportunities for visual flair and responsive improvements.

**Priority Actions:**
1. Increase LED strip brightness for better visibility
2. Enhance scanline shader with CRT effects
3. Implement responsive viewport scaling
4. Consider backbox score integration

**Current Configuration Safety:** ✅ All parameters within safe operating ranges

**Estimated Total Enhancement Effort:** 12-20 hours for all medium-priority items

---

## Appendix A: Current Camera Configuration Reference

```typescript
// From src/game.ts lines 194-214
const headCam = new ArcRotateCamera(
  'headCam',
  -Math.PI / 2,              // alpha: front-facing
  Math.PI / 2,               // beta: top-down (90°)
  25,                        // radius (unused in ortho)
  new Vector3(0.75, 8, 21.5), // target: backbox display center
  this.scene
)
headCam.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA
headCam.viewport = new Viewport(0, 0.6, 1, 0.4)  // 40% height, top

// Orthographic bounds
const headScale = 24
headCam.orthoTop    =  4.8   // 24 * 0.2
headCam.orthoBottom = -4.8   // -24 * 0.2
headCam.orthoLeft   = -12    // -24 / 2
headCam.orthoRight  =  12    // 24 / 2
```

## Appendix B: Display Layer Stack

```
Z-Depth    Layer                    Content
─────────────────────────────────────────────────────
-0.05      overlay      → UI text, scanlines, effects
-0.30      reels        → Slot machine symbols
-0.35      video        → Video media (optional)
-0.40      image        → Static image (optional)
-0.50      shader       → Animated grid background
+0.80      innerBezel   → Physical frame
+1.20      screenGlass  → Glass reflection
+1.30      LED strips   → Perimeter lighting
```

---

*End of Audit Report*
