cmake_minimum_required(VERSION 3.20)
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

# ---------------------------------------------------------------------------
# Source files
# ---------------------------------------------------------------------------
set(PHYSICS_CORE_SOURCES
  src/RigidBody.cpp
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

  # web + worker: #361 can instantiate PhysicsModule.js on a Worker.
  # node: scripts/run-wasm-parity.mjs. Do not drop node.
  set(PACHINBALL_WASM_ENVIRONMENT "web,worker,node")
  set(PACHINBALL_WASM_INITIAL_MEMORY 16777216)

  message(STATUS "PACHINBALL WASM SIMD=${PACHINBALL_WASM_SIMD} LTO=${PACHINBALL_WASM_LTO} ENV=${PACHINBALL_WASM_ENVIRONMENT} INITIAL_MEMORY=${PACHINBALL_WASM_INITIAL_MEMORY}")

  add_executable(PhysicsModule
    ${PHYSICS_CORE_SOURCES}
    src/bindings.cpp
  )
  target_include_directories(PhysicsModule PRIVATE src)

  # Output as a proper ES module that can be imported directly by Vite
  set_target_properties(PhysicsModule PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  )

  target_link_options(PhysicsModule PRIVATE
    "-sEXPORT_ES6=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=PhysicsModule"
    "--bind"
    "-sENVIRONMENT=${PACHINBALL_WASM_ENVIRONMENT}"
    "-sFILESYSTEM=0"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sINITIAL_MEMORY=${PACHINBALL_WASM_INITIAL_MEMORY}"
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
  message(STATUS "PACHINBALL native: CMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}")

  add_library(pachinball_physics_native STATIC ${PHYSICS_CORE_SOURCES})
  target_include_directories(pachinball_physics_native PUBLIC src)
  # No -O here: CMAKE_CXX_FLAGS_<CONFIG> is the single source of the opt level.
  target_compile_options(pachinball_physics_native PRIVATE
    -Wall -Wextra -Werror
    -fno-exceptions
  )

  include(CTest)
  enable_testing()

  include(FetchContent)
  FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG        v3.7.1
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
  )
  target_link_libraries(physics_world_test PRIVATE
    pachinball_physics_native
    Catch2::Catch2WithMain
  )
  # Catch2 requires C++ exceptions; do not pass -fno-exceptions here.
  target_compile_options(physics_world_test PRIVATE
    -Wall -Wextra -Werror
  )

  include(Catch)
  catch_discover_tests(physics_world_test)
endif()
