# Kimi Agent Swarm Task — Pachinball Backlog Sprint (2026-05-07)

**Repo**: https://github.com/ford442/pachinball  
**Goal**: Complete the remaining items from `weekly_plan.md` Backlog in parallel using a coordinated agent swarm.  
**Swarm Size**: 4 specialized agents (run in parallel)  
**Coordination**: Use GitHub branch `feature/swarm-backlog-may07`, create separate PRs or one consolidated PR. All agents must update `weekly_plan.md` and run `npm test` before finishing.

---

## Swarm Roles & Parallel Tasks

### Agent 1: Sound Architect (Highest Priority)
**Focus**: Sound System EventBus Integration  
**Files to touch**:
- `src/game.ts`
- `src/game/sound.ts` (or wherever `getSoundSystem` / `SoundSystem` is defined — discover it)
- `tests/` (add or update sound-related tests if missing)

**Instructions**:
1. Locate `getSoundSystem()` and `SoundSystem` implementation.
2. Refactor `getSoundSystem(eventBus?: EventBus)` to accept and subscribe to the EventBus.
3. Wire these events (use existing methods like `playBeep`, `playStartJingle`, etc.):
   - `'game:start'`
   - `'game:over'`
   - `'fever:start'`
   - `'jackpot:start'`
   - `'adventure:end'` (replace the direct `playBeep(440)` call)
4. In `src/game.ts`:
   - Pass `this.eventBus` when calling `getSoundSystem(this.eventBus)`
   - Remove the direct `this.effects?.playBeep(440)` line in the adventure END handler.
5. Verify no direct sound calls remain in `src/game.ts`.
6. Run `npm test` and confirm sounds still trigger correctly in browser.

**Output**: Clean commit + short summary of changes.

---

### Agent 2: Config Refactorer
**Focus**: Finish Config Extraction  
**Files to touch**:
- `src/config.ts`
- `src/game.ts`
- Possibly `src/display/` or other files with remaining hardcodes

**Instructions**:
1. Audit `src/game.ts` for any remaining magic numbers (known ones: `cameraFollowTransitionSpeed = 3.0`, `fogDensity = 0.015`, `mirrorSize`, `mirrorTexture.level = 0.6`, `skybox size = 200.0`, `uMapBlend = 0.5`, `scanlineIntensity = 0.12`, timing fallbacks).
2. Move them into appropriate sections in `src/config.ts` (create `CameraConfig`, `EnvironmentConfig`, `PostProcessConfig`, or expand `GAME_TUNING` / `visuals`).
3. Update all references in `src/game.ts` to read from `config`.
4. Keep changes minimal and type-safe.
5. Run `npm test`.

**Output**: Commit with "config: extract remaining magic numbers" + list of moved values.

---

### Agent 3: Audit Triage Specialist
**Focus**: Docs Audit Reports Triage  
**Files to touch**:
- `docs/` (all `*_AUDIT*.md` files)
- New file: `docs/AUDIT_TRIAGE_2026-05-07.md`

**Instructions**:
1. Review the most important audit reports:
   - `PHYSICS_AUDIT_MASTER.md` + `PHYSICS_*` reports
   - `LIGHTING_SHADOW_PP_AUDIT_REPORT.md`
   - `MATERIAL_PBR_AUDIT_REPORT.md`
   - `RENDERING_AUDIT_REPORT.md`
   - Any recent `CAMERA_*` or `INPUT_*` audits
2. For each report, create a short status:
   - ✅ Implemented / Stale / Needs work
   - Key open recommendations
3. Consolidate findings into `docs/AUDIT_TRIAGE_2026-05-07.md` with a clear table and prioritized action items.
4. If quick wins are obvious (e.g., one-line fixes), implement them.
5. Update `weekly_plan.md` with triage status.

**Output**: New triage document + updates to `weekly_plan.md`.

---

### Agent 4: Swarm Coordinator & Verifier
**Focus**: Orchestration, Testing, Documentation, GitHub PR
**Files to touch**:
- `weekly_plan.md` (final update)
- `README.md` (optional status update)
- GitHub: Create branch, PR(s), issue if needed

**Instructions**:
1. Monitor progress of Agents 1–3 (coordinate via shared branch or comments).
2. After all agents finish:
   - Run full test suite: `npm run test` + Playwright smoke tests.
   - Update `weekly_plan.md`:
     - Move all completed items to "Done (2026-05-07)"
     - Add new "Next Sprint" section if anything remains
   - Create a clear PR description with:
     - Summary of all changes
     - Test results
     - Links to individual commits
3. (Optional) Create a GitHub Issue titled "Backlog Sprint May 7 — Sound + Config + Audits" and link the PR.
4. Ensure everything is merge-ready.

**Output**: Final PR + updated `weekly_plan.md` + swarm summary.

---

## Swarm Execution Rules (Important)

- **Branch**: All agents work on `feature/swarm-backlog-may07`
- **Communication**: Use clear commit messages. Agents can leave comments in code or in `weekly_plan.md`.
- **Testing**: Every agent must run `npm test` before marking their task complete.
- **GitHub Collaboration**: 
  - Push to the shared branch.
  - Create one consolidated PR or separate PRs per agent (Coordinator decides).
  - Use GitHub PR comments or @mentions for handoffs.
- **Style**: Follow existing patterns (typed EventBus, clean separation, minimal changes).
- **Safety**: If any agent is blocked, they should document the blocker in `weekly_plan.md` and pause.

## How to Run This Swarm

1. Clone the repo and checkout a new branch:
   ```bash
   git checkout -b feature/swarm-backlog-may07
   ```

2. Copy this entire prompt into **kimi-cli swarm mode** (or run 4 separate kimi-cli instances with role-specific prompts).

3. Launch the swarm (example for kimi-cli):
   ```bash
   kimi swarm --task-file docs/plans/kimi-agent-swarm-task.md --agents 4
   ```

4. Let the agents work in parallel. The Coordinator (Agent 4) will finalize.

**Expected Outcome**: All three backlog items completed, tests passing, `weekly_plan.md` updated, and a clean PR ready for review/merge on GitHub.

---

**Start the swarm now.** Go! 🚀

*(This task is designed to be fully autonomous — agents should only ask for clarification if truly stuck.)*