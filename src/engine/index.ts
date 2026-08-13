export {
  createEngine,
  isWebGPUEngine,
  resolveEngineCreationPlan,
  type EngineCreationPlan,
} from './create-engine'
export {
  applyHardwareScaling,
  resolveEngineOptions,
  resolveHardwareScalingLevel,
  shouldForceLowQualityMobile,
  isMobileUserAgent,
  type PowerPreference,
  type ResolvedEngineOptions,
  type EngineOptionsContext,
  type MobileQualityHints,
} from './engine-options'
export {
  scheduleIdleWasmPreload,
  getPreloadedWasmModule,
  resetWasmPreloadForTests,
} from './wasm-idle-preload'
export { VisibilityManager, type VisibilityManagerDeps } from './visibility-manager'
