/**
 * WASM Physics Engine — barrel export
 *
 * Public surface for the Emscripten-compiled C++ physics module.
 * Import from this barrel rather than the individual files.
 *
 * @example
 * import { WasmPhysicsEngine } from './wasm'
 */

export { WasmPhysicsEngine, type WasmBodyDesc, type WasmHingeDesc } from './PhysicsModule'
export type { WasmSimEngine } from './wasm-sim-engine'
export {
  PhysicsWorkerClient,
  createPhysicsWorker,
  warmPhysicsWorker,
  consumePrewarmedPhysicsWorker,
  resetPhysicsWorkerPrewarmForTests,
} from './physics-worker-client'
export {
  WasmIdShadow,
  STATIC_BOX_ID_BASE,
  STATIC_CAPSULE_ID_BASE,
  HINGE_ANGLE_STRIDE,
  cloneFloat32Array,
  encodeHingeAngleBuffer,
  decodeHingeAngle,
  type PhysicsWorkerCommand,
  type PhysicsWorkerFromWorker,
  type PhysicsWorkerToWorker,
  type PhysicsWorkerStepResult,
} from './physics-worker-protocol'
export {
  applyPhysicsCommand,
  collectStepSnapshot,
  createWorkerRuntimeState,
} from './physics-worker-runtime'
export {
  ContactPhase,
  CONTACT_STRIDE,
  decodeContactBuffer,
  encodeContactBuffer,
  contactStarted,
  toWasmContactEvent,
} from './contact-buffer'
export {
  TRANSFORM_STRIDE,
  decodeTransformSlot,
  encodeTransformBuffer,
  createTransformBufferView,
  type WasmTransform,
} from './transform-buffer'
export type {
  PhysicsContact,
  WasmContactEvent,
  WasmPhysicsModule,
  WasmPhysicsModuleFactory,
  WasmPhysicsWorldInstance,
} from './wasm-types'
