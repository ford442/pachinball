cmake_minimum_required(VERSION 3.20)
project(pachinball_physics LANGUAGES CXX)

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
  src/PhysicsWorld.cpp
)

# ---------------------------------------------------------------------------
# Emscripten WASM module
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
  # SoA integration + broadphase loops vectorize under -msimd128; bench justifies ON.
  option(PACHINBALL_WASM_SIMD "Enable WASM SIMD auto-vectorization (-msimd128)" ON)
  option(PACHINBALL_WASM_LTO  "Enable link-time optimization (-flto)" ON)

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
    # Produce an ES module (import PhysicsModuleFactory from './PhysicsModule.js')
    "-sEXPORT_ES6=1"
    # Wrap the module in a factory so callers await PhysicsModule()
    "-sMODULARIZE=1"
    # Global/factory export name expected by src/wasm/PhysicsModule.ts
    "-sEXPORT_NAME=PhysicsModule"

    # Enable Embind bindings (native/src/bindings.cpp)
    "--bind"

    # Browser + Node only — keeps Node parity harness working; excludes shell/worker
    "-sENVIRONMENT=web,node"
    # No fopen/FS usage in the physics module — shrinks the JS glue
    "-sFILESYSTEM=0"

    # Allow heap to grow at runtime (ball swarms can be large)
    "-sALLOW_MEMORY_GROWTH=1"
    # Initial heap — 16 MB covers table + adventure; grows if needed
    "-sINITIAL_MEMORY=16777216"
    # Smaller allocator — module does little dynamic allocation after setup
    "-sMALLOC=emmalloc"

    # Contact buffer HEAP view for JS wrapper
    "-sEXPORTED_RUNTIME_METHODS=[\"HEAPF32\"]"

    # Shrink JS glue (parity harness validates embind + modularize)
    "--closure=1"
  )

  # No C++ exceptions in native/src — drop EH runtime for smaller binaries
  target_compile_options(PhysicsModule PRIVATE "-fno-exceptions")
  target_link_options(PhysicsModule PRIVATE "-fno-exceptions")

  # Opt-in SIMD (auto-vectorize only; no hand wasm_simd128 intrinsics yet)
  if(PACHINBALL_WASM_SIMD)
    target_compile_options(PhysicsModule PRIVATE "-msimd128")
    target_link_options(PhysicsModule PRIVATE "-msimd128")
  endif()

  # Opt-in LTO — apply to both compile and link
  if(PACHINBALL_WASM_LTO)
    target_compile_options(PhysicsModule PRIVATE "-flto")
    target_link_options(PhysicsModule PRIVATE "-flto")
  endif()

  # Optimisation / assertions follow CMAKE_BUILD_TYPE:
  #   Debug          — -O0 -g -gsource-map, ASSERTIONS=2
  #   Release        — -O3, ASSERTIONS=0  (production default)
  #   RelWithAsserts — -O3, ASSERTIONS=1  (CI parity without full debug)
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
# Native (non-Emscripten) build — used for unit-testing the C++ logic with
# a standard compiler (Catch2, GoogleTest, etc.).
# ---------------------------------------------------------------------------
if(NOT EMSCRIPTEN)
  add_library(pachinball_physics_native STATIC ${PHYSICS_CORE_SOURCES})
  target_include_directories(pachinball_physics_native PUBLIC src)
  target_compile_options(pachinball_physics_native PRIVATE -Wall -Wextra -Werror -O2)

  include(CTest)
  enable_testing()

  include(FetchContent)
  FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG        v3.7.1
  )
  FetchContent_MakeAvailable(Catch2)

  add_executable(physics_world_test tests/physics_world_test.cpp)
  target_link_libraries(physics_world_test PRIVATE
    pachinball_physics_native
    Catch2::Catch2WithMain
  )
  target_compile_options(physics_world_test PRIVATE -Wall -Wextra -Werror -O2)

  include(Catch)
  catch_discover_tests(physics_world_test)
endif()
