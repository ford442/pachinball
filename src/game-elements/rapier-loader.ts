/**
 * The one runtime import of `@dimforge/rapier3d-compat` (#412).
 *
 * The production boot (`wasm-owner` / `wasm-worker`) never calls this: the C++
 * engine owns the table and adventure tracks and builders author through
 * `WASM_PHYSICS_API`. Rapier is fetched only for the explicit `rapier` /
 * `wasm-mirror` modes and for the fail-closed degrade when the C++ bundle is
 * missing, so its chunk stays out of the entry graph and the PWA precache.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'

let pending: Promise<typeof RAPIER> | null = null

export function loadRapier(): Promise<typeof RAPIER> {
  pending ??= (async () => {
    const rapier = await import('@dimforge/rapier3d-compat')
    try {
      await (rapier.init as unknown as () => Promise<void>)()
    } catch {
      // ESM test runners reject the export mutation init performs; the WASM is ready regardless.
    }
    return rapier
  })().catch((err: unknown) => {
    pending = null
    throw err
  })
  return pending
}
