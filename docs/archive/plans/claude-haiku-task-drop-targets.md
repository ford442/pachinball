# Claude Haiku Task — Drop Targets System (Pachinball)

**Repo**: https://github.com/ford442/pachinball  
**Focus**: Implement a classic Drop Targets system with modern polish.

## Goal
Add **Drop Targets** — a staple pinball mechanic that adds strategy, timing, and satisfaction when completed.

## Features to Implement

### 1. Core Drop Target System
- Create `object-drop-targets.ts`
- Individual drop targets that lower when hit
- Visual animation (smooth lowering + reset)
- Sound and particle effects on hit and reset

### 2. Bank System
- Group 3–5 drop targets into banks
- Completion bonus when entire bank is dropped
- Visual feedback (lights, glow, or animation when bank is complete)

### 3. Reset Mechanics
- Auto-reset after a timer or when triggered by another event (e.g., outlane, mode start)
- Manual reset via EventBus for special modes

### 4. Scoring & Strategy
- Points for each target hit
- Big bonus for completing a full bank
- Possible multiplier or mode trigger on bank completion

### 5. Quality & Polish
- QualityTier-aware visuals (more detail on HIGH)
- Nice hit feedback (impact flash, sound variation)
- Proper physics collider setup

## Instructions
- Integrate with existing EventBus and scoring system
- Make it feel satisfying and strategic
- Keep code clean and modular
- Test for fair difficulty and fun factor

Start building the core Drop Target class and bank system. Go!