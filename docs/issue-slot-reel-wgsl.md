# Slot-reel rendering: measure the canvas path, then decide on a WGSL/atlas hybrid (WebGPU parity)

## Context / motivation

The slot mini-game (#261) renders its reels through `src/display/display-reels.ts`. This is an active focus area (backbox display) in a WebGPU-first codebase, so the question came up: should the reels take a real WGSL/WebGPU path, or is the current canvas fallback fine — and are the two equivalent?

Three independent analyses (Gemini Pro, Grok, Kimi K2) audited this. **They agree on the current behavior but disagree on the conclusion**, so this issue is deliberately structured as *measure first, then decide* rather than "go build a shader." Read the "Contested premise" section before starting.

This is pure display work with **zero overlap** with the concurrent C++/WASM physics effort.

## Current behavior (verified by code audit — Gemini + Kimi agree)

- `display-reels.ts` has **no** `engine.isWebGPU` check anywhere. The WGSL path is entirely absent, not stubbed.
- Rendering uses a single **512×256** `DynamicTexture` on a `StandardMaterial` (`disableLighting = true`).
- `renderReels()` does full **CPU canvas-2D rasterization every frame during a spin** (`fillRect` backgrounds, clip regions, `fillText` symbols, glow shadow, win-line overlay) and then uploads via `dynamicTexture.update()` each frame.
- Spring settle physics (stiffness 90 / damping 4.0) computes fractional reel positions per frame.
- The only existing WGSL in the repo is `src/shaders/numberScroll.ts` (Babylon WGSL dialect, 5-sample motion-blur loop). Note: its history includes a "fix WGSL uniform access and syntax errors" commit — transpilation is not free.

## The contested premise (why this is measure-first)

| Source | Position |
|---|---|
| **Gemini Pro** | Per-frame `texture.update()` during a spin is a "severe bottleneck" that contradicts the WebGPU-first architecture → WGSL required. |
| **Kimi K2** (quantified) | 512×256×4 = **0.5 MB/frame** upload + ~0.13 MP rasterization is trivial on any modern GPU. WGSL saves ~0.2 ms (below perception), while adding transpilation/fallback risk, a 50–200 ms first-spin compile hitch, and atlas management. Canvas also gives free, crisp, native text. **Recommends canvas-only.** |
| **Grok** | WGSL `ShaderMaterial` is still idiomatic and fully supported in current Babylon (no deprecation through 9.x) — but does not argue it's *necessary* here. |

**Resolution:** don't assume the bottleneck exists. Prove it or rule it out (Phase 1), then only build the shader path if the data justifies it (Phase 2).

## Phase 1 — Measure (always do this first)

- Add debug-gated telemetry to `renderReels()`: canvas draw time + `update()` upload time, warn when total exceeds a **1 ms/frame** budget (Kimi's approach).
- Capture a spin on **both** WebGPU and WebGL2, and also during a stress moment (jackpot meltdown + gold-ball swarm) where the frame is already loaded.
- **Decision gate:**
  - If draw stays under budget (expected outcome) → **stop.** Document canvas as sufficient with the numbers, and close. This is a valid — and likely — endpoint.
  - If it exceeds budget or causes measurable frame drops under load → proceed to Phase 2.

## Phase 2 — Atlas + WGSL hybrid (only if Phase 1 fails the gate)

All three analyses agree: **do not attempt full-procedural WGSL text** — a shader can't render arbitrary labels like "DIAMOND"/"CHERRY". Use the atlas-hybrid (Kimi's Alternative B, matching Gemini's file plan):

- **Build a static symbol atlas once** at init: canvas draws each symbol into a grid on a `DynamicTexture`; regenerate only on `setSymbols()`.
- **`ShaderMaterial` (WGSL)** samples the atlas; per-frame updates are **uniforms only** (`uReelOffsets`, `uReelSpeeds`) — no per-frame canvas redraw or `DynamicTexture.update()`.
- **Dual path in `createLayer()`** branched on `engine.isWebGPU`; the existing canvas path stays byte-for-byte as the WebGL fallback.
- Pass a `useWGSL` flag from `display-core.ts` into the `DisplayReelsLayer` constructor (currently computed in `display-core.ts` but not forwarded).
- Extract shader strings to a new `src/shaders/reels.ts` (follow the `numberScroll.ts` Babylon-WGSL dialect).
- Motion blur: optional, only during high-speed spin, per-reel via uniform arrays. **Skip it if it complicates the fallback** — Kimi notes the eye integrates reel motion at 60 fps, so it's marginal.
- `updateParallax()` and the CRT post-process compose over the reel mesh automatically (reels live at `DISPLAY_LAYER_Z.REELS`); no changes needed there.

### Babylon/WGSL implementation notes (Grok, current mid-2026)

- Set `shaderLanguage: BABYLON.ShaderLanguage.WGSL` explicitly.
- Declare `attributes` / `uniforms` / `uniformBuffers: ['Scene','Mesh']` / `samplers` explicitly in the options object. **Do not include a `color` attribute** (special-cased).
- Babylon WGSL dialect: read attributes via `vertexInputs.*`, write varyings via `vertexOutputs.*`, read them via `fragmentInputs.*`; pull built-ins with `#include<sceneUboDeclaration>` / `#include<meshUboDeclaration>`; sample with `textureSample(...)`.
- **DynamicTexture on WebGPU must be `.update()`-ready before binding** or you get a wrong/random texture — applies to the atlas; wait on readiness before first draw.
- Crisp symbols at speed: SDF/MSDF is the gold standard (no native Babylon MSDF; a community lib exists). Treat MSDF as a **stretch goal**, not a requirement — a sufficiently high-res atlas is likely fine.
- Repo is on Babylon 7.31.1; the pattern is stable through 9.x. **No engine upgrade is required** for this work.

## Acceptance criteria

**Phase 1 (required):**
- Debug-gated draw/upload telemetry in `renderReels()`.
- Numbers recorded in the PR for WebGPU + WebGL2 (+ under-load sample).
- A written go/no-go decision backed by the data.

**Phase 2 (only if gate triggers):**
- `display-reels.ts` has an explicit, documented `engine.isWebGPU` branch; canvas path unchanged as fallback.
- WGSL path builds the atlas once and does **uniform-only** per-frame updates (no per-frame `DynamicTexture.update()`).
- WGSL path renders reels with no console/WebGPU errors and visually matches the canvas layout (symbol positions, win-line).
- **Playwright visual-regression** spec asserting both paths produce equivalent reels. Vitest runs on `NullEngine` and compiles zero shaders, so a visual snapshot is the *only* way to validate uniform binding / UV wrapping / atlas layout. Drive it via the debug hooks in `slot-machine.ts` (`window.forceSlotSpin([...])` + spin-state getter); force each render path.
- `npx tsc -b`, `npm run lint`, `npm run build`, `npx vitest run` all green; `npx playwright test` passes the new spec.

## Boundaries

Touch `src/display/display-reels.ts`, `src/display/display-core.ts` (constructor wiring only), a new `src/shaders/reels.ts`, and a new Playwright spec. **Do not** touch `native/**`, `src/wasm/**`, `src/game-elements/physics.ts`, `src/game/game-physics-controller.ts` (active parallel WASM lane), the slot *logic* (`slot-logic.ts` / `slot-machine.ts` orchestration), or any physics/adventure files.

## Open questions for Noah

1. **Gate policy:** if Phase 1 shows canvas is under budget (likely), accept canvas-only and close — or build the WGSL path anyway for architectural consistency / future dense-symbol effects?
2. **Motion blur:** want it, or skip (Kimi: negligible at 60 fps, not worth fallback complexity)?
3. **MSDF:** confirm it's out of scope unless atlas symbols look soft during fast spins?
4. **Visual baseline:** OK to commit Playwright snapshot PNGs to the repo?
