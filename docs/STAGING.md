# Staging deploy

Production ships from `main` / `v*` tags through `.github/workflows/deploy.yml`. Staging is the same
build and the same storage manager, under a **separate project**, so any ref can be looked at in a real
browser on the real host before it is released. Release sequence: Build → Smoke → Visual → Hardening →
Release; the Smoke and Visual stages run against this target.

| | production | staging |
|---|---|---|
| workflow | `deploy.yml` (main / tags, gated on green CI + Native Physics) | `deploy-staging.yml` (any ref, manual) |
| storage-manager project / target folder | `pachinball` | `pachinball-staging` |
| URL | `LIVE_URL` (default `https://test.1ink.us/pachinball/`) | `STAGING_URL` (repo variable, no default) |
| GitHub environment | `production` | `staging` |

The staging workflow pins `DEPLOY_PROJECT_NAME=pachinball-staging` and refuses to run when `STAGING_URL` is
unset or points at the production project; `verify-live.mjs` would otherwise fall back to its production default.

## One-time setup

1. **Storage manager**: the `/api/deploy/<project>/bundle` route takes the project name from the URL and
   `target_folder` from the form (`deploy.py`). Confirm that `DEPLOY_TOKEN` is accepted for
   `pachinball-staging` and that the folder is created on the VPS.
2. **Web server (outside this repo; Apache on the Contabo host)**: the `pachinball-staging` folder must be
   served with the same configuration as `pachinball`, see `docs/cross-origin-isolation.md`:
   - `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every
     response (index.html, assets, wasm), and `Cross-Origin-Resource-Policy: cross-origin` on sub-resources;
   - `Content-Type: application/wasm` for `.wasm` (streaming compile needs it);
   - `sw.js` as JavaScript, served from the project root (the service worker scope is its folder).
   The build uses `base: './'`, so it works from any sub-path.
3. **GitHub**: Settings → Environments → `staging`: secret `DEPLOY_TOKEN`, variable `STAGING_URL`
   (with a trailing slash), optionally `DEPLOY_BASE_URL` and `VITE_ARCADE_URL`. The latter is embedded in
   the production build and enables the smoke test's read-only leaderboard fetch.

## Deploy

Actions → **Deploy staging** → Run workflow → choose the branch/tag. `dry_run` builds, gates and prints the
transfer plan without uploading. The job runs the same gates as production
(`build` with the pinned emsdk, `check:dist-wasm`, `check:bundle`, `check-dist-console`, golden replay
verification and preview runtime smoke), uploads, runs `scripts/verify-live.mjs` and the Chromium +
mobile production smoke against `STAGING_URL`, then uploads the captures.

By hand, from a machine that has the token:

```bash
npm run build                                   # with the pinned emsdk on PATH (source emsdk/emsdk_env.sh)
export DEPLOY_TOKEN=…                           # or .env.deploy (never committed)
DEPLOY_PROJECT_NAME=pachinball-staging python deploy.py --list-only
DEPLOY_PROJECT_NAME=pachinball-staging python deploy.py
LIVE_URL=https://<host>/pachinball-staging/ node scripts/verify-live.mjs
```

`verify-live.mjs` fails unless the live `build-info.json` has this build's `buildId` (the commit SHA, with
`-dirty` if the tree was) and `wasmSha256`, `index.html` and the wasm carry COOP/COEP, the wasm is
`application/wasm`, `sw.js` answers 200 as JavaScript, and every boot asset answers 200.

## State of the App capture

```bash
node scripts/state-of-app.mjs --url https://<host>/pachinball-staging/ --out state-of-app
```

Boots the URL on a desktop and a Pixel 7 viewport and writes `report.json` (every console message, page
errors, failed requests, `crossOriginIsolated`, the engine and renderer that booted, `build-info.json`, the
state reached after START) plus `desktop-menu.png`, `desktop-play.png`, `mobile-menu.png`, `mobile-play.png`.
The `staging-playwright-<sha>` artifact also contains the production smoke's menu, playing and game-over
screenshots and Playwright diagnostics. The smoke checks offline service-worker boot, runtime errors and
HTTP failures, and—when `VITE_ARCADE_URL` is configured—a leaderboard read. Use `--executable` /
`$CHROMIUM_PATH` when Playwright's own Chromium is not installed.
