# Cross-origin isolation (COOP/COEP)

Tracking issues: **#384** (headers) and **#414** (the SharedArrayBuffer transport).
This doc covers the headers. The shared memory layout that depends on them is
specified in `docs/wasm-physics-engine.md` → *Worker transport* → *Shared snapshot
layout*.

## Why

`SharedArrayBuffer` (used by `wasm-worker` to hand transforms, hinge angles and
contacts from the physics worker to the main thread without a per-step allocation)
is only constructible when the page is **cross-origin isolated**:
`window.crossOriginIsolated === true`. That requires every top-level response to
carry:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

and every cross-origin sub-resource (images, video, fetches) to opt in via either
`Cross-Origin-Resource-Policy: cross-origin` or a matching CORS response.

## Production already serves these headers

Verified live (`curl -I` against `test.1ink.us/pachinball/`, 2026-08-30 — see
`weekly_plan.md`): `index.html`, `assets/*.js`, and `wasm/PhysicsModule.wasm` all
return `cross-origin-opener-policy: same-origin`, `cross-origin-embedder-policy:
require-corp`, and `cross-origin-resource-policy: cross-origin` today, with the
correct `content-type: application/wasm` on the WASM bundle (required for streaming
compile).

**This configuration lives entirely outside this repo.** It's Apache config on the
Contabo host — there is no `.htaccess`, `nginx.conf`, or Caddyfile checked in, and
`deploy.py` never touches server/header configuration; it only zips `dist/` and
POSTs the bundle to the deploy API. If that host is ever rebuilt from scratch, these
three headers (plus the `.wasm` MIME type) must be reproduced manually from this
doc — nothing in-repo will regenerate them automatically.

## What this repo's slice closes

Before this change, **local dev and preview had zero header configuration** —
`vite.config.ts` had no `server.headers`/`preview.headers` block at all, so
`crossOriginIsolated` was always `false` under `npm run dev` / `npm run preview`,
even though production already worked. `vite.config.ts` now sets the same COOP/COEP
pair for both `server` and `preview`.

`Cross-Origin-Resource-Policy` is deliberately **not** set in `vite.config.ts` — that
header belongs on cross-origin resource responses (`storage.noahcohn.com`), not on
first-party same-origin responses served by the dev server itself.

## Mandatory fallback

`wasm-worker` mode does not require cross-origin isolation to function.
`isCrossOriginIsolated()` (`src/config/physics.ts`) picks the snapshot transport
only: shared memory when true, transferred `postMessage` buffers when false. It
never decides whether the worker (or the game) boots — engine selection and its
fallbacks in `PhysicsSystem.init()` (`src/game-elements/physics.ts`) do not branch
on it. `tests/wasm-worker-adventure.spec.ts` plays an adventure track both ways,
stripping COOP/COEP from the document response for the non-isolated run.

## Verifying locally

1. `npm run dev`, open DevTools console, evaluate `crossOriginIsolated` — expect
   `true`. Check the Network tab on `index.html` and any `assets/*.js`/`wasm/*.wasm`
   request for the two headers above.
2. `npm run build && npm run preview` — repeat the same check against the preview
   server.
3. With the dev server running, confirm requests to `storage.noahcohn.com/...`
   (backbox/API assets) still succeed with no COEP-related console errors — this is
   the one cross-origin dependency this repo doesn't control directly, though
   production evidence above suggests it's already fine.
