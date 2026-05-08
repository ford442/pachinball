# Claude Haiku Prompt — Next Sprint (Pachinball)

You are an expert TypeScript + Babylon.js game developer. The project https://github.com/ford442/pachinball is in excellent shape — the entire backlog has been cleared and the game is visually polished.

## Current Project State
- All previous backlog items completed (Sound EventBus, Config extraction, Audit triage, Rendering polish, etc.)
- 51 Vitest tests passing
- Strong event-driven architecture
- Modern visual effects already implemented (parallax layers, reel bounce physics, hologram effects)

## Next Sprint Goal
Focus on **"Next Sprint Ideas"** with emphasis on:
- Modern screen enhancement (high-quality LCD/OLED look instead of retro CRT)
- Performance profiling
- Adventure track polish
- Input improvements

## Tasks (Prioritized)

### 1. Modern Screen Enhancement (Highest Priority)
- Improve the backbox / display system to look more like a high-end modern LCD/OLED screen
- Add subtle enhancements: better anti-aliasing, slight glow, improved contrast, soft scanlines (modern style), or gentle chromatic effects
- Keep it tasteful and performant
- File: likely `src/shaders/scanline.ts` or `src/display/`

### 2. Performance Profiling
- Add basic performance profiling (physics step timing, render loop timing, FPS tracking)
- Create a simple debug overlay or console output for key metrics
- Identify any obvious bottlenecks

### 3. Adventure Track Polish (Optional but nice)
- Improve cinematic camera transitions during adventure mode
- Polish existing adventure track switching

### 4. Input Improvements (Optional)
- Add input buffering for flippers
- Improve mobile touch controls if time allows

## Instructions
- Work in small, clean commits
- Prioritize quality and performance
- Use existing patterns in the codebase (EventBus, QualityTier, EffectsSystem)
- Run `npm test` and `npm run build` after major changes
- Update `weekly_plan.md` at the end with completed items

Start with Task 1 (Modern Screen Enhancement). Go!