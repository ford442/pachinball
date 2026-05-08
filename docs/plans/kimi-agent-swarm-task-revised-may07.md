# Kimi Agent Swarm Task — Pachinball Revised Sprint (May 7 Evening)

**Repo**: https://github.com/ford442/pachinball  
**Context**: Major progress completed today (Sound EventBus, Config Extraction, Audit Triage, Vitest coverage, Playwright spec).  
**Goal**: Finish the remaining high-value items and properly close the day.  
**Swarm Size**: 3 agents

---

## Current Accurate Status

- ✅ Sound System EventBus integration — complete
- ✅ Config extraction — complete
- ✅ Audit Triage report created (`docs/AUDIT_TRIAGE_2026-05-07.md`)
- ✅ Vitest tests for EventBus + GameStateManager — exist and passing (51 tests)
- ✅ Playwright spec for DisplayState transitions — exists (215 lines) but unstable in headless/container

**Remaining Work**:
- Implement 2–3 quick wins from the audit triage
- Stabilize or document Playwright test limitations
- Update `weekly_plan.md` to reflect reality

---

## Swarm Roles

### Agent 1: Quick Wins Implementer
**Focus**: Implement 2–3 high-impact items from `docs/AUDIT_TRIAGE_2026-05-07.md`

**Suggested quick wins** (pick any 2–3):
- Shadow bias tuning (Lighting/Post-Processing audit)
- CSS `touch-action` improvements (Input audit)
- Wall friction unification (Physics audit)
- Pin collar / bumper visual polish (Material or Rendering audit)
- Non-QWERTY keyboard support (Input accessibility)

**Tasks**:
1. Review the triage report
2. Choose and implement 2–3 items with clear, minimal changes
3. Add a short note in the triage doc about what was done
4. Run `npm test` + build

**Output**: 2–3 implemented quick wins + updated triage doc

---

### Agent 2: Playwright Stability Engineer
**Focus**: Make `tests/display-states.spec.ts` more reliable or document limitations

**Tasks**:
1. Run the existing Playwright spec and identify exact failure points
2. Options (choose best):
   - Add longer timeouts / better waiting strategies
   - Make the test more resilient to slow startup
   - Add a clear note/skipped test with explanation if headless environment is the blocker
3. Ensure the test still provides good regression value
4. Update the test file with comments explaining current status

**Output**: More stable Playwright tests (or well-documented limitation) + commit

---

### Agent 3: Documentation & Closer
**Focus**: Final cleanup and planning

**Tasks**:
1. Update `weekly_plan.md`:
   - Move all completed May 7 work to the Done section
   - Mark Playwright spec as "exists but needs environment tuning"
   - Add any new backlog items discovered today
   - Create a short "Next Sprint" section with realistic priorities
2. Review the triage report and note which quick wins were done
3. Run full verification:
   - `npx tsc -b`
   - `npm run build`
   - `npm test`
4. Prepare final commit(s) and push

**Output**: Clean `weekly_plan.md`, verification report, and ready-to-push changes

---

## Execution Rules

- Branch: `feature/revised-sprint-may07`
- Keep changes small and focused
- Every agent must run tests before finishing
- Agent 3 makes the final push

## Launch Command

```bash
git checkout -b feature/revised-sprint-may07
# Then paste this file into kimi-cli swarm mode
```

**Expected Outcome**: 
- 2–3 quick wins implemented
- Playwright situation clarified
- `weekly_plan.md` accurately reflects the excellent progress made today

---

**Start the revised swarm now.** Let's finish the day strong! 🚀