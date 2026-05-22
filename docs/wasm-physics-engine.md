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
└── src/
    ├── MathTypes.h              Vec3, Quat, Transform
    ├── RigidBody.h / .cpp       Dynamic / static / kinematic sphere bodies
    ├── ContactListener.h        Contact-event queue + callback dispatch
    ├── PhysicsWorld.h / .cpp    Simulation world (step, broadphase, solver)
    └── bindings.cpp             EMSCRIPTEN_BINDINGS (Embind)

src/wasm/
├── wasm-types.ts                TypeScript interfaces matching the Embind API
├── PhysicsModule.ts             WasmPhysicsEngine wrapper
└── index.ts                     Barrel export

scripts/
└── build-wasm.sh                Emscripten build helper

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

### Release build

```bash
npm run build:wasm
# Equivalent: bash scripts/build-wasm.sh
```

### Debug build (assertions enabled, no optimisation)

```bash
npm run build:wasm:debug
# Equivalent: bash scripts/build-wasm.sh --debug
```

Both commands:
1. Run `emcmake cmake` to configure the CMake project with the Emscripten toolchain.
2. Run `cmake --build` to compile and link.
3. Copy `PhysicsModule.js` + `PhysicsModule.wasm` to `public/wasm/` so that Vite
   serves them as static assets.

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

## Phased plan

| Phase | Goal | Status |
|-------|------|--------|
| **0 – Spike** | C++ source + TypeScript wrapper + Vite import path working | ✅ Done (this PR) |
| **1 – Core API** | PhysicsWorld + RigidBody + Embind bindings | ✅ Done (this PR) |
| **2 – Events & Parity** | Contact events via EventBus; match Rapier behaviour | 🔜 Next |
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

- Use `npm run build:wasm:debug` to enable `ASSERTIONS=2` and disable
  optimisations.
- The `PhysicsModule.js` debug build includes source-map comments for
  browser devtools.
- The `Debug HUD` (`src/game-elements/debug-hud.ts`) will be extended in
  Phase 5 to show WASM body count and step time alongside Rapier stats.

---

## C++ development without Emscripten

The `CMakeLists.txt` supports a **native (non-Emscripten) build** that
produces a static library `pachinball_physics_native` for unit-testing the
C++ logic directly:

```bash
cmake -S native -B native/build-native
cmake --build native/build-native
# Link your C++ test runner against pachinball_physics_native
```

This lets you iterate on solver logic with fast compile times using your
native compiler before re-running the full Emscripten build.
