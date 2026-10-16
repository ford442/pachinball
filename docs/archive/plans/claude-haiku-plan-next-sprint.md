# Claude Haiku Plan — Pachinball Next Sprint (May 2026)

**Repo**: https://github.com/ford442/pachinball  
**Goal**: Execute the "Next Sprint Ideas" with focus on modern screen polish and performance  
**Style**: Optimized for Claude Haiku (fast, precise, high-quality single-pass work)

---

## Project Context

The project is in excellent shape:
- All backlog items cleared
- Strong architecture (EventBus, QualityTier system, EffectsSystem)
- 51 passing Vitest tests
- Visually polished (parallax layers, reel physics, hologram effects already implemented)

---

## Sprint Priorities (Recommended Order)

### Priority 1: Modern Screen Enhancement (Recommended Starting Point)
**Goal**: Make the backbox/display look like a high-end modern LCD/OLED screen instead of retro CRT.

**Focus Areas**:
- Subtle modern scanlines or grid (soft, not harsh)
- Gentle glow / bloom on bright elements
- Improved contrast and color vibrancy
- Slight anti-aliasing / sharpening if needed
- Keep it performant and tasteful

**Suggested Files**:
- `src/shaders/scanline.ts` (rename or extend if needed)
- `src/display/display-core.ts`
- `src/effects/effects-core.ts`

**Success Criteria**:
- Screen looks premium and modern
- No performance regression
- Works well across QualityTiers

---

### Priority 2: Performance Profiling
**Goal**: Add basic but useful performance visibility.

**Tasks**:
- Add simple FPS + frame time tracking
- Profile physics step timing vs render time
- Create a lightweight debug overlay (toggleable)
- Log key metrics to console when debug mode is active

**Suggested Files**:
- `src/game.ts` or new `src/debug/performance-monitor.ts`

---

### Priority 3: Adventure Track Polish (Optional)
- Improve camera transitions during adventure mode
- Add subtle cinematic touches (smooth lerps, better timing)

---

### Priority 4: Input Improvements (Optional)
- Add input buffering for flipper presses
- Polish mobile touch controls

---

## Execution Guidelines for Haiku

- Work in small, focused commits
- Prioritize **Priority 1** first (Modern Screen Enhancement)
- Use existing patterns (QualityTier gating, EventBus where appropriate)
- Keep changes minimal and clean
- Test visually in browser + run `npm test`
- Update `weekly_plan.md` when done

---

## Suggested Approach

**Phase 1 (Main Focus)**: Modern Screen Enhancement + Performance Profiling  
**Phase 2 (Stretch)**: Adventure polish + Input improvements

---

**Start with Priority 1.** Make the screens look premium and modern. Go!