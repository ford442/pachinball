# 3.25: FetchContent SYSTEM + FIND_PACKAGE_ARGS (Catch2 below).
cmake_minimum_required(VERSION 3.25)
project(pachinball_physics LANGUAGES CXX)

# CMAKE_BUILD_TYPE (single-config generators) / configs:
#   Debug          — native: -O0 -g; WASM: -O0 -g -gsource-map, ASSERTIONS=2
#   Release        — native: -O3 -DNDEBUG (CMAKE_CXX_FLAGS_RELEASE); WASM: -O3, ASSERTIONS=0
#   RelWithDebInfo — native: -O2 -g -DNDEBUG (CMAKE_CXX_FLAGS_RELWITHDEBINFO); (unused for WASM)
#   RelWithAsserts — WASM only: -O3, ASSERTIONS=1  (CI parity; build-wasm.sh --assert)
#
# The native targets do NOT add their own -O flag: CMAKE_CXX_FLAGS_<CONFIG> owns the
# optimisation level so every translation unit in compile_commands.json carries exactly
# one -O. Always configure with an explicit -DCMAKE_BUILD_TYPE (npm run test:native does);
# a bare configure defaults to Debug below so clangd/ASan see -O0 -g.
#
# Native library uses -fno-exceptions to match the WASM dialect of the same sources.
# Catch2 test binary keeps exceptions (the framework requires them).

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Opt-in rebuild speed-up for both trees. Set before any target exists — the
# launcher is captured at target creation. Not part of compile_commands.json.
option(PACHINBALL_CCACHE "Compile through ccache when it is installed" OFF)
if(PACHINBALL_CCACHE)
  find_program(PACHINBALL_CCACHE_PROGRAM ccache)
  if(PACHINBALL_CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${PACHINBALL_CCACHE_PROGRAM}")
    message(STATUS "PACHINBALL ccache: ${PACHINBALL_CCACHE_PROGRAM}")
  else()
    message(WARNING "PACHINBALL_CCACHE=ON but ccache was not found — building without it")
  endif()
endif()

# ---------------------------------------------------------------------------
# Shared compile policy — linked PRIVATE into every target that compiles
# project sources (native library, Catch2 tests, PhysicsModule), so
# bindings.cpp is held to the same bar as the solver.
# ---------------------------------------------------------------------------
add_library(pachinball_warnings INTERFACE)
target_compile_options(pachinball_warnings INTERFACE
  -Wall -Wextra -Werror
  -Wshadow -Wconversion -Wdouble-promotion
)

# Byte-exact native ↔ WASM parity needs every a*b+c rounded twice. GCC
# defaults to -ffp-contract=fast outside ISO mode (we build gnu++17), which
# fuses into FMA on any FMA-capable target (aarch64, -march=native x86-64);
# Clang defaults to `on`. Neither fuses today (baseline x86-64 has no FMA;
# wasm has none without relaxed-simd) — this keeps it that way everywhere.
add_library(pachinball_fp INTERFACE)
target_compile_options(pachinball_fp INTERFACE -ffp-contract=off)

# ---------------------------------------------------------------------------
# Source files
# ---------------------------------------------------------------------------
set(PHYSICS_CORE_SOURCES
  src/BodyStore.cpp
  src/BroadphaseGrid.cpp
  src/HingeJoint.cpp
  src/KinematicMover.cpp
  src/SensorVolume.cpp
  src/VolumeShape.cpp
  src/Cylinder.cpp
  src/TriangleMesh.cpp
  src/ForceField.cpp
  src/DynamicBox.cpp
  src/Narrowphase.cpp
  src/StaticShapes.cpp
  src/Cone.cpp
  src/PinField.cpp
  src/KinematicBody.cpp
  src/PhysicsWorld.cpp
  src/PhysicsWorldStep.cpp
  src/Snapshot.cpp
  src/SnapshotCodec.cpp
)

# ---------------------------------------------------------------------------
# Emscripten WASM module
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
  # SoA / broadphase vectorize under -msimd128; docs/WASM_BENCH_RESULTS.md justifies ON.
  option(PACHINBALL_WASM_SIMD "Enable WASM SIMD auto-vectorization (-msimd128)" ON)
  option(PACHINBALL_WASM_LTO  "Enable link-time optimization (-flto)" ON)
  # Emscripten writes TypeScript declarations for the Embind surface. Needs
  # `tsc` on PATH; build-wasm.sh turns it on for the Release build and copies
  # the file to src/wasm/generated/ (committed, diffed in CI). Does not
  # change PhysicsModule.js / .wasm.
  option(PACHINBALL_WASM_EMIT_TSD "Emit PhysicsModule.d.ts (--emit-tsd; needs tsc on PATH)" OFF)

  # web + worker: the shipped bundle (main thread, and the wasm-worker
  # Dedicated Worker, #361). Node shims stay out of it. Bundles loaded from
  # Node (run-wasm-parity.mjs, the RUN_WASM_PARITY vitest suites, the bench)
  # are built with "web,worker,node" — build-wasm.sh passes that for --assert
  # and --bench-matrix, and always passes the value explicitly so a stale
  # cache cannot leak one into the other.
  set(PACHINBALL_WASM_ENVIRONMENT "web,worker" CACHE STRING "Emscripten -sENVIRONMENT for PhysicsModule")
  set(PACHINBALL_WASM_INITIAL_MEMORY 16777216)
  # Growth stops at 256 MiB: a runaway allocation fails loudly instead of
  # eating the tab (a full table is a few MiB).
  set(PACHINBALL_WASM_MAXIMUM_MEMORY 268435456)
  # The solver never recurses; 256 KiB is 4× the 64 KiB default as headroom.
  set(PACHINBALL_WASM_STACK_SIZE 262144)

  message(STATUS "PACHINBALL WASM SIMD=${PACHINBALL_WASM_SIMD} LTO=${PACHINBALL_WASM_LTO} ENV=${PACHINBALL_WASM_ENVIRONMENT} INITIAL_MEMORY=${PACHINBALL_WASM_INITIAL_MEMORY}")

  add_executable(PhysicsModule
    ${PHYSICS_CORE_SOURCES}
    src/bindings.cpp
  )
  target_include_directories(PhysicsModule PRIVATE src)
  target_link_libraries(PhysicsModule PRIVATE pachinball_warnings pachinball_fp)

  # Output as a proper ES module that can be imported directly by Vite
  set_target_properties(PhysicsModule PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  )

  target_link_options(PhysicsModule PRIVATE
    # STRICT drops deprecated settings and implicit libraries, so everything
    # the module needs is spelled out below (-lembind, --no-entry).
    "-sSTRICT=1"
    "--no-entry"
    "-sEXPORT_ES6=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=PhysicsModule"
    "-lembind"
    "-sENVIRONMENT=${PACHINBALL_WASM_ENVIRONMENT}"
    # Every caller invokes the factory with no options (the .wasm is found
    # via import.meta.url), so the glue reads no Module.* overrides.
    "-sINCOMING_MODULE_JS_API=[]"
    # No -sWASM_BIGINT: BigInt integration is always on in the pinned SDK (the
    # setting is deprecated), so uint64_t returns cross as a lossless BigInt.
    "-sFILESYSTEM=0"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=${PACHINBALL_WASM_INITIAL_MEMORY}"
    "-sMAXIMUM_MEMORY=${PACHINBALL_WASM_MAXIMUM_MEMORY}"
    "-sSTACK_SIZE=${PACHINBALL_WASM_STACK_SIZE}"
    "-sMALLOC=emmalloc"
    "-sEXPORTED_RUNTIME_METHODS=[\"HEAPF32\",\"HEAPU32\"]"
    # Triangle soup is uploaded through the heap (addStaticTriangleMesh takes
    # pointers), so the allocator has to be reachable from JS.
    "-sEXPORTED_FUNCTIONS=[\"_malloc\",\"_free\"]"
    "--closure=1"
  )

  target_compile_options(PhysicsModule PRIVATE "-fno-exceptions")
  target_link_options(PhysicsModule PRIVATE "-fno-exceptions")

  if(PACHINBALL_WASM_SIMD)
    target_compile_options(PhysicsModule PRIVATE "-msimd128")
    target_link_options(PhysicsModule PRIVATE "-msimd128")
  endif()

  if(PACHINBALL_WASM_LTO)
    target_compile_options(PhysicsModule PRIVATE "-flto")
    target_link_options(PhysicsModule PRIVATE "-flto")
  endif()

  if(PACHINBALL_WASM_EMIT_TSD)
    target_link_options(PhysicsModule PRIVATE
      "SHELL:--emit-tsd ${CMAKE_BINARY_DIR}/PhysicsModule.d.ts")
  endif()

  target_compile_options(PhysicsModule PRIVATE
    "$<$<CONFIG:Debug>:-O0;-g;-gsource-map>"
    "$<$<CONFIG:Release>:-O3>"
    "$<$<CONFIG:RelWithAsserts>:-O3>"
  )
  target_link_options(PhysicsModule PRIVATE
    "$<$<CONFIG:Debug>:-O0;-g;-gsource-map;-sASSERTIONS=2>"
    "$<$<CONFIG:Release>:-O3;-sASSERTIONS=0>"
    "$<$<CONFIG:RelWithAsserts>:-O3;-sASSERTIONS=1>"
  )
endif()

# ---------------------------------------------------------------------------
# Native (non-Emscripten) build — Catch2 unit tests.
# compile_commands.json lands in native/build-native/ (see root .clangd).
# ---------------------------------------------------------------------------
if(NOT EMSCRIPTEN)
  # OFF skips Catch2 entirely: no network on configure, so `npm run compile-db --
  # -DPACHINBALL_BUILD_TESTS=OFF` works offline (the database then omits tests/).
  option(PACHINBALL_BUILD_TESTS "Build the Catch2 test binary (fetches Catch2 unless installed)" ON)
  # ASan + UBSan on the library and the tests; any report fails the run.
  # `npm run test:native:san` configures native/build-san with this ON.
  option(PACHINBALL_SANITIZE "Build with -fsanitize=address,undefined (no recovery)" OFF)
  # Faster clean builds of the library (one TU per batch). Library only — the
  # test files each define their own helpers. compile-db forces it OFF: clangd
  # needs one entry per source file, not unity_*.cxx batches.
  option(PACHINBALL_UNITY_BUILD "Unity-build pachinball_physics_native (not the tests)" OFF)

  # Single-config generators leave CMAKE_BUILD_TYPE empty, which means no
  # CMAKE_CXX_FLAGS_<CONFIG> at all — no -O, no -g, and a compile_commands.json that
  # matches nothing anybody debugs. Default to Debug; callers override explicitly.
  get_property(_pachinball_multi_config GLOBAL PROPERTY GENERATOR_IS_MULTI_CONFIG)
  if(NOT _pachinball_multi_config AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Debug" CACHE STRING "Build type for the native Catch2 tree" FORCE)
    message(STATUS "PACHINBALL native: CMAKE_BUILD_TYPE unset, defaulting to Debug")
  endif()
  # GCC/Clang ship CMAKE_CXX_FLAGS_DEBUG as bare "-g" and lean on the compiler's
  # implicit -O0. Spell it out so compile_commands.json states the level clangd and
  # the sanitizer tree are actually building at.
  if(NOT CMAKE_CXX_FLAGS_DEBUG MATCHES "(^| )-O")
    string(APPEND CMAKE_CXX_FLAGS_DEBUG " -O0")
  endif()
  message(STATUS "PACHINBALL native: CMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE} TESTS=${PACHINBALL_BUILD_TESTS} SANITIZE=${PACHINBALL_SANITIZE}")

  add_library(pachinball_sanitize INTERFACE)
  if(PACHINBALL_SANITIZE)
    set(_pachinball_san_flags
      -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer)
    target_compile_options(pachinball_sanitize INTERFACE ${_pachinball_san_flags})
    target_link_options(pachinball_sanitize INTERFACE ${_pachinball_san_flags})
  endif()

  add_library(pachinball_physics_native STATIC ${PHYSICS_CORE_SOURCES})
  set_target_properties(pachinball_physics_native PROPERTIES UNITY_BUILD ${PACHINBALL_UNITY_BUILD})
  target_include_directories(pachinball_physics_native PUBLIC src)
  target_link_libraries(pachinball_physics_native
    PRIVATE pachinball_warnings pachinball_fp
    PUBLIC  pachinball_sanitize
  )
  # No -O here: CMAKE_CXX_FLAGS_<CONFIG> is the single source of the opt level.
  target_compile_options(pachinball_physics_native PRIVATE -fno-exceptions)

  if(NOT PACHINBALL_BUILD_TESTS)
    return()
  endif()

  include(CTest)
  enable_testing()

  # Pinned to the v3.7.1 commit (a tag can move; a SHA cannot). An installed
  # Catch2 3.x is used instead when find_package finds one — no network then.
  include(FetchContent)
  FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG        fa43b77429ba76c462b1898d6cd2f2d7a9416b14 # v3.7.1
    SYSTEM
    FIND_PACKAGE_ARGS 3
  )
  FetchContent_MakeAvailable(Catch2)

  add_executable(physics_world_test
    tests/physics_world_test.cpp
    tests/hinge_friction_test.cpp
    tests/kinematic_mover_test.cpp
    tests/sensor_volume_test.cpp
    tests/collision_filter_test.cpp
    tests/static_shapes_test.cpp
    tests/adventure_geometry_test.cpp
    tests/kinematic_body_test.cpp
    tests/cone_test.cpp
    tests/pin_field_test.cpp
    tests/snapshot_test.cpp
    tests/sleeper_contact_test.cpp
    tests/axis_pull_field_test.cpp
    tests/state_hash_test.cpp
    tests/golden_trace_test.cpp
  )
  # Catch2 requires C++ exceptions; do not pass -fno-exceptions here.
  target_link_libraries(physics_world_test PRIVATE
    pachinball_physics_native
    pachinball_warnings
    pachinball_fp
    Catch2::Catch2WithMain
  )

  # A fetched Catch2 puts its extras/ on CMAKE_MODULE_PATH; an installed one
  # ships Catch.cmake next to its package config instead.
  if(Catch2_DIR AND EXISTS "${Catch2_DIR}/Catch.cmake")
    include("${Catch2_DIR}/Catch.cmake")
  else()
    include(Catch)
  endif()
  catch_discover_tests(physics_world_test)
endif()
