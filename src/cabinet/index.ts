/**
 * Cabinet Module - Barrel exports
 *
 * Provides a unified API for all cabinet-related functionality.
 * Each preset (classic, neo, vertical, wide) has its own implementation file.
 */

// Main orchestrator exports
export {
  CabinetBuilder,
  getCabinetBuilder,
  resetCabinetBuilder,
  CABINET_PRESETS,
  type CabinetType,
  type CabinetPreset,
  type LoadCabinetOptions,
} from './cabinet-builder'

// Type exports
export type {
  CabinetConfig,
  CabinetDimensions,
  CabinetPart,
  CabinetGltfConfig,
} from './cabinet-types'

export {
  pickCabinetGltfUrl,
  loadCabinetGltf,
  loadCabinetGltfForPreset,
  loadOptionalInsert,
  assertCabinetAlignment,
  splitAssetUrl,
} from './cabinet-gltf-loader'

export {
  loadInsertGltfForPreset,
  attachInsertMeshes,
  PRISM_CORE_INSERT_GLTF,
  MAG_SPIN_INSERT_GLTF,
  NANO_LOOM_INSERT_GLTF,
} from './insert-gltf-loader'

// Preset data. The procedural builders (`createClassicCabinet` etc.) are not
// re-exported: CabinetBuilder loads them on demand so they stay out of the
// entry chunk.
export {
  CLASSIC_CONFIG,
  NEO_CONFIG,
  VERTICAL_CONFIG,
  WIDE_CONFIG,
} from './cabinet-presets'
