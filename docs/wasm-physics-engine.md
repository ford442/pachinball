# WASM Physics Engine

> High-performance C++ simulation core for Pachinball, compiled to WebAssembly
> via Emscripten and integrated with the existing Rapier / Babylon.js stack.

---

## Motivation

Pachinball's current physics stack — Rapier 3D WASM + Babylon.js — works well
for the standard game flow.  A custom C++ WASM core unlocks:

| Benefit | Detail |
|---------|--------|
| **Performance** | Dense simulations (gold-ball swarms, adventure pin fields) run 2–4× faster with a solver tuned for sphere-only workloads. |
| **Determinism** | Fixed-point or bit-exact arithmetic paths are trivial to add in C++. |
| **Portability** | The same C++ source can be used on native desktop builds for benchmarking. |
| **Custom physics** | Trap mechanics, launcher arcs, and pin-field generation can live directly in C++. |
| **Ecosystem fit** | Aligns with the ford442 org-wide Emscripten work (ProjectM, Tetris_WebGPU, rubberband-wasm). |

---

## Architecture overview

```
TypeScript (game logic)
        │
        ▼
WasmPhysicsEngine  ◄──── src/wasm/PhysicsModule.ts
(TypeScript wrapper)           │
        │                      │  dynamic import
        ▼                      ▼
PhysicsModule.js  ◄─── native/build/ (Emscripten output)
PhysicsModule.wasm
        │
        ▼
C++ PhysicsWorld  ◄──── native/src/PhysicsWorld.{h,cpp}
        │
   ┌────┴────┐
RigidBody  ContactListener
```

The C++ engine is a **sphere-only** rigid-body solver and runs as a thin,
fast supplement to — or eventual replacement for — Rapier.  It is
**not** a full physics engine; it is purpose-built for Pachinball's workload.

---

## Directory structure

```
native/
├── CMakeLists.txt               Emscripten + native build config
├── src/
│   ├── MathTypes.h              Vec3, Quat, Transform
│   ├── RigidBody.h / .cpp       Dynamic / static / kinematic sphere bodies
│   ├── ContactListener.h        Contact-event queue + callback dispatch
│   ├── PhysicsWorld.h / .cpp    Simulation world (step, broadphase, solver)
│   └── bindings.cpp             EMSCRIPTEN_BINDINGS (Embind)
└── tests/
    ├── physics_world_test.cpp   Catch2 unit tests (native build only)
    └── test_helpers.hpp         Shared test utilities

src/wasm/
├── wasm-types.ts                TypeScript interfaces matching the Embind API
├── PhysicsModule.ts             WasmPhysicsEngine wrapper
└── index.ts                     Barrel export

scripts/
├── build-wasm.sh                Emscripten build helper (Release/Debug/Assert/bench)
├── build-wasm-colab.sh          Thin Colab wrapper → build-wasm.sh
├── bench-wasm-flags.mjs         50-sphere flag A/B/C microbench
└── run-wasm-parity.mjs          Native + WASM parity (WASM_MODULE_PATH override)

public/wasm/                     Generated at build time (git-ignored)
├── PhysicsModule.js
└── PhysicsModule.wasm
```

---

## Building

### Prerequisites

```bash
# Install and activate Emscripten SDK (one-time)
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh   # add to ~/.bashrc or ~/.zshrc
```

CMake ≥ 3.20 must also be in `PATH`.

### Release build (production path)

```bash
npm run build:wasm
# Equivalent: bash scripts/build-wasm.sh
```

Copies `PhysicsModule.js` + `PhysicsModule.wasm` to `public/wasm/`. Does **not**
copy source maps. SIMD and LTO stay **off** by default until promoted after
measurement (see [Flag microbench](#flag-microbench-50-spheres)).

### Debug build

```bash
npm run build:wasm:debug
# Equivalent: bash scripts/build-wasm.sh --debug
```

`-O0 -g -gsource-map` with `ASSERTIONS=2`. Copies `PhysicsModule*.map` into
`public/wasm/` for browser DevTools. Do not ship debug artefacts in production
`dist/`.

### RelWithAsserts (CI parity)

```bash
npm run build:wasm:assert
# Equivalent: bash scripts/build-wasm.sh --assert
```

`-O2` + `ASSERTIONS=1` → `native/build-assert/` (does **not** overwrite
`public/wasm/` unless `WASM_INSTALL_ASSERT=1`).

```bash
WASM_MODULE_PATH=native/build-assert/PhysicsModule.js npm run test:wasm-parity
```

### Opt-in SIMD / LTO

```bash
bash scripts/build-wasm.sh --simd          # -msimd128
bash scripts/build-wasm.sh --lto           # -flto
bash scripts/build-wasm.sh --simd --lto
# or: PACHINBALL_WASM_SIMD=ON PACHINBALL_WASM_LTO=ON npm run build:wasm
```

### Flag matrix microbench build

```bash
bash scripts/build-wasm.sh --bench-matrix
node scripts/bench-wasm-flags.mjs
# or: npm run bench:wasm-flags
```

Writes `native/build-bench/{baseline,simd,simd-lto}/` and never touches
`public/wasm/`.

---

## Emscripten flag matrix

Configured in [`native/CMakeLists.txt`](../native/CMakeLists.txt). Every
`target_link_options` / `target_compile_options` entry has an inline rationale.

### Always-on (all configs)

| Flag | Rationale |
|------|-----------|
| `-sEXPORT_ES6=1` | ES module import from Vite / dynamic `import()` |
| `-sMODULARIZE=1` | Factory `await PhysicsModule()` |
| `-sEXPORT_NAME=PhysicsModule` | Name expected by `src/wasm/PhysicsModule.ts` |
| `--bind` | Embind surface in `bindings.cpp` |
| `-sENVIRONMENT=web,node` | Browser + Node parity harness; excludes shell/worker. Pure `web` would break `run-wasm-parity.mjs`. |
| `-sFILESYSTEM=0` | No FS APIs in the physics module — smaller JS glue |
| `-sALLOW_MEMORY_GROWTH=1` | Heap grows for large ball swarms |
| `-sINITIAL_MEMORY=33554432` | 32 MB initial heap |
| `-sEXPORTED_RUNTIME_METHODS=…` | `addFunction` / `removeFunction` / UTF8 helpers for contact callbacks |
| `-fno-exceptions` | No `try`/`throw` in `native/src` — drops EH runtime |

### Per-config compile / link

| Config | Compile | Link assertions | Source maps |
|--------|---------|-----------------|-------------|
| **Release** (default / production) | `-O2` | `ASSERTIONS=0` | none |
| **Debug** | `-O0 -g -gsource-map` | `ASSERTIONS=2` | yes (`.map` → `public/wasm/` only for `--debug`) |
| **RelWithAsserts** | `-O2` | `ASSERTIONS=1` | none; artefact in `native/build-assert/` |

### Opt-in CMake options (default OFF)

| Option | Flags | Notes |
|--------|-------|-------|
| `PACHINBALL_WASM_SIMD` | `-msimd128` (compile + link) | Auto-vectorize only; no hand `wasm_simd128` intrinsics yet |
| `PACHINBALL_WASM_LTO` | `-flto` (compile + link) | Measure size + step before promoting to Release |

### Embind migration (non-goal)

Stay on Embind until profiles show glue overhead dominating step time. A raw C
API / wasm-bindgen-style surface is deferred.

### Flag microbench (50 spheres)

Scenario: floor plane + 50 dynamic spheres, warmup 30 steps, timed 300 steps
at `1/60` s. Host: Node on the build machine (2026-07-23).

| Combo | Flags | mean ms | p50 ms | p95 ms | .wasm KiB |
|-------|-------|---------|--------|--------|-----------|
| A Baseline | Release + always-on size/env | 0.0591 | 0.0424 | 0.0949 | 27.1 |
| B +SIMD | A + `-msimd128` | 0.0448 | 0.0369 | 0.0699 | 27.7 |
| C +SIMD+LTO | B + `-flto` | 0.0626 | 0.0276 | 0.0645 | 27.0 |

**Interpretation:** SIMD improved mean step ~24% on this host; LTO did not
clearly improve mean step time (p50 improved, mean noisier) and only shaved a
fraction of a KiB. **Default Release stays without SIMD/LTO** until a second
host confirms the win and browser SIMD coverage is accepted. Regenerate with
`npm run bench:wasm-flags`.

---

## TypeScript integration

```typescript
import { WasmPhysicsEngine } from './src/wasm'

const engine = new WasmPhysicsEngine()

// Load WASM (async — do once at startup, in parallel with Rapier/Babylon)
await engine.load()              // uses './wasm/PhysicsModule.js' by default

// Wire EventBus for contact events
engine.init(eventBus)

// Add a static floor plane (y=0, normal pointing up)
engine.addStaticPlane({ x: 0, y: 1, z: 0 }, 0)

// Create a dynamic sphere body
const id = engine.createBody({
  position:     { x: 0, y: 5, z: 0 },
  radius:       0.12,
  mass:         0.08,
  restitution:  0.6,
})

// Per-frame in the render loop
const alpha = engine.step(deltaTime)   // returns interpolation alpha

// Query position for mesh sync
const pos = engine.getPosition(id)
mesh.position.set(pos.x, pos.y, pos.z)

// Cleanup
engine.dispose()
```

### EventBus events

| Event | Payload | When |
|-------|---------|------|
| `wasm:physics:contact` | `WasmContactEvent` | Each contact pair, each physics step |
| `wasm:physics:ready` | `void` | After successful WASM load (future — emit from game init) |
| `wasm:physics:error` | `{ message: string }` | Fatal load error (future) |

```typescript
eventBus.on('wasm:physics:contact', (evt) => {
  // evt.bodyId1, evt.bodyId2, evt.normal, evt.point, evt.impulse, evt.isEntering
  console.log(`Contact: body ${evt.bodyId1} hit body ${evt.bodyId2}`)
})
```

---

## Hybrid model (recommended for initial rollout)

Keep Rapier handling all existing game objects.  Offload new, dense
simulations to WasmPhysicsEngine:

```
Game render loop
  │
  ├── physicsSystem.step(dt)      ← Rapier: flippers, bumpers, existing balls
  └── wasmEngine.step(dt)         ← C++ WASM: gold-ball swarm, pin field
```

Once parity is proven (see Phase 3 in the phased plan below), you can
migrate body creation to the WASM engine incrementally.

---

## Physics engine modes

Set via `localStorage['pachinball:physics-engine']`:

| Mode | Value | Behaviour |
|------|-------|-----------|
| **Rapier** (default) | `rapier` or unset | Full Rapier simulation — production path |
| **WASM mirror** | `wasm-mirror` or legacy `wasm` | WASM steps ball+bumper subset; poses sync Rapier↔WASM each frame |
| **WASM owner** | `wasm-owner` | WASM owns balls + static table geometry (boxes/capsules/planes) + kinematic flipper proxies; Rapier keeps flipper joints/motors |

Mirror mode remains the default WASM path until owner mode is stable. Owner mode disables Rapier colliders for exported static bodies and ball puppets while WASM simulates them. Flipper bodies are **not** disabled — Rapier's joint/motor keeps driving each flipper's blade every frame, and `WasmOwner.syncFlipperProxies()` mirrors the resulting live pose + point-velocity into a kinematic capsule proxy in WASM before each step (Phase 2c-A), so the WASM-owned ball collides with flippers and picks up momentum on a flick.

```javascript
// Dev console — mirror (default WASM path)
localStorage.setItem('pachinball:physics-engine', 'wasm-mirror')

// Owner mode — balls + walls/rails in WASM
localStorage.setItem('pachinball:physics-engine', 'wasm-owner')

// Back to Rapier
localStorage.removeItem('pachinball:physics-engine')
location.reload()
```

Debug HUD (Developer settings → Enable Debug HUD) shows `wasm ms`, `rapier ms` (owner), and `mirror ms` (mirror sync overhead) under the Physics panel.

---

## Static colliders (Phase 2a)

The C++ engine supports oriented static boxes and capsules in addition to infinite planes and sphere bodies:

```typescript
engine.addStaticBox(
  { x: 0, y: 0, z: 0 },           // centre
  { x: 2, y: 0.5, z: 2 },         // half-extents
  { x: 0, y: 0, z: 0, w: 1 },     // rotation quaternion
  0.5                              // restitution
)

engine.addStaticCapsule(
  { x: 0, y: 1, z: 0 },           // centre
  0.35, 0.5,                       // radius, half-height (local Y)
  { x: 0, y: 0, z: 0, w: 1 },
  0.5
)
```

Native C++ tests (no browser, no Emscripten):

```bash
npm run test:native
# Equivalent:
cmake -S native -B native/build-native
cmake --build native/build-native
ctest --test-dir native/build-native --output-on-failure
```

Catch2 is fetched automatically via CMake `FetchContent` on first configure.
Test scenarios:

| Test | Validates |
|------|-----------|
| `gravity integration` | Semi-implicit Euler velocity/position after one tick |
| `sphere-sphere contact` | Overlapping balls separate; relative velocity resolves |
| `sphere-plane bounce restitution` | Post-bounce speed ratio within bounds for `e=0.6` |
| `energy non-explosion (60 steps)` | Multi-ball swarm stays finite and bounded after 60 ticks |
| `body remove and recreate` | Handle lifecycle and `getActiveBodyCount()` |
| `ball drops on box` | Static OBB collision + settling |
| `ball hits capsule` | Static capsule collision + settling |
| `stationary kinematic capsule supports resting ball` | Kinematic-body capsule shape parity with the static-geometry capsule path |
| `kinematic capsule flings ball` | A moving kinematic capsule imparts its own velocity onto a resting ball |

Parity suite (native Catch2 + compiled WASM bundle):

```bash
RUN_WASM_PARITY=1 npx vitest run tests/wasm-physics-parity.test.ts
# or directly:
node scripts/run-wasm-parity.mjs
```

---

## Kinematic capsule bodies (Phase 2c)

`RigidBodyDesc` gained a `shape` field (`Sphere` — the default — or `Capsule`)
and a `capsuleHalfHeight` field, so a `RigidBody` (not just static geometry)
can present a capsule collider. Combined with `BodyType.Kinematic`, this is
how the WASM engine represents a moving flipper: `RigidBody::integrate()` is
a no-op for non-Dynamic bodies, so a kinematic capsule's position/rotation
are fully caller-controlled via `setBodyPosition`/`setBodyRotation`, while its
caller-set `velocity` still participates in the impulse response against a
dynamic sphere (`getInvMass()` is 0, so the capsule itself is never moved by
collision — but the sphere it hits picks up the capsule's momentum, same as
the existing kinematic-sphere-vs-sphere path).

```typescript
const proxyId = engine.createBody({
  shape: 'capsule',
  radius: 0.3,
  capsuleHalfHeight: 1.55,   // segment runs along local +Y
  bodyType: 2,               // Kinematic
  mass: 0,
  restitution: 0.9,
})

// Each tick, before engine.step():
engine.setBodyPosition(proxyId, px, py, pz)
engine.setBodyRotation(proxyId, qx, qy, qz, qw)
engine.setVelocity(proxyId, vx, vy, vz)
```

`WasmOwner.syncFlipperProxies()` (`src/game/physics/wasm-owner.ts`) is the
concrete consumer: each flipper's blade collider's live world transform
(`collider.translation()`/`.rotation()`) is read directly from Rapier — no
manual pivot/offset reconstruction needed, since Rapier already resolves the
joint each frame — composed with a fixed axis-remap quaternion (the capsule's
native +Y segment axis onto the blade's local +X long axis), and the contact
point's linear velocity is computed as `linvel + angvel × r`. Capsule-vs-capsule
collision (e.g. two flippers hitting each other) is an explicit non-goal and
is skipped in the solver.

---

## Phased plan

| Phase | Goal | Status |
|-------|------|--------|
| **0 – Spike** | C++ source + TypeScript wrapper + Vite import path working | ✅ Done |
| **1 – Core API** | PhysicsWorld + RigidBody + Embind bindings | ✅ Done |
| **2a – Geometry** | Static box + capsule colliders; parity tests | ✅ Done |
| **2b – Ownership** | `wasm-mirror` / `wasm-owner` modes; static table export | ✅ Done |
| **2c – Flipper motors** | Kinematic hybrid — capsule proxies mirror Rapier-driven flippers | ✅ Done (2c-A; native hinge/motor parity remains 2c-B, deferred) |
| **2d – Perf HUD** | Rapier vs WASM vs mirror timing in Debug HUD | ✅ Done |
| **3 – Benchmark** | RapierVsCppBenchmark scene; frame-time comparison | 🔜 Next |
| **4 – Decision Point** | Replace vs hybrid; determinism comparison | 🔜 After Phase 3 |
| **5 – Polish** | Memory budgeting, Debug HUD, documentation | 🔜 After Phase 4 |

---

## Memory model

- Emscripten allocates a single contiguous `ArrayBuffer` (WASM heap).
- `ALLOW_MEMORY_GROWTH=1` allows the heap to grow dynamically.
- Initial heap is 32 MB (`INITIAL_MEMORY=33554432`).
- `PhysicsWorld::delete()` must be called when the world is disposed to
  release C++ memory back to the WASM heap.
- `WasmPhysicsEngine.dispose()` calls `world.delete()` automatically.

### SharedArrayBuffer / threading

WebAssembly threads require `SharedArrayBuffer`, which in turn requires
`Cross-Origin-Isolation` headers (`COOP: same-origin` + `COEP: require-corp`).
The current build uses a **single-threaded** configuration.  Threading can be
enabled later by adding `-pthread` and `-sPROXY_TO_PTHREAD=1` to the Emscripten
link flags, but this requires server-side header changes.

---

## Debugging

- Use `npm run build:wasm:debug` for `-O0 -g -gsource-map` and `ASSERTIONS=2`.
- Debug installs copy `PhysicsModule*.map` into `public/wasm/` for browser
  DevTools. Release and RelWithAsserts never ship maps into `public/wasm/` or
  production `dist/`.
- Use `npm run build:wasm:assert` for CI-style `-O2` + `ASSERTIONS=1` without
  full debug cost.
- The `Debug HUD` (`src/game-elements/debug-hud.ts`) shows WASM vs Rapier step
  timing when a WASM physics mode is active.
---

## C++ development without Emscripten

The `CMakeLists.txt` supports a **native (non-Emscripten) build** that
produces a static library `pachinball_physics_native` and a Catch2 test
executable for unit-testing the C++ logic directly:

```bash
npm run test:native
```

Prerequisites: CMake ≥ 3.20 and a C++17 compiler (g++ or clang). No
Emscripten required. Catch2 v3.7.1 is downloaded automatically on first
`cmake` configure.

This lets you iterate on solver logic with fast compile times using your
native compiler before re-running the full Emscripten build.

---

## CI (optional)

A non-blocking GitHub Actions workflow (`.github/workflows/native-physics.yml`)
runs on changes under `native/`:

| Job | Tools | What it checks |
|-----|-------|----------------|
| `native_ctest` | cmake, g++ | `npm run test:native` (Catch2 suite) |
| `wasm_build` | emsdk (cached) | Release `npm run build:wasm` + artefact size; no `.map` in `public/wasm/`; RelWithAsserts `npm run build:wasm:assert`; parity via `WASM_MODULE_PATH=native/build-assert/PhysicsModule.js` |

Both jobs use `continue-on-error: true` so they **do not gate merges** until
main CI ([#283](https://github.com/ford442/pachinball/issues/283)) lands.
Main CI will add tsc/lint/Vitest/vite build separately.

Skip options:

- **WASM job only:** include `[skip wasm-ci]` in the commit message.
- **Entire workflow:** trigger manually via `workflow_dispatch` only.
- **Local without emcc:** `npm run build:wasm` exits 0 with a skip message;
  the WASM CI job fails explicitly if `emcmake` is missing or artefacts are absent.
