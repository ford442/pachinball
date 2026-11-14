/** Types for `sim-bundle.mjs` (imported by vite.config.ts). */
export declare const SIM_ENTRY: string
export declare const SIM_BUNDLE: string
export declare function buildSimBundle(options: {
  outfile: string
  buildId?: string
  wasmSha256?: string | null
  env?: Record<string, unknown>
}): Promise<{ inputs: number; bytes: number | null }>
export declare function wasmModuleFactory(
  wasmDir: string,
  options?: { expectSha256?: string | null },
): Promise<{ sha256: string; moduleFactory: () => Promise<unknown> }>
export declare function loadSimBundle(file: string): Promise<(tape: unknown, options: unknown) => Promise<unknown>>
