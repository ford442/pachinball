# Agent Swarm Task: Visual Effects System Audit & Enhancement

**Task ID:** `claude/audit-effects-system-{sessionId}`  
**Priority:** High  
**Estimated Duration:** 2-3 hours  
**Dependencies:** None (self-contained audit)

---

## Mission Brief

Audit the existing particle, impact, and visual-effects systems in Pachinball to identify opportunities for enhancement that improve player feedback, environmental detail, and cinematic flair—without breaking existing gameplay or fallback rendering.

**Core Constraint:** All changes must be additive and feature-flagged where possible. The game must still run (and look acceptable) if new effects are disabled.

---

## Phase 1: Discovery & Documentation (30 min)

### 1.1 Map Current Effects Architecture

Read and document the current state of these files:
- `src/game-elements/effects.ts` - Core EffectsSystem class
- `src/game-elements/visual-language.ts` - Color/intensity standards
- `src/game-elements/display.ts` - Display/shader integration
- `src/game-elements/game-objects.ts` - Object-level effects hooks
- `src/game.ts` - Where effects are triggered

**Deliverable:** Create `docs/EFFECTS_AUDIT_BASELINE.md` with:
- List of all current effect types (particles, lights, sounds, shaders)
- Trigger points (where effects are spawned from)
- Performance characteristics (particle counts, update frequency)
- Current fallback behavior (what happens when effects fail)

### 1.2 Identify Effect Categories

Categorize every effect found into:

| Category | Description | Examples |
|----------|-------------|----------|
| **Collision Feedback** | Ball hitting things | Bumpers, walls, pins |
| **State Changes** | Game mode transitions | Fever, Reach, Jackpot |
| **Environmental** | Ambient world detail | Cabinet lights, background shimmer |
| **Cinematic** | Camera/show moments | Track start, goal reached, ball lost |
| **UI Feedback** | Interface responses | Button hover, score popups |

---

## Phase 2: Gap Analysis (45 min)

### 2.1 Compare Against Reference Games

Research (or recall) visual feedback in:
- Zen Pinball / Pinball FX
- Peggle (impact feedback)
- Monument Valley (environmental detail)
- Cyberpunk 2077 UI (holographic/cinematic flair)

**Deliverable:** Create `docs/EFFECTS_OPPORTUNITIES.md` cataloging:

#### A. Missing Collision Feedback
For each collision type, check if we have:
- [ ] Immediate flash/bloom
- [ ] Particle burst
- [ ] Screen shake (subtle)
- [ ] Audio-visual sync
- [ ] Trajectory change visibility

**Collision types to audit:**
- Bumper (circular) hits
- Slingshot (linear) hits
- Pin hits (small, numerous)
- Wall/rail glances
- Flipper strikes
- Ball-to-ball (if multi-ball)

#### B. Missing State Transitions
- [ ] Fever mode entry/exit animation
- [ ] Reach countdown visual intensity escalation
- [ ] Jackpot phase transitions (Breach → Error → Meltdown)
- [ ] Adventure track start/end sequences
- [ ] Ball save activation
- [ ] Multi-ball start/merge

#### C. Missing Environmental Detail
- [ ] Volumetric light shafts (if performant)
- [ ] Dust motes in light
- [ ] Surface reflection dynamics
- [ ] Playfield depth haze
- [ ] Cabinet edge glow pulsing
- [ ] Background parallax layers

#### D. Missing Cinematic Moments
- [ ] Ball launch anticipation
- [ ] Drain/loss moment
- [ ] High score celebration
- [ ] Track completion sequence
- [ ] Secret discovery reveal

### 2.2 Technical Constraints Audit

Document current limitations:
- Max particles per effect: ___
- Max concurrent effects: ___
- Shader complexity budget: ___
- Mobile performance targets: ___

---

## Phase 3: Safe Enhancement Proposals (60 min)

### 3.1 Design Enhancement Prototypes

For each high-impact opportunity, design a **safe enhancement**:

#### Template for Each Proposal:

```markdown
### Enhancement: [Name]

**Target:** [What gameplay moment this enhances]

**Current State:** [What happens now]

**Proposed Enhancement:** [What should happen]

**Implementation Approach:**
- Add to: `effects.ts` (method name)
- Trigger from: [file/line]
- Feature flag: `CONFIG.enable[Name]Effects`

**Safety Mechanisms:**
- [ ] Particle pool limit
- [ ] LOD (simplified version for low-end)
- [ ] Automatic disable if FPS < 30
- [ ] Fallback to current behavior

**Performance Budget:**
- Max particles: ___
- Max lights: ___
- Shader passes: ___

**Visual Reference:** [Describe or link]
```

### 3.2 Prioritized Enhancement List

**Tier 1 - High Impact, Low Risk:**
1. **Enhanced Bumper Impact** - Multi-ring ripple + screen shake
2. **Fever Trail** - Ball leaves particle trail during fever
3. **State Transition Flashes** - Full-screen color wash on mode changes

**Tier 2 - Medium Impact, Medium Risk:**
4. **Environmental Pulse** - Cabinet lights breathe with game rhythm
5. **Collision Spark Variants** - Different spark colors for different surfaces
6. **Jackpot Crescendo** - Escalating visual intensity through phases

**Tier 3 - Polish, Higher Complexity:**
7. **Volumetric Goal Glow** - Light shafts from goal bucket
8. **Depth-Based Haze** - Distant playfield elements fade slightly
9. **Cinematic Camera Shakes** - Contextual shake on big moments

---

## Phase 4: Implementation (45 min)

### 4.1 Implement Tier 1 Enhancements

Create the actual code for at least 2 Tier 1 enhancements:

**Required for each:**
1. Effect method in `EffectsSystem`
2. Trigger integration in appropriate game file
3. Config flag in `src/config.ts`
4. Visual polish pass (colors from `visual-language.ts`)
5. Performance test (confirm 60fps)

### 4.2 Add Feature Flags

Update `src/config.ts`:

```typescript
export const EffectsConfig = {
  // New enhancements
  enableEnhancedBumperImpact: true,
  enableFeverTrail: true,
  enableStateTransitionFlashes: true,
  enableEnvironmentalPulse: false, // experimental
  
  // Performance limits
  maxParticlesPerEffect: 50,
  maxConcurrentEffects: 10,
  enableLOD: true,
  lowFpsThreshold: 30,
  autoDisableOnLowFps: true,
}
```

### 4.3 Fallback Rendering Support

Ensure all enhancements check for fallback mode:

```typescript
if (isFallbackMode || !EffectsConfig.enableEnhancedBumperImpact) {
  // Use original simple effect
  return
}
// Enhanced version
```

---

## Phase 5: Testing & Validation (20 min)

### 5.1 Build Verification

```bash
npm run build
# Must complete without errors
```

### 5.2 Visual Regression Check

Test in browser:
- [ ] Game loads without console errors
- [ ] All original effects still work
- [ ] New effects appear when enabled
- [ ] New effects don't appear when disabled
- [ ] No visual glitches or artifacts

### 5.3 Performance Check

Open DevTools Performance tab:
- [ ] Frame time stays < 16ms (60fps)
- [ ] No memory leaks (heap stable)
- [ ] Effect spawning doesn't cause jank

---

## Deliverables Checklist

- [ ] `docs/EFFECTS_AUDIT_BASELINE.md` - Current system documentation
- [ ] `docs/EFFECTS_OPPORTUNITIES.md` - Gap analysis and opportunities
- [ ] `docs/EFFECTS_ENHANCEMENTS.md` - Detailed proposals for Tier 1-3
- [ ] Code: Enhanced effects in `effects.ts`
- [ ] Code: Feature flags in `config.ts`
- [ ] Code: Trigger integrations in game files
- [ ] Working build with no errors
- [ ] Git commit with proper message

---

## Git Workflow

```bash
# 1. Start fresh
git checkout main
git pull origin main

# 2. Create branch
git checkout -b claude/audit-effects-system-{sessionId}

# 3. Work through phases above
# ... implementation ...

# 4. Regular commits
git add docs/EFFECTS_AUDIT_BASELINE.md
git commit -m "docs: document current effects system baseline"

git add docs/EFFECTS_OPPORTUNITIES.md
git commit -m "docs: identify effects enhancement opportunities"

git add src/
git commit -m "feat: implement Tier 1 visual effect enhancements

- Enhanced bumper impact with ripple rings
- Fever mode ball trail
- State transition flashes
- Feature flags for all enhancements
- Fallback rendering support"

# 5. Push
git push origin claude/audit-effects-system-{sessionId}
```

---

## Success Criteria

✅ **Audit Complete:** All current effects documented  
✅ **Gaps Identified:** Clear list of enhancement opportunities  
✅ **Safe Implementation:** At least 2 Tier 1 enhancements working  
✅ **Feature Flags:** All enhancements can be toggled  
✅ **Fallback Support:** Game works without new effects  
✅ **Performance:** No FPS drops on target hardware  
✅ **Clean Build:** `npm run build` passes  
✅ **Committed:** All changes pushed to branch  

---

## Coordination Notes

**Sync Points:**
- Commit after Phase 2 (documentation complete)
- Commit after Phase 4 (implementation complete)
- Push after each commit to stay in sync with other swarms

**Merge Conflicts:**
If `effects.ts` or `config.ts` has conflicts with main:
1. Pull latest: `git pull origin main`
2. Resolve by keeping both changes (additions are safe)
3. Re-test build
4. Commit merge resolution

**Communication:**
If you discover architectural issues that block enhancement, document in `docs/EFFECTS_BLOCKERS.md` and report immediately rather than forcing a solution.

---

## Quick Reference: Effect System API

```typescript
// From effects.ts - what's already available
EffectsSystem.spawnShardBurst(pos, colorHex?)     // Particle explosion
EffectsSystem.createCabinetLighting()              // LED strips
EffectsSystem.updateLighting(mode, dt)             // State-based lighting
EffectsSystem.triggerImpactFlash(intensity)        // Screen flash
EffectsSystem.setBloomIntensity(val)               // Bloom control

// From visual-language.ts - use these colors/intensities
PALETTE.CYAN, PALETTE.MAGENTA, PALETTE.GOLD        // State colors
INTENSITY.AMBIENT, INTENSITY.FLASH, INTENSITY.BURST // Emissive levels
STATE_COLORS.FEVER, STATE_COLORS.REACH             // Semantic colors
```

---

**Start Time:** ___  
**End Time:** ___  
**Agent:** ___  

*Remember: Add, don't replace. Feature flag everything. Test performance.*
