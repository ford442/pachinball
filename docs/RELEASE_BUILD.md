# Release build baseline

How a shippable build is produced and what the gates measure. Staging/production deploys: `docs/STAGING.md`,
`.github/workflows/deploy.yml`.

## Fresh build

```bash
npm ci
git clone https://github.com/emscripten-core/emsdk.git emsdk && (cd emsdk && git checkout "$(cat ../.emsdk-commit)" \
  && ./emsdk install "$(cat ../.emsdk-version)" && ./emsdk activate "$(cat ../.emsdk-version)")
source emsdk/emsdk_env.sh
npm run build            # typecheck → build:wasm → build:worklet → vite build → dist/build-info.json
npm run check:dist-wasm && npm run check:bundle && node scripts/check-dist-console.mjs
```

Without emsdk, `build:wasm` skips and the build has no `dist/wasm`: it cannot run the default `wasm-owner`
physics and must not be deployed. `public/wasm/` is generated, not committed.

## Budgets (`bundle-budget.json`)

Measured on the first green baseline (pinned emsdk 6.0.10, Vite 8 / Rolldown, Babylon 9.37, Rapier 0.15.1):

| gate | measured | budget | note |
|---|---|---|---|
| entry chunk, gzip | 219.2 KB | 240 | down from 250.8 KB with the lazy JSON tracks (#505 §A) |
| initial JS (entry + modulepreloads), gzip | 253.9 KB | **256** (was 245) | ~35 KB gzip of small boot chunks the adventure / profile / audio slices added; cutting ~9 KB needs app-code splitting, a separate slice |
| babylon-core, gzip | 533.8 KB | 680 | |
| rapier (lazy, never precached), gzip | 765.6 KB | 800 | see below |
| precache | 6716.7 KiB | **6740** (was 6400) | now includes the C++ wasm pair (~0.25 MiB), the 29 track JSONs and the always-loaded glTF chunks |
| dist/ total | 37.79 MiB | 40 | |

`tolerancePercent` (5 %) stays a safety margin; the budgets above are set so the build passes **without** it.

**What fills `dist/` (≈ 37.8 MiB):** 19 backbox `.mp4` clips, 24.6 MiB (streamed on demand, not precached);
Rapier ~2.1 MiB (lazy dev / degrade physics path); babylon-core 2.1 MiB; everything else ≈ 7 MiB.

**Rapier is pinned to 0.15.x.** 0.21.0 (Dependabot #567) doubled the Rapier chunk (1606 KB gzip, 4.13 MiB raw; 0.15.1 is 766 KB gzip), pushed `dist/` over 40 MiB, removed `numAdditionalFrictionIterations` (the OP-1
friction tuning in `src/game-elements/physics.ts`) and needs `lib: ESNext.Disposable` to typecheck. Dependabot
ignores minor/major Rapier bumps until someone upgrades on purpose and re-baselines these two numbers.

## Gotchas found while establishing the baseline

- Rolldown emits its runtime helper as its own chunk, preloaded by `index.html`; `vite.config.ts` must keep it a
  plain (precached) chunk, not `babylon-lazy-*`.
- A new Babylon version can add a lazy chunk that every model load fetches (`textureProcessor`). Offline boot
  then fails unless it is in `GLTF_ALWAYS_LOADED_CHUNKS` (`tests/offline-boot.spec.ts` catches it; `check:bundle` does not).
