# Kimi Agent Swarm Task — Pachinball Next Sprint (May 7 Evening)

**Repo**: https://github.com/ford442/pachinball  
**Context**: The May 7 afternoon sprint (Sound EventBus + Config Extraction + Audit Triage) is complete and pushed.  
**Goal**: Close the remaining high-priority items from `weekly_plan.md` and stabilize the new event-driven architecture.  
**Swarm Size**: 3 agents (focused & fast)

---

## Swarm Roles & Tasks

### Agent 1: Playwright Test Engineer (Highest Priority)
**Focus**: Complete Playwright Smoke Tests for DisplayState Transitions  
**Goal**: Close the last open "Ideas" item and create a permanent regression harness.

**Tasks**:
1. Create / complete `tests/display-states.spec.ts`
2. Verify every transition:
   - IDLE → FEVER, IDLE → REACH, IDLE → JACKPOT, IDLE → ADVENTURE
   - Return paths (FEVER → IDLE, etc.)
3. Drive all changes via `window.game.eventBus.emit('display:set', state)`
4. Assert using `window.game.display.getDisplayState()`
5. Also test that semantic events (`fever:start`, `jackpot:start`, etc.) do **not** change the display state
6. Make sure tests pass in headless mode (or note any environment limitations)

**Output**: Fully working Playwright spec + updated `weekly_plan.md` marking the Ideas item as Done.

---

### Agent 2: Vitest Coverage Specialist
**Focus**: Add Unit Tests for EventBus and GameStateManager

**Tasks**:
1. Create `tests/event-bus.test.ts` (if not already present) with comprehensive coverage:
   - `on()` / `emit()` / `off()` / `clear()`
   - Typed payloads (`display:set`, `state:change`, etc.)
   - Multiple listeners, unsubscribe, edge cases (emit during iteration)
2. Create `tests/game-state.test.ts` covering:
   - All state transitions (MENU → PLAYING → PAUSED → GAME_OVER → MENU)
   - Event emission order (`game:start`, `game:over`, `state:change`, etc.)
   - Guards and idempotency
3. Aim for high coverage of the new event-driven architecture
4. Ensure tests run cleanly with `npm test`

**Output**: Two new test files + passing results + commit message.

---

### Agent 3: Swarm Coordinator & Closer
**Focus**: Finalization, Documentation, and Next Planning

**Tasks**:
1. Monitor Agents 1 & 2 and ensure they finish cleanly
2. Review the new `docs/AUDIT_TRIAGE_2026-05-07.md` and implement **2–3 quick wins** if obvious (e.g., fix stale path references mentioned in Rendering audit)
3. Update `weekly_plan.md`:
   - Move Playwright tests and Vitest coverage to Done
   - Add any new backlog items discovered during this sprint
   - Create a short "Next Sprint Ideas" section
4. Run full verification:
   - `npx tsc -b`
   - `npm run build`
   - `npm test`
5. Prepare a clean PR (or push directly to main) with excellent commit messages

**Output**: Updated `weekly_plan.md`, verification report, and ready-to-merge changes.

---

## Execution Rules

- Work on branch: `feature/next-sprint-may07-evening`
- Every agent runs `npm test` before finishing their task
- Use clear, atomic commits
- Agent 3 makes the final push / PR
- Keep changes minimal and high-quality

## How to Launch

```bash
git checkout -b feature/next-sprint-may07-evening

# Then run in kimi-cli swarm mode:
kimi swarm --task-file docs/plans/kimi-agent-swarm-task-next-sprint.md --agents 3
```

**Expected Outcome**:
- Playwright DisplayState tests complete (Ideas section closed)
- Full Vitest coverage for EventBus + GameStateManager
- `weekly_plan.md` properly updated
- Project in a very stable, well-tested state

---

**Start the swarm.** Let's close out the day strong! 🚀