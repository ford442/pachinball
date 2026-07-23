# Pachinball PoC

This proof-of-concept demonstrates a Babylon.js scene backed by Rapier 3D physics, showcasing a pachinko/pinball hybrid with WebGPU-first rendering.

## Stack
- Vite (vanilla TypeScript template)
- Babylon.js (core)
- Rapier 3D WASM (`@dimforge/rapier3d-compat`)

## Getting Started

```powershell
npm install
npm run dev
```

Open http://localhost:5173/. Use **1** / **0** for the flippers, hold **Space** or **Enter** to charge and release the plunger, and press **R** to reset the ball.

## Continuous Integration

Every pull request and push to `main` is gated by GitHub Actions (`.github/workflows/ci.yml`):
`tsc -b`, `npm run lint`, `npx vitest run`, and `npx vite build`. **Keep PRs green.** A
non-blocking Playwright smoke job also runs against a live dev server. CI builds the bundle
with `vite build` (not `npm run build`) so the Emscripten/WASM step is skipped on the runner —
the physics-engine flag falls back to Rapier when the C++ bundle is absent. Enabling branch
protection on `main` (require the CI `check` job) is recommended.

## Campaign Mode

The recommended progression path is the alternating A/B campaign system (`EXTENDED_MAP` <-> `STATIONARY_TABLE`) driven by `AdventureTrackProgression` + `AdventureProgressionSupervisor`. See `docs/ADVENTURE_CAMPAIGN.md`.

## Renderer: WebGPU vs WebGL2

The game runs WebGPU-first with an automatic WebGL fallback, but you can force WebGL2 — handy for visual debugging, Playwright, and CI where WebGPU output isn't easily inspectable.

Ways to select a renderer (checked in this order):
1. URL param: `http://localhost:5173/?renderer=webgl2` (or `?renderer=webgpu`)
2. `window.DEBUG_RENDERER = 'webgl2'` set before the page loads
3. Settings → Developer → **Renderer** dropdown (persists via `localStorage`, reloads the page)
4. Default: `auto` (WebGPU first, WebGL fallback)

The Developer settings panel (visible in dev builds or with a debug query param) also has two debug overlays, available in either renderer:
- **Wireframe Mode** — toggles `scene.forceWireframe`
- **Physics Debug Draw** — overlays Rapier's collider/joint wireframes via `world.debugRender()`

See `AGENTS.md` for implementation details and WebGL2 ↔ WebGPU porting notes.

## Deployment

Production deploy is a two-step local workflow:

```bash
npm run build
cp .env.deploy.example .env.deploy   # first time only
# Edit .env.deploy and set DEPLOY_TOKEN (from VPS env)
python3 deploy.py
```

Dry-run without uploading:

```bash
python3 deploy.py --list-only
```

`deploy.py` contains no secrets. Required config is read from `.env.deploy` (gitignored) or
shell environment variables. See `.env.deploy.example` for all supported keys.
