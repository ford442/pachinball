/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The build's commit (`-dirty` with local changes); stamped into replays (#444). */
declare const __PACHINBALL_BUILD__: string

/**
 * SHA-256 (hex) of the `PhysicsModule.wasm` this build ships; null on the dev server and in a
 * Rapier-only build. Stamped into replays so the verifier picks the same binary (#490 Slice B).
 */
declare const __PACHINBALL_WASM_SHA256__: string | null
