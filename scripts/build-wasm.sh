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
#   ./scripts/build-wasm.sh              # Release → public/wasm/ (production)
#   ./scripts/build-wasm.sh --debug      # Debug (+ source maps)
#   ./scripts/build-wasm.sh --assert     # RelWithAsserts → native/build-assert/
#   ./scripts/build-wasm.sh --clean      # delete active build dir then rebuild
#   ./scripts/build-wasm.sh --bench-matrix  # A/B/C flag combos → native/build-bench/
#   ./scripts/build-wasm.sh --simd       # enable -msimd128
#   ./scripts/build-wasm.sh --lto        # enable -flto
#
# Env overrides
# ─────────────
#   PACHINBALL_WASM_SIMD=ON|OFF
#   PACHINBALL_WASM_LTO=ON|OFF
#   WASM_INSTALL_ASSERT=1   # also copy RelWithAsserts artefacts to public/wasm/
#
# Output
# ──────
#   native/build/PhysicsModule.js   — Emscripten ES module loader (Release/Debug)
#   native/build/PhysicsModule.wasm — Binary WASM payload
#   native/build-assert/…           — RelWithAsserts (does not overwrite public/wasm)
#   native/build-bench/{baseline,simd,simd-lto}/ — benchmark matrix
# =============================================================================

set -euo pipefail

# Optional: source a Colab-specific Emscripten install if present.
for f in /content/build*/emsdk/emsdk_env.sh /root/emsdk/emsdk_env.sh; do
    if [ -f "$f" ]; then
        # shellcheck disable=SC1090
        source "$f"
        break
    fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NATIVE_DIR="${REPO_ROOT}/native"
PUBLIC_WASM_DIR="${REPO_ROOT}/public/wasm"

BUILD_TYPE="Release"
BUILD_DIR="${NATIVE_DIR}/build"
INSTALL_TO_PUBLIC=1
DO_CLEAN=0
DO_BENCH_MATRIX=0
WASM_SIMD="${PACHINBALL_WASM_SIMD:-OFF}"
WASM_LTO="${PACHINBALL_WASM_LTO:-OFF}"

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --debug)
      BUILD_TYPE="Debug"
      BUILD_DIR="${NATIVE_DIR}/build"
      INSTALL_TO_PUBLIC=1
      ;;
    --assert)
      BUILD_TYPE="RelWithAsserts"
      BUILD_DIR="${NATIVE_DIR}/build-assert"
      # Do not overwrite production public/wasm unless explicitly requested
      if [[ "${WASM_INSTALL_ASSERT:-0}" == "1" ]]; then
        INSTALL_TO_PUBLIC=1
      else
        INSTALL_TO_PUBLIC=0
      fi
      ;;
    --clean)
      DO_CLEAN=1
      ;;
    --bench-matrix)
      DO_BENCH_MATRIX=1
      ;;
    --simd)
      WASM_SIMD="ON"
      ;;
    --lto)
      WASM_LTO="ON"
      ;;
    --no-simd)
      WASM_SIMD="OFF"
      ;;
    --no-lto)
      WASM_LTO="OFF"
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Usage: $0 [--debug|--assert|--bench-matrix] [--clean] [--simd|--lto|--no-simd|--no-lto]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Check Emscripten
# ---------------------------------------------------------------------------
if ! command -v emcmake &>/dev/null; then
  echo "[build:wasm] Emscripten not found — skipping WASM compile (source emsdk_env.sh first)."
  exit 0
fi

EMSCRIPTEN_VERSION=$(emcc --version 2>&1 | head -1)
echo "[build-wasm] Using: ${EMSCRIPTEN_VERSION}"

JOBS="$(nproc 2>/dev/null || echo 4)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
configure_and_build() {
  local build_dir="$1"
  local build_type="$2"
  local simd="$3"
  local lto="$4"

  if [[ "${DO_CLEAN}" -eq 1 ]]; then
    rm -rf "${build_dir}"
    echo "[build-wasm] Cleaned ${build_dir}"
  fi

  mkdir -p "${build_dir}"
  echo "[build-wasm] Configuring (${build_type}, SIMD=${simd}, LTO=${lto}) → ${build_dir}"
  emcmake cmake \
    -S "${NATIVE_DIR}" \
    -B "${build_dir}" \
    -DCMAKE_BUILD_TYPE="${build_type}" \
    -DPACHINBALL_WASM_SIMD="${simd}" \
    -DPACHINBALL_WASM_LTO="${lto}"

  echo "[build-wasm] Building..."
  cmake --build "${build_dir}" --config "${build_type}" -- -j"${JOBS}"
}

install_artefacts() {
  local build_dir="$1"
  local dest_dir="$2"
  local copy_maps="$3"

  mkdir -p "${dest_dir}"

  # When build_dir == dest_dir (bench matrix), artefacts are already in place.
  if [[ "$(cd "${build_dir}" && pwd)" != "$(cd "${dest_dir}" && pwd)" ]]; then
    cp "${build_dir}/PhysicsModule.js"   "${dest_dir}/"
    cp "${build_dir}/PhysicsModule.wasm" "${dest_dir}/"
  fi

  # Remove stale maps from destination on non-debug installs
  if [[ "${copy_maps}" -eq 1 ]]; then
    # Emscripten may emit PhysicsModule.wasm.map and/or PhysicsModule.js.map
    shopt -s nullglob
    for map in "${build_dir}"/PhysicsModule*.map; do
      if [[ "$(cd "${build_dir}" && pwd)" != "$(cd "${dest_dir}" && pwd)" ]]; then
        cp "${map}" "${dest_dir}/"
      fi
    done
    shopt -u nullglob
  else
    rm -f "${dest_dir}/PhysicsModule.wasm.map" "${dest_dir}/PhysicsModule.js.map" \
          "${dest_dir}/PhysicsModule.map"
  fi

  echo "[build-wasm] Installed to ${dest_dir}"
  ls -la "${dest_dir}/PhysicsModule.js" "${dest_dir}/PhysicsModule.wasm" || true
}

# ---------------------------------------------------------------------------
# Benchmark matrix: baseline / simd / simd-lto (never touches public/wasm)
# ---------------------------------------------------------------------------
if [[ "${DO_BENCH_MATRIX}" -eq 1 ]]; then
  BENCH_ROOT="${NATIVE_DIR}/build-bench"
  echo "[build-wasm] Building flag matrix into ${BENCH_ROOT}"

  # A — Release baseline (always-on size/env flags from CMakeLists)
  configure_and_build "${BENCH_ROOT}/baseline" "Release" "OFF" "OFF"
  install_artefacts "${BENCH_ROOT}/baseline" "${BENCH_ROOT}/baseline" 0

  # B — +SIMD
  configure_and_build "${BENCH_ROOT}/simd" "Release" "ON" "OFF"
  install_artefacts "${BENCH_ROOT}/simd" "${BENCH_ROOT}/simd" 0

  # C — +SIMD+LTO
  configure_and_build "${BENCH_ROOT}/simd-lto" "Release" "ON" "ON"
  install_artefacts "${BENCH_ROOT}/simd-lto" "${BENCH_ROOT}/simd-lto" 0

  echo ""
  echo "[build-wasm] ✔ Bench matrix ready. Run:"
  echo "  node scripts/bench-wasm-flags.mjs"
  exit 0
fi

# ---------------------------------------------------------------------------
# Single-config build
# ---------------------------------------------------------------------------
echo "[build-wasm] Build type: ${BUILD_TYPE} (SIMD=${WASM_SIMD}, LTO=${WASM_LTO})"
configure_and_build "${BUILD_DIR}" "${BUILD_TYPE}" "${WASM_SIMD}" "${WASM_LTO}"

COPY_MAPS=0
if [[ "${BUILD_TYPE}" == "Debug" ]]; then
  COPY_MAPS=1
fi

if [[ "${INSTALL_TO_PUBLIC}" -eq 1 ]]; then
  install_artefacts "${BUILD_DIR}" "${PUBLIC_WASM_DIR}" "${COPY_MAPS}"
else
  echo "[build-wasm] Skipping public/wasm install (assert artefact at ${BUILD_DIR})"
  ls -la "${BUILD_DIR}/PhysicsModule.js" "${BUILD_DIR}/PhysicsModule.wasm" || true
fi

echo ""
echo "[build-wasm] ✔ Done!"
if [[ "${INSTALL_TO_PUBLIC}" -eq 1 ]]; then
  echo "  ${PUBLIC_WASM_DIR}/PhysicsModule.js"
  echo "  ${PUBLIC_WASM_DIR}/PhysicsModule.wasm"
else
  echo "  ${BUILD_DIR}/PhysicsModule.js"
  echo "  ${BUILD_DIR}/PhysicsModule.wasm"
fi
echo ""
echo "  Import in TypeScript:"
echo "    import { WasmPhysicsEngine } from './src/wasm'"
echo "    const engine = new WasmPhysicsEngine()"
echo "    await engine.load('./wasm/PhysicsModule.js')"
