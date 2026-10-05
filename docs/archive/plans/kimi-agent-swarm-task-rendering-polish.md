# Kimi Agent Swarm Task — Rendering Polish Sprint (Final Backlog Clear)

**Repo**: https://github.com/ford442/pachinball  
**Goal**: Completely clear the remaining 4-item Backlog  
**Total Estimated Time**: ~1.5 hours  
**Strategy**: 3-agent swarm for maximum parallel execution

---

## Backlog Items (All Rendering)

1. **CRT scanline enhancement** (~20 min) — `src/shaders/scanline.ts`
2. **Parallax display layers** (~15 min) — `src/display/display-core.ts`
3. **Reel stop bounce physics** (~30 min) — `src/display/display-shader.ts`
4. **Hologram fresnel rim effect** (~15 min) — `src/materials/material-interactive.ts`

---

## Swarm Roles (3 Agents)

### Agent 1: Display & Shader Polish
**Focus**: Items 2 + 3 (Parallax layers + Reel stop bounce)

**Tasks**:
1. Implement parallax display layers in `display-core.ts` (Z-axis breathing per layer)
2. Add reel stop bounce physics in `display-shader.ts` (overshoot + elastic settle)
3. Make both QualityTier-aware and performant
4. Test visually

**Output**: Parallax layers + reel bounce physics + commit

---

### Agent 2: Shader & Material Effects
**Focus**: Items 1 + 4 (CRT scanline + Hologram fresnel)

**Tasks**:
1. Enhance CRT scanline shader (`scanline.ts`) with temporal flicker + chromatic aberration
2. Add hologram fresnel rim effect in `material-interactive.ts`
3. Gate both behind appropriate QualityTier
4. Ensure good performance

**Output**: CRT enhancement + Hologram fresnel effect + commit

---

### Agent 3: Coordinator & Closer
**Focus**: Documentation + Final Cleanup

**Tasks**:
1. Monitor Agents 1 & 2
2. Update `weekly_plan.md`:
   - Move all 4 rendering items to Done
   - Mark Backlog as **completely cleared**
   - Move "Next Sprint Ideas" to the top as the new focus
3. Run full verification (`npx tsc -b`, `npm run build`, `npm test`)
4. Prepare final push to main

**Output**: Clean `weekly_plan.md`, zero open backlog, project in polished state + push

---

## Execution Rules

- Branch: `feature/rendering-polish-final`
- Keep changes small, focused, and high-quality
- Run `npm test` after each major change
- Agent 3 handles final documentation and push

## Launch Command

```bash
git checkout -b feature/rendering-polish-final
# Paste this file into kimi-cli swarm mode
```

**Expected Outcome**:
- All 4 remaining backlog items completed
- **Zero open backlog items**
- Project in a very polished, production-ready visual state
- Clean handoff to future "Next Sprint Ideas"

---

**This is the final backlog-clearing sprint. Let's finish strong!** 🚀