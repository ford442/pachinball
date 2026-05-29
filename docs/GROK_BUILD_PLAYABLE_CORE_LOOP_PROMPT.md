# Grok Build Prompt — Make Pachinball Playable End-to-End (4 Phases)

**Repo:** https://github.com/ford442/pachinball  
**Live demo:** https://test.1ink.us/pachinball/index.html  
**Key context files (read first):**
- `README.md`, `grok.md`
- `docs/ADVENTURE_CAMPAIGN.md`
- Physics audits (all of them): `docs/PHYSICS_COLLISION_AUDIT.md`, `PHYSICS_MOTION_AUDIT.md`, `PHYSICS_CONFIG_AUDIT.md`, `PHYSICS_ROBUSTNESS_AUDIT.md`, `PHYSICS_PERFORMANCE_AUDIT.md`, `PHYSICS_AUDIT_MASTER.md`
- `docs/wasm-physics-engine.md`

**GitHub issues created for this work (use these exact numbers):**
- #202 Phase 1 — Core Physics Collisions & Bumper Interaction System
- #203 Phase 2 — Launcher/Plunger Mechanics & Ball Launch Control
- #204 Phase 3 — Level/Map Loading, Table Switching & Free Map Test Mode
- #205 Phase 4 — Playable Level Loop, Drain Detection, Scoring & Map Progression

---

## Verified Current State (as of latest investigation)

**Collisions:**  
Partially-to-mostly in place and improved since the audits. `src/game-elements/physics.ts` now implements the top recommendations: fixed 60 Hz timestep + accumulator, DT clamping, solver iterations=8 + extra friction, contactSkin=0.005.  
`src/game/game-physics-controller.ts` has solid dispatch with handle Sets (bumper/flipper/target/spinner/trap/launcher/gate/death/portal), debounce, NaN guards, and early portal skip.  
Bumper hits → `handleBumperCollision` → score + combo + effects + ball animator (reliable).  
Death zone drains correctly. Flippers have dynamic bodies + revolute joints + CCD and collision routing.  
**Remaining gaps (correctness + feel):** no collision groups (perf), some secondary dynamic objects may miss consistent event wiring on map reloads, contact force magnitude under-used for intensity, a few O(N) visual lookups remain.

**Launcher/Plunger:**  
Confirmed broken experience.  
- Visual plunger (shooterRod + knob in `object-decoration.ts`) animates on charge via `updatePlungerVisual` (pulls back on Z).  
- Full charge system exists (input.ts, game-input-actions.ts, haptics, sound) — hold/release works, variable impulse is applied to the ball when it is in the plunger lane (`x > 8 && z < -4`).  
- **No physical/kinematic plunger body.** The rod is cosmetic. No contact, no spring joint, no "the plunger physically strikes the ball."  
- Separate `LauncherBuilder` (`object-launchers.ts`) creates cool fixed cyber feeder mechanisms with their own charge visuals — these are **not** the classic right-lane pinball plunger.  
User report "the launcher does not move" is accurate for physical expectation.

**Playable level + advance to next / free map mode:**  
Not yet possible as a smooth, repeatable loop.  
- Core stationary table loop exists (spawn at config ball.spawnMain in plunger lane with tiny pop, charge/impulse launch, flip with Space, bumper scoring, drain → lives or GAME_OVER).  
- Adventure campaign (A/B EXTENDED_MAP ↔ STATIONARY_TABLE alternation) has conceptual pieces: `AdventureTrackProgression` + `AdventureProgressionSupervisor`, portal sensors + intersectionPair detection, `onPortalEntered` → track complete → advance.  
- **Missing glue for "play a level and advance":**
  - No physical launcher (Phase 2) makes the start of every attempt feel wrong.
  - Drain in pure table mode only costs lives — no intentional "level complete + next map" path outside full adventure supervisor.
  - No lightweight **Free Map / Sandbox Test Mode** (hotkey, debug HUD, or console) that lets you instantly load any adventure track or stationary variant, get a clean ball + full input/physics, and iterate rapidly. Current map switching is mostly LCD shader + some adventure dynamic overlays; core table objects are not easily swappable.
  - End-to-end state hygiene on repeated map resets / ball drains is still fragile in places (body leaks, kinematic state, supervisor reset).

**Good news:** The physics foundation (fixed timestep, event dispatch, many robustness guards) and input scaffolding are much stronger than the May 2026 audits. The gap is **gameplay wiring + physical launcher + loader + test harness**, not the low-level Rapier integration.

---

## Mission

You are a senior Babylon.js + Rapier3D (WASM) + WebGPU game developer specializing in lightweight, high-feel physics PoCs.

Investigate the current implementation (start with the physics audits + the files listed in the 4 issues), close the gaps, and deliver a playable core loop so a user can:

1. Launch a ball (with satisfying physical or tightly-coupled plunger feel)
2. Flip the paddles (Space — already works)
3. Hit bumpers for points with reliable, juicy feedback
4. Drain or complete the objective
5. Advance to the next map (or freely switch in test mode)
6. Repeat cleanly

**Strict guidelines (from grok.md):**
- Keep it lightweight PoC — no over-engineering.
- Prioritize fun factor, responsive physics feel, 60 fps stability.
- WebGPU-first, graceful fallback.
- Test manually in Chrome/Edge with WebGPU.
- Follow the exact 4 phases defined in GitHub issues #202–#205. Work one phase at a time.

**Workflow (do not skip):**

1. Explore the repo (read the physics audits first — they contain the historical state and known issues; then read the current implementations in `src/game-elements/physics.ts`, `game/game-physics-controller.ts`, `objects/object-launchers.ts`, `object-bumpers.ts`, `game-input-actions.ts`, `adventure-track-progression.ts`, `game-systems-init.ts`, etc.).
2. Search for physics world, rigid bodies (ball, launcher, bumpers, paddle, death zone, portals), input handling, scene setup, map/config code, and the EventBus flows.
3. Work **one phase at a time**. For each phase:
   - Summarize current state after investigation (cite specific files/lines).
   - Implement the **minimal solid changes** needed.
   - Test locally (`npm run dev`) + in browser (WebGPU).
   - Lightly update relevant docs or the phase issue.
4. When a phase is done, clearly mark progress in the GitHub issue and move to the next.
5. Only after Phase 4 passes the success criteria below should you declare victory.

**Final success criteria (Phase 4 green):**
- User can launch (with good feel) → play a level (flip + bumper hits + visible scoring) → drain or end → advance to next map **or** freely switch in test mode → repeat.
- R reset works cleanly in all states.
- Physics feels like a real hybrid pachinko-pinball table (responsive paddle, satisfying bumper hits, predictable ball behavior, no tunneling or weird sticking under normal play).
- Free Map Test Mode lets you iterate any layout in seconds.
- At least one full A/B adventure portal loop works end-to-end.

**Focus areas per phase (high level — see the full issue bodies for details):**

- **Phase 1 (#202):** Rapier colliders + contact events for bumpers/walls/paddle. Stable bouncy ball. Reliable scoring + feedback on hits. Collision groups, handle caching, contact force usage where cheap.
- **Phase 2 (#203):** Kinematic (or tightly synced) launcher + input (pull/release or hold). Variable launch power that feels physical. Ball spawn + impulse (or contact) that is satisfying. Keep existing charge UX.
- **Phase 3 (#204):** Simple map config + minimal LevelLoader / MapSwitcher. Runtime switch between STATIONARY_TABLE / EXTENDED_MAP + specific tracks. **Free Map Mode** (hotkey or debug UI) for instant testing of any layout with clean physics reset.
- **Phase 4 (#205):** Drain sensor/detection polish. Gameplay state machine hygiene. Progression glue (table → advance or test-mode next). Minimal HUD. Full end-to-end manual test loop. R always returns to launch-ready state.

**Reporting:**
Report findings, proposed diffs (or actual PRs), test results (what you manually verified in browser), and any blockers. When blocked on a specific file or Rapier pattern, share the relevant snippet and ask for targeted help.

Prioritize making the physics **feel good** — responsive paddle, satisfying bumper hits, predictable ball behavior — over visual polish.

Start now with a short investigation summary + which phase you will tackle first (and why).

---

## Quick Start Commands for the Agent

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production build
npm run lint
npx playwright test  # optional E2E after core loop works
```

Open Chrome/Edge with `chrome://gpu` or `edge://gpu` to confirm WebGPU is active.

---

Copy the text above (from the `---` line downward) and paste it directly into any agent (Grok Build, Jules, Kimi Code, GitHub Copilot Workspace, Claude Code, etc.). It is self-contained.

Once the phases are moving, we can add themed visuals (the concept/ images in the repo are perfect reference), particles on bumper hits, better materials, or music-reactive elements later.

Let's get this thing actually playable. 🚀
