# Cross-origin isolation (COOP/COEP)

Tracking issue: **#384** ("SharedArrayBuffer physics ring + COOP/COEP, finish #361").
This doc covers the isolation-headers slice only; the SAB memory layout itself is a
separate follow-up (see `src/config/physics.ts`'s `wasm-worker` doc comment).

## Why

`SharedArrayBuffer` (needed for a future zero-copy worker↔main physics transform/
contact ring) is only constructible when the page is **cross-origin isolated**:
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

`wasm-worker` mode does not require cross-origin isolation to function — it has no
`SharedArrayBuffer` dependency today and works identically over `postMessage`
whether or not the page is isolated. `isCrossOriginIsolated()`
(`src/config/physics.ts`) exists purely as a detector/diagnostic for the future
SAB-backed transport; nothing in the physics engine's mode-selection or fallback
path (`PhysicsSystem.init()`, `src/game-elements/physics.ts`) branches on it yet.
The game must and does still boot with headers off.

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
