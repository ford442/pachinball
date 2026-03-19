# Pachinball Agent Swarm Plan

A structured, repeatable guide for agents to enhance the Pachinball project iteratively. Each task is self-contained and can be executed independently or in sequence.

---

## Overview

This document provides **repeatable prompt templates** for agents to work on Pachinball improvements in parallel or sequence. Each section has:
- **Task Template**: The core prompt to give an agent
- **Success Criteria**: What "done" looks like
- **Dependencies**: What must exist first
- **Output**: What the agent should produce

---

## Track Implementation Tasks

### TASK: Implement a Single Adventure Track

**Prompt Template:**
```
Implement the adventure track: "[TRACK_NAME]"

Track Specifications (from PLAN.md):
- Concept: [CONCEPT]
- Layout: [LAYOUT_STEPS]
- Technical Variables: [VARIABLES]

Requirements:
1. Create the track geometry using addStraightRamp(), addCurvedRamp(), etc.
2. Implement all hazards, obstacles, and mechanics
3. Add the track builder method to adventure-mode-tracks-{A|B}.ts
4. Register the track in the buildTrack() switch statement
5. Handle the goal trigger to emit 'mission-complete' event
6. Add the enum to AdventureTrackType if missing
7. Commit with message: "feat: implement [TRACK_NAME] adventure track"

Success Criteria:
- Track loads without errors
- Ball can navigate from start to goal
- All hazards function correctly
- Code follows existing patterns (see other tracks)
```

**Repeatable For These Tracks:**
1. NEON_HELIX (Section 6 of PLAN.md)
2. CYBER_CORE (Section 7)
3. QUANTUM_GRID (Section 9)
4. SINGULARITY_WELL (Section 10)
5. GLITCH_SPIRE (Section 11)
6. RETRO_WAVE_HILLS (Section 14)
7. CHRONO_CORE (Section 15)
8. TESLA_TOWER (Section 35)

**Dependencies:**
- `AdventureModeBuilder` base class exists
- Helper methods: `addStraightRamp()`, `addCurvedRamp()`, `createRotatingPlatform()`, etc.

**Output:**
- Modified `src/game-elements/adventure-mode-tracks-{A|B}.ts`
- Updated enum in `adventure-mode-builder.ts` (if new)
- Git commit on working branch

---

### TASK: Add Feeder System

**Prompt Template:**
```
Implement the feeder system: "[FEEDER_NAME]"

System Specifications (from PLAN.md Section [NUM]):
- Mechanic: [DESCRIPTION]
- Logic State Machine: [STATES]
- Technical Specification: [CONFIG]
- Position: [COORDINATES]
- Timing: [DURATIONS]

Requirements:
1. Create feeder class in src/game-elements/{feeder-name}-feeder.ts
2. Extend FeederSystem base class (or create base if needed)
3. Implement state machine with update(dt) method
4. Handle ball capture/release/cooldown logic
5. Create visual feedback (materials, emissive states)
6. Add audio feedback hooks
7. Register feeder in game.ts initialization
8. Commit with message: "feat: implement [FEEDER_NAME] feeder system"

Success Criteria:
- Feeder captures balls correctly
- State transitions work as specified
- Visual feedback is clear
- No physics glitches or ball clips
```

**Repeatable For These Feeders:**
1. Mag-Spin (Section 5) - ✅ DONE
2. Nano-Loom (Section 12) - ✅ DONE
3. Prism-Core (Section 13) - ✅ DONE
4. Gauss-Cannon (Section 26) - ✅ DONE
5. Quantum-Tunnel (Section 31) - ✅ DONE

**Dependencies:**
- Physics world initialized
- Ball physics system in place

**Output:**
- New feeder class file
- Integration in `game.ts`
- Git commit

---

## UI & UX Tasks

### TASK: Build Adventure Track Selection Menu

**Prompt Template:**
```
Create an adventure track selection UI system.

Requirements:
1. Create UI component: src/game-elements/track-selector.ts
   - Display grid of available tracks
   - Show track name, difficulty, description
   - Show unlock status / high score if completed
   - Support mouse + touch selection

2. Add to DisplayState enum: ADD_TRACK_SELECT state

3. In game.ts, handle track selection flow:
   - MENU → (press key) → TRACK_SELECT
   - TRACK_SELECT → (select track) → START_ADVENTURE
   - START_ADVENTURE → load selected track → PLAYING

4. Persist selection in localStorage or game state

5. Bind keyboard (arrow keys + enter) and touch (tap) controls

6. Commit with message: "feat: add adventure track selection UI"

Success Criteria:
- Menu displays all available tracks
- Selection is intuitive (keyboard and touch)
- Transitions smoothly to selected track
- Shows track metadata
```

**Dependencies:**
- DisplaySystem in place
- InputHandler functional

**Output:**
- New UI component file
- Updated `types.ts` with DisplayState additions
- Modified `input.ts` to handle track selection input
- Git commit

---

### TASK: Add Track Progression/Unlock System

**Prompt Template:**
```
Implement track progression system.

Requirements:
1. Create file: src/game-elements/progression.ts
   - Track completion status per track
   - High score per track
   - Unlocking logic (e.g., complete 3 tracks to unlock next difficulty)
   - Save/load from localStorage

2. Add fields to Game class:
   - activeTrack: string
   - trackProgress: Map<string, { completed, bestScore, attempts }>

3. On track completion:
   - Save score to progression
   - Check if next track should unlock
   - Trigger unlock event if needed

4. Display progression in track selector:
   - Lock icon on locked tracks
   - Best score on completed tracks

5. Commit with message: "feat: add track progression system"

Success Criteria:
- Tracks unlock correctly based on progression
- Scores persist across sessions
- UI reflects progression state
```

**Dependencies:**
- Track selector menu exists
- Game state management in place

**Output:**
- New progression system file
- Modified `game.ts` with progression integration
- Git commit

---

## Audio & Atmosphere Tasks

### TASK: Add Background Music Per Track

**Prompt Template:**
```
Implement background music system for adventure tracks.

Requirements:
1. Create audio manager: src/game-elements/audio-manager.ts
   - Load audio files from /public/audio/
   - Manage track music playback
   - Support fade in/out transitions
   - Volume control

2. Create music mapping in config:
   ```typescript
   const TRACK_MUSIC: Record<AdventureTrackType, string> = {
     NEON_HELIX: 'neon-helix.mp3',
     CYBER_CORE: 'cyber-core.mp3',
     // ... etc
   }
   ```

3. In AdventureMode.createTrack(), call:
   ```
   audioManager.playMusicForTrack(trackType, {fadeIn: 1.0})
   ```

4. On track reset/fail, fade out music

5. Create placeholder audio files or use synthesized tones

6. Commit with message: "feat: add background music system"

Success Criteria:
- Music plays when track loads
- Volume is appropriate (not too loud)
- Smooth transitions between tracks
- Audio files are organized in /public/audio/
```

**Dependencies:**
- Adventure mode system
- Web Audio API or HTML5 Audio

**Output:**
- Audio manager class
- Music file mapping
- Integration points in `adventure-mode.ts` and `game.ts`
- Git commit

---

### TASK: Add Ambient Sound Effects

**Prompt Template:**
```
Implement ambient SFX for track environments.

Requirements:
1. Expand EffectsSystem (src/game-elements/effects.ts):
   - Add playAmbientSound(trackType) method
   - Support looping ambient tracks
   - Volume ramping when entering/exiting track

2. Create sound library mapping:
   ```typescript
   const TRACK_AMBIENT: Record<AdventureTrackType, string[]> = {
     NEON_HELIX: ['data-stream.mp3', 'hum.mp3'],
     CYBER_CORE: ['server-room.mp3'],
     // ... etc
   }
   ```

3. Ambient sounds loop continuously during track

4. Play hazard-specific SFX on collision:
   - Rotating platforms: swish sound
   - Pistons: mechanical clang
   - Lasers: laser beam sound

5. Commit with message: "feat: add ambient sound effects per track"

Success Criteria:
- Ambient audio loops smoothly
- Hazard sounds trigger on impact
- Audio queue doesn't overflow
- Sounds enhance immersion without being distracting
```

**Dependencies:**
- Audio manager exists
- Effects system in place
- SFX file library organized

**Output:**
- Updated `effects.ts`
- Sound mapping configuration
- Git commit

---

## Visual Polish Tasks

### TASK: Enhance Track Visuals

**Prompt Template:**
```
Polish visuals for adventure track: [TRACK_NAME]

Requirements:
1. Review track materials and colors (from PLAN.md Section [NUM]):
   - Primary color: [COLOR]
   - Secondary color: [COLOR]
   - Visual theme: [DESCRIPTION]

2. Update materials in createXxxTrack():
   - Use consistent color palette
   - Apply correct emissive values
   - Adjust roughness/metallic properties

3. Add lighting-specific elements:
   - Emissive strips on hazards
   - Spotlights on goal areas
   - Ambient color glow matching track theme

4. Particle effects:
   - Add dust/energy particles to hazard zones
   - Glow effect on goal bucket
   - Trail effect on moving platforms

5. Refine mesh scaling:
   - Ensure visual proportions match game feel
   - Test with ball collision (ball should look correct scale)

6. Commit with message: "visual: enhance [TRACK_NAME] track visuals"

Success Criteria:
- Track looks cohesive and themed
- Colors match design specification
- Lighting enhances atmosphere
- Performance stays smooth
```

**Dependencies:**
- Track geometry exists
- Material library in place
- Lighting system functional

**Output:**
- Updated track creation method
- Material tweaks in `material-library.ts`
- Git commit

---

### TASK: Add Particle Effects to Interactions

**Prompt Template:**
```
Implement particle effects for ball interactions.

Requirements:
1. Expand EffectsSystem with particle methods:
   - spawnCollisionParticles(position, type)
   - spawnGoalParticles(position)
   - spawnHazardParticles(position, hazardType)

2. Collision feedback:
   - Bumper hit: bright flash + expanding ring
   - Wall hit: small dust cloud
   - Goal reach: celebration sparkles

3. Hazard-specific effects:
   - Rotating platform: motion blur
   - Piston: compression shockwave
   - Conveyor: directional flow particles
   - Laser: laser flash effect

4. Pooling system:
   - Reuse particles to avoid GC spikes
   - Cull off-screen particles

5. Integrate with collisions in PhysicsSystem

6. Commit with message: "feat: add particle effects system"

Success Criteria:
- Effects are visually appealing
- No performance impact (smooth 60fps)
- Particles cull properly
- Effects enhance feedback without overwhelming
```

**Dependencies:**
- Physics system with collision events
- Effects system base
- Material library

**Output:**
- Expanded `effects.ts` with particle methods
- Particle system configuration
- Integration in `game-objects.ts`
- Git commit

---

## Game Mechanics Tasks

### TASK: Implement Checkpoint System for Long Tracks

**Prompt Template:**
```
Add checkpoint system for complex adventure tracks.

Requirements:
1. Create checkpoints.ts:
   - Track segments with checkpoint sensors
   - Save ball position and state at checkpoints
   - Allow resume from checkpoint on fail

2. In long tracks, define 2-3 checkpoints:
   - Checkpoint 1: Midway point
   - Checkpoint 2: Final stretch
   - Store checkpoint positions in track metadata

3. On ball falling/reset:
   - Show "Retry from Checkpoint?" prompt
   - Teleport ball back to checkpoint position
   - Restore momentum (optional)

4. Checkpoint visualization:
   - Subtle marker on track
   - Glow on activation
   - Audio chime

5. Commit with message: "feat: add checkpoint system for long tracks"

Success Criteria:
- Checkpoints load ball correctly
- Game state restores properly
- UX is clear and smooth
- Works for all track types
```

**Dependencies:**
- Adventure mode system
- Ball physics system
- Display/UI system

**Output:**
- Checkpoint system class
- Integration in `adventure-mode-builder.ts`
- Git commit

---

### TASK: Add Difficulty Modifiers

**Prompt Template:**
```
Implement difficulty modifiers for adventure tracks.

Requirements:
1. Create difficulty enum: EASY, NORMAL, HARD, INSANE

2. Modifiers apply:
   - Ball speed multiplier
   - Gravity multiplier
   - Obstacle speed multiplier
   - Reduced/increased friction
   - Narrower passages (HARD/INSANE)
   - Hidden/visible obstacles toggle

3. Config per track:
   ```typescript
   const DIFFICULTY_CONFIG = {
     EASY: { speedMult: 0.8, gravityMult: 0.9, ... },
     NORMAL: { speedMult: 1.0, gravityMult: 1.0, ... },
     // ... etc
   }
   ```

4. UI:
   - Difficulty selector in track menu
   - Difficulty-specific high score tracking

5. Commit with message: "feat: add difficulty modifiers"

Success Criteria:
- Each difficulty feels distinct
- Progression from EASY to INSANE is balanced
- Score multiplier based on difficulty
- Leaderboard shows difficulty level
```

**Dependencies:**
- Track selection UI
- Progression system
- Physics system

**Output:**
- Difficulty configuration module
- Physics adjustments in adventure mode
- UI modifications
- Git commit

---

## Performance & Optimization Tasks

### TASK: Profile and Optimize Frame Rate

**Prompt Template:**
```
Optimize frame rate and identify bottlenecks.

Requirements:
1. Profile the game:
   - Use Chrome DevTools Performance tab
   - Identify long-running frames (> 16ms at 60fps)
   - Check memory leaks

2. Optimization targets:
   - Particle count: cap at reasonable level
   - Physics bodies: pool/reuse where possible
   - Mesh complexity: reduce poly count if needed
   - Draw calls: batch similar materials

3. Specific checks:
   - Adventure mode track generation time
   - Ball physics updates per frame
   - Particle system performance
   - Lighting complexity

4. Benchmarking:
   - Before/after FPS measurement
   - Mobile device testing

5. Commit with message: "perf: optimize frame rate and memory usage"

Success Criteria:
- Consistent 60fps on target hardware
- No jank or stuttering
- Mobile-playable (30fps minimum)
- Memory stable (no unbounded growth)
```

**Dependencies:**
- Working game implementation
- DevTools access

**Output:**
- Performance analysis notes
- Code optimizations
- Possible configuration tweaks
- Git commit

---

### TASK: Add Level of Detail (LOD) System

**Prompt Template:**
```
Implement LOD for distant geometry.

Requirements:
1. Create LOD system:
   - High-detail mesh near camera
   - Low-detail mesh far from camera
   - Auto-swap based on distance

2. Mesh simplification:
   - Bumper detail: high near player, cylinders far away
   - Pins: visible near, culled far away
   - Platforms: simple geometry at distance

3. Configuration:
   ```typescript
   const LOD_DISTANCES = {
     HIGH: 15,
     MEDIUM: 30,
     LOW: 50,
   }
   ```

4. Performance impact:
   - Measure draw call reduction
   - Memory footprint improvement

5. Commit with message: "perf: add LOD system for distant geometry"

Success Criteria:
- No visible popping
- Measurable FPS improvement
- Mobile performance improved
```

**Dependencies:**
- Scene management in place
- Mesh system

**Output:**
- LOD manager class
- Mesh variants or simplification approach
- Configuration
- Git commit

---

## Testing & QA Tasks

### TASK: Test All Adventure Tracks

**Prompt Template:**
```
Comprehensive testing of adventure track: [TRACK_NAME]

Requirements:
1. Load the track in game
2. Test ball physics:
   - Can ball reach goal?
   - Do hazards work correctly?
   - Physics feel responsive?

3. Test edge cases:
   - Ball going out of bounds
   - Hazard collisions
   - Rapid direction changes
   - Extended play (no crashes)

4. Visual check:
   - Materials render correctly
   - Lighting is appropriate
   - No mesh clipping
   - Performance acceptable

5. Document findings:
   - Note any bugs or issues
   - Suggest visual improvements
   - Rate difficulty

6. Create issue if bugs found

Output: Test report with Pass/Fail for each aspect
```

**Dependencies:**
- Track implemented

**Output:**
- Test report document
- GitHub issues for any bugs
- Notes for improvements

---

### TASK: Create End-to-End Test Suite

**Prompt Template:**
```
Build automated E2E test suite for core game loops.

Requirements:
1. Test framework: Vitest or Jest

2. Test scenarios:
   - Game initialization
   - Main playfield ball flow
   - Adventure mode track loading
   - Feeder systems (capture/release)
   - Score accumulation
   - Game state transitions

3. Mock physics if needed

4. Coverage target: 70%+

5. Integrate with CI/CD

6. Commit with message: "test: add E2E test suite"

Success Criteria:
- Tests run without errors
- >70% code coverage
- Test suite completes in <10 seconds
```

**Dependencies:**
- Testing framework setup
- Game code is testable

**Output:**
- Test file(s) in test/ directory
- GitHub Actions workflow (if CI/CD available)
- Git commit

---

## Documentation Tasks

### TASK: Create Track Implementation Guide

**Prompt Template:**
```
Document how to implement an adventure track.

Requirements:
1. Write guide: TRACK_IMPLEMENTATION.md
   - Step-by-step walkthrough
   - Code examples from existing tracks
   - Common patterns and helpers
   - Debugging tips

2. Include:
   - Coordinate system explanation
   - Physics considerations
   - Material and color guidelines
   - Hazard implementation patterns
   - Testing checklist

3. Update ARCHITECTURE.md with track info

4. Commit with message: "docs: add track implementation guide"

Success Criteria:
- Guide is clear and actionable
- New developer can follow it
- Code examples are accurate
```

**Dependencies:**
- Several tracks already implemented

**Output:**
- New markdown guide
- Updated ARCHITECTURE.md
- Git commit

---

## Coordinating Multiple Agents

### Agent Swarm Execution Pattern

1. **Task Distribution**:
   - Assign one agent per task from a section
   - Mark assigned tasks in this file with agent ID
   - Use branch naming: `claude/[task-slug]-[sessionId]`

2. **Communication Protocol**:
   - Agents report completion via commit messages
   - Use consistent format: `[type]: [description]`
   - Types: `feat`, `fix`, `perf`, `visual`, `docs`, `test`

3. **Merge Strategy**:
   - Each agent creates PR with their changes
   - PR title references this plan section
   - Merge when tests pass and review is done

4. **Iteration**:
   - After all agents complete round 1, prioritize remaining tasks
   - Create new agent assignments for round 2
   - Repeat until all planned improvements are complete

---

## Quick Start for Agents

### To Start Work on a Task:

```bash
# 1. Pull latest
git pull origin master

# 2. Create branch
git checkout -b claude/[task-slug]-[sessionId]

# 3. Implement task following prompt template
# 4. Test thoroughly
# 5. Commit with proper message
# 6. Create PR (or report completion)
```

### PR Template:

```markdown
## Task: [TASK_NAME]

**Section**: [PLAN_MD_SECTION]
**Prompt Used**: [WHICH_TEMPLATE]

## Summary
[Brief description of what was implemented]

## Changes
- [Change 1]
- [Change 2]
- etc.

## Testing
- [Test 1]: ✅ Pass
- [Test 2]: ✅ Pass

## Notes
[Any additional context]
```

---

## Progress Tracking

Update this section as tasks are completed:

### Round 1 - Adventure Tracks
- [ ] NEON_HELIX
- [ ] CYBER_CORE
- [ ] QUANTUM_GRID
- [ ] SINGULARITY_WELL
- [ ] GLITCH_SPIRE
- [ ] RETRO_WAVE_HILLS
- [ ] CHRONO_CORE
- [ ] TESLA_TOWER

### Round 1 - UI & UX
- [ ] Track Selection Menu
- [ ] Track Progression System

### Round 1 - Audio
- [ ] Background Music System
- [ ] Ambient SFX

### Round 1 - Visuals
- [ ] Track Visuals Enhancement
- [ ] Particle Effects System

### Round 1 - Mechanics
- [ ] Checkpoint System
- [ ] Difficulty Modifiers

### Round 1 - Performance
- [ ] Frame Rate Optimization
- [ ] LOD System

### Round 1 - Testing
- [ ] Track Testing
- [ ] E2E Test Suite

---

## Notes for Future Rounds

After Round 1 is complete, consider:
1. Additional 15+ remaining adventure tracks
2. Multiplayer/cooperative modes
3. Procedural track generation
4. Advanced physics (ball spin, tilt effects)
5. VR support
6. Custom level editor
7. Social features (leaderboards, replays)

---

**Last Updated**: 2026-03-19
**Status**: Ready for Agent Swarm Execution
