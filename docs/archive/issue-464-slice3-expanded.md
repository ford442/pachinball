# [P1][Correctness] Subdirectory-safe asset URLs and a prompt-based PWA update policy (#464 slice 3)

Refs #464 (findings 5 and 8). Expanded 2026-10-15 from the planner draft plus a Gemini codebase pass, a gpt-oss stress-test and a Grok ecosystem check; every file/line below was re-verified on `main` at `0cef18c`.

## Context / motivation

Production is `https://test.1ink.us/pachinball/`, built with `base: './'` (`vite.config.ts:6`) on Vite 7.2 and `vite-plugin-pwa` 1.3.0 (Workbox 7). Several runtime URLs are root-absolute or hand-joined, so the deployed game degrades silently under the subdirectory, and the service worker's update policy can reload the page mid-game. Nothing here changes gameplay, physics or rendering, and nothing here touches the files the #464 slice 1–2 lane owns.

### Verified defects

**Root-absolute (broken under `/pachinball/`):**
- `src/audio/audio-engine.ts:15` `WORKLET_URL = '/audio/pachinko-voice-processor.js'`, used by `addModule` at `:108`. 404s at the origin root; `audio-engine.ts:116-119` falls back to oscillators with no visible error. The pachinko voice worklet has never run on the live site.
- `index.html:5` `href="/vite.svg"` and `:6` `href="/icons/icon-192.png"`. Public files; Vite does not rewrite them. (`:15` `/src/style.css` and `:299` `/src/main.ts` are module entries and are rewritten, fine.)
- `src/config/api.ts` `resolveBackboxAssetPath` returns `/backbox/${relative}` in the dev branch (`VITE_ASSET_URL` unset, `PROD` false). Production returns the CDN URL, so this only bites a non-root dev/preview.

**Hand-joined `BASE_URL` (each with its own empty-base default):**
- `src/audio/audio-sample-bank.ts:66` (`|| '/'`), `src/game-elements/map-system.ts:152` (`?? './'`), `src/materials/material-core.ts:124` (bare concat, field initializer read by `loadEnvironmentTexture` / `tryLoadTexture`), `src/effects/effects-particles.ts:153` and `:157` (bare concat).
- The one correct resolver is `resolveAssetUrl` in `src/core/asset-urls.ts:13`.

**Deprecated wrapper:** `resolveVideoUrl` (`asset-urls.ts:22`) has four call expressions in three files, `src/game/game-scenario.ts:136` and `:143`, `src/adventure/adventure-state.ts:528`, `src/adventure/zone-registry.ts:52`, plus three barrel re-exports: `src/core/index.ts:24`, `src/game/game-utils.ts:4`, `src/game/index.ts:54`. No test imports it. `tests/cabinet-gltf-lod.test.ts` mocks `resolveAssetUrl` with one argument.

**PWA policy (`vite.config.ts`):**
- `:45` `registerType: 'autoUpdate'` with `:46` `injectRegister: false`. In `vite-plugin-pwa` 1.3.0 `autoUpdate` subscribes to `activated` and reloads on `isUpdate`; it never subscribes to `waiting`, so `onNeedRefresh` (`src/pwa/register-sw.ts:32`, which today only `console.info`s) never fires, and `updateSW()` is a no-op in that mode. Because `injectRegister` is `false` the plugin does not inject `skipWaiting`, so a new worker waits while a tab is open and the reload happens whenever something else activates it.
- `:89` `navigateFallbackDenylist: [/^\/api\//]` matches the origin root only.
- `:97` `globIgnores` hard-codes 17 track chunk names; three of them (`neon-helix`, `cyber-core`, `pachinko-spire`) match no emitted file, and a new `src/adventure/tracks/*.ts` is precached by default.
- `:145` and `:174` `localhost:8000` runtime rules ship in the production `sw.js`.
- `:225` `devOptions.enabled: true` unconditionally. Note: `vite preview` runs with `command === 'serve'` and `mode === 'production'`, so gating on `mode` (not `command`) is what keeps preview on the built `dist/sw.js`.

**Not bugs, leave alone:** `src/wasm/physics-worker-boot.ts:33` `new Worker(new URL('./physics-worker.ts', import.meta.url), { type: 'module' })` and `:26` `new URL(bundleUrl, location.href)` with `bundleUrl: './wasm/PhysicsModule.js'` (`src/config/physics.ts`) both follow the document directory correctly; rewriting either to `/wasm/…` would 404 production physics. `apiFetch('/maps')`, `/replays`, `/leaderboard`, `/adventure/progress`, `/challenges` are API paths prefixed by `API_BASE`, not static assets. `display-lcd-overlay.ts`, `object-decoration.ts`, `cabinet-gltf-loader.ts`, `sound-system-synth.ts` already go through `resolveAssetUrl`. No `fetch('/…')` in `src/`, no `url(/…)` in CSS.

### Ecosystem check (2026-10-15)
`vite-plugin-pwa` 2.0.0 exists (Node ≥ 20.19 floor, otherwise modest); stay on 1.3.0 for this slice. `registerType: 'prompt'` + `registerSW({ onNeedRefresh })` is still the documented pattern. Vite 7/8 did not change `base: './'`, `import.meta.env.BASE_URL` or `new URL(…, import.meta.url)` semantics. Same-origin AudioWorklet scripts need no CORP header under COEP `require-corp`; the script must still arrive with a JavaScript content type. Babylon 7→9 did not change relative asset resolution.

## Decisions (made; do not relitigate)

1. **Keep `base: './'`.** An absolute `base: '/pachinball/'` would change `BASE_URL` for `src/wasm/**` (slice 1–2 lane), break root-hosted previews without a `VITE_BASE`, and the `?url` / eager-glob alternative would push the entry chunk past its 210.00 KB ceiling (0.93 KB of headroom).
2. **No service-worker URL rewriting.** It fails on the cold first load (the worklet is requested before the SW controls the page), on `Shift+Reload`, and wherever SWs are blocked.
3. **One resolver, two functions.** `resolveAssetUrl(path, base = import.meta.env.BASE_URL || './')` stays the only `BASE_URL` read; add `resolveAbsoluteAssetUrl(path, base?, baseUri = document.baseURI)` for APIs that need an absolute URL (`addModule`). Both strip leading `./` and `/` from `path`, pass `http(s):`, `data:` and `blob:` through, and normalise the base so `''`/`'.'`/`'./'` → `'./'` and `'/pachinball'` → `'/pachinball/'`. `resolveAbsoluteAssetUrl` appends a `/` to `baseUri`'s pathname when its last segment has no `.` (so `https://test.1ink.us/pachinball` without a trailing slash resolves to `/pachinball/audio/…`, not `/audio/…`). The app has no client-side routes, so deep-route resolution is out of scope.
4. **Worklet URL:** `addModule(resolveAbsoluteAssetUrl('audio/pachinko-voice-processor.js'))`. Expose `workletModuleUrl` (the resolved string) and the existing `isWorkletReady()` on `AudioEngine`, forwarded by `SoundSystem` (already on `window.game.soundSystem`). Attach a `processorerror` listener on the voice node and expose `workletProcessorError`.
5. **PWA:** `registerType: 'prompt'`, `injectRegister: false` unchanged, add `workbox.clientsClaim: true` (without `skipWaiting`). Rationale: in prompt mode the plugin registers one `controlling` listener and reloads once; `updateSW(true)` only posts `SKIP_WAITING`; without `clientsClaim` the new worker never fires `controllerchange` and accept does nothing. The accept handler must **not** call `location.reload()` itself (double reload races the claim). A one-shot guard so a double click posts `SKIP_WAITING` once.
6. **Toast is a lazy `import()` from `register-sw.ts`** (that module is on the entry graph via `src/main.ts`). It does not import `GameState` or any game module. It mounts without stealing focus (no `.focus()`, buttons act on click only, so Space/Enter on the flippers cannot accept it), and has a **Later** button that only dismisses; the next load prompts again. No PLAYING-state gating in this slice (open question 2 answered: show immediately, non-focusing).
7. **`navigateFallbackDenylist: [/\/api\//]`** (unanchored): matches `/api/…` and `/pachinball/api/…`. With `base: './'` a `^${base}api/` form cannot be built.
8. **`globIgnores` derived from the directory:** `readdirSync('src/adventure/tracks')` → `**/${basename}-*.js` per `.ts` file (14 today: bio-hazard-lab, casino-heist, cpu-core, gravity-forge, magnetic-storage, neon-skyline, neon-stronghold, neural-network, orbital-junkyard, pachinko-hall, polychrome-void, prism-pathway, synthwave-surf, tesla-tower). Vite's default `assets/[name]-[hash].js` names chunks after the facade basename, and `manualChunks` returns `undefined` for tracks, so this matches exactly the dynamic-import chunks and nothing else. Do not merge tracks into one `manualChunks` group. JSON tracks are eager-globbed into the registry chunk and are not affected. Drop the three dead names.
9. **`localhost:8000` rules:** open question 3 answered by the code, `DEV_API_BASE` in `src/config/api.ts` still points there, so dev-gate them (`mode !== 'production'`), do not delete.
10. **Production smoke tests the shipped artefact, not a different build.** Build with plain `npx vite build` (base `./`) and mount it under the prefix with `npx vite preview --base /pachinball/ --port 4174 --strictPort`. Do **not** build with `--base /pachinball/`; that bakes absolute URLs and tests a code path that never ships.
11. **`index.html` icons** use `%BASE_URL%vite.svg` / `%BASE_URL%icons/icon-192.png` (Vite's HTML env replacement). `resolveBackboxAssetPath`'s dev branch goes through `resolveAssetUrl('backbox/…')`.

## Proposed approach (ordered; step 1 ships alone)

1. **`src/core/asset-urls.ts`**: harden `resolveAssetUrl`, add `resolveAbsoluteAssetUrl`, keep `resolveVideoUrl` for now. **`src/audio/audio-engine.ts`**: `WORKLET_PATH = 'audio/pachinko-voice-processor.js'`, resolve at `addModule`, expose `workletModuleUrl`, `isWorkletReady()`, `workletProcessorError`; forward on `SoundSystem`. Verified by the single Playwright assertion in step 5.
2. Replace the five hand joins with `resolveAssetUrl`; delete `resolveVideoUrl`, update its four call sites and remove the three barrel re-exports; `index.html` icons and `resolveBackboxAssetPath` dev branch. Vitest `tests/asset-urls.test.ts` (table below). `grep -rn "import.meta.env.BASE_URL" src` must list only `src/core/asset-urls.ts`.
3. **`vite.config.ts`** → `defineConfig(({ mode }) => ({ … }))`. `base`, the `esbuild.drop` block, both COOP/COEP header blocks, `manualChunks`, `includeAssets`, `manifest` (`start_url: './'`, `scope: './'`), `globPatterns`, the `storage.noahcohn.com` rules and the same-origin JS/asset rules stay byte-for-byte. Changes: `registerType: 'prompt'`, `clientsClaim: true`, `navigateFallbackDenylist: [/\/api\//]`, derived `globIgnores`, `localhost:8000` rules spread in only when `mode !== 'production'`, `devOptions.enabled: mode !== 'production'`.
4. **`src/pwa/register-sw.ts`**: `onNeedRefresh` → one-shot `import('./update-toast')` → `showUpdateToast({ onAccept: () => void updateSW?.(true), onLater })`; `applyServiceWorkerUpdate` shares the one-shot guard. New `src/pwa/update-toast.ts` (plain DOM, `{ signal }`-scoped listeners, no game imports). Vitest for the one-shot guard and that accept never calls `location.reload`.
5. **Playwright `tests/preview-subdir-worklet.spec.ts`** with its own `webServer` (`npx vite build && npx vite preview --base /pachinball/ --port 4174 --strictPort`), opening `http://127.0.0.1:4174/pachinball/?renderer=webgl2`; record requests from the start, click Start, then assert all of: no request pathname starts with `/audio/`; one response for `/pachinball/audio/pachinko-voice-processor.js` with status 200, a `javascript` content type and a body containing `registerProcessor`; `soundSystem.workletModuleUrl` ends with `/pachinball/audio/pachinko-voice-processor.js`; `isWorkletReady()` true; `workletProcessorError` null after a triggered voice; `AudioContext.state === 'running'` and `currentTime` advancing (so `process()` actually ran). Vitest `tests/audio-engine.test.ts`: stub `document.baseURI = 'http://localhost:4174/pachinball'` (no trailing slash) and `'…/pachinball/'`, expect the same absolute URL both times.
6. Post-build checks (script or test): `grep -c "localhost:8000" dist/sw.js` = 0; precache manifest contains `audio/pachinko-voice-processor.js`; add a throwaway `src/adventure/tracks/zz-fake-track.ts` dynamically imported like the manifests, rebuild, assert no `zz-fake-track-` entry in the manifest, delete it.

### `resolveAssetUrl` cases

| base | input | result |
|---|---|---|
| `'./'` | `'audio/pachinko-voice-processor.js'` | `'./audio/pachinko-voice-processor.js'` |
| `'./'` | `'/audio/pachinko-voice-processor.js'` | `'./audio/pachinko-voice-processor.js'` |
| `''` | `'maps.json'` | `'./maps.json'` |
| `'/'` | `'textures/environment.env'` | `'/textures/environment.env'` |
| `'/pachinball/'` | `'assets/particle.png'` | `'/pachinball/assets/particle.png'` |
| `'/pachinball'` | `'/assets/shard.png'` | `'/pachinball/assets/shard.png'` |
| any | `'https://storage.noahcohn.com/pachinball/backbox/attract.mp4'` | unchanged |
| any | `undefined` / `''` | `undefined` |

## Acceptance criteria

- [ ] `grep -rn "import.meta.env.BASE_URL" src` returns only `src/core/asset-urls.ts`; `grep -rn resolveVideoUrl src` returns nothing; `index.html` has no `href="/…"` for public files.
- [ ] Plain `npx vite build` + `npx vite preview --base /pachinball/`: the Playwright spec in step 5 passes with every listed assertion.
- [ ] `registerType: 'prompt'`, `clientsClaim: true`, `injectRegister: false`; Vitest proves accept posts `SKIP_WAITING` once and never calls `location.reload`; the toast module is not in the entry chunk (lazy).
- [ ] `dist/sw.js` contains no `localhost:8000`; `devOptions` is off for `vite preview` (preview serves the built `sw.js`).
- [ ] A fake track chunk is excluded from the precache manifest without editing `vite.config.ts`; the worklet script is included.
- [ ] `npx tsc -b`, `npm run lint`, `npx vitest run`, `npm run check:bundle` pass; `entryGzipKb` does not exceed 209.07 + the import stub (ceiling 210.00; do not touch `bundle-budget.json`).
- [ ] `tests/verify_prism_core.spec.ts`, `tests/basic-gameplay.spec.ts`, `tests/lifecycle-dispose.spec.ts` still pass on the dev server (`--workers=1`).

## Out of scope / do not touch

`package.json` scripts, `scripts/`, `.github/workflows/native-physics.yml`, `native/**`, `src/wasm/**`, `src/config/physics.ts`, `src/game/physics/**`, `tests/replay-seed-determinism.spec.ts` (slice 1–2 lane); `src/display/display-shader.ts` and glslang/twgsl vendoring (slice 4); worker failure path (slice 5); `bundle-budget.json`; `deploy.py`; the `esbuild.drop` block (PR #458); upgrading `vite-plugin-pwa` to 2.x; PLAYING-state gating of the toast (follow-up if the non-focusing toast proves annoying); `AudioEngine` fallback behaviour beyond exposing the flags.

## Open questions (remaining)

1. Does the live host serve `/pachinball/audio/pachinko-voice-processor.js` with a JavaScript content type? `vite preview` will; Apache may not. Today's §E deploy check records it. If it does not, this PR still lands and the host config is a separate ops fix.
2. Does the host redirect `/pachinball` → `/pachinball/`? `resolveAbsoluteAssetUrl` handles the no-slash case regardless; this only affects `start_url: './'` behaviour for installed PWAs.
