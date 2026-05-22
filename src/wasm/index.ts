/**
 * WASM Physics Engine — barrel export
 *
 * Public surface for the Emscripten-compiled C++ physics module.
 * Import from this barrel rather than the individual files.
 *
 * @example
 * import { WasmPhysicsEngine } from './wasm'
 */

export { WasmPhysicsEngine, type WasmBodyDesc } from './PhysicsModule'
export type {
  WasmContactEvent,
  WasmPhysicsModule,
  WasmPhysicsModuleFactory,
  WasmPhysicsWorldInstance,
} from './wasm-types'
