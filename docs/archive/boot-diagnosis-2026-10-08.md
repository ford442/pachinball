# Boot diagnosis — issues #449–#455

Branch `fix/boot-visibility-449-455`, based on `main` c9acc42. Written when the boot-visibility
fixes landed; this note covers what is *not* fixed by code and what the owner should run next.

## Where the owner's Windows machine stands

Symptom (#452): Start stays greyed with the "Loading cabinet…" tooltip and the table is black,
even with `?renderer=webgl2`, with nothing in the console. Before this branch a failed boot was
invisible: the production build used `esbuild.drop: ['console']`, so the
`console.error` in `bootstrap().catch` (and every `[StageDebug]` line) did not exist.

**It does not reproduce on c9acc42 in CI-like conditions.** Headless Linux Chromium with SwiftShader
(the same flags as `playwright.config.ts`), measured 2026-10-09 against a pristine checkout of c9acc42:

| Build | URL | Start enabled after | `Error compiling effect` | Flippers (mesh + joint) |
|---|---|---|---|---|
| production (`vite build` + `preview`) | `/` (auto) | 6.6 s | 0 | left + right |
| production | `/?renderer=webgl2` | 8.5 s | 0 | left + right |
| dev server | `/?renderer=webgl2` | 11.1 s | 0 | left + right |

In all three runs `window.game` was set, `#start-btn` was enabled with label "Start Game",
the stylesheet was applied, and the physics mode was `wasm-worker`. Healthy per-stage timings
(dev server, `?renderer=webgl2`, SwiftShader, so slower than real hardware):

```
settings_ui 64 ms · render_bootstrap 216 ms · core_helpers 2 ms · state_setup 6 ms
physics 2766 ms · scene_rendering 123 ms · scene_gameplay 88 ms · scene_optional 63 ms
scene_critical 3365 ms (cabinet glTF) · scene_gameplay_build 674 ms · input_runtime 3 ms
managers_postinit 1 ms · scene_cosmetic 1097 ms (after Start) · total 7.6 s
```

The issue also cites the deployed bundle `index-yWcUHvFd.js`. Per the task brief that is the
Aug 31 build; I did not fetch the deployed site to confirm, but it means the report may describe
code that `main` no longer contains. Rule that out first.

### What the owner should run on the Windows machine

1. **Make sure the page is running current code.** DevTools → Application → Service Workers →
   *Unregister*, Application → Storage → *Clear site data*, then hard-reload. The PWA is
   `registerType: 'autoUpdate'` and runtime-caches same-origin JS `CacheFirst` for 30 days
   (`vite.config.ts`, cache `nexus-js-chunks`), so a stale worker can keep serving an old bundle.
   In the Network tab confirm the entry script is **not** `index-yWcUHvFd.js`.
2. Open the deployed URL with `?renderer=webgl2` appended, with DevTools open (Console and Network,
   "Preserve log" on).
3. **Read the banner at the top of the page.**
   - *Game failed to start* — an error was thrown. The second line is the message, the third is
     `Stage: <key> (<label>)` (the checkpoint stage that was running, or `engine + physics
     preload` if it failed before the Game existed). `#start-btn` reads **Load failed** and its
     tooltip is the same message. The console has `Failed to bootstrap game` plus the error and
     stack (these reach the production console through `src/boot-log.ts`).
   - *Still loading…* — nothing threw, but Start was still disabled 30 s after the page began
     loading. The `Stage:` line lists the stage(s) still `loading`. The console has
     `[Bootstrap] Start still disabled after 30s; loading: …`.
   - No banner and Start enabled — the boot worked; the problem is elsewhere (see #453/#454 below).
4. Add `?debug=1` for the **Checkpoint Debug Stages** panel (✓ / ✗ / ⏳ with per-stage timings and
   the error text). `debugStages=<comma list>` runs *only* the listed stages and skips the rest, so
   to rule the optional ones out use
   `?debug=1&debugStages=settings_ui,render_bootstrap,core_helpers,state_setup,physics,scene_rendering,scene_gameplay,scene_critical,scene_gameplay_build,input_runtime`.
5. Copy these into the issue: the banner text, `chrome://gpu` (WebGL2 status, "Hardware
   accelerated"), and in the console `window.currentRenderer`, `window.currentPhysicsEngine`,
   `crossOriginIsolated`, and whether `window.game` is defined.
6. `window.runVisibilityDiagnostic()` **prints nothing in a production build** (its `console.*`
   calls are stripped; I measured 0 lines on a production build of c9acc42). To use it, run
   `npm run dev` or build with `NODE_ENV=development npx vite build`.

### What each stage failure implies

The message on the banner is the real cause; the right-hand column is where to look first.

| Stage on the banner | What runs there | Where to look |
|---|---|---|
| `settings_ui` | DOM lookups, `GameUIManager`, Start listener, lazy `daily-cascade-ui` chunk, `localStorage` settings | A lazy-chunk fetch failure ("Failed to fetch dynamically imported module": stale cache, blocked request, wrong base path); `index.html` out of step with the JS bundle |
| `render_bootstrap` | camera, post-processing/bloom, lighting, room environment, resize/DPR observers | GPU/driver or shader-compile problem (look for `Error compiling effect` in the console); environment-texture load |
| `core_helpers` | constructs the helper classes, settings panel | Missing element from `index.html` (HTML and JS from different deploys) |
| `state_setup` | sound system, event bus, state machine, physics controller | The stack on the console error; construction of those objects |
| `physics` | `PhysicsSystem.init()`: C++ WASM bundle, worker when cross-origin isolated | Network tab for `PhysicsModule.wasm` / `.js` (404, wrong MIME type, must be `application/wasm`) and the physics worker script. Missing COOP/COEP headers are *not* a failure (it runs in-process as `wasm-owner`); a worker that never answers `init` hits a backstop timeout and surfaces here |
| `scene_rendering` | skybox, `MirrorTexture`, `EffectsSystem`, `DisplaySystem` (WGSL or canvas backbox), cabinet lighting | GPU/shader failure, MirrorTexture size unsupported |
| `scene_gameplay` | `GameObjects`, `BallManager`, zone triggers | The stack on the console error |
| `scene_critical` | playfield group, cabinet glTF (15 s timeout per LOD, then procedural fallback), LCD playfield, walls, flippers, ball, backbox | **Stalled** here = the cabinet GLB request is hanging (Network tab). **`Critical scene incomplete: N/2 flipper joints, M flipper meshes`** = flippers or joints were not built (new assertion, see #453) |
| `scene_gameplay_build` | bumpers, slingshots, pachinko field, rails (runs *after* Start enables) | Start is already live; the table is incomplete. A stall here used to be a hidden-tab `requestAnimationFrame` (now raced against 50 ms) |
| `input_runtime` | `GameInputManager`, gamepad, touch, render loop | The stack on the console error; a skipped stage here means no render loop and a black canvas |
| `managers_postinit` (optional) | maps/cabinet/adventure managers | Failure is swallowed: `Optional stage managers_postinit failed` + the error in the console, boot continues |
| `scene_optional`, `scene_cosmetic` (optional) | adventure toys, cosmetic scene | Same: logged, not fatal |

`scene_lcd_post` exists in `DEBUG_STAGES` but nothing in `src/` runs it, so it never appears.

If the banner says *Still loading…* with `engine + physics preload`, the hang is before the Game
exists: `createEngine()` (WebGPU adapter/device request) or the physics bundle preload. With
`?renderer=webgl2` only the physics preload and `new Engine()` remain.

## What this branch fixed

| Issue | Change |
|---|---|
| #449 | Boot errors are visible: banner + "Load failed" Start + prod-visible console lines. See *Console decision* below for why `drop` was kept |
| #450 | `setRendererPreference('webgl2')` stores `'webgl2'` (only `auto` clears the key); the switch buttons reload with `?renderer=<choice>`, which outranks storage, and rewrite a stale param (so "Try WebGPU" works after the banner's `?renderer=webgl2` link) |
| #451 | After every WebGPU feature level fails, the WebGL2 fallback builds the engine on a fresh clone of the canvas (a canvas that has handed out a `webgpu` context returns `null` for `getContext('webgl2')`); `main.ts` tags `engine.getRenderingCanvas()` |
| #452 | 30 s watchdog (pre-Game on a local `TimerScope`, then `game.timers`, so `Game.dispose()` cancels it); `yieldFrame()` races rAF against `setTimeout(50)` |
| #453 f1 | Cabinet load starts first and is awaited at the end of `scene_critical`; walls, flippers and ball no longer wait for it; both flippers (mesh + joint) are asserted before Start enables. `createBackbox` still follows the cabinet because `BackboxBorderGlow` binds to the preset's `cabinetBackbox` mesh |
| #455 | A missing music track is `console.debug`, no fetch is attempted (`tests/play-map-music.test.ts`). The 404s in the issue belong to the pre-Aug-31 build that still requested `/api/music`; `fetchMusicTracks()` is a no-op on main |
| CI | `.github/workflows/native-physics.yml` asserted `defaultEngine: 'wasm-owner'`, which PR #448 changed to `'wasm-worker'`. That one `grep` failed the Release WASM step and skipped every wasm Playwright spec on `main` since 10-05. It now checks `defaultEngine: 'wasm-worker'` and `nonIsolatedDefaultEngine: 'wasm-owner'` |

## Not changed, with reasons

### #453 finding 2 — "WASM owner mode skips the joint motor": by design

In `wasm-owner` / `wasm-worker` the flippers are C++ revolute hinges with motors, driven by the
engine, not by Rapier. `WasmOwner.driveFlippers()` (`src/game/physics/wasm-owner.ts`) runs every
step: it reads the pressed state from the input frame and calls `engine.setHingeMotor()` with the
same stiffness/damping tuning the Rapier path uses (`native/src/HingeJoint.cpp` is the other
side). `GameInputActions.handleFlipperLeft/Right` therefore skips `configureMotorPosition` when
`physics.isWasmOwnerMode()`; calling it would write to a Rapier joint that does not exist in that
mode. It is covered by `tests/wasm-owner-flipper.spec.ts` and `tests/wasm-worker-flipper.spec.ts`.
No Rapier motor fallback was added.

### #453 finding 3 (pose sync under the tilted `playfieldGroup`) and #454 (unstyled page): not reproduced

Headless run of `window.runVisibilityDiagnostic()` on c9acc42 (dev server, `?renderer=webgl2`,
viewport 1280×800, camera `cabinetCamera` at (0, 16, −21) looking at (0, 2, 6)):

- 790 meshes; every `flipper*` mesh (19) is enabled, visible and **in the camera frustum**, parented
  under `flipperRoot` → `playfieldGroup` (tilted 18°, `rotation.x` 0.314). `lcdGround`,
  `flipperGlow` and both flipper ramps are in frustum.
- Left and right flipper entries both have a mesh and a joint.
- Screenshot: styled UI, the table, flippers and the start overlay all render. The canvas is
  680×748 (not the unstyled default 300×150).
- Both the dev and the production build of c9acc42 apply their stylesheet(s) and `#game-cabinet`
  is `display: flex`. #454 asked whether this reproduces on the owner's machine; it does not in
  headless Linux Chromium, which fits its own note that it may be specific to that browser.

One observation outside the issue's claims, not investigated: the main ball spawns at
(10.5, 0.5, −9) — its mesh and physics body agree — and `isInFrustum` is **false** for it in the
menu state (and after Start in this run). The plunger lane may simply sit outside the visible
frame in a 680×748 canvas; I have no evidence that is wrong, so I changed nothing.

## Console decision (why `esbuild.drop` was kept)

The task asked for `esbuild.pure: ['console.log', 'console.debug', 'console.info']` so
`console.warn`/`console.error` survive. Measured entry-chunk gzip (budget ceiling 210.00 KB, `main`
at 209.80):

| Config | Entry |
|---|---|
| main, `drop: ['console', 'debugger']` | 209.80 |
| main, spec `pure` list | 213.22 |
| main, **every** console method in `pure` | 211.10 |

`pure` (unlike `drop`) keeps side-effecting call arguments (`x.toFixed()`, `isCrossOriginIsolated()`,
…) spread across dozens of files, about +1.3 KB even when every method is listed, and keeping the 81
`console.warn` + 9 `console.error` call sites costs about +2.1 KB more. That cannot fit without
raising the budget or editing files outside this task's boundaries, so the owner chose to keep
`drop` and route only boot-critical diagnostics through `src/boot-log.ts`
(`globalThis.console.*`, which the strip does not match), with the banner lazy-loaded.
Everything else stays silent in production, as before.
