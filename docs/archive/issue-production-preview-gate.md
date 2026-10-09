# [P1][CI] Production-build smoke gate: boot `dist/` under `vite preview` on both physics defaults, blocking

Expanded 2026-10-09 from the 2026-10-08 dispatch draft (§B) after Gemini / Kimi / Grok review, with every claim re-checked against `main` at `c9acc42`. Copy the body below into the GitHub issue.

---

## Context / motivation

The blocking `playwright smoke (desktop + mobile, blocking)` job in `.github/workflows/ci.yml` boots `npm run dev` through the `webServer` block in `playwright.config.ts` and runs four specs: `tests/verify_prism_core.spec.ts`, `tests/basic-gameplay.spec.ts`, `tests/lifecycle-dispose.spec.ts`, `tests/mobile-touch-smoke.spec.ts`. The production bundle is never booted anywhere in CI.

That gap is exactly what let #449 and #452 reach the owner with no signal: `vite.config.ts:8` drops every `console.*` in production (the built entry chunk contains zero console calls, including the `bootstrap().catch` handler at `src/main.ts:84-85`), while the dev server keeps them, serves unminified modules, and never runs the esbuild `drop` / `pure` settings. The `wasm-worker` default from PR #448 (`src/config/physics.ts:108`, chosen when `crossOriginIsolated` is true) has likewise only ever been smoke-tested against Vite dev.

Note that in this repo the dev server **does** register the service worker (`devOptions.enabled: true`, `vite.config.ts:225-229`; `registerServiceWorker()` is called unconditionally at `src/main.ts:22`), so the SW itself is not the untested part. The untested part is the bundle.

Related: #449 (console stripping), #452 (Start never enables), #443 Slice D (headers in-repo), PR #448 (wasm-worker default), the Native Physics assertion fix riding on the boot-visibility branch.

## Scope

**One new blocking job that builds `dist/`, serves it with `vite preview`, and runs the desktop smoke specs twice: once with the WASM bundle (production path, expects `wasm-worker`) and once without it (fail-closed path, expects `rapier`).** Desktop `chromium` only; the dev-server job keeps `mobile-chrome`.

## Proposed approach

### 1. `playwright.preview.config.ts` (new)

Model it on `playwright.degrade.config.ts`, not on a generic template:

- `testDir: '.'`, `webServer.command: 'npx vite preview --port 4174 --strictPort'`, `url: 'http://localhost:4174'`, `reuseExistingServer: !process.env.CI`, `timeout: 120_000`.
- `use.baseURL: 'http://localhost:4174'`; `use.serviceWorkers: 'block'` so the four smoke specs test the bundle, not Workbox (see the SW spec below for the one test that does not block it).
- `launchOptions.args`: the repo's existing flags (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-gpu-sandbox`, `--use-gl=angle`, `--use-angle=swiftshader`) plus `--enable-unsafe-swiftshader` (automatic SwiftShader fallback is deprecated in current Chromium; the flag is a no-op on builds that do not know it).
- One project, `chromium` with `devices['Desktop Chrome']`, `testIgnore: '**/mobile-touch-smoke.spec.ts'`.
- `vite.config.ts:19-23` already sets COOP / COEP on `preview`, so `crossOriginIsolated` is true under this server. Assert it anyway (below); do not rely on it.

### 2. Make the smoke specs port-agnostic

`tests/verify_prism_core.spec.ts:7` hard-codes `http://localhost:5173`; the other three already use `page.goto('/…')` against `baseURL`. Change line 7 to `page.goto('/')`. Then drop the "pinned to 5173 because verify_prism_core hard-codes it" sentence from the comment at `.github/workflows/ci.yml:57-58`. (Eleven other specs also hard-code 5173, e.g. `engine-bootstrap.spec.ts`, `campaign-progression.spec.ts`; they are not in the smoke set and stay out of scope.)

### 3. `tests/preview-boot.spec.ts` (new, runs only under the preview config)

One spec, three assertions, so a WebGL2-only boot that still loads the worker cannot pass as "production path":

```ts
// pseudo-code, keep it this small
await page.goto('/')
await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 60_000 })
const state = await page.evaluate(() => ({
  isolated: window.crossOriginIsolated,
  engine: (window as { currentPhysicsEngine?: string }).currentPhysicsEngine,
  renderer: document.querySelector('canvas')?.dataset.renderer ?? null,
}))
expect(state.isolated).toBe(true)
expect(state.engine).toBe(process.env.PREVIEW_EXPECT_ENGINE)   // 'wasm-worker' | 'rapier', set by the CI leg
expect(state.renderer).toBe('webgl2')                            // SwiftShader never offers a WebGPU adapter
```

`window.currentPhysicsEngine` is set in `src/game-elements/physics.ts:27`; `canvas.dataset.renderer` is the tag `tests/engine-bootstrap.spec.ts:41-54` already reads. `PREVIEW_EXPECT_ENGINE` is an env var the job sets per leg; locally it defaults to `wasm-worker` when `public/wasm/` exists.

### 4. `tests/preview-sw.spec.ts` (new, preview config, `test.use({ serviceWorkers: 'allow' })`)

The one test that lets Workbox run: `goto('/')`, wait for `navigator.serviceWorker.ready`, `reload()`, then assert `navigator.serviceWorker.controller !== null` **and** `window.crossOriginIsolated === true` on the SW-served document. This catches the failure mode where a precached response loses the COOP / COEP headers and the production default silently falls back to `wasm-owner`. (`registerType: 'autoUpdate'` at `vite.config.ts:45` means the worker claims clients on install, so one reload is enough.)

### 5. `scripts/check-dist-console.mjs` (new)

Post-build assertion that error reporting survived the esbuild settings. A bare `console.error(` presence check is weak (a dependency can satisfy it), so assert the literal **`Failed to bootstrap game`** from `src/main.ts:85`: with `drop: ['console']` the whole call expression is removed, string included; with the #449 `pure` list it survives. Also assert no `debugger`. Locate the entry chunk the same way `scripts/check-bundle-size.mjs:41-58` does (the largest `dist/assets/index-*.js`). Exit 1 with a one-line reason. Wire it as a step after `vite build`, `continue-on-error: true` with a comment "remove once #449 merges".

### 6. `.github/workflows/ci.yml`: new job `e2e-preview` (blocking)

- `runs-on: ubuntu-24.04` (pin it; `ubuntu-latest` is moving majors this autumn and emsdk + Mesa need re-verifying there). Node 22 like the other jobs.
- `strategy.matrix.wasm: [true, false]`, `fail-fast: false`. Matrix legs are separate runners, so there is no port sharing between them.
- Leg `wasm: true`: restore the Emscripten SDK with the **same** `actions/cache` key as `.github/workflows/native-physics.yml:115-119` (`emsdk-${{ runner.os }}-latest`, path `emsdk`) — the cache is repo-scoped and shared across workflows, so a Native Physics run on the same runner image usually leaves it warm — install + activate on a miss (copy the step at `native-physics.yml:121`), then `npm run build:wasm` (the Release build took 19 s in run 89). No cross-workflow artefact: `workflow_run` cannot be a required check on the PR that built the sources, and "latest main artefact" tests the wrong SHA.
- Leg `wasm: false`: `rm -rf public/wasm` before the build, mirroring the existing "Physics degrade" step. Do not install emsdk.
- Both legs: `npm ci` → `npx tsc -b && npx vite build` → `node scripts/check-dist-console.mjs` (continue-on-error until #449) → `npx playwright install --with-deps chromium` → `PREVIEW_EXPECT_ENGINE=<wasm-worker|rapier> npx playwright test --config=playwright.preview.config.ts tests/preview-boot.spec.ts tests/preview-sw.spec.ts tests/verify_prism_core.spec.ts tests/basic-gameplay.spec.ts tests/lifecycle-dispose.spec.ts`.
- `lifecycle-dispose.spec.ts` counts CDP listeners by `listener.type` (`tests/lifecycle-dispose.spec.ts:26-27`), not by function name, so minification does not affect it.
- Budget: build ≈ 1 min, WASM ≈ 20 s warm, Playwright ≈ 2–3 min for four desktop specs. Target under 6 min per leg; the legs run in parallel.

### 7. `docs/TESTING.md`

A short table: `playwright.config.ts` (dev, 5173, desktop + mobile, blocking `e2e`), `playwright.degrade.config.ts` (dev without WASM, 4173, `Physics degrade` step), `playwright.preview.config.ts` (built `dist/`, 4174, desktop only, blocking `e2e-preview`, two legs). Name which specs run where and why mobile is dev-only.

## Acceptance criteria

- [ ] `npx vite build && npx playwright test --config=playwright.preview.config.ts` passes locally with `public/wasm/` present (`PREVIEW_EXPECT_ENGINE=wasm-worker`) and after `rm -rf public/wasm` (`PREVIEW_EXPECT_ENGINE=rapier`).
- [ ] `e2e-preview` is a required (blocking) job with two matrix legs; both green on the PR.
- [ ] Canary proven and reverted: a throwaway commit with `throw new Error('ci-canary')` at the top of `bootstrap()` in `src/main.ts` turns both legs red; the PR description pastes that run's failure and the green run after revert.
- [ ] `tests/preview-boot.spec.ts` asserts `crossOriginIsolated === true`, `currentPhysicsEngine` equal to the leg's expectation, and `canvas.dataset.renderer === 'webgl2'`.
- [ ] `tests/preview-sw.spec.ts` passes: SW controls the reloaded document and `crossOriginIsolated` is still true.
- [ ] `scripts/check-dist-console.mjs` exists, is wired after `vite build`, asserts the `Failed to bootstrap game` literal and no `debugger`, and is `continue-on-error` with a "#449" comment.
- [ ] `tests/verify_prism_core.spec.ts` uses `baseURL`; the stale comment in `ci.yml` is updated; the existing `e2e` job's steps are otherwise unchanged.
- [ ] `docs/TESTING.md` updated. `npx tsc -b`, `npm run lint` (scripts are linted), `npx vitest run`, `npm run check:bundle` all pass.
- [ ] Each leg finishes in under 6 minutes on a warm emsdk cache.

## Out of scope / do not touch

`src/**` (the boot-visibility branch owns `src/main.ts`, `src/engine/create-engine.ts`, `src/game/game-scene-builder.ts`, `src/game/game-systems-init.ts`, `src/renderers/renderer-selector.ts`), `vite.config.ts`, `.github/workflows/native-physics.yml`, `deploy.py`, `bundle-budget.json`, `playwright.config.ts` / `playwright.degrade.config.ts` beyond nothing, `tests/mobile-touch-smoke.spec.ts`, the eleven other specs that hard-code 5173, action-version bumps on the existing jobs (separate PR), and any WebGPU-on-SwiftShader experiment (below).

## Decisions already made (so the implementer does not relitigate)

- **emsdk in-job on a shared cache, not a cross-workflow artefact.** PR checks must test the PR's SHA.
- **Desktop only on the preview legs.** #449 / #452 are not touch-specific; mobile stays on the dev job.
- **`serviceWorkers: 'block'` for the smoke specs, one explicit SW spec that allows it.** Blocking makes the four specs deterministic; the SW spec covers the header-loss risk.
- **No `physics-degrade.spec.ts` on preview.** The `wasm: false` leg plus `currentPhysicsEngine === 'rapier'` covers the production fail-closed path; the dev step already covers the marker behaviour.
- **Renderer under test is WebGL2.** SwiftShader via ANGLE offers no WebGPU adapter, so both legs exercise the `auto → WebGPU unsupported → WebGL2` path, which is also what every player without WebGPU hits.

## Open questions for Noah

1. **WebGPU headless leg (non-blocking experiment, separate PR?)** Chromium can boot WebGPU on a GPU-less runner with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface`, Playwright `channel: 'chromium'` (new headless, not the headless shell), and `libvulkan1` + `mesa-vulkan-drivers` installed. Worth a `continue-on-error` third leg asserting `canvas.dataset.renderer === 'webgpu'`, or leave it until a real-GPU need appears? Screenshots stay black on that path; only pixel readback and the dataset tag are usable.
2. **Action majors.** The repo pins `actions/checkout@v4` / `actions/cache@v4` / `setup-node@v4` everywhere. Bump the whole file to the current node24 majors in this PR, or in a separate housekeeping PR? (This issue only pins the new job to `ubuntu-24.04`.)
3. **Should `e2e-preview` replace the dev-server `Physics degrade` step eventually,** or do we keep both (dev covers the `[Bootstrap][physics-degrade]` marker, preview covers the bundle)?
4. **Once #449 lands**, replace the static `check-dist-console.mjs` check with a runtime one (a spec that forces a bootstrap throw and asserts the error banner)? Keep both?

## Reconciliation notes (what was taken from each review, and why)

- **Gemini:** config shape, in-job emsdk, `TESTING.md` table, the hard-coded-port dependency (real: `verify_prism_core.spec.ts:7`), the `crossOriginIsolated` assertion. Rejected: the CDP `functionName` worry (the spec counts by `type`), `devices['Pixel 5']` / Node 20 (repo uses Pixel 7 / Node 22), `needs: [build]` (no such job; `check` is the existing one).
- **Grok:** `--enable-unsafe-swiftshader`, the WebGPU-on-SwiftShader-Vulkan recipe (parked as open question 1), `serviceWorkers: 'block'` + explicit SW spec, assert the renderer not just the engine, no cross-workflow artefact, shared cache, `ubuntu-24.04` pin, the unique-literal console check. Corrected: the dev server **does** register the SW here (`devOptions.enabled`); the WASM is fetched whole, not by Range, so the 206 note does not apply.
- **Kimi:** desktop-only legs, `currentPhysicsEngine` runtime assertion. Rejected: port conflicts between matrix legs (separate runners), `vite preview --no-cache` (no such flag), cross-workflow artefact restore, manual SW unregister + `sleep(500)` (Playwright's `serviceWorkers: 'block'` does this properly).
