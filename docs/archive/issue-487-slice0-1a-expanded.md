# #487 slice 0 + 1a — merge the build-hardening branch, pin emsdk in CI, and land the bit-identical half of the reproduced solver bugs with Catch2 tests

Sub-issue of #487. Expanded 2026-10-29 from the §B draft after a Gemini / gpt-oss / Grok / Gemini-Argon review round; every file, line and constant below was re-checked against `main` at `d835d90` and `origin/claude/442-e-build-hardening`, and the model claims that did not survive that check are listed at the end so nobody re-litigates them.

## Context / motivation

#487 freezes the C++ engine's numerics before verified scores and tournaments (#471 / #490) go live, because every numeric change after that invalidates every stored replay. Its slice 0 is "merge, don't redo": `claude/442-e-build-hardening` has been on `origin` since 10-15 (9 commits, 46 files, +1,354/−431), is 96 commits behind `main`, and still has zero textual conflicts (re-measured 2026-10-29). Until it lands there is no golden trace to attribute drift to, both workflows run `./emsdk install latest` under the constant cache key `emsdk-${{ runner.os }}-latest` (`native-physics.yml:122-134`, `ci.yml:123-140`), and `-ffp-contract` is whatever the compiler defaults to. Slice 1 lists nine reproduced bugs, none with a test; the UB / capacity / NaN half of them can land **bit-identically for every well-formed scene**, i.e. without changing a golden-trace constant, which is why they go first.

This issue is scoped to `native/**`, the two workflows' emsdk and sanitizer steps, `scripts/build-wasm.sh`, `.emsdk-version`, `docs/wasm-physics-engine.md`, and the `src/wasm` type surface the merge itself touches (`PhysicsModule.ts`, `wasm-types.ts`, `wasm-types-conformance.ts`, `generated/`, `physics-module-adventure.ts`). It cannot collide with the #486 ship-it work running in `src/engine`, `src/materials`, `src/wasm/physics-worker-*`, `vite.config.ts`, `public/` and `tsconfig*`.

"Bit-identical" is a domain-restricted guarantee, not a total one: identical over finite, in-capacity, in-range inputs. Behaviour changes only where the old code invoked undefined behaviour, aliased handles, or exposed platform-dependent NaN payloads. Each PR body states that contract explicitly.

## What the code actually looks like (verified 2026-10-29)

- Static ids are **negative and descending**: `STATIC_BOX_ID_BASE −1000`, `STATIC_CAPSULE −2000`, `KINEMATIC_MOVER −3000`, `SENSOR_VOLUME −4000`, `STATIC_CYLINDER −5000`, `STATIC_MESH −6000` (`TriangleMesh.h:51`), `FORCE_FIELD −7000` (`ForceField.h:56`), `STATIC_SPHERE −8000`, `PIN_FIELD −10000` (`PinField.h:106`). `STATIC_HANDLE_CAPACITY = 1000` and `STATIC_HANDLE_OVERFLOW = 0x7FFFFFFF` (`PhysicsWorld.h:78,85`); boxes, capsules, movers, sensors (`PhysicsWorld.cpp:140-203`) and pin fields (`PinField.cpp:136`) already check capacity and bump `droppedStatics_`. **Meshes and force fields do not:** `TriangleMesh.cpp:106-107` returns `STATIC_MESH_ID_BASE - meshIndex`, so the 1001st mesh is `−7000`, the first force field's id; `ForceField.cpp:21-24` has no check at all.
- Signed overflow: `ForceField.cpp:28,34` compute `FORCE_FIELD_ID_BASE - fieldId` before any range check (`fieldId = INT_MIN` overflows); `PinField.cpp:142` (`PIN_FIELD_ID_BASE - fieldId`) is computed before its `fieldId > PIN_FIELD_ID_BASE` guard; `BroadphaseGrid.cpp:334` does `base.cx + dx` on a cell coordinate that came from an unchecked cast.
- Float→int: `BroadphaseGrid::cellX/cellZ` (`BroadphaseGrid.cpp:25-31`) are `static_cast<int>(std::floor((x - minX) / cellSize))` with no finiteness or range check. Native x86 yields `INT_MIN` for NaN/±inf, aarch64 and WASM saturate, so the three builds already disagree on such inputs.
- `maxSubsteps` is a **`float` field of `WorldParams`** (`PhysicsWorld.h:94`, default 8), exposed through an Embind `value_object` (`bindings.cpp:75`), and cast at `PhysicsWorldStep.cpp:83` (`substepsDone < static_cast<int>(params_.maxSubsteps)`). A NaN from JS is UB there.
- `getStateHash()` lives in `Snapshot.cpp:444`: `SNAPSHOT_VERSION` (2), the canonical static content hash, `writeState`, hinge angles, then the static insertion ranks. `SnapshotHasher::f32` (`SnapshotCodec.cpp:69`) and `SnapshotWriter::f32` (`:20`) both `memcpy` the raw IEEE bits. **No NaN and no −0 canonicalisation exists anywhere.**
- The 442-e golden test (`native/tests/golden_trace_test.cpp`) uses `RigidBodyDesc` / `createRigidBody`, which `main` still exposes (`PhysicsWorld.h:110`, `RigidBody.h:24`); its three constants (`table 0xcda66fece2129bfd`, `fast 0xf371da108346ec38`, `sleep 0x7e7068e629e2c128`) were recorded against the 10-15 engine and **will not match** after the merge, because `main` since changed the hash itself (`eb6f29b`, `SNAPSHOT_VERSION` 2, static ranks hashed) and the solver (#474, #492).
- 442-e already builds two environments: `WEB_WASM_ENV="web,worker"` for the shipped bundle and `NODE_WASM_ENV="web,worker,node"` for the `--assert` and bench artefacts that Node loads (`scripts/build-wasm.sh:63-66`). `scripts/run-wasm-parity.mjs` imports the assert bundle (`WASM_MODULE_PATH=native/build-assert/PhysicsModule.js`). The parity question is therefore already answered by the branch: no `wasmBinary` shim, no second production artefact.
- The native library and the test target both compile with `-Wall -Wextra -Werror` (`CMakeLists.txt:141-143,178-179`); the WASM target does not carry the warning set. `CMAKE_CXX_EXTENSIONS` is unset (so `-std=gnu++17`). The sanitizer job uses `g++` with `-fsanitize=address,undefined -fno-sanitize-recover=all` and `UBSAN_OPTIONS=halt_on_error=1` (`native-physics.yml:93-112`); GCC's `undefined` group excludes `float-cast-overflow`, so bug 6 above is invisible to it today.
- Test files on `main`: `adventure_geometry, axis_pull_field, collision_filter, cone, hinge_friction, kinematic_body, kinematic_mover, physics_world, pin_field, sensor_volume, sleeper_contact, snapshot, state_hash, static_shapes` + `test_helpers.hpp`. 442-e adds `golden_trace_test.cpp` and edits `physics_world_test.cpp`.

## Proposed approach

### PR 1 — slice 0: `fix/487-slice0-build-hardening`

Branch off `origin/main` **after PR #492 merges** (it edits `PhysicsWorld.h`, `PhysicsWorldStep.cpp`, `BroadphaseGrid.cpp`, `SensorVolume.*`; cutting before it means re-recording the goldens twice).

1. `git merge --no-ff origin/claude/442-e-build-hardening`. Never rebase, amend or force-push the branch; its nine commits stay as they are. Resolve semantic breakage in follow-up commits, one concern each:
   - `golden_trace_test.cpp` against the current `createRigidBody` / `WorldParams` surface and the #492 sensor sweep (compile first, then re-record).
   - `src/wasm/generated/PhysicsModule.d.ts` regenerated from the merged `bindings.cpp` (it is 96 commits stale: `getStateHash`, `getStaticContentHash`, `getDroppedStaticCount`, the #492 sensor API, the #480 rail colliders); `tests/wasm-generated-types.test.ts` and `tests/embind-surface.test.ts` must pass against it.
   - `wasm-types.ts` / `wasm-types-conformance.ts` / `PhysicsModule.ts`: keep every method `main` added since 10-15; adopt 442-e's BigInt u64 conversion point for `getStateHash`.
   - `scripts/check-wasm-docs.mjs` parses `-sEXPORTED_RUNTIME_METHODS` / `-sEXPORTED_FUNCTIONS` out of `CMakeLists.txt` and compares with the flag table in `docs/wasm-physics-engine.md`; update the table, the toolchain section (`.emsdk-version`) and the environment note.
2. CI: both workflows read the pin: `./emsdk install "$(tr -d '[:space:]' < .emsdk-version)"` / `activate` the same, cache key `emsdk-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('.emsdk-version') }}` (`runner.arch` so the ARM job below cannot poison the x64 cache). Keep the clone-and-cache structure that is there; `emscripten-core/setup-emsdk@v16` is the maintained alternative if the manual block misbehaves. Keep **6.0.10**, the version the branch pinned; moving to 6.0.13 is its own PR with its own golden diff. Do not add `-sDETERMINISTIC` (removed in Emscripten 5.0.7; it only ever injected a pre-js).
3. CMake: `set(CMAKE_CXX_EXTENSIONS OFF)` next to `CMAKE_CXX_STANDARD_REQUIRED`; `-ffp-contract=off` stays on both `pachinball_physics_native` and `PhysicsModule` (442-e put it there; verify after the merge). Add `-Wshadow -Wconversion -Wsign-conversion -Wdouble-promotion -Wold-style-cast` to those **two targets only** via `target_compile_options` (never `add_compile_options`, which would compile Catch2 with them; the test target keeps its `-Wall -Wextra -Werror`). Fix the two `-Wshadow` hits (`MathTypes.h:12,43`, constructor parameters named like members) and whatever `-Wdouble-promotion` / `-Wconversion` surfaces in the 96 commits — **in PR 1, before the goldens are recorded**, because a `0.5` → `0.5f` fix can change a result.
4. `native-physics.yml`: a `native_release_ctest` job (`-DCMAKE_BUILD_TYPE=Release`, same ctest) next to the Debug one, and `native_arm64_ctest` on `runs-on: ubuntu-24.04-arm` (free for public repositories; the repo is public). Both non-blocking for one week, then promoted.
5. Re-record the three golden constants on the merged tree and put the old → new table in the PR body with the reason (hash layout `eb6f29b`, solver #474/#492, toolchain pin). `npm run test:native`, `test:wasm-parity` (needs `emcc`), `check:wasm-docs`, `check:compile-db`, `tsc -b`, `lint`, `vitest` green.

### PR 2 — slice 1a: `fix/487-slice1a-ub-nan-capacity`, on PR 1's head

Each fix is one commit with a Catch2 case shown failing on the parent commit in the PR body. **Golden constants identical before and after, `SNAPSHOT_VERSION` unchanged, no new bytes in the hashed stream.**

6. **Capacity.** `addStaticTriangleMesh` and `addForceField` get the same guard the other families have: `if (meshes_.size() >= STATIC_HANDLE_CAPACITY) { ++droppedStatics_; return STATIC_HANDLE_OVERFLOW; }` (before any triangle is inserted into the broadphase, so a rejected mesh leaves `triangles_` and the static content hash untouched); same for `fields_`. `droppedStatics_` stays an out-of-band counter, never hashed.
7. **Signed overflow.** `ForceField.cpp:28,34` and `PinField.cpp:142`: range-check `fieldId` against `[BASE − (size−1), BASE]` before the subtraction; compute the index in `int64_t` or after the check. `BroadphaseGrid.cpp:334`: neighbour arithmetic on cell coordinates that are guaranteed in-range by fix 8 (and a `static_assert`/clamp that `|cx| < INT_MAX − 1`).
8. **Float→int.** `cellX/cellZ`: map NaN to the origin cell, clamp the scaled float to `[−1.0e8f, +1.0e8f]` **before** the cast. Every playfield coordinate (|x| < 1e3) converts to the same `int` as today; ±inf and 1e30 no longer trap under `float-cast-overflow` and no longer feed overflow into fix 7. Do **not** clamp to the grid extent: that would move far bodies into boundary buckets and change pair order on healthy scenes.
9. **`maxSubsteps`.** Validate at the Embind boundary (where `WorldParams` is set) and at the cast site: `!isfinite → 8` (the default), else `clamp(1, 64)`, then `static_cast<int>`. Document the contract in `docs/wasm-physics-engine.md`.
10. **NaN quarantine + hash canonicalisation.** At the end of **every substep** (not once per `step()`, otherwise a NaN body contaminates its neighbours through `std::min`/`f32.min`, which disagree between native and WASM on NaN operands), check the 13 floats of each active dynamic body; if any is non-finite: restore the pose the substep started from (identity/origin if the NaN was injected before any step), zero linear and angular velocity, put the body to sleep through the **existing** sleep flag the hash already covers (no new hashed field), skip it in the solver, and push a `NaNQuarantine{ bodyId, step, substep }` event. In `SnapshotHasher::f32` only: `std::isnan(v) ? 0x7fc00000u : bits`. **Leave `SnapshotWriter::f32` raw** (a snapshot must restore the exact bits) and **do not canonicalise −0.0f** (healthy traces contain it; that would be a golden change). Wire the event through the contact/event buffer so TypeScript can later decide stuck-ball rescue vs. score-neutral drain; the C++ side only freezes.
11. Sanitizer job: `apt-get install clang`, `CC=clang CXX=clang++`, `-fsanitize=address,undefined,float-cast-overflow -fno-sanitize-recover=all`. Land this as the **first** commit of PR 2 and show it red on PR 1's head for fix 8, then green.

### Catch2 cases (names are the acceptance list)

- `static_shapes_test.cpp` — *"meshes and force fields reject the 1001st entry without aliasing"*: add 1000 meshes, assert ids `−6000 … −6999`, `getDroppedStaticCount() == 0`, record `getStaticContentHash()` and `getStateHash()`; the 1001st returns `STATIC_HANDLE_OVERFLOW`, the count is 1, both hashes unchanged; `addForceField` then returns `−7000` and `setForceFieldEnabled(−7000, false)` does not touch any mesh. Same for 1000 + 1 force fields.
- `static_shapes_test.cpp` / `pin_field_test.cpp` — *"field ids at the integer limits are rejected, not decoded"*: `setForceFieldEnabled`, `setForceFieldVector`, `getPinFieldPinCount` with `INT_MIN`, `INT_MAX`, `−1`, `BASE + 1`, `BASE − size`: no sanitizer report, `−1` / no-op, state hash unchanged.
- new `broadphase_test.cpp` — *"cell coordinates clamp before the int cast"*: bodies at `{1e25, −1e25}`, `{3.4e38}`, `{±inf, NaN}` and two ordinary bodies at `{12.34, −56.78}` / `{12.50, −56.70}`: no `float-cast-overflow` report, the ordinary pair's cell keys and emitted pair are identical to the unpatched values (record them in the test), the extreme ones land in finite cells.
- `physics_world_test.cpp` — *"maxSubsteps is validated at the boundary"*: six identical worlds stepped with `maxSubsteps` = NaN, 8, −100, −inf, +inf, 64: `hash(NaN) == hash(8)`, `hash(−100) == hash(−inf)`, `hash(+inf) == hash(64)`, no report.
- `state_hash_test.cpp` — *"a NaN body is quarantined on its first substep and the hash is payload-invariant"*: two worlds, sphere 2 given velocity NaN with payload `0x7fc00001` in one and `0xffffffff` in the other: hashes equal **before** stepping; after `step(1/60)`, sphere 2 is asleep with zero velocities and a finite pose, the event buffer holds one `NaNQuarantine` at substep 0, sphere 1 keeps a finite pose and the same trajectory as a third world where sphere 2 was simply asleep, and both hashes are equal.
- `golden_trace_test.cpp` — unchanged constants from PR 1, run in Debug, Release, the sanitizer job and the ARM job.

## Acceptance criteria

- `origin/claude/442-e-build-hardening` merged into `main` through a reviewed PR with a merge commit; `git log` shows its nine commits unchanged.
- Both workflows install the emsdk named in `.emsdk-version` (6.0.10); the cache key changes when the file changes; `emcc --version` is echoed.
- `native_ctest`, `native_release_ctest`, `sanitizer_ctest` (clang + `float-cast-overflow`), `wasm_parity`, `check:wasm-docs`, `check:compile-db` green; `native_arm64_ctest` runs and reports (non-blocking for the first week).
- The warning set is on the two engine targets only; the Catch2 target is untouched.
- PR 1 body: old → new golden table with reasons. PR 2 body: the same table with zero diff and the contract paragraph: *"All golden-trace constants are bit-for-bit identical before and after this PR. Behaviour changes only on inputs that previously triggered undefined behaviour, handle aliasing, or platform-dependent NaN payloads: `maxSubsteps` non-finite or outside [1, 64], broadphase coordinates beyond ±1e8 cells, the 1001st mesh or force field, field ids outside their range, and non-finite body state. `SNAPSHOT_VERSION` is unchanged."*
- Six new Catch2 cases above, each demonstrably failing on the parent commit (sanitizer report or wrong value).
- No change to `SnapshotWriter`, to the snapshot layout, or to any hashed byte of a healthy scene.

## Deferred (next #487 PR, "slice 1b", with an announced golden diff)

Bug 1 (z-face `shallow = dz`, `Narrowphase.cpp:241`), bug 2 (sleep before solve, `PhysicsWorldStep.cpp:117`), bug 3 (mover velocity per `step()` not per substep, `:73-78`), bug 9 (silent shape-pair skips, `:146-170`), the 1/30 + 1/144 mover tests, `removeHinge`, `ForceSpace::Local`, `resolveCapsuleVsMover`, `doubleSided`; slices 2–5. Also the `actions/*` major bumps (v4 → current; Grok reports checkout v7, setup-node v7, cache v6 as of late October 2026, unverified here) as the separate housekeeping PR the Backlog already lists.

## Not doing in this slice

- No rebase, squash or cherry-pick of 442-e (the acceptance criterion requires the nine commits intact; cherry-picking would mean resolving the 96-commit gap twice).
- No second Node-only production bundle and no loosening of `web,worker`; the assert artefact already carries `node` for parity.
- No removal or despawn of a NaN body inside C++; freeze + event, TypeScript decides.
- No hashing of `droppedStatics_`, no new hashed per-body field, no −0 canonicalisation, no `SNAPSHOT_VERSION` bump.
- No touch of `src/engine`, `src/materials`, `src/wasm/physics-worker-*`, `vite.config.ts`, `public/`, `tsconfig*` (#486's files).

## Open questions — resolved during expansion

1. **ARM runner** — `ubuntu-24.04-arm` is free for public repositories; the job is added, non-blocking for one week.
2. **`web,worker` vs. Node parity** — already solved on the branch (`build-wasm.sh:63-66`): the shipped bundle is `web,worker`, the assert/bench artefacts are `web,worker,node`, and parity loads the assert bundle.
3. **NaN policy** — freeze in place, sleep flag, zero velocities, event; never remove.
4. **Tracker** — GitHub sub-issue of #487 (the Linear bot mirrors it).

## Model claims that did not survive verification (so nobody re-litigates them)

- "`ForceField.cpp` / `PinField.cpp` / `TriangleMesh.cpp` may be introduced by 442-e" — they exist on `main`; 442-e does not touch them.
- "`HANDLE_TRIANGLE_MESH_BASE = 5000`, `HANDLE_FORCE_FIELD_BASE = 6000`, `MAX_FORCE_FIELDS = 64`" — ids are negative and descending (−6000 / −7000), capacity is the shared `STATIC_HANDLE_CAPACITY = 1000`, the overflow sentinel is `STATIC_HANDLE_OVERFLOW`, not `−1`.
- "`getStateHash()` is FNV-1a in `PhysicsWorld.cpp` and may already canonicalise −0" — it is `SnapshotHasher` in `Snapshot.cpp:444` / `SnapshotCodec.cpp:69`, raw bits, no canonicalisation of anything.
- "`setMaxSubsteps(float)` exists" — it is a `WorldParams` float field set through a `value_object`; validation goes at the params setter and the cast site.
- "The 442-e golden test needs porting from `RigidBody` to `BodyDesc.h`" — it uses `RigidBodyDesc` / `createRigidBody`, which `main` still has; it needs re-recording, not porting.
- "`run-wasm-parity.mjs` needs a `wasmBinary` / `importScripts` shim" — it loads the Node-capable assert bundle.
- "Golden suite has 23 scenes, max 736 meshes" and "`.emsdk-version` 3.1.45" (gpt-oss) — the suite has three traces; the pin is 6.0.10.
- "Hash a `frozen` flag / `BODY_FLAG_QUARANTINED`" — any new hashed byte breaks every golden; reuse the sleep flag.
