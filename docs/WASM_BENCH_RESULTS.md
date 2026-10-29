# WASM Flag Microbench Results

Command: `npm run bench:wasm-flags` (50 spheres, warmup=30, timed=300 steps).
Each row is one run on a shared Linux build host, so treat sub-0.05 ms
differences as noise; compare rows within a table, not across tables.

## 2026-10-09 — emsdk 6.0.10 (`.emsdk-version` pin, #442 slice E)

Same sources as the pre-pin build (golden traces and parity fixture
unchanged), now with `-ffp-contract=off`, `-lembind` and the shared
`-Werror` policy.

| Combo | Flags | mean ms | p50 ms | p95 ms | .wasm KiB |
|-------|-------|---------|--------|--------|-----------|
| A Baseline | Release + always-on size/env | 0.2906 | 0.2680 | 0.3671 | 147.5 |
| B +SIMD | A + -msimd128 | 0.2754 | 0.2654 | 0.3707 | 146.9 |
| C +SIMD+LTO | B + -flto | 0.2449 | 0.2157 | 0.3005 | 164.8 |

SIMD ≈ baseline is expected: `BodyStore` is SoA but its loops still go
through `view(i).integrate()` one body at a time, so `-msimd128` has nothing
to vectorise across bodies yet (#442 slice C). Combo C stays the production
path.

## 2026-08-14 — native toolchain repair (emsdk unpinned)

| Combo | Flags | mean ms | p50 ms | p95 ms | .wasm KiB |
|-------|-------|---------|--------|--------|-----------|
| A Baseline | Release + always-on size/env | 0.8178 | 0.2211 | 1.7659 | 57.2 |
| B +SIMD | A + -msimd128 | 0.2557 | 0.2378 | 0.4040 | 57.9 |
| C +SIMD+LTO | B + -flto | 0.3160 | 0.1876 | 0.4975 | 59.1 |

## Decisions applied

- **Release `-O3`** (was `-O2`)
- **`-sMALLOC=emmalloc`** — smaller allocator footprint
- **`--closure=1`** — JS glue minification (parity-validated)
- **`EXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU32"]`** only — dropped unused addFunction/string helpers
- **SIMD + LTO ON by default** in `build-wasm.sh` (combo C production path)
- **`INITIAL_MEMORY=16777216`** (16 MB, with `ALLOW_MEMORY_GROWTH=1`)
- **emsdk pinned** in `.emsdk-version` (2026-10-09: 6.0.10)

The production `.wasm` has grown with the engine since the 2026-08-14 pass
(statics, pin fields, snapshots): 168,782 bytes on 2026-10-09.
