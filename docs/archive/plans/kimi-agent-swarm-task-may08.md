# Kimi Agent Swarm Task — Pachinball May 8 Sprint

**Repo**: https://github.com/ford442/pachinball  
**Date**: May 8, 2026  
**Context**: Excellent progress on May 7. Most quick wins from the audit triage are now complete.  
**Goal**: Tackle the remaining high-value items from the current `weekly_plan.md` Backlog.

---

## Current Backlog (Accurate as of May 8)

From `weekly_plan.md`:
- [ ] Stuck-ball detection (from `PHYSICS_AUDIT_MASTER.md`)
- [ ] Rendering audit refresh — rewrite `RENDERING_AUDIT_REPORT.md` to reference current files (`src/display/`, `src/materials/`, etc.)
- [ ] Pin collar details + flipper grip texture (low-poly manufacturing detail from Rendering audit)
- [ ] Playwright CI optimization (tests currently take ~6 minutes)

---

## Swarm Roles (3 Agents)

### Agent 1: Physics & Gameplay Robustness
**Focus**: Stuck-ball Detection

**Tasks**:
1. Review `PHYSICS_AUDIT_MASTER.md` for the stuck-ball recommendation
2. Implement a simple but effective stuck-ball detection system (e.g. velocity threshold + timeout + auto-nudge or respawn)
3. Wire it into the existing physics loop or `BallManager`
4. Add a lightweight Vitest test if possible
5. Keep it non-intrusive (respect `reducedMotion` if applicable)

**Output**: Functional stuck-ball detection + commit

---

### Agent 2: Documentation Refresh
**Focus**: Rendering Audit Refresh

**Tasks**:
1. Read the current `RENDERING_AUDIT_REPORT.md`
2. Update it to reference the actual current file structure:
   - `src/display/` (display-core, display-image, display-reels, etc.)
   - `src/materials/`
   - `src/effects/`
   - `src/game-elements/`
3. Remove references to deleted files (especially old `src/game-elements/display.ts`)
4. Add a short "Status as of May 2026" section at the top
5. Mark which recommendations are now implemented vs still open

**Output**: Updated, accurate `RENDERING_AUDIT_REPORT.md`

---

### Agent 3: Visual Polish + Coordinator
**Focus**: Pin Collar + Flipper Grip Details + Final Cleanup

**Tasks**:
1. Implement low-poly pin collar and flipper grip texture details (from Rendering audit)
   - Use existing material system
   - Keep performance-friendly (gated by QualityTier if needed)
2. Act as Coordinator:
   - Monitor Agents 1 & 2
   - Update `weekly_plan.md`:
     - Move completed items to Done
     - Add any new backlog items discovered
     - Create clear "Next Sprint" section
   - Run full verification (`tsc`, build, `npm test`)
   - Prepare final push

**Output**: Visual polish complete + updated documentation + clean sprint close

---

## Execution Rules

- Branch: `feature/may08-sprint`
- Keep changes focused and high-quality
- Run `npm test` after major changes
- Agent 3 handles final documentation and push

## Launch

```bash
git checkout -b feature/may08-sprint
# Paste this file into kimi-cli swarm mode
```

**Expected Outcome**: 
- Stuck-ball detection added
- Rendering documentation refreshed
- Nice visual polish on pins and flippers
- Clean `weekly_plan.md` for the next day

---

**Ready when you are.** Let's keep the momentum going! 🚀