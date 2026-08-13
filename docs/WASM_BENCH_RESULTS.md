# WASM Flag Microbench Results

Generated during native toolchain repair (2026-08-14).

Command: `npm run bench:wasm-flags` (50 spheres, warmup=30, timed=300 steps)

| Combo | Flags | mean ms | p50 ms | p95 ms | .wasm KiB |
|-------|-------|---------|--------|--------|-----------|
| A Baseline | Release + always-on size/env | 0.8178 | 0.2211 | 1.7659 | 57.2 |
| B +SIMD | A + -msimd128 | 0.2557 | 0.2378 | 0.4040 | 57.9 |
| C +SIMD+LTO | B + -flto | 0.3160 | 0.1876 | 0.4975 | 59.1 |

## Decisions applied

- **Release `-O3`** (was `-O2`)
- **`-sMALLOC=emmalloc`** — smaller allocator footprint
- **`--closure=1`** — JS glue minification (parity-validated)
- **`EXPORTED_RUNTIME_METHODS=["HEAPF32"]`** only — dropped unused addFunction/string helpers
- **SIMD + LTO ON by default** in `build-wasm.sh` (combo C production path)
- **`INITIAL_MEMORY=16777216`** (16 MB, with `ALLOW_MEMORY_GROWTH=1`)

Production Release artefact after full flag pass: **60,569 bytes** `.wasm`.
