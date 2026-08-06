#!/usr/bin/env bash
# =============================================================================
# build-wasm-colab.sh — Colab-oriented wrapper around build-wasm.sh
#
# Prefer scripts/build-wasm.sh for full flag support (--assert, --simd, etc.).
# This script keeps the Colab-friendly emsdk discovery path and delegates
# to the main builder so flag matrices stay in sync.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Optional: source a Colab-specific Emscripten install if present.
for f in /content/build*/emsdk/emsdk_env.sh /root/emsdk/emsdk_env.sh; do
    if [ -f "$f" ]; then
        # shellcheck disable=SC1090
        source "$f"
        break
    fi
done

exec bash "${SCRIPT_DIR}/build-wasm.sh" "$@"
