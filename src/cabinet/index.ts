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

// Classic preset exports
export {
  CLASSIC_CONFIG,
  createClassicCabinet,
} from './cabinet-classic'

// Neo preset exports
export {
  NEO_CONFIG,
  createNeoCabinet,
} from './cabinet-neo'

// Vertical preset exports
export {
  VERTICAL_CONFIG,
  createVerticalCabinet,
} from './cabinet-vertical'

// Wide preset exports
export {
  WIDE_CONFIG,
  createWideCabinet,
} from './cabinet-wide'
