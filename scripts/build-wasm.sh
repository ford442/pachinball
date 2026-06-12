#!/usr/bin/env bash
# =============================================================================
# build-wasm.sh — Compile the Pachinball C++ physics engine to WebAssembly
#                 using Emscripten.
#
# Prerequisites
# ─────────────
#   1. Emscripten SDK installed and activated:
#        source /path/to/emsdk/emsdk_env.sh
#   2. CMake ≥ 3.20 in PATH.
#
# Usage
# ─────
#   ./scripts/build-wasm.sh              # release build
#   ./scripts/build-wasm.sh --debug      # debug build (no optimisation, assertions)
#   ./scripts/build-wasm.sh --clean      # delete build dir then rebuild
#
# Output
# ──────
#   native/build/PhysicsModule.js   — Emscripten ES module loader
#   native/build/PhysicsModule.wasm — Binary WASM payload
#
# These files are copied to public/wasm/ so that Vite can serve them as
# static assets and the TypeScript wrapper can import them at runtime.
# =============================================================================

set -euo pipefail

# Optional: source a Colab-specific Emscripten install if present.
for f in /content/build*/emsdk/emsdk_env.sh /root/emsdk/emsdk_env.sh; do
    if [ -f "$f" ]; then
        source "$f"
        break
    fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NATIVE_DIR="${REPO_ROOT}/native"
BUILD_DIR="${NATIVE_DIR}/build"
PUBLIC_WASM_DIR="${REPO_ROOT}/public/wasm"

BUILD_TYPE="Release"

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --debug) BUILD_TYPE="Debug" ;;
    --clean) rm -rf "${BUILD_DIR}" && echo "[build-wasm] Build directory cleaned." ;;
    *)       echo "Unknown flag: $arg" && exit 1 ;;
  esac
done

echo "[build-wasm] Build type: ${BUILD_TYPE}"

# ---------------------------------------------------------------------------
# Check Emscripten
# ---------------------------------------------------------------------------
if ! command -v emcmake &>/dev/null; then
  echo "[build:wasm] Emscripten not found — skipping WASM compile (source emsdk_env.sh first)."
  exit 0
fi

EMSCRIPTEN_VERSION=$(emcc --version 2>&1 | head -1)
echo "[build-wasm] Using: ${EMSCRIPTEN_VERSION}"

# ---------------------------------------------------------------------------
# Configure + build via CMake
# ---------------------------------------------------------------------------
mkdir -p "${BUILD_DIR}"

echo "[build-wasm] Configuring..."
emcmake cmake \
  -S "${NATIVE_DIR}" \
  -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE="${BUILD_TYPE}"

echo "[build-wasm] Building..."
cmake --build "${BUILD_DIR}" --config "${BUILD_TYPE}" -- -j"$(nproc 2>/dev/null || echo 4)"

# ---------------------------------------------------------------------------
# Copy artefacts to public/wasm/ so Vite serves them as static assets
# ---------------------------------------------------------------------------
mkdir -p "${PUBLIC_WASM_DIR}"
cp "${BUILD_DIR}/PhysicsModule.js"   "${PUBLIC_WASM_DIR}/"
cp "${BUILD_DIR}/PhysicsModule.wasm" "${PUBLIC_WASM_DIR}/"

echo ""
echo "[build-wasm] ✔ Done!"
echo "  ${PUBLIC_WASM_DIR}/PhysicsModule.js"
echo "  ${PUBLIC_WASM_DIR}/PhysicsModule.wasm"
echo ""
echo "  Import in TypeScript:"
echo "    import { WasmPhysicsEngine } from './src/wasm'"
echo "    const engine = new WasmPhysicsEngine()"
echo "    await engine.load('./wasm/PhysicsModule.js')"
