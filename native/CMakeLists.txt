cmake_minimum_required(VERSION 3.20)
project(pachinball_physics LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Source files
# ---------------------------------------------------------------------------
set(PHYSICS_CORE_SOURCES
  src/RigidBody.cpp
  src/PhysicsWorld.cpp
)

# ---------------------------------------------------------------------------
# Emscripten WASM module
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
add_executable(PhysicsModule
  ${PHYSICS_CORE_SOURCES}
  src/bindings.cpp
)
target_include_directories(PhysicsModule PRIVATE src)
  # Output as a proper ES module that can be imported directly by Vite
  set_target_properties(PhysicsModule PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/build"
  )

  target_link_options(PhysicsModule PRIVATE
    # Produce an ES module (import PhysicsModuleFactory from './PhysicsModule.js')
    "-sEXPORT_ES6=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=PhysicsModule"

    # Enable Embind bindings
    "--bind"

    # Allow heap to grow at runtime (ball swarms can be large)
    "-sALLOW_MEMORY_GROWTH=1"

    # Initial heap size — 32 MB is more than enough for the initial prototype
    "-sINITIAL_MEMORY=33554432"

    # Export the helper functions used by the JS wrapper
    "-sEXPORTED_RUNTIME_METHODS=[\"addFunction\",\"removeFunction\",\"UTF8ToString\",\"stringToUTF8\"]"
  )

  # Optimisation flags follow CMAKE_BUILD_TYPE so --debug builds work correctly.
  target_compile_options(PhysicsModule PRIVATE
    "$<$<CONFIG:Debug>:-O0;-g>"
    "$<$<CONFIG:Release>:-O2>"
  )
  target_link_options(PhysicsModule PRIVATE
    "$<$<CONFIG:Debug>:-O0;-sASSERTIONS=2>"
    "$<$<CONFIG:Release>:-O2;-sASSERTIONS=0>"
  )
endif()

# ---------------------------------------------------------------------------
# Native (non-Emscripten) build — used for unit-testing the C++ logic with
# a standard compiler (Catch2, GoogleTest, etc.).
# ---------------------------------------------------------------------------
if(NOT EMSCRIPTEN)
  add_library(pachinball_physics_native STATIC ${PHYSICS_CORE_SOURCES})
  target_include_directories(pachinball_physics_native PUBLIC src)
  target_compile_options(pachinball_physics_native PRIVATE -Wall -Wextra -O2)

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
  target_compile_options(physics_world_test PRIVATE -Wall -Wextra -O2)

  include(Catch)
  catch_discover_tests(physics_world_test)
endif()
