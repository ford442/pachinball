/**
 * The compiled PhysicsModule bundle the Node-side suites load.
 *
 * public/wasm/ holds the shipped bundle, which is built with
 * ENVIRONMENT=web,worker and has no Node shims (#442), so it cannot be
 * instantiated here. Node loads the RelWithAsserts artefact that
 * `npm run build:wasm:assert` writes with ENVIRONMENT=web,worker,node.
 * WASM_MODULE_PATH (repo-relative) overrides it, as CI does.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WasmPhysicsModule } from '../../src/wasm/wasm-types'

export const WASM_TEST_BUNDLE = resolve(
  __dirname,
  '..',
  '..',
  process.env.WASM_MODULE_PATH ?? 'native/build-assert/PhysicsModule.js',
)

/** The bundle has been built (suites that run whenever it exists). */
export const hasWasmTestBundle = existsSync(WASM_TEST_BUNDLE)

/** RUN_WASM_PARITY=1 and the bundle exists (the opt-in parity suites). */
export const runWasmParity = process.env.RUN_WASM_PARITY === '1' && hasWasmTestBundle

/** A fresh module instance from the test bundle. */
export async function loadWasmTestModule(): Promise<WasmPhysicsModule> {
  const { default: factory } = (await import(/* @vite-ignore */ pathToFileURL(WASM_TEST_BUNDLE).href)) as {
    default: () => Promise<WasmPhysicsModule>
  }
  return factory()
}
