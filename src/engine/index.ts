export {
  createEngine,
  isWebGPUEngine,
  resolveEngineCreationPlan,
  webgpuFeatureLevelsToTry,
  toWebGLEngineOptions,
  toWebGPUEngineOptions,
  attachGpuContextLogging,
  createWebGPUEngineWithFallback,
  GPU_DEGRADE_MARKER,
  type EngineCreationPlan,
  type WebGPUEngineLike,
  type WebGPUEngineFactory,
  type WebGPUCreationResult,
  type WebGPUFallbackDeps,
  type GpuLimitsProbe,
  type GpuContextLoggingDeps,
} from './create-engine'
export {
  MRT_REQUIRED_LIMITS,
  resolveRequiredLimits,
  probeGpuLimits,
  describeClampedLimits,
  type AdapterLike,
  type AdapterLimitsLike,
  type ClampedLimit,
  type GpuLike,
  type ProbeGpuLimitsOptions,
  type ResolvedGpuLimits,
} from './gpu-limits'
export {
  recordGpuDegrade,
  getGpuDegrades,
  countGpuDegrades,
  ensureGpuDegradeBuffer,
  resetGpuDegradesForTests,
  GPU_DEGRADE_RING_SIZE,
  GPU_DEGRADE_GLOBAL,
  type GpuDegradeEntry,
  type GpuDegradePath,
} from './gpu-degrade-telemetry'
export {
  GpuContextToast,
  GPU_CONTEXT_ATTRIBUTE,
  GPU_CONTEXT_TOAST_ID,
  GPU_CONTEXT_LOST_MESSAGE,
  GPU_CONTEXT_RESTORED_MESSAGE,
  type GpuContextState,
  type GpuContextToastDeps,
} from './gpu-context-toast'
export {
  applyHardwareScaling,
  resolveEngineOptions,
  resolveHardwareScalingLevel,
  shouldForceLowQualityMobile,
  isMobileUserAgent,
  type PowerPreference,
  type GpuFeatureLevel,
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
