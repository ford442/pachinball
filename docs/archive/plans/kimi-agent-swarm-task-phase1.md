# Kimi Agent Swarm Task — Phase 1 (May 8 Evening)

**Repo**: https://github.com/ford442/pachinball  
**Focus**: Playwright CI Optimization + Visual Polish  
**Goal**: Reduce test time + add visible player-facing improvements

---

## Phase 1 Backlog Items

1. **Playwright CI optimization** (~1–2 hr)
   - Restructure `tests/display-states.spec.ts` to use a single shared browser context
   - One game initialization → multiple state transitions
   - Target: Reduce ~6 min suite to ~2 min

2. **Bumper burst effects** (~1 hr)
   - Add satisfying burst / explosion effect on bumper hits
   - Use existing EffectsSystem + particle pool

3. **Cabinet beveled edges** (~20 min)
   - Add subtle bevels to cabinet edges for better depth
   - Keep performance-friendly (QualityTier gated)

---

## Swarm Roles (3 Agents)

### Agent 1: Playwright Optimizer
**Focus**: Dramatically speed up the test suite

**Tasks**:
1. Analyze current `tests/display-states.spec.ts` structure
2. Refactor to use **single shared browser context** + `beforeAll` / `afterAll`
3. Keep all 10 state transition tests but run them sequentially in one browser instance
4. Add timing comments and verify the ~2 min target
5. Update `weekly_plan.md` with new timing

**Output**: Much faster Playwright suite + updated test file

---

### Agent 2: Effects Polish
**Focus**: Bumper Burst Effects

**Tasks**:
1. Review current bumper hit handling in `game.ts` / `effects-core.ts`
2. Implement a satisfying burst effect (radial particles + flash + optional sound trigger via EventBus)
3. Make it respect QualityTier and `reducedMotion`
4. Wire it into existing bumper collision code
5. Add a lightweight test if possible

**Output**: New bumper burst effect + commit

---

### Agent 3: Visual Polish + Coordinator
**Focus**: Cabinet Beveled Edges + Coordination

**Tasks**:
1. Add subtle beveled edges to the cabinet (in `cabinet/cabinet-builder.ts`)
2. Gate behind `QualityTier.HIGH` or `MEDIUM`
3. Act as Coordinator:
   - Monitor Agents 1 & 2
   - Update `weekly_plan.md` (move completed items to Done)
   - Run full verification
   - Prepare push

**Output**: Cabinet bevels + clean documentation + final push

---

## Execution

Branch: `feature/phase1-may08`

Launch with kimi-cli swarm mode using this file.

**Expected Outcome**: 
- Playwright suite significantly faster
- Nice visual bump on bumper hits + cabinet edges
- Clean sprint close

---

**Let's crush Phase 1!** 🚀