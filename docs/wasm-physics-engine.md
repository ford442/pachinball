# WASM Physics Engine

> C++ simulation core for Pachinball, compiled to WebAssembly via Emscripten.
> It is the **production physics engine** (`wasm-owner`, see
> [`src/config/physics.ts`](../src/config/physics.ts)). Since #412 the owner boot never
> loads Rapier: builders author through a narrow physics API, bodies are keyed on WASM
> public ids, and `@dimforge/rapier3d-compat` is fetched lazily only for the explicit
> `rapier` / `wasm-mirror` modes or when the WASM bundle is missing (fail-closed fallback).

---

## Motivation

Pachinball started on Rapier 3D WASM + Babylon.js. The custom C++ core replaced
Rapier as the simulation owner because it unlocks:

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
TypeScript (game logic: table builders, balls, toys, adventure tracks)
        │  PhysicsApi / PhysicsWorldSink / PhysicsBody (src/core/physics-api.ts)
        ▼
WASM_PHYSICS_API + WasmTableWorld  ◄──── src/wasm/wasm-{physics-api,table-world,body}.ts
        │  TableColliderDesc per body; balls are C++ bodies from birth
        ▼
WasmOwner / WasmMirror  ◄──── src/game/physics/wasm-{owner,mirror}.ts
        │  WasmSimEngine (src/wasm/wasm-sim-engine.ts)
        ├───────────────────────────────┐
        ▼ in-process                    ▼ wasm-worker
WasmPhysicsEngine                PhysicsWorkerClient ──postMessage──► physics-worker.ts
 src/wasm/PhysicsModule.ts        (physics-worker-protocol.ts)          └─► WasmPhysicsEngine
 + physics-module-adventure.ts
        │  dynamic import
        ▼
PhysicsModule.js / .wasm  ◄─── public/wasm/ (Emscripten output, npm run build:wasm)
        │  Embind (native/src/bindings.cpp)
        ▼
C++ PhysicsWorld  ◄──── native/src/PhysicsWorld.{h,cpp}
        │
   ┌────┴──────────────┬──────────────┬───────────────┐
BodyStore/RigidBody  Narrowphase   HingeJoint   ContactListener
```

The C++ engine is a sphere-and-capsule rigid-body solver with dynamic boxes,
static boxes / capsules / cylinders / spheres / triangle meshes, kinematic movers,
sensor volumes, force fields and world-anchored hinges. It owns the table and every
adventure track in production. Collision response includes a **normal
impulse**, **Coulomb friction** (geometric-mean combine `μ = sqrt(μ_a μ_b)`),
**spherical inertia** `I = 2/5 m r²` with integrated orientation, and a small
**rolling-resistance** term so balls settle instead of rolling forever.

---

## Directory structure

```
native/
├── CMakeLists.txt               Emscripten + native (Catch2) build config
├── src/
│   ├── MathTypes.h              Vec3, Quat, Transform
│   ├── RigidBody.h / .cpp       Dynamic / static / kinematic sphere + capsule bodies
│   ├── DynamicBox.cpp           Dynamic oriented-box bodies (createBoxBody)
│   ├── BodyStore.h / .cpp       SoA body storage + packed transform buffer
│   ├── HandleTable.h            Stable body / hinge handles
│   ├── BroadphaseGrid.h / .cpp  Uniform-grid broadphase
│   ├── Narrowphase.cpp          Pair tests (sphere / capsule / box / statics)
│   ├── CollisionFilter.h        membership/filter masks (mirrors CollisionGroups)
│   ├── StaticShapes.h / .cpp    Static box / capsule / sphere (+ ConeDesc)
│   ├── Cylinder.h / .cpp        Static cylinder (closed-form sphere vs cylinder)
│   ├── Cone.cpp                 Static cone — ball-trap funnels (closed-form sphere vs cone)
│   ├── PinField.h / .cpp        Pin field — a whole pachinko lattice as ONE static handle (#421)
│   ├── TriangleMesh.h / .cpp    Static triangle mesh (addStaticTriangleMesh)
│   ├── VolumeShape.h / .cpp     Box / Cylinder / Sphere tag for movers + sensors
│   ├── KinematicMover.h / .cpp  Pose-driven kinematic movers
│   ├── KinematicBody.cpp        Runtime setBodyType + kinematic rigid-body targets (toy capture)
│   ├── SensorVolume.h / .cpp    Enter/Stay/Exit trigger volumes
│   ├── ForceField.h / .cpp      Oriented force / acceleration regions
│   ├── HingeJoint.h / .cpp      World-anchored revolute hinge + motor
│   ├── ContactListener.h        Contact-event queue + packed contact buffer
│   ├── PhysicsWorld.h / .cpp    Simulation world: bodies, colliders, handle ranges
│   ├── PhysicsWorldStep.cpp     step() / substep(): integration, broadphase, solver loop, transform scatter
│   └── bindings.cpp             EMSCRIPTEN_BINDINGS (Embind) — Emscripten only
└── tests/                       Catch2 (native build only)
    ├── physics_world_test.cpp   Integration, contacts, broadphase, sleep, benchmark
    ├── hinge_friction_test.cpp  Friction / spin / rolling resistance + hinges
    ├── static_shapes_test.cpp
    ├── adventure_geometry_test.cpp
    ├── kinematic_mover_test.cpp
    ├── sensor_volume_test.cpp
    ├── collision_filter_test.cpp
    ├── kinematic_body_test.cpp  Runtime body type: capture, steer, release (#420)
    ├── cone_test.cpp            Static cone: apex / slant / base / inside / groups (#420)
    ├── pin_field_test.cpp       Pin field: 12×12 fall-through, keep-out, mask, dropout, parity, handle cap (#421)
    └── test_helpers.hpp         Shared test utilities

src/wasm/
├── wasm-types.ts                TypeScript interfaces matching the Embind API
├── PhysicsModule.ts             WasmPhysicsEngine: load, world, table statics, bodies, hinges, step
├── physics-module-adventure.ts  Cylinder / sphere / cone / pin field / mesh / mover / sensor / box body / force field
├── wasm-sim-engine.ts           WasmSimEngine interface (in-process engine + worker client)
├── physics-worker-protocol.ts   Worker command union + id shadow
├── physics-worker-runtime.ts    applyPhysicsCommand / WorkerSnapshotPublisher
├── physics-shared-layout.ts     Versioned SharedArrayBuffer snapshot layout (seqlock + contact ring)
├── physics-worker-client.ts     Main-thread PhysicsWorkerClient
├── physics-worker.ts            Dedicated Worker entry
├── contact-buffer.ts            Packed contact codec
├── transform-buffer.ts          Packed transform codec
├── wasm-physics-api.ts          WASM_PHYSICS_API: descriptor-recording RigidBodyDesc / ColliderDesc / JointData
├── wasm-table-world.ts          WasmTableWorld: the owner-path PhysicsWorldSink (bodies, colliders, joints)
├── wasm-body.ts                 WasmBody / WasmCollider: WASM-id-keyed bodies (linked to C++ or pose stores)
└── index.ts                     Barrel export

src/game/physics/
├── wasm-owner.ts                wasm-owner / wasm-worker driver + WASM-id contact resolution
├── wasm-mirror.ts               wasm-mirror driver (Rapier-authoritative parity path)
├── wasm-static-export.ts        TableColliderDesc → C++ statics / sensors / kinematic movers
└── wasm-adventure-export.ts     AdventureColliderDesc → C++

scripts/
├── build-wasm.sh                Emscripten build helper (Release/Debug/Assert/bench)
├── build-wasm-colab.sh          Thin Colab wrapper → build-wasm.sh
├── bench-wasm-flags.mjs         50-sphere flag A/B/C microbench
├── print-wasm-flags.mjs         Print the effective CMake WASM flags
├── run-wasm-parity.mjs          Native + WASM parity (WASM_MODULE_PATH override)
├── check-compile-db.mjs         clangd compile_commands.json smoke check
└── check-wasm-docs.mjs          Fails when this doc drifts from CMake / sources

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
copy source maps. **SIMD and LTO default ON** (see [`docs/WASM_BENCH_RESULTS.md`](WASM_BENCH_RESULTS.md)).

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

`-O3` + `ASSERTIONS=1` → `native/build-assert/` (does **not** overwrite
`public/wasm/` unless `WASM_INSTALL_ASSERT=1`).

```bash
WASM_MODULE_PATH=native/build-assert/PhysicsModule.js npm run test:wasm-parity
```

### SIMD / LTO (default ON)

```bash
bash scripts/build-wasm.sh --no-simd --no-lto   # opt out
# or: PACHINBALL_WASM_SIMD=OFF PACHINBALL_WASM_LTO=OFF npm run build:wasm
```

Print the CMake source-of-truth line (also logged on the `wasm_parity` CI job):

```bash
npm run print:wasm-flags
# [wasm-flags] SIMD=ON LTO=ON ENV=web,worker,node INITIAL_MEMORY=16777216
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
| `-sENVIRONMENT=web,worker,node` | Browser + Worker (#361) + Node parity harness (`run-wasm-parity.mjs`). |
| `-sFILESYSTEM=0` | No FS APIs in the physics module — smaller JS glue |
| `-sALLOW_MEMORY_GROWTH=1` | Heap grows for large ball swarms |
| `-sINITIAL_MEMORY=16777216` | 16 MB initial heap (`emmalloc`; grows if needed) |
| `-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU32"]` | `HEAPF32` for packed contact/transform buffer views and mesh vertices; `HEAPU32` for mesh indices — no `addFunction` / UTF8 helpers |
| `-sEXPORTED_FUNCTIONS=["_malloc","_free"]` | `addStaticTriangleMesh` takes heap pointers, so JS allocates + frees the triangle soup around the call |
| `-sMALLOC=emmalloc` | Smaller allocator after setup |
| `--closure=1` | Minify JS glue (parity-validated) |
| `-fno-exceptions` | No `try`/`throw` in `native/src` — drops EH runtime |

### Per-config compile / link

Emscripten targets only. The native Catch2 tree (`native/build-native`, `npm run test:native`)
adds **no** `-O` of its own — `CMAKE_CXX_FLAGS_<CONFIG>` owns the level there, so every entry in
its `compile_commands.json` carries exactly one. It is configured with an explicit
`-DCMAKE_BUILD_TYPE=Debug` by `npm run compile-db`; see the root `.clangd`.

| Config | Compile | Link assertions | Source maps |
|--------|---------|-----------------|-------------|
| **Release** (default / production) | `-O3` | `ASSERTIONS=0` | none |
| **Debug** | `-O0 -g -gsource-map` | `ASSERTIONS=2` | yes (`.map` → `public/wasm/` only for `--debug`) |
| **RelWithAsserts** | `-O3` | `ASSERTIONS=1` | none; artefact in `native/build-assert/` |

### CMake options (default ON)

| Option | Flags | Notes |
|--------|-------|-------|
| `PACHINBALL_WASM_SIMD` | `-msimd128` (compile + link) | Auto-vectorize only; no hand `wasm_simd128` intrinsics |
| `PACHINBALL_WASM_LTO` | `-flto` (compile + link) | Production default after 2026-08-14 bench |

### Embind migration (non-goal)

Stay on Embind until profiles show glue overhead dominating step time. A raw C
API / wasm-bindgen-style surface is deferred.

### Flag microbench (50 spheres)

Scenario: floor plane + 50 dynamic spheres, warmup 30 steps, timed 300 steps
at `1/60` s. Host: Linux build environment (2026-08-07).

| Combo | Flags | mean ms | p50 ms | p95 ms | .wasm KiB |
|-------|-------|---------|--------|--------|-----------|
| A Baseline | Release + always-on size/env | 0.0445 | 0.0367 | 0.0692 | 28.6 |
| B +SIMD | A + `-msimd128` | 0.0611 | 0.0431 | 0.0875 | 29.3 |
| C +SIMD+LTO | B + `-flto` | 0.0452 | 0.0356 | 0.0775 | 28.6 |

**Canonical numbers:** [`docs/WASM_BENCH_RESULTS.md`](WASM_BENCH_RESULTS.md) (2026-08-14) — SIMD+LTO **ON**, 16 MiB heap, `-O3`, `emmalloc`, `--closure=1`. Production combo is **C**.

Historical 2026-08-07 table above is retained for comparison only; do not copy those defaults.

**Other decisions:**
1. **No `-pthread` / `SharedArrayBuffer` yet** — #361; ENVIRONMENT already includes `worker` so the glue can instantiate off-thread without a rebuild of that flag.
2. **Regenerate metrics:** `npm run bench:wasm-flags`.

---

## TypeScript integration

```typescript
import { WasmPhysicsEngine } from './src/wasm'

const engine = new WasmPhysicsEngine()

// Load WASM (async — do once at startup; main.ts starts the fetch in parallel
// with Babylon engine creation via preloadWasmPhysicsNow())
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

## Physics engine modes

Production physics defaults to **WASM owner** (`WASM_PHYSICS.defaultEngine`) for the
table **and** every catalogued adventure track (see *Adventure geometry* below). If
`public/wasm/PhysicsModule.wasm` is missing, init fail-closes to Rapier and logs
`[Bootstrap][physics-degrade]`.

`window.currentPhysicsEngine` reports the engine that actually served the last
init/step (`rapier` | `wasm-mirror` | `wasm-owner` | `wasm-worker`), not the
localStorage preference.

Set via `localStorage['pachinball:physics-engine']`:

| Mode | Value | Behaviour |
|------|-------|-----------|
| **WASM owner** (default) | `wasm-owner` or unset | WASM owns balls + the table scope + **native hinge flippers** + adventure track geometry and gizmos. Rapier is never loaded: no module, no `World` (`getRapier() === null`, `lastRapierStepMs === 0`). |
| **Rapier** | `rapier` (explicit) | Dev / degrade path: full Rapier simulation, and the fail-closed fallback when the WASM bundle is missing — Rapier is imported lazily (`loadRapier()`). Kept deliberately and covered by `tests/physics-degrade.spec.ts` and the fallback case in `tests/wasm-owner-adventure-cutover.spec.ts`. |
| **WASM mirror** | `wasm-mirror` or legacy `wasm` | Rapier authoritative (loaded at boot); WASM steps ball+bumper subset and poses sync Rapier↔WASM each frame |
| **WASM worker** | `wasm-worker` | Same ownership as `wasm-owner` — table **and** adventure tracks — but `PhysicsWorld` runs in a Dedicated Worker (**one physics frame of extra latency**). Snapshots arrive over a SharedArrayBuffer when the page is cross-origin isolated, otherwise as transferred `ArrayBuffer`s; see *Worker transport*. Worker construction / load failure falls back to in-process `wasm-owner`. `tests/wasm-worker-api-parity.test.ts` fails the build if an engine method has no worker command; `tests/physics-worker-shared-parity.test.ts` runs the worker path against real C++ and requires identical handles, poses and contacts. |

Mirror mode remains a WASM parity path on Rapier bodies. Owner mode has no Rapier bodies at
all (see *Table authoring and WASM-id identity* below): each flipper is a dynamic WASM capsule
with a world-anchored hinge (`PhysicsWorld::createHinge` / `setHingeMotor`), linked to the
`WasmBody` the flipper builder authored so meshes interpolate from the C++ pose directly.

```javascript
// Dev console — mirror
localStorage.setItem('pachinball:physics-engine', 'wasm-mirror')

// Owner mode — production default (also: localStorage.removeItem(...))
localStorage.setItem('pachinball:physics-engine', 'wasm-owner')

// Worker mode — same as owner, C++ world off the main thread
localStorage.setItem('pachinball:physics-engine', 'wasm-worker')

// Explicit Rapier override (removeItem now falls back to wasm-owner)
localStorage.setItem('pachinball:physics-engine', 'rapier')
location.reload()
```

Debug HUD (Developer settings → Enable Debug HUD) shows `engine` (`wasmMode`), `wasm ms`, `rapier ms` (owner), and `mirror ms` (mirror sync overhead) under the Physics panel, and `wasm unexported` (table colliders the C++ owner is not simulating) under Campaign. Physics debug draw in owner/worker mode reads packed C++ transform/contact buffers plus the exported collider descriptors.

---

## Static colliders (Phase 2a)

The C++ engine supports oriented static boxes, capsules, cylinders, spheres
and cones in addition to infinite planes and sphere bodies:

```typescript
engine.addStaticBox(
  { x: 0, y: 0, z: 0 },           // centre
  { x: 2, y: 0.5, z: 2 },         // half-extents
  { x: 0, y: 0, z: 0, w: 1 },     // rotation quaternion
  0.5,                             // restitution
  0.2                              // friction (Coulomb; combined as sqrt(μ_a μ_b))
)

engine.addStaticCapsule(
  { x: 0, y: 1, z: 0 },           // centre
  0.35, 0.5,                       // radius, half-height (local Y)
  { x: 0, y: 0, z: 0, w: 1 },
  0.5
)

// Slice B — the two shapes the adventure tracks needed. NOTE the argument
// order: this API takes radius BEFORE halfHeight, the opposite of Rapier's
// ColliderDesc.cylinder(halfHeight, radius). Both put the axis on local Y.
// The descriptor factory cylinderDesc() deliberately keeps Rapier's order,
// since it replaces Rapier call sites — wasm-adventure-export.ts is what
// swaps them over.
engine.addStaticCylinder(
  { x: 0, y: 0, z: 0 },           // centre
  0.5, 2.0,                        // radius, half-height (local Y)
  { x: 0, y: 0, z: 0, w: 1 },
  0.4,
  0.2
)

engine.addStaticSphere(
  { x: 0, y: 0, z: 0 },           // centre
  0.5,                             // radius
  0.4,
  0.2
)

// #420 — ball-trap funnels. Apex at +halfHeight on local Y, base disc at
// -halfHeight: Rapier's ColliderDesc.cone(halfHeight, radius), with the same
// radius-first argument swap as the cylinder above.
engine.addStaticCone(
  { x: -5, y: 0.5, z: 10 },       // centre
  0.2, 0.6,                        // base radius, half-height (local Y)
  { x: 0, y: 0, z: 0, w: 1 },
  0.6,
  0.3
)

// Statics are append-only — a rebuilt scene (a new adventure track, a fresh
// WasmOwner.rebuild) must clear first or it stacks a second copy. This
// invalidates every negative handle; dynamic bodies and hinges survive.
engine.clearStaticGeometry()
```

Negative handle ranges, one per shape family (see `native/src/PhysicsWorld.h`
and `native/src/StaticShapes.h`):

| Base | Shape |
|------|-------|
| `-1` | the infinite plane |
| `-1000` | static box |
| `-2000` | static capsule |
| `-3000` | kinematic OBB mover |
| `-4000` | OBB sensor volume |
| `-5000` | static cylinder |
| `-6000` | static triangle mesh |
| `-7000` | force field |
| `-8000` | static sphere |
| `-9000` | static cone |
| `-10000` | pin field (one slot per whole lattice) |

**Sphere vs cylinder** is closed form (`native/src/StaticShapes.cpp`). The ball
centre is transformed into the cylinder's local frame and clamped
independently in the radial and axial directions; that yields the three
regions for free — the curved side (only the radial clamp bites), the flat end
caps (only the axial clamp bites), and the rim circle where both do. A centre
strictly inside the solid falls back to the shallower of the two exit faces.
No GJK, no convex solver — the adventure tracks between them use only cuboid,
cylinder and ball, plus prism-pathway's triangular prisms, which are closed
convex triangle meshes (`triangularPrismLayout`) rather than a hull.

**Sphere vs cone** (`native/src/Cone.cpp`, #420) is closed form too. The solid
is the triangle apex (0, h) / rim (R, −h) / base centre (0, −h) swept around
the axis, and a point's nearest cone point always lies in the half-plane
through the axis and that point — so the query runs in 2D, (ρ, y), against
the base segment and the slant segment, then lifts back along the point's
radial direction. Inside the solid it exits through whichever of the base and
the slant is shallower. The broadphase files a cone under its bounding
cylinder. `run-wasm-parity.mjs` compares a slant hit against Rapier's own cone.
A native cone was chosen over a TS-emitted cylinder + sphere compound: it
added one ~170-line TU and kept `PhysicsWorld.cpp` well under the 500-line cap.

### Pin fields (#421)

A pachinko lattice is ONE static collider, not one cylinder per pin:

```typescript
// src/core/pin-field.ts — PinFieldSpec; object-pachinko.ts builds it via
// pachinkoPinFieldSpec() (src/objects/pachinko-pin-field.ts).
const id = engine.addPinField({
  origin: { x: -12, y: 0.4, z: -5 },   // centre of pin (row 0, col 0)
  rows: 10, cols: 13,
  spacingX: 24 / 13, spacingZ: 2.2,
  rowOffsetX: 12 / 13,                  // odd rows shift half a column
  radius: 0.09, halfHeight: 0.75,       // every pin: this cylinder, local Y axis
  rotation: { x: 0, y: 0, z: 0, w: 1 }, // field orientation
  restitution: 0.65, friction: 0.1,
  keepOuts: KEEP_OUT_BOXES,             // world-XZ rectangles, inclusive edges
  occupancy,                            // optional bit mask, LSB-first, index row * cols + col
  dropoutSeed, dropout,                 // optional seeded removal (lowbias32 hash, 24-bit compare)
})
engine.setCollisionGroups(id, membership, filter)  // one mask for every pin
```

- **Handles.** A field takes one slot of the `-10000` family however many pins
  it holds, so four 400-pin fields plus the table's statics never touch
  `getDroppedStaticCount()` (the cylinder family would have overflowed at
  1000). `getPinFieldPinCount(id)` reports how many pins survived the mask,
  keep-outs and dropout.
- **Collision.** The broadphase half is one world-AABB test per (awake
  sphere, field). The narrowphase moves the ball into the field frame and
  derives the candidate row range and, per row, column range from the ball's
  reach (ball + pin radius): O(1) candidates regardless of field size, never
  `rows × cols` pairs. Each candidate pin runs the exact
  `resolveSphereVsCylinder` that `addStaticCylinder` uses, so a field is
  contact-for-contact interchangeable with the equivalent cylinder loop
  (`pin_field_test.cpp` and `run-wasm-parity.mjs` compare the two).
- **Contacts.** Every pin contact reports the field id as `bodyId2`, with the
  pin's lattice index in contact slot 11 (`PhysicsContact.subIndex`; 0 for all
  other colliders). Touching two pins of one field in a step folds into one
  event per pair (peak impulse) — scoring does not need per-pin handles.
- **Determinism.** `resolvePinField` (TS) mirrors `buildPinField` (C++) rule
  for rule and does its lattice maths in float32 exactly as `PinField::worldPin`
  does, so the visual instances sit on precisely the pins that collide; the
  dropout hash is shared bit-for-bit (goldens in both test suites). A Daily
  Cascade layout records its `pinLattice`; the builder fits the seeded pins
  into an occupancy mask (keep-out safety net applied in TS on the layout's
  double-precision positions, since a seeded pin can land exactly on a keep-out
  edge in float32).
- **Paths.** `WasmTableWorld.createPinField` records one fixed body with one
  `pinField` collider; `wasm-static-export.ts` exports it with a single
  `addPinField`; the worker carries it as one `addPinField` command with the
  occupancy mask transferred. A world without the capability (Rapier —
  `supportsPinFields()` is false) gets one fixed cylinder per pin, from the
  same resolved positions. Debug draw instances one AABB per pin from the
  descriptor (`pinFieldPinBounds`); nothing per pin comes back from C++.

Native C++ tests (no browser, no Emscripten):

```bash
npm run test:native
# Equivalent:
npm run compile-db                      # configure only: Debug + compile_commands.json
cmake --build native/build-native
ctest --test-dir native/build-native --output-on-failure
```

Catch2 is fetched automatically via CMake `FetchContent` on first configure.
Test scenarios (friction and hinge cases live in `hinge_friction_test.cpp`):

| Test | Validates |
|------|-----------|
| `gravity integration` | Semi-implicit Euler velocity/position after one tick |
| `sphere-sphere contact` | Overlapping balls separate; relative velocity resolves |
| `sphere-plane bounce restitution` | Post-bounce speed ratio within bounds for `e=0.6` |
| `energy non-explosion (60 steps)` | Multi-ball swarm stays finite and bounded after 60 ticks |
| `body remove and recreate` | Handle lifecycle and `getActiveBodyCount()` |
| `ball drops on box` | Static OBB collision + settling |
| `ball hits capsule` | Static capsule collision + settling |
| `ball rolls down a static box rotated 15 degrees` | Rotated OBB ramp — no tunnelling, no jitter (adventure ramps are rotated cuboids) |
| `cylinder SIDE / END CAP / RIM` | The three sphere-vs-cylinder regions, each with the expected normal; the rim normal is finite and unit |
| `ball vs static sphere` | Static sphere reflection |
| `filter word excludes a static cylinder / sphere` | Group masks apply to the new shapes |
| `clearStaticGeometry` | Statics drop, handles restart from their bases, dynamic bodies and hinges survive |
| `stationary kinematic capsule supports resting ball` | Kinematic-body capsule shape parity with the static-geometry capsule path |
| `kinematic capsule flings ball` | A moving kinematic capsule imparts its own velocity onto a resting ball |
| `ball rolls down inclined plane` | Coulomb friction converts sliding into rolling |
| `spinning ball deflects on wall contact` | ω × r at the contact produces a tangential impulse |
| `kinematic capsule flick imparts spin` | Flipper-proxy motion with a tangential component spins the ball |
| `ball on flat plane comes to rest` | Rolling resistance + friction settle a sliding ball |
| `orientation integrates from angular velocity` | Quaternion `q` advances from ω and stays unit length |
| `hinge holds angle under gravity` | World-anchored hinge + locked limits keep a hanging body |
| `hinge motor reaches target omega` | Velocity motor hits target ω within ε |
| `hinge angle limits do not explode` | Hard limits stay finite under an aggressive motor |
| `hinge motor wakes sleeping body` | `setHingeMotor` wakes a sleeper |
| `ball resting on a rising kinematic piston is launched upward` (`kinematic_mover_test.cpp`) | Pose-delta velocity actually launches a resting ball, not just teleports geometry |
| `ball on a rotating kinematic platter picks up tangential velocity` (`kinematic_mover_test.cpp`) | ω × r at the mover contact point imparts tangential speed via friction |
| `ball crossing a sensor volume emits exactly one enter and one exit` (`sensor_volume_test.cpp`) | Enter/Stay/Exit lifecycle, zero impulse |
| `ball dwelling inside a sensor for N frames emits N-2 stay events` (`sensor_volume_test.cpp`) | Multi-frame dwell + exit-by-teleport lifecycle |
| `two bodies whose filter masks exclude each other never generate a contact pair` (`collision_filter_test.cpp`) | Broadphase respects membership/filter masks |
| `Dynamic <-> Kinematic round trip preserves mass` (`kinematic_body_test.cpp`) | `setBodyType` zeroes / restores inverse mass; a captured ball ignores impulses |
| `kinematic ball does not respond to gravity` (`kinematic_body_test.cpp`) | No integration or force accumulation while kinematic |
| `release velocity matches the last kinematic delta` (`kinematic_body_test.cpp`) | → Dynamic keeps the pose-delta velocity; free flight continues it |
| `captured ball holds for 30 frames while a second ball rolls past` (`kinematic_body_test.cpp`) | The held ball stays on its targets and deflects the roller without tunnelling |
| `kinematic body skips static solids but still trips sensors` (`kinematic_body_test.cpp`) | No impulse-less contact spam against statics; sensors still see a carried ball |
| `a ball hitting the slant gets the slant normal` (`cone_test.cpp`, + apex / base / inside / rotated / groups) | Sphere-vs-cone regions and handle family |
| `a ball falling through a 12x12 field contacts its pins` (`pin_field_test.cpp`) | Pin-field narrowphase, lattice sub-index in contacts |
| `a keep-out AABB holds no pin` / `an occupancy mask punches a hole` (`pin_field_test.cpp`) | Lattice resolution rules shared with `src/core/pin-field.ts` |
| `a pin field steps like the same pins added one cylinder at a time` (`pin_field_test.cpp`) | Field ≡ `addStaticCylinder` loop |
| `four dense fields plus table statics fit without dropping a handle` (`pin_field_test.cpp`, + rotated / groups / capacity / dropout) | One handle per field; family capacity and reset |

Parity suite (native Catch2 + compiled WASM bundle):

```bash
RUN_WASM_PARITY=1 npx vitest run tests/wasm-physics-parity.test.ts
# or directly:
node scripts/run-wasm-parity.mjs
```

---

## Kinematic OBB movers and sensor volumes (#383 Slice A)

Table physics (`wasm-owner`) can represent moving platforms and non-impulse
trigger zones without a second physics engine:

```typescript
// Kinematic oriented-box mover (piston, platter, gate). Push a new pose once
// per tick; linear/angular velocity is derived from the pose delta so a
// resting ball is actually launched by a rising piston or carried
// tangentially by a rotating platter — it does not just teleport through it.
const piston = engine.addKinematicMover(
  { x: 0, y: 0, z: 0 },        // position
  { x: 1, y: 0.1, z: 1 },      // half-extents
  { x: 0, y: 0, z: 0, w: 1 },  // rotation quaternion
  0.3,                          // restitution
  0.2                           // friction
)
engine.setNextKinematicTransform(piston, { x: 0, y: 0.05, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })

// Static OBB trigger volume: Enter/Stay/Exit contact events with zero
// impulse and no positional correction. Rides the existing packed contact
// buffer — decoded contacts carry an `isSensor` flag (contact-buffer.ts).
const sensor = engine.addSensorVolume(
  { x: 0, y: 0, z: 0 },        // centre
  { x: 0.5, y: 0.5, z: 0.5 },  // half-extents
)
```

Sphere-vs-OBB and capsule-vs-OBB narrowphase are implemented for movers;
OBB-vs-OBB is out of scope (movers never pair with statics or each other).
Sensors are static-position OBBs — Enter/Stay/Exit lifecycle is entirely a
byproduct of `ContactListener`'s existing pair-presence bookkeeping, so a
ball leaving a sensor by teleport (`setBodyPosition`) is handled the same
way as one leaving by velocity.

Every body — dynamic/kinematic RigidBody, static box/capsule, mover, or
sensor — carries a `membership`/`filter` bitmask mirroring `CollisionGroups`
in `src/game-elements/physics.ts` (see `native/src/CollisionFilter.h`; do not
renumber independently of the TS side). Two colliders interact iff each
one's membership intersects the other's filter. Unset masks default to
"collides with everything", so existing callers are unaffected:

```typescript
engine.setCollisionGroups(ballId, CollisionGroups.BALL, COLLIDES_WITH_EVERYTHING)
```

### Adventure geometry

Adventure tracks never build Rapier colliders inline. Every primitive emits an
`AdventureColliderDesc` (`src/adventure/track-collider-descriptors.ts`), and
the list has two consumers: `TrackColliderEmitter` realises it on the active
world sink (Rapier bodies on the dev/degrade path, `WasmBody` pose stores on
the owner path), and `src/game/physics/wasm-adventure-export.ts` walks it into
the C++ engine. A collider's *body* is its own descriptor, or its
`parentIndex` descriptor when attached, and the body's `motion` picks the route:

| Body motion | Collider | C++ |
|-------------|----------|-----|
| `fixed` | box / cylinder / sphere | `addStaticBox` / `addStaticCylinder` / `addStaticSphere` |
| `fixed` | `convexMesh` (prism-pathway's prisms) | `addStaticTriangleMesh`, one-sided, outward winding |
| `fixed` | sensor (any volume) | `addSensorVolume` with its `VolumeShape` |
| `kinematic-position` / `kinematic-velocity` | box / cylinder / sphere | `addKinematicMover` with its `VolumeShape` |
| moving | sensor | none — tested analytically in TS (`sphereTouchesVolume`) |
| `dynamic` | any | unsupported (no track builds one) |

**Moving bodies are posed in TypeScript.** `WasmOwner.driveAdventure(dt)`
advances each moving body once per frame — animated obstacles take the next
pose AdventureMode's animator set, spinning platters and mills integrate their
prescribed angular velocity exactly (`integrateSpin`) — then composes each
collider's body-local pose and pushes it through `setNextKinematicTransform`.
No Rapier exists on this path; the track's `WasmBody` only stores the
committed pose for mesh bindings.

**The ownership gate.** `WasmOwner.syncAdventureTrack()` returns true — the
track is fully owned and its WASM overlap bridge is installed — when every live
descriptor is expressible in C++ and
the track built nothing outside the descriptor path (`markUnexportedCollider`).
Exit portals no longer hold Rapier awake: portal entry goes through the
`AdventurePhysicsBridge`, and its cylinder sensor is exported like any other.
Closing a portal retires its descriptors (`TrackColliderEmitter.retireBody`) so
C++ does not keep a sensor for a body Rapier has removed.

`tests/wasm-owner-adventure.spec.ts` (run in the native-physics CI job) walks
**every** `AdventureTrackType` in the browser and fails on any unsupported
collider, an unowned track, a loaded Rapier module, a non-zero
`lastRapierStepMs`, or a spinning body that did not turn.

---

## Table authoring and WASM-id identity (#412)

The table, the balls, the toys and the adventure tracks are authored through a
narrow physics API — `PhysicsApi`, `PhysicsWorldSink`, `PhysicsBody`
(`src/core/physics-api.ts`) — instead of Rapier types. Rapier satisfies those
interfaces structurally, so the explicit `rapier` mode and the degrade path hand
the real library straight to the same builders and build a byte-identical table.
On the owner path `PhysicsSystem.init()` hands out `WASM_PHYSICS_API` and a
`WasmTableWorld` instead, and never imports Rapier.

**Descriptors.** `WASM_PHYSICS_API`'s `RigidBodyDesc` / `ColliderDesc` /
`JointData` builders only record data (`TableBodyDesc`, `TableColliderDesc`,
Rapier's defaults for anything left unset). `WasmTableWorld.createRigidBody` /
`createCollider` turn them into `WasmBody`s carrying `TableColliderDesc`s.

**Bodies.** A `WasmBody` is either

- *linked* to a C++ rigid body (`WasmBodyLink.id` is its WASM public id): a
  dynamic body whose first collider is a sphere becomes a C++ body the moment
  that collider is attached (balls, multiball, gold swarms), and `WasmOwner`
  links each flipper to its hinged capsule. Reads come from the engine, writes
  go straight to it, and values written since the last step are served from a
  write-through cache, because the C++ transform snapshot only refreshes when
  the engine steps (an impulse shows in `linvel()` at once, as in Rapier); or
- a *pose store* (fixed, kinematic): its colliders are exported below, and a
  kinematic target (`setNextKinematicTranslation`) becomes the pose after the
  step, as in Rapier.

**Runtime body type (#420).** A linked body's Rapier type is a C++ body type.
A toy capturing a ball (`setBodyType(KinematicPositionBased)`) flips the C++
body to `Kinematic` — infinite mass, no gravity, velocity zeroed, pose kept —
and its `setNextKinematicTranslation` / `Rotation` become C++ pose targets on
the ball's WASM id (`setNextKinematicTransform(id ≥ 0, …)`): the step moves the
body onto the target and gives it the pose delta over the fixed tick as its
velocity, so a held ball pushes a passing ball like a wall. A tick without a
target leaves a driven body at rest. Back to `Dynamic` rebuilds mass and
inertia and keeps that last kinematic velocity, so a release carries the
well's motion before the toy's impulse. A kinematic body never collides with
statics or movers (no impulse can pass, and Rapier reports no
kinematic-vs-fixed contact); sensors still see it. A disabled body is frozen
the same way and also drops to collision groups `0/0`; a hinged flipper is
never retyped. `WasmBody.translation()` of a driven body reports its last
target, since the worker's snapshot trails a frame.

Every toy that holds a ball — MagSpin, NanoLoom, Prism Core, Gauss Cannon,
Quantum Tunnel, `BallManager`'s hologram catch and the ball traps — goes
through one driver, `CapturedBall` (`src/core/captured-ball.ts`):
`capture(ball)` → `steer(ball, pose)` each tick → `release(ball, { impulse,
linvel, angvel })`. The toy state machines stay in TypeScript; the body-type
flip and the kinematic integration live in the solver that steps the ball.
`tests/feeder-golden-fixtures.test.ts` replays each feeder's golden FSM on the
Rapier mock and on the owner path (`WasmTableWorld` + the `WasmSimEngine`
fake) with identical impulses; `tests/wasm-owner-capture.spec.ts` captures and
launches a real ball in `wasm-owner` and `wasm-worker`.

Otherwise a linked body keeps C++'s all-groups default, as owner-mode balls
always have. The authored group word is kept on the collider but not forwarded
yet: the adventure chroma masks (`MASK_RED` …) omit `ADVENTURE_GROUP`, so a
coloured ball would drop through ordinary track geometry. Statics carry their
authored groups.

**Export.** `wasm-static-export.ts` walks the descriptors — nothing reads a
Rapier collider:

| Body | Collider | C++ |
|------|----------|-----|
| fixed | box / capsule / cylinder / sphere / cone | `addStaticBox` / `addStaticCapsule` / `addStaticCylinder` / `addStaticSphere` / `addStaticCone` |
| fixed | pin field (`WasmTableWorld.createPinField`) | `addPinField` — one id for the whole lattice |
| any | sensor box / cylinder / sphere | `addSensorVolume` |
| kinematic | box / cylinder | `addKinematicMover`, posed each tick from the body's target |
| any | convex hull, kinematic capsule / cone / sphere, unlinked dynamic | reported, not exported |

Export order is deterministic and C++ static ids are index-based, so a
re-export (an adventure track switch, a table edit) hands every collider the
same WASM id. Authored collision groups are applied (`setCollisionGroups`).

**The owner table scope.** `GameObjects.getWasmExportBodies()` names the table
bodies the C++ world simulates: everything with a mesh binding (walls,
slingshots, bumpers, pachinko pins and targets, decoration rails), the lane
rollover sensors and the drain; `GamePhysicsController` adds the ball traps
(funnel cone + chamber sensor, #420). Every other authored body — RailBuilder's
rails and guards, the plunger body, the spinner / launcher / gate, the
feeders' well geometry, the LCD ground (the owner's ground plane replaces it)
— is recorded but held out, and listed with a reason by `WasmOwner.getTableUnsupported()`. Those
bodies were authored against the Rapier table surface (the LCD ground's top,
y = −0.9), where the ball rolls underneath them; the owner's ground plane is
y = 0, and exported unchanged they close the plunger lane. They join the scope
once calibrated for the owner plane.

**Identity.** `CollisionDispatcher` keys every set on WASM public ids: a ball's
C++ body id, and a static body's first exported collider id. A contact's WASM
id resolves collider → body → key in `WasmOwner.resolveContactId`, the C++
analogue of Rapier's collider-handle → body-handle conversion, and the sets
rebuild whenever ids change (`WasmOwner.getIdEpoch()`: a re-export, a flipper
hinge, a ball spawned or removed).
`WasmMirror.getRapierBody()` is the only WASM-id → Rapier-body map left, for
the mirror parity path. `tests/collision-dispatch-wasm-ids.test.ts` locks the
key space.

**Bundle.** `loadRapier()` (`src/game-elements/rapier-loader.ts`) is the one
runtime import of `@dimforge/rapier3d-compat`. `main.ts` preloads the C++
bundle in parallel with engine creation (`preloadWasmPhysicsNow()`) and only
warms Rapier for the explicit Rapier modes. The rapier chunk is excluded from
the Workbox precache, and `npm run check:bundle` fails if it is ever precached
or modulepreloaded again.

---

## Joints

World-anchored 1-DOF revolute hinges live in `native/src/HingeJoint.cpp` and are
solved **after contacts** in each `PhysicsWorld` solver iteration so the motor
and the contact manifold do not fight.

```typescript
const hingeId = engine.createHinge({
  bodyId: flipperId,
  worldAnchor: { x: -4, y: -0.25, z: -7 },
  worldAxis: { x: 0, y: 1, z: 0 },   // table flippers match Rapier's Y revolute
  minAngle: PhysicsConfig.flipper.leftLimits[0],
  maxAngle: PhysicsConfig.flipper.leftLimits[1],
})

engine.setHingeMotor(hingeId, targetVel, maxTorque)
const angle = engine.getHingeAngle(hingeId)
```

`WasmOwner` creates one hinge per flipper at `rebuildHandleCaches()`, drives
`setHingeMotor` from the same `InputFrame` / `PhysicsConfig.flipper` rest and
active angles + stiffness/damping as Rapier `configureMotorPosition`. There is
no Rapier world on the owner path (Debug HUD `rapier ms` /
`lastRapierStepMs === 0`); Rapier only exists on the explicit `rapier` override
or the missing-bundle fallback.

Dynamic capsules now report isotropic inertia (averaged cylinder) so the hinge
can apply motor torque. Capsule-vs-capsule collision remains skipped.

Native capsules are authored along local +Y; Rapier flipper cuboids are long on
local +X. `wasm-owner` applies a one-time 90° Z rest rotation, and the authored
flipper `WasmBody` reports the inverse (`WasmBodyLink.rotationOffset`) plus its
pivot (`WasmBodyLink.pivot`), exactly as the Rapier flipper body did. That remap
is shape-axis alignment, not the retired kinematic `syncFlipperProxies` path.

This unblocks #361 Phase 3 (worker + SharedArrayBuffer): flippers no longer
depend on Rapier impulse joints on the main thread.

Kinematic capsules remain available for tests and non-flipper movers; they are
no longer the wasm-owner flipper path.

---

## Kinematic capsule bodies (legacy / tests)

`RigidBodyDesc` includes `shape` (`Sphere` or `Capsule`) and `capsuleHalfHeight`.
Combined with `BodyType.Kinematic`, a caller-driven capsule still imparts
momentum to dynamic spheres (`getInvMass()` is 0). That path is used by Catch2
flicking tests; production flippers use hinges (above).

---

## Phased plan

| Phase | Goal | Status |
|-------|------|--------|
| **0 – Spike** | C++ source + TypeScript wrapper + Vite import path working | ✅ Done |
| **1 – Core API** | PhysicsWorld + RigidBody + Embind bindings | ✅ Done |
| **2a – Geometry** | Static box + capsule colliders; parity tests | ✅ Done |
| **2b – Ownership** | `wasm-mirror` / `wasm-owner` modes; static table export | ✅ Done |
| **2c – Flipper motors** | Native world-anchored hinge + velocity motor; kinematic proxy deleted | ✅ Done |
| **2d – Perf HUD** | Rapier vs WASM vs mirror timing in Debug HUD | ✅ Done |
| **2e – Worker (#361 P1)** | `wasm-worker` + `postMessage` transferables; one-frame lag; no COOP/COEP | ✅ Done |
| **2f – Adventure (#383)** | Movers, sensors, cylinders, spheres, meshes, force fields; every track owned by C++ | ✅ Done |
| **3 – Decision** | Replace, not hybrid: `wasm-owner` is the production default | ✅ Done |
| **4 – Rapier removal (#412)** | Builders author through `PhysicsApi`; `WasmTableWorld` / WASM-id identity; no Rapier module or `World` on the owner boot; rapier chunk lazy and out of the PWA precache | ✅ Done |
| **5 – Worker parity (#414)** | Worker commands for mesh / box body / force field; SAB snapshot transport gated on isolation | ✅ Done |

---

## Memory model

- Emscripten allocates a single contiguous `ArrayBuffer` (WASM heap).
- `ALLOW_MEMORY_GROWTH=1` allows the heap to grow dynamically.
- Initial heap is 16 MB (`INITIAL_MEMORY=16777216`).
- `PhysicsWorld::delete()` must be called when the world is disposed to
  release C++ memory back to the WASM heap.
- `WasmPhysicsEngine.dispose()` calls `world.delete()` automatically.

### Worker transport (#361, #414)

`wasm-worker` instantiates `PhysicsModule` inside a Dedicated Worker
(`src/wasm/physics-worker.ts`). The main thread never blocks: it queues
commands, and each `step()` first reads whatever the worker last published,
then posts the frame's command batch. Visuals therefore trail by one physics
frame. Idle preload warms the worker instead of compiling the module on the
main thread. `-pthread` / `PROXY_TO_PTHREAD` stay unused — the C++ world is
single-threaded *inside* the worker, and its WASM memory is not shared.

**Commands (main → worker)** are the tagged `PhysicsWorkerCommand` union, one
ordered `postMessage` batch per frame. Keeping a single ordered channel means a
`createBody` can never be overtaken by the `applyImpulse` that names it. Mesh
vertex / index arrays are copied at enqueue and transferred, not cloned.
Handles are allocated on the main thread by `WasmIdShadow`, which mirrors every
native id range (bodies, hinges, and the static families -1000 … -8000).

**Snapshots (worker → main)** take one of two transports, chosen by
`isCrossOriginIsolated()` (`src/config/physics.ts`):

| | Cross-origin isolated | Not isolated (file://, embeds, header misconfig) |
|---|---|---|
| Transforms + hinge angles | Copied from HEAP into a SharedArrayBuffer under a seqlock | Copied into new `ArrayBuffer`s, transferred on `step-result` |
| Contacts | SPSC ring in the same buffer (exactly once, in order) | Same `step-result` message |
| Per-step allocation | None on either side (reader ping-pongs two staging buffers) | Three `ArrayBuffer`s per step |

The client asks for shared transport with `use-shared-transport`; the worker
allocates the buffer (it knows the slot count) and posts `shared-attach`. When a
step outgrows the buffer — body ids are never reused, so transform slots only
grow — the worker allocates one with doubled capacity and posts `shared-attach`
again *before* writing to it; the client drains the old contact ring and then
switches, so contact order survives. Past 64 MB, or if the client rejects the
layout version, that step falls back to `step-result`. A snapshot older than one
already applied is discarded (`staleSnapshots`).

`PhysicsWorkerClient.getTransportStats()` reports the active transport and
counts shared reads, `step-result` messages, attaches and stale snapshots;
`tests/wasm-worker-adventure.spec.ts` asserts `postMessageSnapshots === 0` when
isolated.

#### Shared snapshot layout (v1)

Defined in `src/wasm/physics-shared-layout.ts`; bump `SHARED_LAYOUT_VERSION`
when anything below moves. All words are 4 bytes, little-endian.

| Words | Type | Content |
|-------|------|---------|
| 0 | Int32 | `MAGIC` = `0x4c534250` ("PBSL") |
| 1 | Int32 | `VERSION` = 1 — the reader refuses any other |
| 2 | Int32 | `SEQ` — seqlock counter; odd while the worker is publishing |
| 3 | Int32 | `STEP_COUNT` of the published snapshot |
| 4 | Int32 | `TRANSFORM_FLOATS` in use |
| 5 | Int32 | `HINGE_COUNT` in use |
| 6 | Int32 | `CONTACT_HEAD` — advanced only by the main thread |
| 7 | Int32 | `CONTACT_TAIL` — advanced only by the worker |
| 8–10 | Int32 | Capacities: transform floats, hinge entries, contact records |
| 11 | Int32 | `PUBLISH_COUNT` |
| 12–15 | Int32 | Reserved |
| 16–17 | Float32 | `alpha`, worker `stepMs` |
| 18–19 | Float32 | Padding |
| 20… | Float32 | Transforms, `TRANSFORM_STRIDE` (16) per body slot |
| … | Float32 | Hinges: `id, angle` per entry |
| … | Float32 | Contact ring: (capacity + 1) × `CONTACT_STRIDE` (12) |

Transforms, hinges and the scalars are latest-wins: the reader copies them into
its own staging buffers and keeps the copy only if `SEQ` was even and unchanged
across it; otherwise it keeps the previous snapshot for another frame rather
than retrying. Nobody calls `Atomics.wait` or `Atomics.notify` — the main thread
polls once per `step()`, and the worker is driven by the command batch.

A world step that runs no substeps (a frame shorter than the fixed timestep)
publishes no contacts: native only refreshes its contact buffer when it
substeps, so re-reading it would deliver the previous step's contacts twice.
The in-process engine applies the same rule.

---

## Debugging

- Use `npm run build:wasm:debug` for `-O0 -g -gsource-map` and `ASSERTIONS=2`.
- Debug installs copy `PhysicsModule*.map` into `public/wasm/` for browser
  DevTools. Release and RelWithAsserts never ship maps into `public/wasm/` or
  production `dist/`.
- Use `npm run build:wasm:assert` for CI-style `-O3` + `ASSERTIONS=1` without
  full debug cost.
- The `Debug HUD` (`src/game-elements/debug-hud.ts`) shows WASM vs Rapier step
  timing when a WASM physics mode is active, and how many table colliders the
  owner is not simulating (`wasm unexported`; the list with reasons is
  `game.physicsController.getTableUnexported()`).
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

### Language Server & IDE Tooling (`compile_commands.json`)

CMake sets `CMAKE_EXPORT_COMPILE_COMMANDS ON`. `npm run compile-db` configures
`native/build-native` (Debug, no build, never Emscripten) and writes
`native/build-native/compile_commands.json` (gitignored); `npm run test:native`
runs it first. Root `.clangd` sets `CompilationDatabase: native/build-native` so
clangd indexes `native/src/**` without a symlink. Run `compile-db` once after clone
so the database exists, and again after adding a `.cpp`.

`npm run check:compile-db` verifies the database: every `native/src` and
`native/tests` TU present, exactly one `-O` level per TU, no `em++` entries, and
no stray `compile_commands.json` at the repo root or `native/`.

---

## CI Workflows

The GitHub Actions workflow (`.github/workflows/native-physics.yml`) runs on changes touching `native/**` or build scripts:

| Job | Status | Tools | What it checks |
|-----|--------|-------|----------------|
| `native_ctest` | **BLOCKING** | cmake, g++ | `npm run test:native` (Catch2), `check:compile-db`, `check:wasm-docs` |
| `sanitizer_ctest` | **BLOCKING** | cmake, g++ | ASan/UBSan Catch2 (`CMAKE_BUILD_TYPE=Debug`) |
| `wasm_parity` | **BLOCKING** | emsdk | `print:wasm-flags` then Release + RelWithAsserts + `test:wasm-parity` |

`native_ctest` runs in ~15 seconds without requiring Emscripten and gates PRs against C++ logic regressions. Additionally, `tests/embind-surface.test.ts` asserts that TypeScript interface definitions (`src/wasm/wasm-types.ts`) match the exported Embind surface (`native/src/bindings.cpp`), and `tests/wasm-worker-api-parity.test.ts` (Vitest, no WASM) fails when a mutating Embind function is not wrapped on `WasmPhysicsEngine`, or a mutating engine method has no `PhysicsWorkerCommand` and is not on its tracked-gap list.

Skip options:

- **WASM job only:** include `[skip wasm-ci]` in the commit message.
- **Entire workflow:** trigger manually via `workflow_dispatch` only.
- **Local without emcc:** `npm run build:wasm` exits 0 with a skip message;
  the WASM CI job fails explicitly if `emcmake` is missing or artefacts are absent.
