import { getWasmPhysicsRuntimeMode, runtimeModeUsesRapier } from '../config'
import { preloadWasmPhysicsNow } from '../engine/wasm-idle-preload'
import { PhysicsSystem } from './physics'
import { loadRapier } from './rapier-loader'

/**
 * Start the physics download in parallel with engine creation and hand back the
 * `PhysicsSystem` that will consume it, so the orchestrator (`main.ts`, `Game`)
 * never has to know which engine is behind it.
 *
 * The production modes (`wasm-owner` / `wasm-worker`) fetch and compile only
 * the C++ bundle; Rapier is never imported on that path (#412), and
 * `PhysicsSystem.init()` loads it lazily if the bundle turns out to be
 * missing. The explicit `rapier` / `wasm-mirror` modes still warm Rapier here.
 */
export async function preloadPhysicsSystem(): Promise<PhysicsSystem> {
  if (runtimeModeUsesRapier(getWasmPhysicsRuntimeMode())) {
    return new PhysicsSystem(await loadRapier())
  }
  preloadWasmPhysicsNow()
  return new PhysicsSystem()
}
