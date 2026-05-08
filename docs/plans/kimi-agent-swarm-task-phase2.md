# Kimi Agent Swarm Task — Phase 2 (May 9)

**Repo**: https://github.com/ford442/pachinball  
**Focus**: Lighting & Material Polish  
**Goal**: Close out remaining lighting and material audit items

---

## Phase 2 Backlog Items

1. **Bounce light proximity response** (~15 min)
   - Dynamic bounce light intensity based on ball proximity to surfaces

2. **Cabinet light exclusion lists** (~10 min)
   - Proper light exclusion so cabinet lights don't leak into playfield

3. **Glass refraction enhancement** (~10 min)
   - Improve glass material refraction / fresnel effect

4. **Playfield normal map** (~15 min)
   - Add subtle normal map detail to playfield surface

---

## Swarm Roles (3 Agents)

### Agent 1: Lighting Polish
**Focus**: Bounce Light + Cabinet Light Exclusion

**Tasks**:
1. Implement dynamic bounce light response based on ball proximity (`game.ts` + `effects-core.ts`)
2. Add cabinet light exclusion lists so lights don't bleed incorrectly
3. Keep changes minimal and performant
4. Respect QualityTier settings

**Output**: Improved lighting behavior + commit

---

### Agent 2: Material Polish
**Focus**: Glass Refraction + Playfield Normal Map

**Tasks**:
1. Enhance glass refraction / fresnel in `materials/material-structural.ts`
2. Add subtle normal map detail to the playfield surface
3. Make both QualityTier-aware
4. Test visually in browser

**Output**: Better glass and playfield materials + commit

---

### Agent 3: Coordinator & Closer
**Focus**: Documentation + Final Cleanup

**Tasks**:
1. Monitor Agents 1 & 2
2. Update `weekly_plan.md`:
   - Move all Phase 1 + Phase 2 items to Done
   - Clean up any remaining backlog
   - Add final "Next Sprint Ideas" if needed
3. Run full verification (`tsc`, build, `npm test`)
4. Prepare final push to main

**Output**: Clean documentation + project in excellent shape + push

---

## Execution

Branch: `feature/phase2-may09`

Launch with kimi-cli swarm mode using this file.

**Expected Outcome**:
- All remaining lighting & material items completed
- Project in a very polished state
- Clean `weekly_plan.md` for the weekend / next week

---

**Ready for Phase 2 when you are!** 🚀